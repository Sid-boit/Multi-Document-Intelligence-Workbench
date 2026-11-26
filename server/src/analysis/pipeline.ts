import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import {
  AnalysisResult,
  LlmDocExtraction,
  LlmPlan,
  LlmSynthesis,
  type AnalysisPlan,
  type ComparisonRow,
  type Evidence,
  type Finding,
  type PlanAttribute,
} from '@workbench/shared';
import type { Config } from '../config.js';
import type { Repo } from '../db/repo.js';
import { LlmInvalidOutputError, LlmUnavailableError, type GenerateRequest, type LlmProvider } from '../llm/provider.js';
import type { ChunkRecord, LoadedDocument } from '../types.js';
import { checkExpiry, compareAttribute, type AttributeCell } from './compare.js';
import { deterministicExtract, labelledForAnotherAttribute, matchFactScored } from './deterministic.js';
import { normalizeLabel } from './normalize.js';
import { extractPrompt, planPrompt, PROMPT_VERSION, synthesisPrompt, type SynthesisInput } from './prompts.js';
import { applySynthesis, fallbackSummary } from './synthesise.js';
import { ATTRIBUTE_LIBRARY, enrichAttribute, fallbackPlan, findTemplateId, templatePlan } from './templates.js';
import { EvidenceRegistry, literalValue, verifyCandidate, type VerifiedLocation } from './verify.js';

const MAX_OBSERVATIONS_PER_DOC = 5;

export interface PipelineDeps {
  repo: Repo;
  llm: LlmProvider;
  config: Config;
  now?: () => Date;
}

/**
 * Orchestrates one analysis:
 *   plan → per-document extraction (map, documents in isolation) → verify quotes →
 *   deterministic compare → synthesis citing evidence handles only (reduce) → assemble.
 * Every stage is persisted; failures of the model degrade to rule-based output with a
 * warning instead of failing the whole analysis.
 */
