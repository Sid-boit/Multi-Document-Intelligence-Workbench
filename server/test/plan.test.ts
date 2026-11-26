import { describe, expect, it } from 'vitest';
import { AnalysisPlan } from '@workbench/shared';
import { deterministicExtract, matchFact } from '../src/analysis/deterministic.js';
import { sanitizePlan } from '../src/analysis/pipeline.js';
import { ATTRIBUTE_LIBRARY, enrichAttribute, fallbackPlan, findTemplateId, templatePlan, TEMPLATES } from '../src/analysis/templates.js';
import type { FactRecord } from '../src/types.js';

describe('templates', () => {
  it('provides the five example instructions, each with a valid plan', () => {
    expect(TEMPLATES).toHaveLength(5);
    for (const t of TEMPLATES) expect(() => AnalysisPlan.parse(templatePlan(t.id))).not.toThrow();
    expect(() => AnalysisPlan.parse(fallbackPlan())).not.toThrow();
  });

  it('matches a template by id or by exact instruction text', () => {
    expect(findTemplateId('anything', 'financial_position')).toBe('financial_position');
    expect(findTemplateId('  compare the information across all uploaded documents. ')).toBe('compare_all');
    expect(findTemplateId('Something custom')).toBeNull();
    expect(findTemplateId('Something custom', 'unknown-id')).toBeNull();
  });

  it('enriches known attribute keys with library synonyms', () => {
    const a = enrichAttribute({ key: 'annual_revenue', label: 'Revenue', valueType: 'money', required: true });
    expect(a.synonyms).toContain('turnover');
  });
});

describe('sanitizePlan (LLM plan clean-up)', () => {
  it('normalises keys, removes duplicates and empties', () => {
    const plan = sanitizePlan({
      attributes: [
        { key: 'Licence Number', label: 'Licence number', valueType: 'identifier', required: true },
        { key: 'licence-number', label: 'dup', valueType: 'identifier', required: false },
        { key: '123', label: 'bad key', valueType: 'text', required: false },
        { key: 'net_profit', label: '  ', valueType: 'money', required: false },
      ],
    });
    expect(plan.source).toBe('llm');
    expect(plan.attributes.map((a) => a.key)).toEqual(['licence_number']);
    expect(() => AnalysisPlan.parse(plan)).not.toThrow();
  });

  it('falls back to the generic plan when nothing usable is proposed', () => {
    expect(sanitizePlan({ attributes: [] }).source).toBe('fallback');
  });
});

describe('deterministic extraction', () => {
  const fact = (label: string, rawValue: string, type: FactRecord['type'] = 'labelled_field'): FactRecord => ({
    id: `f-${label}`,
    documentId: 'd',
    chunkId: 'c1',
    pageNo: 1,
    type,
    label,
    rawValue,
    normalized: null,
    charStart: 0,
    charEnd: rawValue.length,
  });

  it('matches form labels and CSV headers to attributes via synonyms', () => {
    expect(matchFact(ATTRIBUTE_LIBRARY.annual_revenue!, [fact('Declared annual revenue', '£1,250,000')])?.rawValue).toBe('£1,250,000');
    expect(matchFact(ATTRIBUTE_LIBRARY.annual_revenue!, [fact('revenue', '1180000', 'table_cell')])?.rawValue).toBe('1180000');
    expect(matchFact(ATTRIBUTE_LIBRARY.company_name!, [fact('Account name', 'Northwind Ltd')])?.rawValue).toBe('Northwind Ltd');
  });

  it('does not let a short synonym match a longer, different label', () => {
    // "name" must not match "Company name" for the applicant
    expect(matchFact(ATTRIBUTE_LIBRARY.applicant_name!, [fact('Company name', 'Northwind Ltd')])).toBeUndefined();
  });

  it('rejects values of the wrong type', () => {
    expect(matchFact(ATTRIBUTE_LIBRARY.licence_expiry!, [fact('Expiry date', 'see overleaf')])).toBeUndefined();
    expect(matchFact(ATTRIBUTE_LIBRARY.annual_revenue!, [fact('Revenue', 'not disclosed')])).toBeUndefined();
  });

  it('prefers exact label matches over partial ones', () => {
    const f = matchFact(ATTRIBUTE_LIBRARY.licence_number!, [fact('Previous licence number reference', 'OLD-1'), fact('Licence number', 'LIC-1')]);
    expect(f?.rawValue).toBe('LIC-1');
  });

  it('returns found / not_found for every plan attribute', () => {
    const out = deterministicExtract(fallbackPlan().attributes, {
      chunks: [{ id: 'c1', documentId: 'd', ordinal: 0, ref: 'p1-c1', pageNo: 1, charStart: 0, charEnd: 10, text: '' }],
      facts: [fact('Applicant name', 'Jonathan A. Smith')],
    });
    expect(out.values).toHaveLength(fallbackPlan().attributes.length);
    expect(out.values.filter((v) => v.status === 'found')).toEqual([
      { attribute: 'applicant_name', status: 'found', value: 'Jonathan A. Smith', chunkRef: 'p1-c1', quote: 'Jonathan A. Smith' },
    ]);
  });
});
