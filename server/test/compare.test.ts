import { describe, expect, it } from 'vitest';
import type { PlanAttribute, ValueType } from '@workbench/shared';
import { checkExpiry, compareAttribute, compareValues, type AttributeCell } from '../src/analysis/compare.js';

const attr = (key: string, valueType: ValueType, label = key): PlanAttribute => ({ key, label, valueType, required: true, synonyms: [] });

let n = 0;
const ctx = { nextId: () => `F${++n}` };

const cell = (alias: string, value: string | null): AttributeCell => ({
  documentId: `doc-${alias}`,
  alias,
  documentName: `${alias}.pdf`,
  value,
  evidenceHandle: value === null ? null : `E-${alias}`,
});

describe('compareValues', () => {
  it('treats equivalent amounts as consistent and grades real differences', () => {
    expect(compareValues('money', '£1.18m', '1,180,000').relation).toBe('equivalent');
    expect(compareValues('money', '£1,000,000', '£1,005,000').relation).toBe('equivalent'); // within 1%
    expect(compareValues('money', '£1,250,000', '£1.18m')).toMatchObject({ relation: 'mismatch', rule: 'money.mismatch', severity: 'medium' });
    expect(compareValues('money', '£100', '£200')).toMatchObject({ severity: 'high' });
    expect(compareValues('money', '£100', '$100')).toMatchObject({ rule: 'money.currency' });
  });

  it('compares dates regardless of format', () => {
    expect(compareValues('date', '31/03/2026', '31 March 2026').relation).toBe('equivalent');
    expect(compareValues('date', '31/03/2026', '01/04/2026')).toMatchObject({ relation: 'mismatch', rule: 'date.mismatch' });
  });

  it('distinguishes spelling variants from different names', () => {
    expect(compareValues('person_name', 'Jonathan A. Smith', 'Jonathan Smith').relation).toBe('equivalent');
    expect(compareValues('person_name', 'Jonathan A. Smith', 'Jonathon Smith')).toMatchObject({ rule: 'name.spelling_variant', severity: 'medium' });
    expect(compareValues('person_name', 'Jonathan Smith', 'Priya Hartley')).toMatchObject({ rule: 'name.different', severity: 'high' });
  });

  it('treats legal-suffix variants of a company as the same organisation', () => {
    expect(compareValues('organisation', 'Northwind Fabrication Ltd', 'Northwind Fabrications Limited').relation).toBe('equivalent');
    expect(compareValues('organisation', 'Northwind Fabrication Ltd', 'Acme Widgets Ltd').rule).toBe('organisation.different');
  });

  it('pinpoints which part of an address differs', () => {
    expect(compareValues('address', '14 Harbour Road, Bristol BS1 4QA', '14 Harbour Rd, Bristol BS1 4QA').relation).toBe('equivalent');
    expect(compareValues('address', '14 Harbour Road, Bristol BS1 4QA', '41 Harbour Road, Bristol BS1 4QA').rule).toBe('address.house_number');
    expect(compareValues('address', '14 Harbour Road, Bristol BS1 4QA', '14 Harbour Rd, Bristol BS1 4QB').rule).toBe('address.postcode');
    expect(compareValues('address', '14 Harbour Road, Bristol', '9 Mill Lane, Leeds').rule).toBe('address.house_number');
  });

  it('detects transposed identifiers', () => {
    expect(compareValues('identifier', 'LIC-48213', 'lic 48213').relation).toBe('equivalent');
    expect(compareValues('identifier', 'LIC-48213', 'LIC-48231')).toMatchObject({ rule: 'identifier.transposition', severity: 'high' });
    expect(compareValues('identifier', 'LIC-48213', 'LIC-48214').rule).toBe('identifier.typo');
    expect(compareValues('identifier', 'LIC-48213', 'ABC-1').rule).toBe('identifier.different');
  });

  it('falls back to text comparison for unparseable values', () => {
    expect(compareValues('money', 'not stated', 'not stated').relation).toBe('match');
    expect(compareValues('text', 'FY2025', 'fy2025').relation).toBe('match');
    expect(compareValues('text', 'FY2025', 'FY2024').rule).toBe('text.mismatch');
  });
});

