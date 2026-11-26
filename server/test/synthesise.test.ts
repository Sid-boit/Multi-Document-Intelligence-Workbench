import { describe, expect, it } from 'vitest';
import type { Evidence, Finding } from '@workbench/shared';
import { applySynthesis, fallbackSummary } from '../src/analysis/synthesise.js';

const ev = (handle: string, documentId: string): Evidence => ({
  handle,
  documentId,
  documentName: `${documentId}.pdf`,
  alias: documentId.toUpperCase(),
  pageNo: 1,
  charStart: 0,
  charEnd: 5,
  quote: 'quote',
  verification: 'exact',
  source: 'llm',
  attribute: null,
  value: null,
});

const evidence = { E1: ev('E1', 'd1'), E2: ev('E2', 'd2') };

const derived: Finding = {
  id: 'F1',
  category: 'discrepancy',
  tier: 'derived',
  title: 'Revenue: amounts differ',
  detail: '…',
  attribute: 'annual_revenue',
  severity: 'medium',
  rule: 'money.mismatch',
  verdict: null,
  verdictNote: null,
  documentIds: ['d1', 'd2'],
  evidence: [
    { handle: 'E1', role: 'supports' },
    { handle: 'E2', role: 'contradicts' },
  ],
};

let n = 100;
const nextId = () => `F${++n}`;

describe('applySynthesis (provenance enforcement)', () => {
  it('keeps AI points with valid evidence and labels them as interpretation', () => {
    const out = applySynthesis({
      synthesis: { summary: ' Summary. ', summaryPoints: [{ title: 'Revenue conflict', detail: 'd', evidence: ['e1', 'E2'] }], assessments: [], additionalFindings: [] },
      derived: [derived],
      evidence,
      allDocumentIds: ['d1', 'd2'],
      nextId,
    });
    expect(out.summary).toBe('Summary.');
    expect(out.summaryPoints).toHaveLength(1);
    expect(out.summaryPoints[0]).toMatchObject({ tier: 'interpretation', category: 'summary_point', documentIds: ['d1', 'd2'] });
    expect(out.warnings).toEqual([]);
  });

  it('strips invented evidence handles and drops claims left without evidence', () => {
    const out = applySynthesis({
      synthesis: {
        summary: 's',
        summaryPoints: [
          { title: 'Fabricated', detail: 'd', evidence: ['E99'] },
          { title: 'Partly real', detail: 'd', evidence: ['E1', 'E42'] },
        ],
        assessments: [],
        additionalFindings: [{ category: 'discrepancy', title: 'Invented', detail: 'd', severity: 'high', evidence: ['E77'] }],
      },
      derived: [derived],
      evidence,
      allDocumentIds: ['d1', 'd2'],
      nextId,
    });
    expect(out.summaryPoints.map((p) => p.title)).toEqual(['Partly real']);
    expect(out.summaryPoints[0]!.evidence).toEqual([{ handle: 'E1', role: 'supports' }]);
    expect(out.additional).toEqual([]);
    expect(out.warnings.join(' ')).toMatch(/Fabricated/);
    expect(out.warnings.join(' ')).toMatch(/Invented/);
    expect(out.warnings.join(' ')).toMatch(/3 citation\(s\)/);
  });

  it('applies verdicts to rule-based findings; "benign" lowers severity to info', () => {
    const out = applySynthesis({
      synthesis: { summary: 's', summaryPoints: [], assessments: [{ findingId: 'f1', verdict: 'benign', explanation: 'Rounding.' }], additionalFindings: [] },
      derived: [derived],
      evidence,
      allDocumentIds: ['d1', 'd2'],
      nextId,
    });
    expect(out.derived[0]).toMatchObject({ verdict: 'benign', verdictNote: 'Rounding.', severity: 'info', tier: 'derived' });
  });

  it('skips AI findings that merely restate a rule-based finding, keeps new ones', () => {
    const out = applySynthesis({
      synthesis: {
        summary: 's',
        summaryPoints: [],
        assessments: [],
        additionalFindings: [
          { category: 'discrepancy', title: 'Same as F1', detail: 'd', severity: 'medium', evidence: ['E1', 'E2'] },
          { category: 'missing_information', title: 'No bank statements', detail: 'd', severity: 'low', evidence: [] },
        ],
      },
      derived: [derived],
      evidence,
      allDocumentIds: ['d1', 'd2'],
      nextId,
    });
    expect(out.additional.map((f) => f.title)).toEqual(['No bank statements']);
    expect(out.additional[0]).toMatchObject({ tier: 'interpretation', documentIds: ['d1', 'd2'], evidence: [] });
  });
});

describe('fallbackSummary', () => {
  it('summarises rule-based findings and says the AI was unavailable', () => {
    const s = fallbackSummary('Compare', 3, [{ ...derived, severity: 'high', title: 'Licence number: possible transposed characters' }]);
    expect(s).toMatch(/3 document/);
    expect(s).toMatch(/1 discrepancy/);
    expect(s).toMatch(/licence number: possible transposed characters/);
    expect(s).toMatch(/AI summary was unavailable/);
  });
});
