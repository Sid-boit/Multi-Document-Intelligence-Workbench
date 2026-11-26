import type { LlmDocExtraction, PlanAttribute } from '@workbench/shared';
import type { FactRecord, LoadedDocument } from '../types.js';
import { normalizeDate, normalizeLabel, normalizeMoney } from './normalize.js';

/**
 * Rule-based extraction from deterministic facts ("Label: Value" form fields and CSV
 * cells). Used by the MockProvider, and as the fallback when the model fails for a
 * document – so an analysis still produces evidence-backed results without AI.
 */

/** 3 = exact label/synonym match, 2 = multi-word synonym contained in the label, 0 = no match. */
export function labelScore(label: string, attr: Pick<PlanAttribute, 'key' | 'label' | 'synonyms'>): number {
  const l = normalizeLabel(label);
  if (!l) return 0;
  let best = 0;
  for (const raw of [attr.key.replace(/_/g, ' '), attr.label, ...attr.synonyms]) {
    const s = normalizeLabel(raw);
    if (!s) continue;
    if (l === s) best = Math.max(best, 3);
    else if (s.includes(' ') && (l.startsWith(`${s} `) || l.endsWith(` ${s}`) || l.includes(` ${s} `))) best = Math.max(best, 2);
  }
  return best;
}

function valueFits(attr: PlanAttribute, value: string): boolean {
  switch (attr.valueType) {
    case 'money':
      return normalizeMoney(value) !== null;
    case 'date':
      return normalizeDate(value) !== null;
    default:
      return value.trim().length > 0;
  }
}

export function matchFactScored(attr: PlanAttribute, facts: FactRecord[]): { fact: FactRecord; score: number } | undefined {
  let best: { fact: FactRecord; score: number } | undefined;
  for (const f of facts) {
    if ((f.type !== 'labelled_field' && f.type !== 'table_cell') || !f.label) continue;
    const score = labelScore(f.label, attr);
    if (score > 0 && valueFits(attr, f.rawValue) && (!best || score > best.score)) best = { fact: f, score };
  }
  return best;
}

export function matchFact(attr: PlanAttribute, facts: FactRecord[]): FactRecord | undefined {
  return matchFactScored(attr, facts)?.fact;
}

/**
 * True when a value located at [start, end) sits in a form field whose label clearly
 * belongs to a *different* attribute (e.g. the model reported the "Issue date" line as
 * the application date). Used to reject misattributed model answers.
 */
export function labelledForAnotherAttribute(
  attr: PlanAttribute,
  facts: FactRecord[],
  pageNo: number,
  start: number,
  end: number,
  universe: Pick<PlanAttribute, 'key' | 'label' | 'synonyms'>[],
): string | null {
  const fact = facts.find(
    (f) => (f.type === 'labelled_field' || f.type === 'table_cell') && f.label && f.pageNo === pageNo && f.charStart < end && start < f.charEnd,
  );
  if (!fact?.label || labelScore(fact.label, attr) > 0) return null;
  return universe.some((u) => u.key !== attr.key && labelScore(fact.label!, u) > 0) ? fact.label : null;
}

export function deterministicExtract(attributes: PlanAttribute[], doc: Pick<LoadedDocument, 'chunks' | 'facts'>): LlmDocExtraction {
  const refByChunk = new Map(doc.chunks.map((c) => [c.id, c.ref]));
  return {
    values: attributes.map((attr) => {
      const fact = matchFact(attr, doc.facts);
      return fact
        ? { attribute: attr.key, status: 'found' as const, value: fact.rawValue, chunkRef: refByChunk.get(fact.chunkId) ?? null, quote: fact.rawValue }
        : { attribute: attr.key, status: 'not_found' as const, value: null, chunkRef: null, quote: null };
    }),
    observations: [],
  };
}