describe('compareAttribute', () => {
  it('uses the majority value as reference and reports the outlier with evidence on both sides', () => {
    const { row, findings } = compareAttribute(attr('annual_revenue', 'money', 'Annual revenue'), [cell('D1', '£1,250,000'), cell('D2', '£1.18m'), cell('D3', '1180000'), cell('D4', null)], ctx);
    expect(row.cells.map((c) => c.status)).toEqual(['mismatch', 'match', 'equivalent', 'missing']);
    expect(row.rowStatus).toBe('inconsistent');
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f).toMatchObject({ category: 'discrepancy', tier: 'derived', rule: 'money.mismatch', attribute: 'annual_revenue' });
    expect(f.evidence).toEqual([
      { handle: 'E-D2', role: 'supports' },
      { handle: 'E-D3', role: 'supports' },
      { handle: 'E-D1', role: 'contradicts' },
    ]);
    expect(f.documentIds.sort()).toEqual(['doc-D1', 'doc-D2', 'doc-D3']);
    expect(f.detail).toContain('D1 (D1.pdf) states "£1,250,000"');
  });

  it('on a tie, the first document (e.g. the application form) is the reference', () => {
    const { row, findings } = compareAttribute(attr('licence_number', 'identifier'), [cell('D1', 'LIC-48213'), cell('D2', 'LIC-48231')], ctx);
    expect(row.cells.map((c) => c.status)).toEqual(['match', 'mismatch']);
    expect(findings[0]!.rule).toBe('identifier.transposition');
    expect(findings[0]!.evidence[0]).toEqual({ handle: 'E-D1', role: 'supports' });
  });

  it('reports consistent, partial and not-found rows without findings', () => {
    const a = attr('company_name', 'organisation');
    expect(compareAttribute(a, [cell('D1', 'Northwind Ltd'), cell('D2', 'Northwind Limited')], ctx)).toMatchObject({ row: { rowStatus: 'consistent' }, findings: [] });
    expect(compareAttribute(a, [cell('D1', 'Northwind Ltd'), cell('D2', null)], ctx).row.rowStatus).toBe('partial');
    expect(compareAttribute(a, [cell('D1', null), cell('D2', '  ')], ctx).row.rowStatus).toBe('not_found');
  });

  it('produces one finding per conflicting cluster', () => {
    const { findings } = compareAttribute(attr('address', 'address'), [cell('D1', '14 Harbour Road, Bristol BS1 4QA'), cell('D2', '41 Harbour Road, Bristol BS1 4QA'), cell('D3', '14 Harbour Rd, Bristol BS1 4QB')], ctx);
    expect(findings.map((f) => f.rule)).toEqual(['address.house_number', 'address.postcode']);
  });
});

describe('compareAttribute in side-by-side mode (different entities)', () => {
  it('reports values next to each other without deriving discrepancies', () => {
    const { row, findings } = compareAttribute(attr('annual_revenue', 'money'), [cell('D1', '1180000'), cell('D2', '2450000')], ctx, 'side_by_side');
    expect(findings).toEqual([]);
    expect(row.rowStatus).toBe('compared');
    expect(row.cells.map((c) => c.status)).toEqual(['reported', 'reported']);
  });

  it('marks rows found in only some documents as partial', () => {
    const { row } = compareAttribute(attr('net_profit', 'money'), [cell('D1', '96000'), cell('D2', null)], ctx, 'side_by_side');
    expect(row.rowStatus).toBe('partial');
    expect(row.cells.map((c) => c.status)).toEqual(['reported', 'missing']);
  });
});

describe('checkExpiry', () => {
  const expiry = attr('licence_expiry', 'date', 'Licence expiry date');

  it('flags an expiry before the application date as high severity', () => {
    const f = checkExpiry(expiry, [cell('D2', '01/01/2026')], [cell('D1', '03/02/2026')], '2026-11-26', ctx);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule: 'date.expired', severity: 'high', tier: 'derived' });
    expect(f[0]!.evidence.map((e) => e.handle)).toEqual(['E-D2', 'E-D1']);
  });

  it('flags an expiry before the review date as medium severity', () => {
    const f = checkExpiry(expiry, [cell('D2', '31/03/2026')], [cell('D1', '03/02/2026')], '2026-11-26', ctx);
    expect(f[0]).toMatchObject({ severity: 'medium', title: 'Licence expiry date: expired' });
  });

  it('does not flag a valid licence', () => {
    expect(checkExpiry(expiry, [cell('D2', '31/03/2027')], [cell('D1', '03/02/2026')], '2026-11-26', ctx)).toEqual([]);
  });
});
