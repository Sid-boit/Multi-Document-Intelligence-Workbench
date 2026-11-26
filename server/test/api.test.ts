import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnalysisView, type DocumentSummary, type Finding } from '@workbench/shared';
import { OllamaProvider } from '../src/llm/ollama.js';
import { createTestApp, sample, SAMPLES_DIR } from './helpers.js';

const CASE_A = ['application_form.pdf', 'accountant_letter.txt', 'financials_2025.csv', 'licence_certificate.png', 'bank_reference.md'];
const expected = JSON.parse(readFileSync(join(SAMPLES_DIR, 'expected.json'), 'utf8')) as {
  caseA: { expectedFindings: { rule: string; attribute: string | null }[]; expectedConsistent: { attribute: string }[] };
};

type TestApp = ReturnType<typeof createTestApp>;

async function upload(t: TestApp, names: string[]): Promise<DocumentSummary[]> {
  let req = request(t.app).post('/api/documents');
  for (const n of names) req = req.attach('files', sample(n), n.split('/').pop());
  const res = await req.expect(201);
  return res.body.documents as DocumentSummary[];
}

async function analyse(t: TestApp, documentIds: string[], instruction: string, templateId?: string): Promise<AnalysisView> {
  const res = await request(t.app).post('/api/analyses').send({ instruction, documentIds, templateId }).expect(202);
  await t.settle();
  const got = await request(t.app).get(`/api/analyses/${res.body.id}`).expect(200);
  return AnalysisView.parse(got.body.analysis);
}

function allFindings(a: AnalysisView): Finding[] {
  const r = a.result!;
  return [...r.summaryPoints, ...r.discrepancies, ...r.missingInformation, ...r.keyValues, ...r.perDocument.flatMap((p) => p.findings)];
}