export async function runAnalysis(deps: PipelineDeps, analysisId: string): Promise<void> {
  const { repo } = deps;
  try {
    await execute(deps, analysisId);
  } catch (err) {
    console.error(`[analysis ${analysisId}] failed`, err);
    const message =
      err instanceof LlmUnavailableError || err instanceof LlmInvalidOutputError
        ? err.message
        : 'The analysis failed unexpectedly. Please try again.';
    repo.failAnalysis(analysisId, message);
  }
}

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function execute(deps: PipelineDeps, analysisId: string): Promise<void> {
  const { repo, llm, config } = deps;
  const started = Date.now();
  const analysis = repo.getAnalysis(analysisId);
  if (!analysis) throw new Error(`Analysis ${analysisId} not found`);

  const docs: LoadedDocument[] = repo.getAnalysisDocuments(analysisId).map((d) => {
    const doc = repo.getDocument(d.documentId);
    if (!doc) throw new Error(`Document ${d.documentId} missing`);
    return { doc, alias: d.alias, pages: repo.getPages(doc.id), chunks: repo.getChunks(doc.id), facts: repo.getFacts(doc.id) };
  });
  const warnings: string[] = docs.flatMap((d) => d.doc.warnings.map((w) => `${d.alias} (${d.doc.displayName}): ${w}`));
  let ids = 0;
  const nextId = () => `F${++ids}`;

  const cachedGenerate = async <T>(req: GenerateRequest<T>, keyParts: unknown[]): Promise<T> => {
    const cacheKey = sha([req.stage, llm.name, llm.model, PROMPT_VERSION, ...keyParts]);
    if (llm.name !== 'mock') {
      const cached = repo.getCachedLlmOutput(cacheKey);
      const parsed = cached === undefined ? null : req.schema.safeParse(cached);
      if (parsed?.success) return parsed.data;
    }
    const t0 = Date.now();
    try {
      const out = await llm.generate(req);
      repo.recordLlmCall({ analysisId, stage: req.stage, provider: llm.name, model: llm.model, cacheKey, durationMs: Date.now() - t0, outcome: 'ok', output: out });
      return out;
    } catch (err) {
      const outcome = err instanceof LlmUnavailableError ? 'unavailable' : err instanceof LlmInvalidOutputError ? 'invalid_output' : 'error';
      repo.recordLlmCall({ analysisId, stage: req.stage, provider: llm.name, model: llm.model, cacheKey, durationMs: Date.now() - t0, outcome, output: undefined });
      throw err;
    }
  };

  /* 1. Plan ------------------------------------------------------------------------ */
  repo.setAnalysisStatus(analysisId, 'planning');
  const templateId = findTemplateId(analysis.instruction, analysis.templateId);
  let plan: AnalysisPlan;
  if (templateId) {
    plan = templatePlan(templateId)!;
  } else {
    try {
      const prompt = planPrompt(
        analysis.instruction,
        docs.map((d) => ({ alias: d.alias, name: d.doc.displayName, preview: d.pages.map((p) => p.text).join('\n').slice(0, 800) })),
      );
      const llmPlan = await cachedGenerate({ stage: 'plan', ...prompt, schema: LlmPlan, context: { instruction: analysis.instruction } }, [
        analysis.instruction,
        docs.map((d) => d.doc.sha256),
      ]);
      plan = sanitizePlan(llmPlan);
    } catch (err) {
      warnings.push(`The AI could not build an analysis plan (${errMessage(err)}); a general comparison plan was used.`);
      plan = fallbackPlan();
    }
  }
  repo.setAnalysisPlan(analysisId, plan);

  /* 2. Map: each document analysed in isolation ----------------------------------- */
  repo.setAnalysisStatus(analysisId, 'extracting');
  const limit = pLimit(config.LLM_CONCURRENCY);
  const planHash = sha(plan.attributes.map((a) => [a.key, a.valueType]));
  const extractions = await Promise.all(
    docs.map((d) =>
      limit(async () => {
        repo.setDocumentProgress(analysisId, d.doc.id, 'running');
        const windows = windowChunks(d.chunks, config.MAP_CHAR_BUDGET);
        const parts: { out: LlmDocExtraction; source: Evidence['source'] }[] = [];
        let usedFallback = false;
        for (const [i, chunks] of windows.entries()) {
          const chunkIds = new Set(chunks.map((c) => c.id));
          const facts = d.facts.filter((f) => chunkIds.has(f.chunkId));
          const refById = new Map(chunks.map((c) => [c.id, c.ref]));
          try {
            const prompt = extractPrompt({
              instruction: analysis.instruction,
              attributes: plan.attributes,
              alias: d.alias,
              name: d.doc.displayName,
              chunks,
              hints: facts
                .filter((f) => f.type !== 'blank_field')
                .map((f) => ({ label: f.label, value: f.rawValue, chunkRef: refById.get(f.chunkId) ?? '' })),
            });
            const out = await cachedGenerate(
              { stage: 'extract', ...prompt, schema: LlmDocExtraction, context: { attributes: plan.attributes, document: { chunks, facts } } },
              [d.doc.sha256, i, planHash, analysis.instruction],
            );
            parts.push({ out, source: llm.name === 'mock' ? 'deterministic' : 'llm' });
          } catch (err) {
            usedFallback = true;
            warnings.push(`${d.alias} (${d.doc.displayName}): AI extraction failed (${errMessage(err)}); rule-based extraction was used instead.`);
            parts.push({ out: deterministicExtract(plan.attributes, { chunks, facts }), source: 'deterministic' });
          }
        }
        repo.setDocumentProgress(analysisId, d.doc.id, usedFallback ? 'fallback' : 'done');
        return { d, parts };
      }),
    ),
  );

  /* 3. Verify: locate every quote in the source text ------------------------------- */
  const registry = new EvidenceRegistry();
  const labelUniverse = [...plan.attributes, ...Object.values(ATTRIBUTE_LIBRARY)];
  const cellsByAttr = new Map<string, AttributeCell[]>(plan.attributes.map((a) => [a.key, []]));
  const keyValues: Finding[] = [];
  const perDocument: { documentId: string; findings: Finding[] }[] = [];
  const observationsForSynthesis: SynthesisInput['observations'] = [];

  for (const { d, parts } of extractions) {
    const docFindings: Finding[] = [];
    const evBase = { documentId: d.doc.id, documentName: d.doc.displayName, alias: d.alias };

    const pageText = (n: number) => d.pages.find((p) => p.pageNo === n)?.text ?? '';
    for (const attr of plan.attributes) {
      // Hybrid selection. Model candidates are verified against the text and rejected if
      // their location is a form field labelled for a different attribute. An exact
      // label match found by the rule-based parser is the most reliable source and wins;
      // otherwise the best verified model answer is used; the rule-based partial match
      // fills gaps the model missed.
      type Choice = { value: string; loc: VerifiedLocation; source: Evidence['source'] };
      const llmChoices: Choice[] = [];
      for (const { out, source } of parts) {
        for (const v of out.values) {
          if (v.attribute !== attr.key || v.status !== 'found' || !v.value?.trim()) continue;
          const loc = verifyCandidate({ quote: v.quote, value: v.value, chunkRef: v.chunkRef }, d);
          const value = loc.verification === 'unverified' ? v.value.trim() : literalValue(loc.quote, v.value.trim());
          if (loc.charStart !== null && loc.charEnd !== null) {
            // Check the field label at the *value's* position, not the whole quote (a quoted
            // CSV row or form line can span several labelled fields).
            const span = valueSpan(pageText(loc.pageNo), loc.charStart, loc.charEnd, value);
            const other = labelledForAnotherAttribute(attr, d.facts, loc.pageNo, span.start, span.end, labelUniverse);
            if (other) {
              warnings.push(`${d.alias}: the AI reported "${v.value}" as ${attr.label.toLowerCase()}, but the document labels it "${other}"; it was ignored.`);
              continue;
            }
          }
          llmChoices.push({ value, loc, source });
        }
      }
      const rank = { exact: 0, fuzzy: 1, unverified: 2 } as const;
      llmChoices.sort((a, b) => rank[a.loc.verification] - rank[b.loc.verification]);
      const det = matchFactScored(attr, d.facts);
      const detChoice: Choice | undefined = det && {
        value: det.fact.rawValue,
        source: 'deterministic',
        loc: {
          pageNo: det.fact.pageNo,
          charStart: det.fact.charStart,
          charEnd: det.fact.charEnd,
          quote: lineAround(pageText(det.fact.pageNo), det.fact.charStart, det.fact.charEnd),
          verification: 'exact',
        },
      };
      const bestLlm = llmChoices[0];
      const best = det && det.score >= 3 ? detChoice : bestLlm && bestLlm.loc.verification !== 'unverified' ? bestLlm : (detChoice ?? bestLlm);
      if (!best) {
        cellsByAttr.get(attr.key)!.push({ ...cellBase(d), value: null, evidenceHandle: null });
        continue;
      }
      const value = best.value;
      const handle = registry.add({ ...evBase, ...best.loc, source: best.source, attribute: attr.key, value });
      cellsByAttr.get(attr.key)!.push({ ...cellBase(d), value, evidenceHandle: handle });
      const kv: Finding = {
        id: nextId(),
        category: 'key_value',
        tier: best.loc.verification === 'unverified' ? 'interpretation' : 'extracted',
        title: attr.label,
        detail: value,
        attribute: attr.key,
        severity: 'info',
        rule: best.source === 'deterministic' ? 'fact.labelled_field' : null,
        verdict: null,
        verdictNote: best.loc.verification === 'unverified' ? 'The quoted text could not be found in the document.' : null,
        documentIds: [d.doc.id],
        evidence: [{ handle, role: 'supports' }],
      };
      keyValues.push(kv);
      docFindings.push(kv);
    }

    // Additional deterministic facts (dates, amounts, identifiers, form fields).
    const taken: [number, number, number][] = [];
    for (const h of Object.values(registry.toRecord())) {
      if (h.documentId === d.doc.id && h.charStart !== null && h.charEnd !== null) taken.push([h.pageNo, h.charStart, h.charEnd]);
    }
    const priority = { labelled_field: 0, table_cell: 1, date: 2, money: 3, identifier: 4 } as Record<string, number>;
    const extraFacts = d.facts
      .filter((f) => f.type in priority)
      .sort((a, b) => (priority[a.type] ?? 9) - (priority[b.type] ?? 9) || a.pageNo - b.pageNo || a.charStart - b.charStart);
    let added = 0;
    for (const f of extraFacts) {
      if (added >= 40) break;
      if (taken.some(([p, s, e]) => p === f.pageNo && f.charStart < e && s < f.charEnd)) continue;
      taken.push([f.pageNo, f.charStart, f.charEnd]);
      const pageText = d.pages.find((p) => p.pageNo === f.pageNo)?.text ?? '';
      const handle = registry.add({
        ...evBase,
        pageNo: f.pageNo,
        charStart: f.charStart,
        charEnd: f.charEnd,
        quote: lineAround(pageText, f.charStart, f.charEnd),
        verification: 'exact',
        source: 'deterministic',
        attribute: null,
        value: f.rawValue,
      });
      const kv: Finding = {
        id: nextId(),
        category: 'key_value',
        tier: 'extracted',
        title: f.label ?? FACT_LABELS[f.type] ?? f.type,
        detail: f.rawValue,
        attribute: null,
        severity: 'info',
        rule: `fact.${f.type}`,
        verdict: null,
        verdictNote: null,
        documentIds: [d.doc.id],
        evidence: [{ handle, role: 'supports' }],
      };
      keyValues.push(kv);
      docFindings.push(kv);
      added++;
    }

    // Model observations (interpretation) – kept only with verified evidence location.
    // "Missing X" observations are skipped: absence is reported once, across documents.
    let obsCount = 0;
    const droppedObs: string[] = [];
    for (const { out, source } of parts) {
      for (const o of out.observations) {
        if (/^\s*(missing|no)\b/i.test(o.title) || obsCount >= MAX_OBSERVATIONS_PER_DOC) continue;
        const loc = verifyCandidate({ quote: o.quote, value: null, chunkRef: o.chunkRef }, d);
        if (loc.verification === 'unverified') {
          droppedObs.push(o.title);
          continue;
        }
        obsCount++;
        const handle = registry.add({ ...evBase, ...loc, source, attribute: null, value: null });
        docFindings.push({
          id: nextId(),
          category: 'observation',
          tier: 'interpretation',
          title: o.title,
          detail: o.detail,
          attribute: null,
          severity: 'info',
          rule: null,
          verdict: null,
          verdictNote: null,
          documentIds: [d.doc.id],
          evidence: [{ handle, role: 'supports' }],
        });
        observationsForSynthesis.push({ alias: d.alias, title: o.title, detail: o.detail, evidence: handle });
      }
    }
    if (droppedObs.length > 0) {
      warnings.push(
        `${d.alias}: ${droppedObs.length} AI observation(s) were dropped because their quotes were not found in the document (${droppedObs.map((t) => `"${t}"`).join(', ')}).`,
      );
    }
    perDocument.push({ documentId: d.doc.id, findings: docFindings });
  }

  /* 4. Compare (deterministic rules) ---------------------------------------------- */
  repo.setAnalysisStatus(analysisId, 'comparing');
  const ctx = { nextId };
  const comparison: ComparisonRow[] = [];
  const derived: Finding[] = [];
  for (const attr of plan.attributes) {
    const { row, findings } = compareAttribute(attr, cellsByAttr.get(attr.key) ?? [], ctx, plan.comparisonMode);
    comparison.push(row);
    derived.push(...findings);
  }
  const today = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  for (const attr of plan.attributes.filter((a) => a.valueType === 'date' && /expir/.test(a.key))) {
    derived.push(...checkExpiry(attr, cellsByAttr.get(attr.key) ?? [], cellsByAttr.get('application_date') ?? [], today, ctx));
  }

  // Missing information: blank form fields, and required attributes found nowhere.
  const blankLabels: string[] = [];
  for (const d of docs) {
    for (const f of d.facts.filter((x) => x.type === 'blank_field')) {
      const label = f.label ?? 'Field';
      blankLabels.push(normalizeLabel(label));
      const pageText = d.pages.find((p) => p.pageNo === f.pageNo)?.text ?? '';
      const handle = registry.add({
        documentId: d.doc.id,
        documentName: d.doc.displayName,
        alias: d.alias,
        pageNo: f.pageNo,
        charStart: f.charStart,
        charEnd: f.charEnd,
        quote: pageText.slice(f.charStart, f.charEnd),
        verification: 'exact',
        source: 'deterministic',
        attribute: null,
        value: null,
      });
      derived.push({
        id: nextId(),
        category: 'missing_information',
        tier: 'derived',
        title: `"${label}" is blank`,
        detail: `${d.alias} (${d.doc.displayName}) contains the field "${label}" on page ${f.pageNo}, but no value was provided.`,
        attribute: null,
        severity: 'medium',
        rule: 'form.blank_field',
        verdict: null,
        verdictNote: null,
        documentIds: [d.doc.id],
        evidence: [{ handle, role: 'expected_in' }],
      });
    }
  }
  for (const row of comparison) {
    const attr = plan.attributes.find((a) => a.key === row.attribute)!;
    if (row.rowStatus !== 'not_found' || !attr.required) continue;
    const coveredByBlank = [attr.label, ...attr.synonyms].some((s) => blankLabels.includes(normalizeLabel(s)));
    if (coveredByBlank) continue;
    derived.push({
      id: nextId(),
      category: 'missing_information',
      tier: 'derived',
      title: `${attr.label} not found`,
      detail: `None of the ${docs.length} analysed document(s) state the ${attr.label.toLowerCase()}.`,
      attribute: attr.key,
      severity: 'low',
      rule: 'attribute.not_found',
      verdict: null,
      verdictNote: null,
      documentIds: docs.map((d) => d.doc.id),
      evidence: [],
    });
  }

  /* 5. Synthesise (reduce) – structured input, evidence handles only -------------- */
  repo.setAnalysisStatus(analysisId, 'synthesising');
  const evidence = registry.toRecord();
  const aliasOf = new Map(docs.map((d) => [d.doc.id, d.alias]));
  const synthesisInput: SynthesisInput = {
    instruction: analysis.instruction,
    comparisonMode: plan.comparisonMode,
    documents: docs.map((d) => ({ alias: d.alias, name: d.doc.displayName })),
    comparison: comparison.map((r) => ({
      attribute: r.attribute,
      label: r.label,
      cells: r.cells.map((c) => ({ alias: aliasOf.get(c.documentId) ?? '?', value: c.value, evidence: c.evidenceHandle, status: c.status })),
    })),
    derivedFindings: derived.map((f) => ({
      id: f.id,
      category: f.category,
      title: f.title,
      detail: f.detail,
      severity: f.severity,
      evidence: f.evidence.map((e) => e.handle),
    })),
    observations: observationsForSynthesis,
  };

  let summary: string;
  let summaryPoints: Finding[] = [];
  let finalDerived = derived;
  let additional: Finding[] = [];
  try {
    const prompt = synthesisPrompt(synthesisInput);
    const synthesis = await cachedGenerate({ stage: 'synthesise', ...prompt, schema: LlmSynthesis, context: synthesisInput }, [sha(synthesisInput)]);
    const applied = applySynthesis({ synthesis, derived, evidence, allDocumentIds: docs.map((d) => d.doc.id), nextId });
    summary = applied.summary;
    summaryPoints = applied.summaryPoints;
    finalDerived = applied.derived;
    additional = applied.additional;
    warnings.push(...applied.warnings);
  } catch (err) {
    warnings.push(`The AI summary failed (${errMessage(err)}); a rule-based summary is shown instead.`);
    summary = fallbackSummary(analysis.instruction, docs.length, derived);
  }

  /* 6. Assemble & validate (provenance invariants are enforced by the schema) ----- */
  const severityRank = { high: 0, medium: 1, low: 2, info: 3 } as const;
  const bySeverity = (a: Finding, b: Finding) => severityRank[a.severity] - severityRank[b.severity];
  const result = AnalysisResult.parse({
    documents: docs.map((d) => ({ id: d.doc.id, alias: d.alias, name: d.doc.displayName })),
    summary,
    summaryPoints,
    comparison,
    discrepancies: [...finalDerived, ...additional].filter((f) => f.category === 'discrepancy').sort(bySeverity),
    missingInformation: [...finalDerived, ...additional].filter((f) => f.category === 'missing_information').sort(bySeverity),
    keyValues,
    perDocument,
    evidence,
    warnings,
    meta: { provider: llm.name, model: llm.model, promptVersion: PROMPT_VERSION, planSource: plan.source, comparisonMode: plan.comparisonMode, durationMs: Date.now() - started },
  });
  repo.completeAnalysis(analysisId, result);
}

