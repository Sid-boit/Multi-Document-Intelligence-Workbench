import type { AnalysisResult, AnalysisView, Evidence, Finding } from '@workbench/shared';

const ev = (handle: string, documentId: string, alias: string, documentName: string, quote: string, verification: Evidence['verification'] = 'exact'): Evidence => ({
  handle,
  documentId,
  documentName,
  alias,
  pageNo: 1,
  charStart: verification === 'unverified' ? null : 25,
  charEnd: verification === 'unverified' ? null : 34,
  quote,
  verification,
  source: 'llm',
  attribute: 'licence_number',
  value: quote,
});

export const discrepancy: Finding = {
  id: 'F1',
  category: 'discrepancy',
  tier: 'derived',
  title: 'Licence number: possible transposed characters',
  detail: 'D2 (cert.png) states "LIC-48231", but D1 (form.pdf) states "LIC-48213".',
  attribute: 'licence_number',
  severity: 'high',
  rule: 'identifier.transposition',
  verdict: 'confirmed',
  verdictNote: 'Likely a transcription error.',
  documentIds: ['d1', 'd2'],
  evidence: [
    { handle: 'E1', role: 'supports' },
    { handle: 'E2', role: 'contradicts' },
  ],
};

export const missing: Finding = {
  id: 'F2',
  category: 'missing_information',
  tier: 'derived',
  title: 'Signature date not found',
  detail: 'None of the 2 documents state the signature date.',
  attribute: 'signature_date',
  severity: 'low',
  rule: 'attribute.not_found',
  verdict: null,
  verdictNote: null,
  documentIds: ['d1', 'd2'],
  evidence: [],
};

export const summaryPoint: Finding = {
  id: 'F3',
  category: 'summary_point',
  tier: 'interpretation',
  title: 'Licence numbers conflict',
  detail: 'The certificate and the form disagree.',
  attribute: null,
  severity: 'info',
  rule: null,
  verdict: null,
  verdictNote: null,
  documentIds: ['d1', 'd2'],
  evidence: [{ handle: 'E1', role: 'supports' }],
};

export const keyValue: Finding = {
  ...summaryPoint,
  id: 'F4',
  category: 'key_value',
  tier: 'extracted',
  title: 'Licence number',
  detail: 'LIC-48213',
  attribute: 'licence_number',
  documentIds: ['d1'],
};

export const result: AnalysisResult = {
  documents: [
    { id: 'd1', alias: 'D1', name: 'form.pdf' },
    { id: 'd2', alias: 'D2', name: 'cert.png' },
  ],
  summary: 'The documents disagree on the licence number.',
  summaryPoints: [summaryPoint],
  comparison: [
    {
      attribute: 'licence_number',
      label: 'Licence number',
      valueType: 'identifier',
      rowStatus: 'inconsistent',
      cells: [
        { documentId: 'd1', value: 'LIC-48213', evidenceHandle: 'E1', status: 'match' },
        { documentId: 'd2', value: 'LIC-48231', evidenceHandle: 'E2', status: 'mismatch' },
      ],
    },
    {
      attribute: 'company_name',
      label: 'Company name',
      valueType: 'organisation',
      rowStatus: 'partial',
      cells: [
        { documentId: 'd1', value: 'Northwind Ltd', evidenceHandle: 'E3', status: 'match' },
        { documentId: 'd2', value: null, evidenceHandle: null, status: 'missing' },
      ],
    },
  ],
  discrepancies: [discrepancy],
  missingInformation: [missing],
  keyValues: [keyValue],
  perDocument: [
    { documentId: 'd1', findings: [keyValue] },
    { documentId: 'd2', findings: [] },
  ],
  evidence: {
    E1: ev('E1', 'd1', 'D1', 'form.pdf', 'LIC-48213'),
    E2: ev('E2', 'd2', 'D2', 'cert.png', 'LIC-48231', 'fuzzy'),
    E3: { ...ev('E3', 'd1', 'D1', 'form.pdf', 'Northwind Ltd', 'unverified'), attribute: 'company_name' },
  },
  warnings: ['D2 (cert.png): Low OCR confidence (55%).'],
  meta: { provider: 'ollama', model: 'qwen3.5:9b', promptVersion: 'v2', planSource: 'template', durationMs: 12_345 },
};

export const analysis: AnalysisView = {
  id: 'a1',
  instruction: 'Highlight discrepancies in licence details.',
  templateId: null,
  status: 'completed',
  progress: { perDocument: { d1: 'done', d2: 'done' } },
  documents: result.documents,
  plan: null,
  result,
  error: null,
  provider: 'ollama',
  model: 'qwen3.5:9b',
  createdAt: '2026-11-26T10:00:00Z',
  completedAt: '2026-11-26T10:01:00Z',
};
