import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AnalysisView, type LlmDocExtraction, type LlmSynthesis } from '@workbench/shared';
import { labelledForAnotherAttribute } from '../src/analysis/deterministic.js';
import { ATTRIBUTE_LIBRARY, enrichAttribute, inferValueType } from '../src/analysis/templates.js';
import { literalValue } from '../src/analysis/verify.js';
import { valueSpan } from '../src/analysis/pipeline.js';
import type { GenerateRequest, LlmProvider } from '../src/llm/provider.js';
import type { ChunkRecord, FactRecord } from '../src/types.js';
import { createTestApp, sample } from './helpers.js';

/**
 * A scripted "model" that makes the kinds of mistakes real local models make:
 * misattributes a value to the wrong field, reformats numbers, misses labelled
 * values, and cites evidence that does not exist.
 */
class MisbehavingProvider implements LlmProvider {
  readonly name = 'ollama' as const;
  readonly model = 'scripted';

  async generate<T>(req: GenerateRequest<T>): Promise<T> {
    if (req.stage === 'extract') {
      const { document } = req.context as { document: { chunks: ChunkRecord[]; facts: FactRecord[] } };
      const text = document.chunks.map((c) => c.text).join('\n');
      const ref = document.chunks[0]?.ref ?? 'p1-c1';
      const values: LlmDocExtraction['values'] = [];
      if (text.includes('TRADING LICENCE CERTIFICATE')) {
        // Wrong field: the issue date reported as the application date.
        values.push({ attribute: 'application_date', status: 'found', value: '01/04/2023', chunkRef: ref, quote: 'Issue date: 01/04/2023' });
        values.push({ attribute: 'licence_number', status: 'found', value: 'LIC-48231', chunkRef: ref, quote: 'Licence number: LIC-48231' });
      }
      if (text.includes('Columns: company')) {
        // Reformatted number with an invented currency symbol, quoting the whole CSV row: the value
        // sits in the "revenue" cell, not the row's first ("company") cell.
        values.push({
          attribute: 'annual_revenue',
          status: 'found',
          value: '$1,180,000',
          chunkRef: ref,
          quote: 'Row 1: company=Northwind Fabrication Ltd; financial_year=FY2025; revenue=1180000',
        });
      }
      if (text.includes('Dear Sir or Madam')) {
        // Prose-only value the rule-based parser cannot attribute (no label), plus an invented quote.
        values.push({ attribute: 'net_profit', status: 'found', value: '£96,000', chunkRef: ref, quote: 'with a net profit of £96,000' });
        values.push({ attribute: 'company_number', status: 'found', value: '12345678', chunkRef: ref, quote: 'Company number 12345678' });
      }
      // Everything else (e.g. the bank's labelled address) is "missed" by the model.
      const out: LlmDocExtraction = { values, observations: [{ title: 'Missing signature', detail: 'noise', chunkRef: ref, quote: 'x' }] };
      return req.schema.parse(out);
    }
    if (req.stage === 'synthesise') {
      const out: LlmSynthesis = {
        summary: 'Scripted summary.',
        summaryPoints: [
          { title: 'Real point', detail: 'Cites real evidence', evidence: ['E1'] },
          { title: 'Hallucinated point', detail: 'Cites nothing real', evidence: ['E999'] },
        ],
        assessments: [],
        additionalFindings: [],
      };
      return req.schema.parse(out);
    }
    throw new Error(`unexpected stage ${req.stage}`);
  }

  async health() {
    return true;
  }
}

