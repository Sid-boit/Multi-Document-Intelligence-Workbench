import type { Evidence, Finding, LlmSynthesis } from '@workbench/shared';

/**
 * Applies the model's synthesis to the deterministic results while enforcing
 * provenance: the model may only cite evidence handles that exist. Anything citing
 * unknown handles is stripped; claims left without evidence are dropped (and reported).
 * Everything the model contributes is tier "interpretation".
 */

export interface SynthesisApplied {
  summary: string;
  summaryPoints: Finding[];
  derived: Finding[]; // derived findings annotated with the model's verdicts
  additional: Finding[]; // new interpretation findings
  warnings: string[];
}

export function applySynthesis(input: {
  synthesis: LlmSynthesis;
  derived: Finding[];
  evidence: Record<string, Evidence>;
  allDocumentIds: string[];
  nextId: () => string;
}): SynthesisApplied {
  const { synthesis, evidence, allDocumentIds, nextId } = input;
  const warnings: string[] = [];
  let stripped = 0;

  const validHandles = (handles: string[]): string[] => {
    const uniq = [...new Set(handles.map((h) => h.trim().toUpperCase()))];
    const ok = uniq.filter((h) => evidence[h] !== undefined);
    stripped += uniq.length - ok.length;
    return ok;
  };
  const docsOf = (handles: string[]) => [...new Set(handles.map((h) => evidence[h]!.documentId))];

  const summaryPoints: Finding[] = [];
  for (const p of synthesis.summaryPoints) {
    const handles = validHandles(p.evidence);
    if (handles.length === 0) {
      warnings.push(`Removed an AI summary point without valid evidence: "${p.title}".`);
      continue;
    }
    summaryPoints.push({
      id: nextId(),
      category: 'summary_point',
      tier: 'interpretation',
      title: p.title,
      detail: p.detail,
      attribute: null,
      severity: 'info',
      rule: null,
      verdict: null,
      verdictNote: null,
      documentIds: docsOf(handles),
      evidence: handles.map((handle) => ({ handle, role: 'supports' as const })),
    });
  }

  const verdicts = new Map(synthesis.assessments.map((a) => [a.findingId.trim().toUpperCase(), a]));
  const derived = input.derived.map((f) => {
    const a = verdicts.get(f.id.toUpperCase());
    if (!a) return f;
    return { ...f, verdict: a.verdict, verdictNote: a.explanation, severity: a.verdict === 'benign' ? ('info' as const) : f.severity };
  });

  const derivedHandleSets = derived.map((f) => new Set(f.evidence.map((e) => e.handle)));
  const additional: Finding[] = [];
  for (const f of synthesis.additionalFindings) {
    const handles = validHandles(f.evidence);
    if (handles.length === 0 && f.category !== 'missing_information') {
      warnings.push(`Removed an AI finding without valid evidence: "${f.title}".`);
      continue;
    }
    // Skip restatements of a rule-based finding (same evidence).
    if (handles.length > 0 && derivedHandleSets.some((s) => handles.every((h) => s.has(h)))) continue;
    additional.push({
      id: nextId(),
      category: f.category,
      tier: 'interpretation',
      title: f.title,
      detail: f.detail,
      attribute: null,
      severity: f.severity,
      rule: null,
      verdict: null,
      verdictNote: null,
      documentIds: handles.length > 0 ? docsOf(handles) : allDocumentIds,
      evidence: handles.map((handle) => ({ handle, role: 'supports' as const })),
    });
  }

  if (stripped > 0) warnings.push(`${stripped} citation(s) produced by the model referenced unknown evidence and were removed.`);
  return { summary: synthesis.summary.trim(), summaryPoints, derived, additional, warnings };
}

/** Summary used when the model is unavailable: built only from rule-based findings. */
export function fallbackSummary(instruction: string, docCount: number, derived: Finding[]): string {
  const disc = derived.filter((f) => f.category === 'discrepancy');
  const missing = derived.filter((f) => f.category === 'missing_information');
  const high = disc.filter((f) => f.severity === 'high');
  return [
    `Rule-based review of ${docCount} document(s) for: "${instruction}".`,
    disc.length > 0
      ? `${disc.length} discrepancy(ies) detected${high.length > 0 ? `, including ${high.map((f) => f.title.toLowerCase()).join('; ')}` : ''}.`
      : 'No discrepancies were detected in the compared attributes.',
    missing.length > 0 ? `${missing.length} item(s) are missing or blank.` : '',
    'The AI summary was unavailable, so this summary was generated from rules only.',
  ]
    .filter(Boolean)
    .join(' ');
}