describe('API: documents', () => {
  let t: TestApp;
  beforeEach(() => (t = createTestApp()));
  afterEach(() => t.cleanup());

  it('ingests a mixed batch, giving every file its own status and reason', async () => {
    const invalid = readdirSync(join(SAMPLES_DIR, 'invalid')).map((f) => `invalid/${f}`);
    const docs = await upload(t, [...CASE_A, ...invalid]);
    const byName = Object.fromEntries(docs.map((d) => [d.displayName, d]));

    for (const name of CASE_A) expect(byName[name]?.status, name).toBe('ready');
    expect(byName['licence_certificate.png']?.extractionMethod).toBe('ocr');
    expect(byName['application_form.pdf']?.pageCount).toBe(2);

    expect(byName['corrupt.pdf']).toMatchObject({ status: 'failed', statusReason: expect.stringMatching(/corrupt/i) });
    expect(byName['fake_invoice.pdf']).toMatchObject({ status: 'rejected', statusReason: expect.stringMatching(/does not match/i) });
    expect(byName['empty.txt']).toMatchObject({ status: 'rejected', statusReason: expect.stringMatching(/empty/i) });
    expect(byName['latin1_notes.txt']).toMatchObject({ status: 'rejected', statusReason: expect.stringMatching(/UTF-8/) });
    expect(byName['notes.docx']).toMatchObject({ status: 'rejected', statusReason: expect.stringMatching(/Unsupported/) });

    const list = await request(t.app).get('/api/documents').expect(200);
    expect(list.body.documents).toHaveLength(CASE_A.length + invalid.length);
  });

  it('rejects an upload with no files', async () => {
    const res = await request(t.app).post('/api/documents').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('serves page text and deletes documents together with their stored file', async () => {
    const [doc] = await upload(t, ['application_form.pdf']);
    const page = await request(t.app).get(`/api/documents/${doc!.id}/pages/2`).expect(200);
    expect(page.body.text).toContain('Application date: 03/02/2026');
    await request(t.app).get(`/api/documents/${doc!.id}/pages/9`).expect(404);

    expect(readdirSync(t.storageDir)).toHaveLength(1);
    await request(t.app).delete(`/api/documents/${doc!.id}`).expect(204);
    expect(readdirSync(t.storageDir)).toHaveLength(0);
    await request(t.app).get(`/api/documents/${doc!.id}`).expect(404);
  });

  it('does not store rejected files on disk', async () => {
    await upload(t, ['invalid/fake_invoice.pdf', 'invalid/notes.docx']);
    expect(readdirSync(t.storageDir)).toHaveLength(0);
  });

  it('returns 400 for malformed ids', async () => {
    const res = await request(t.app).get('/api/documents/not-a-uuid').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('API: analyses (end-to-end with the mock provider)', () => {
  let t: TestApp;
  beforeEach(() => (t = createTestApp()));
  afterEach(() => t.cleanup());

  it('finds every planted discrepancy, each traceable to evidence in an analysed document', async () => {
    const docs = await upload(t, CASE_A);
    const analysis = await analyse(
      t,
      docs.map((d) => d.id),
      'Identify inconsistencies between the application form and supporting documents.',
      'form_vs_supporting',
    );
    expect(analysis.status).toBe('completed');
    const result = analysis.result!;

    // Golden findings
    const derived = [...result.discrepancies, ...result.missingInformation];
    for (const exp of expected.caseA.expectedFindings) {
      const hit = derived.find((f) => f.rule === exp.rule && (exp.attribute === null || f.attribute === exp.attribute));
      expect(hit, `expected finding ${exp.rule} on ${exp.attribute}`).toBeDefined();
      expect(hit!.tier).toBe('derived');
    }
    // Equivalent values must not be reported as discrepancies
    for (const c of expected.caseA.expectedConsistent) {
      const row = result.comparison.find((r) => r.attribute === c.attribute)!;
      expect(row.cells.some((cell) => cell.status === 'mismatch')).toBe(false);
      expect(result.discrepancies.some((f) => f.attribute === c.attribute)).toBe(false);
    }

    // Provenance: every finding (except "not found anywhere") cites evidence that exists and
    // belongs to one of the analysed documents, at a real location in that document.
    const docIds = new Set(docs.map((d) => d.id));
    for (const f of allFindings(analysis)) {
      if (f.rule !== 'attribute.not_found') expect(f.evidence.length, f.title).toBeGreaterThan(0);
      for (const e of f.evidence) {
        const ev = result.evidence[e.handle];
        expect(ev, `${f.id} → ${e.handle}`).toBeDefined();
        expect(docIds.has(ev!.documentId)).toBe(true);
      }
    }
    for (const ev of Object.values(result.evidence)) {
      if (ev.charStart === null) continue;
      const page = await request(t.app).get(`/api/documents/${ev.documentId}/pages/${ev.pageNo}`).expect(200);
      expect(page.body.text.slice(ev.charStart, ev.charEnd!).length).toBeGreaterThan(0);
    }

    // Facts vs interpretation: rule-based findings are "derived", AI points are "interpretation".
    expect(result.summaryPoints.every((p) => p.tier === 'interpretation')).toBe(true);
    expect(result.keyValues.some((k) => k.tier === 'extracted')).toBe(true);
    expect(result.discrepancies.every((d) => d.verdict === 'confirmed')).toBe(true);

    // Per-document results exist for each document (independent analysis)
    expect(result.perDocument.map((p) => p.documentId).sort()).toEqual([...docIds].sort());
    expect(analysis.progress.perDocument).toEqual(Object.fromEntries(docs.map((d) => [d.id, 'done'])));
  });

  it('flags a prompt-injection document without letting it suppress findings', async () => {
    const docs = await upload(t, [...CASE_A, 'adversarial/injection_letter.txt']);
    const inj = docs.find((d) => d.displayName === 'injection_letter.txt')!;
    expect(inj.warnings.join(' ')).toMatch(/instructions to an AI/);

    const analysis = await analyse(t, docs.map((d) => d.id), 'Highlight discrepancies in names, addresses, licence details, or revenue figures.');
    expect(analysis.result!.warnings.join(' ')).toMatch(/instructions to an AI/);
    expect(analysis.result!.discrepancies.some((f) => f.rule === 'identifier.transposition')).toBe(true);
  });

  it('builds a plan for a custom instruction and compares financial position (Case B)', async () => {
    const docs = await upload(t, ['financials_2025.csv', 'acme_widgets_financials.csv']);
    const analysis = await analyse(t, docs.map((d) => d.id), 'Compare the financial position of the companies represented in the documents.');
    expect(analysis.plan?.templateId).toBe('financial_position'); // matched by instruction text
    const revenue = analysis.result!.comparison.find((r) => r.attribute === 'annual_revenue')!;
    expect(revenue.cells.map((c) => c.value)).toEqual(['1180000', '2450000']);
    // Two different companies: compared side by side, differences are not "discrepancies".
    expect(analysis.result!.meta.comparisonMode).toBe('side_by_side');
    expect(revenue.rowStatus).toBe('compared');
    expect(analysis.result!.discrepancies).toEqual([]);

    const custom = await analyse(t, docs.map((d) => d.id), 'Which company is more profitable?');
    expect(custom.status).toBe('completed');
    expect(custom.result!.meta.planSource).toBe('llm');
  });

  it('validates analysis requests', async () => {
    const [bad] = await upload(t, ['invalid/notes.docx']);
    let res = await request(t.app).post('/api/analyses').send({ instruction: 'x', documentIds: [] }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    res = await request(t.app).post('/api/analyses').send({ instruction: 'Compare these', documentIds: [bad!.id] }).expect(400);
    expect(res.body.error.message).toMatch(/cannot be analysed/);
    await request(t.app).get('/api/analyses/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('lists templates', async () => {
    const res = await request(t.app).get('/api/templates').expect(200);
    expect(res.body.templates).toHaveLength(5);
  });
});

describe('API: degraded AI', () => {
  it('still completes with rule-based output and clear warnings when Ollama is unreachable', async () => {
    const offline = new OllamaProvider({
      baseUrl: 'http://127.0.0.1:9',
      model: 'test-model',
      timeoutMs: 1000,
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const t = createTestApp({ llm: offline });
    try {
      const health = await request(t.app).get('/api/health').expect(200);
      expect(health.body.llm).toMatchObject({ provider: 'ollama', reachable: false });

      const docs = await upload(t, CASE_A);
      const analysis = await analyse(t, docs.map((d) => d.id), 'Compare the information across all uploaded documents.');
      expect(analysis.status).toBe('completed');
      expect(analysis.result!.warnings.join(' ')).toMatch(/not reachable/);
      expect(analysis.result!.discrepancies.some((f) => f.rule === 'identifier.transposition')).toBe(true);
      expect(Object.values(analysis.progress.perDocument).every((s) => s === 'fallback')).toBe(true);
    } finally {
      t.cleanup();
    }
  });
});
