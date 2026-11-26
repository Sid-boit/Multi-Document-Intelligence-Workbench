import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  isAdjacentTransposition,
  normalizeDate,
  normalizeIdentifier,
  normalizeLabel,
  normalizeMoney,
  normalizeName,
  normalizeNumber,
  normalizeOrganisation,
  parseAddress,
} from '../src/analysis/normalize.js';

describe('normalizeMoney', () => {
  it.each([
    ['£1,250,000', 1_250_000, 'GBP'],
    ['approximately £1.18m', 1_180_000, 'GBP'],
    ['1180000', 1_180_000, null],
    ['GBP 1.2 million', 1_200_000, 'GBP'],
    ['$2.5bn', 2_500_000_000, 'USD'],
    ['€750k', 750_000, 'EUR'],
    ['96,000 EUR', 96_000, 'EUR'],
  ])('%s → %d %s', (raw, amount, currency) => {
    expect(normalizeMoney(raw)).toEqual({ amount, currency });
  });

  it('returns null when there is no number', () => {
    expect(normalizeMoney('not stated')).toBeNull();
  });

  it('formats amounts for display', () => {
    expect(formatMoney({ amount: 1_250_000, currency: 'GBP' })).toBe('£1,250,000');
    expect(formatMoney({ amount: 1_180_000, currency: null })).toBe('1,180,000');
  });
});

describe('normalizeDate (en-GB)', () => {
  it.each([
    ['03/02/2026', '2026-02-03'],
    ['31 March 2026', '2026-03-31'],
    ['2026-03-31', '2026-03-31'],
    ['1st April 2023', '2023-04-01'],
  ])('%s → %s', (raw, iso) => expect(normalizeDate(raw)).toBe(iso));

  it('rejects text that is not a specific date', () => {
    expect(normalizeDate('within 28 days')).toBeNull();
    expect(normalizeDate('n/a')).toBeNull();
  });
});

describe('names and organisations', () => {
  it('ignores titles, initials and punctuation in person names', () => {
    expect(normalizeName('Mr Jonathan A. Smith')).toBe('jonathan smith');
    expect(normalizeName('JONATHAN SMITH')).toBe('jonathan smith');
    expect(normalizeName('Jonathon Smith')).toBe('jonathon smith');
  });

  it('ignores legal suffixes and simple plurals in organisation names', () => {
    expect(normalizeOrganisation('Northwind Fabrication Ltd')).toBe('northwind fabrication');
    expect(normalizeOrganisation('Northwind Fabrications Limited')).toBe('northwind fabrication');
    expect(normalizeOrganisation('Smith & Sons PLC')).toBe('smith and son');
  });
});

describe('parseAddress', () => {
  it('extracts house number and postcode and expands abbreviations', () => {
    expect(parseAddress('14 Harbour Rd, Bristol bs1 4qb')).toEqual({ houseNumber: '14', postcode: 'BS1 4QB', rest: 'harbour road bristol' });
    expect(parseAddress('Flat 2B, Queen Square, London SW1A1AA')).toMatchObject({ houseNumber: '2B', postcode: 'SW1A 1AA' });
  });
});

describe('identifiers, numbers and labels', () => {
  it('normalises identifiers', () => {
    expect(normalizeIdentifier('lic 48-213')).toBe('LIC48213');
  });

  it('detects a single adjacent transposition only', () => {
    expect(isAdjacentTransposition('LIC48213', 'LIC48231')).toBe(true);
    expect(isAdjacentTransposition('LIC48213', 'LIC48213')).toBe(false);
    expect(isAdjacentTransposition('LIC48213', 'LIC48299')).toBe(false);
    expect(isAdjacentTransposition('LIC48213', 'LIC84213')).toBe(true);
    expect(isAdjacentTransposition('ABC', 'ABCD')).toBe(false);
  });

  it('parses numbers and labels', () => {
    expect(normalizeNumber('42 employees')).toBe(42);
    expect(normalizeNumber('-1,234.5')).toBe(-1234.5);
    expect(normalizeNumber('none')).toBeNull();
    expect(normalizeLabel('Annual_Revenue (GBP)')).toBe('annual revenue gbp');
  });
});