describe('analysis pipeline with an imperfect model', () => {
  let t: ReturnType<typeof createTestApp>;
  afterEach(() => t.cleanup());

  it('rejects misattributed values, keeps literal source values, fills gaps and strips invented citations', async () => {
    t = createTestApp({ llm: new MisbehavingProvider() });
    const names = ['application_form.pdf', 'accountant_letter.txt', 'financials_2025.csv', 'licence_certificate.png', 'bank_reference.md'];
    let req = request(t.app).post('/api/documents');
    for (const n of names) req = req.attach('files', sample(n), n);
    const docs = (await req.expect(201)).body.documents as { id: string; displayName: string }[];

    const created = await request(t.app)
      .post('/api/analyses')
      .send({ instruction: 'Compare the information across all uploaded documents.', documentIds: docs.map((d) => d.id) })
      .expect(202);
    await t.settle();
    const analysis = AnalysisView.parse((await request(t.app).get(`/api/analyses/${created.body.id}`)).body.analysis);
    expect(analysis.status).toBe('completed');
    const r = analysis.result!;
    const row = (key: string) => r.comparison.find((x) => x.attribute === key)!;
    const cellOf = (key: string, name: string) => row(key).cells.find((c) => c.documentId === docs.find((d) => d.displayName === name)!.id)!;

    // 1. Misattribution rejected: the certificate's issue date is not its application date.
    expect(cellOf('application_date', 'licence_certificate.png').value).toBeNull();
    expect(r.warnings.join('\n')).toMatch(/labels it "Issue date"/);

    // 2. Literal value from the source, not the model's reformatting.
    expect(cellOf('annual_revenue', 'financials_2025.csv').value).toBe('1180000');

    // 2b. A whole-row quote is checked at the value's own cell, so it is not misattributed.
    expect(r.warnings.join('\n')).not.toMatch(/labels it "company"/);

    // 3. Gaps the model missed are filled by exact-label rules (bank address → postcode discrepancy).
    expect(cellOf('address', 'bank_reference.md').value).toBe('14 Harbour Rd, Bristol BS1 4QB');
    expect(r.discrepancies.some((f) => f.rule === 'address.postcode')).toBe(true);

    // 4. An invented quote is kept only as unverified, interpretation-tier evidence.
    const companyNo = cellOf('company_number', 'accountant_letter.txt');
    const ev = r.evidence[companyNo.evidenceHandle!]!;
    expect(ev.verification).toBe('unverified');
    expect(r.keyValues.find((k) => k.evidence[0]?.handle === companyNo.evidenceHandle)?.tier).toBe('interpretation');

    // 5. Invented citations in the synthesis are stripped and reported.
    expect(r.summaryPoints.map((p) => p.title)).toEqual(['Real point']);
    expect(r.warnings.join('\n')).toMatch(/Hallucinated point/);

    // 6. Observations whose quotes cannot be found are dropped and reported once per document.
    expect(r.warnings.filter((w) => /observation\(s\) were dropped/.test(w)).length).toBeLessThanOrEqual(docs.length);

    // 7. "Missing X" observations are not repeated per document.
    expect(r.perDocument.flatMap((p) => p.findings).some((f) => f.title === 'Missing signature')).toBe(false);
  });
});

describe('literalValue', () => {
  it('returns the value as written in the source when the model reformatted it', () => {
    expect(literalValue('Row 1: revenue=1180000; net_profit=96000', '$1,180,000')).toBe('1180000');
    expect(literalValue('Expiry date: 31/03/2026', '31 March 2026')).toBe('31/03/2026');
    expect(literalValue('Licence number: LIC-48213', 'LIC-48213')).toBe('LIC-48213');
    expect(literalValue('nothing relevant', 'ABC')).toBe('ABC');
  });
});

describe('valueSpan', () => {
  it('narrows a located quote to the position of the value', () => {
    const text = 'Row 1: company=Acme Ltd; revenue=2450000; net_profit=310000';
    const span = valueSpan(text, 0, text.length, '310000');
    expect(text.slice(span.start, span.end)).toBe('310000');
  });

  it('falls back to the whole quote when the value is not inside it', () => {
    expect(valueSpan('abc def', 0, 7, 'xyz')).toEqual({ start: 0, end: 7 });
  });
});

describe('labelledForAnotherAttribute', () => {
  const fact = (label: string, start: number, end: number): FactRecord => ({
    id: 'f', documentId: 'd', chunkId: 'c', pageNo: 1, type: 'labelled_field', label, rawValue: 'v', normalized: null, charStart: start, charEnd: end,
  });
  const universe = Object.values(ATTRIBUTE_LIBRARY);

  it('detects a value taken from a field labelled for another attribute', () => {
    expect(labelledForAnotherAttribute(ATTRIBUTE_LIBRARY.application_date!, [fact('Issue date', 10, 20)], 1, 12, 18, universe)).toBe('Issue date');
  });

  it('accepts values in matching or unlabelled locations', () => {
    expect(labelledForAnotherAttribute(ATTRIBUTE_LIBRARY.application_date!, [fact('Application date', 10, 20)], 1, 12, 18, universe)).toBeNull();
    expect(labelledForAnotherAttribute(ATTRIBUTE_LIBRARY.application_date!, [fact('Issue date', 10, 20)], 1, 40, 50, universe)).toBeNull();
    expect(labelledForAnotherAttribute(ATTRIBUTE_LIBRARY.application_date!, [fact('Remarks', 10, 20)], 1, 12, 18, universe)).toBeNull();
  });
});

describe('LLM plan enrichment', () => {
  it('maps model-proposed attributes onto the library (stable key, type and synonyms)', () => {
    const a = enrichAttribute({ key: 'business_address', label: 'Business address', valueType: 'text', required: true });
    expect(a).toMatchObject({ key: 'address', valueType: 'address' });
    expect(a.synonyms).toContain('registered address');
  });

  it('infers a value type for unknown attributes the model typed as text', () => {
    expect(inferValueType({ key: 'compliance_report_due', label: 'Compliance report due date', valueType: 'text' })).toBe('date');
    expect(inferValueType({ key: 'vat_no', label: 'VAT number', valueType: 'text' })).toBe('identifier');
    expect(inferValueType({ key: 'insurer', label: 'Insurer company', valueType: 'text' })).toBe('organisation');
    expect(inferValueType({ key: 'gross_margin', label: 'Gross margin', valueType: 'number' })).toBe('number'); // explicit types are kept
    expect(inferValueType({ key: 'notes', label: 'Notes', valueType: 'text' })).toBe('text');
  });
});