/* Helpers ------------------------------------------------------------------------------ */

const FACT_LABELS: Record<string, string> = { date: 'Date', money: 'Amount', identifier: 'Identifier', table_cell: 'Cell' };

function cellBase(d: LoadedDocument) {
  return { documentId: d.doc.id, alias: d.alias, documentName: d.doc.displayName };
}

function errMessage(err: unknown): string {
  if (err instanceof LlmUnavailableError || err instanceof LlmInvalidOutputError) return err.message;
  return err instanceof Error ? err.message : 'unknown error';
}

/** Group chunks into windows that fit the per-call character budget (large documents). */
export function windowChunks(chunks: ChunkRecord[], budget: number): ChunkRecord[][] {
  const windows: ChunkRecord[][] = [];
  let current: ChunkRecord[] = [];
  let size = 0;
  for (const c of chunks) {
    if (current.length > 0 && size + c.text.length > budget) {
      windows.push(current);
      current = [];
      size = 0;
    }
    current.push(c);
    size += c.text.length;
  }
  if (current.length > 0) windows.push(current);
  return windows.length > 0 ? windows : [[]];
}

/** Narrow a located quote span to where the value itself appears in it (falls back to the whole span). */
export function valueSpan(text: string, start: number, end: number, value: string): { start: number; end: number } {
  const v = value.trim().toLowerCase();
  const i = v ? text.slice(start, end).toLowerCase().indexOf(v) : -1;
  return i >= 0 ? { start: start + i, end: start + i + v.length } : { start, end };
}

function lineAround(text: string, start: number, end: number): string {
  const ls = Math.max(text.lastIndexOf('\n', start - 1) + 1, start - 100);
  const nl = text.indexOf('\n', end);
  const le = Math.min(nl === -1 ? text.length : nl, end + 100);
  return text.slice(ls, le).trim();
}

/** Clean up an LLM-proposed plan: valid snake_case keys, no duplicates, library synonyms. */
export function sanitizePlan(p: LlmPlan): AnalysisPlan {
  const seen = new Set<string>();
  const attributes: PlanAttribute[] = [];
  for (const a of p.attributes) {
    const key = a.key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+|_+$/g, '')
      .slice(0, 48);
    if (!key || !a.label.trim()) continue;
    const enriched = enrichAttribute({ key, label: a.label.trim().slice(0, 80), valueType: a.valueType, required: a.required });
    if (seen.has(enriched.key)) continue;
    seen.add(enriched.key);
    attributes.push(enriched);
    if (attributes.length >= 15) break;
  }
  return attributes.length > 0 ? { source: 'llm', templateId: null, comparisonMode: 'consistency', attributes } : fallbackPlan();
}
