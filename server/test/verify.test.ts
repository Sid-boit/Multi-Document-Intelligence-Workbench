import { describe, expect, it } from 'vitest';
import { EvidenceRegistry, locateQuote, normalizeWithMap, quoteSupportsValue, verifyCandidate } from '../src/analysis/verify.js';
import { chunkPages } from '../src/ingestion/chunker.js';
import type { ChunkRecord } from '../src/types.js';

const pages = [
  { pageNo: 1, text: 'Applicant name: Jonathan A. Smith\nExisting licence number: LIC-48213' },
  { pageNo: 2, text: 'Declared annual revenue: £1,250,000\nApplication date: 03/02/2026' },
];
const chunks: ChunkRecord[] = chunkPages(pages, 1000).map((c) => ({ ...c, id: `id-${c.ref}`, documentId: 'd1' }));
const doc = { pages, chunks };

describe('normalizeWithMap', () => {
  it('normalises case, quotes, dashes and whitespace while mapping back to the original', () => {
    const src = 'A  “Quote” – here';
    const { norm, map } = normalizeWithMap(src);
    expect(norm).toBe('a "quote" - here');
    expect(src[map[norm.indexOf('q')]!]).toBe('Q');
  });
});

describe('locateQuote', () => {
  it('finds exact quotes despite case and whitespace differences', () => {
    const hay = 'Line one.\nThe  Licence   holder must RENEW the licence.';
    const loc = locateQuote('the licence holder must renew', hay);
    expect(loc).toMatchObject({ verification: 'exact' });
    expect(hay.slice(loc!.start, loc!.end)).toBe('The  Licence   holder must RENEW');
  });

  it('tolerates OCR noise with a fuzzy match', () => {
    const hay = 'Registered premises: 14 Harbour Road, Bristol BS1 4QA';
    const loc = locateQuote('Registered prernises: 14 Harbour Road', hay);
    expect(loc?.verification).toBe('fuzzy');
    expect(hay.slice(loc!.start, loc!.end)).toContain('Harbour');
  });

  it('returns null for text that is not there', () => {
    expect(locateQuote('the applicant has no criminal record', 'Applicant name: Jonathan')).toBeNull();
    expect(locateQuote('x', 'x')).toBeNull(); // too short to be meaningful
  });
});

describe('quoteSupportsValue', () => {
  it('accepts textual, monetary and date equivalence', () => {
    expect(quoteSupportsValue('Licence number: LIC-48213', 'LIC-48213')).toBe(true);
    expect(quoteSupportsValue('turnover was approximately £1.18m', '£1,180,000')).toBe(true);
    expect(quoteSupportsValue('Application date: 03/02/2026', '3 February 2026')).toBe(true);
    expect(quoteSupportsValue('Licence number: LIC-48213', 'LIC-99999')).toBe(false);
  });
});

describe('verifyCandidate', () => {
  it('verifies a quote in the cited chunk and returns page offsets', () => {
    const v = verifyCandidate({ quote: 'Existing licence number: LIC-48213', value: 'LIC-48213', chunkRef: 'p1-c1' }, doc);
    expect(v).toMatchObject({ pageNo: 1, verification: 'exact' });
    expect(pages[0]!.text.slice(v.charStart!, v.charEnd!)).toBe('Existing licence number: LIC-48213');
  });

  it('recovers when the model cites the wrong chunk', () => {
    const v = verifyCandidate({ quote: 'Declared annual revenue: £1,250,000', value: '£1,250,000', chunkRef: 'p1-c1' }, doc);
    expect(v).toMatchObject({ pageNo: 2, verification: 'exact' });
  });

  it('recovers a paraphrased quote by locating the value itself', () => {
    const v = verifyCandidate({ quote: 'the applicant is called Jonathan Smith', value: 'Jonathan A. Smith', chunkRef: 'p1-c1' }, doc);
    expect(v.verification).toBe('exact');
    expect(pages[0]!.text.slice(v.charStart!, v.charEnd!)).toBe('Jonathan A. Smith');
    expect(v.quote).toBe('Applicant name: Jonathan A. Smith');
  });

  it('rejects a real quote that does not contain the claimed value', () => {
    const v = verifyCandidate({ quote: 'Existing licence number: LIC-48213', value: 'LIC-99999', chunkRef: 'p1-c1' }, doc);
    expect(v.verification).toBe('unverified');
    expect(v.charStart).toBeNull();
  });

  it('marks fabricated evidence as unverified', () => {
    const v = verifyCandidate({ quote: 'Licence revoked in 2024', value: 'revoked', chunkRef: 'p9-c9' }, doc);
    expect(v).toMatchObject({ verification: 'unverified', charStart: null, charEnd: null, pageNo: 1 });
  });
});

describe('EvidenceRegistry', () => {
  const base = { documentId: 'd1', documentName: 'a.pdf', alias: 'D1', pageNo: 1, quote: 'q', verification: 'exact' as const, source: 'llm' as const, attribute: 'x', value: 'v' };

  it('assigns sequential handles and de-duplicates identical spans', () => {
    const r = new EvidenceRegistry();
    expect(r.add({ ...base, charStart: 0, charEnd: 5 })).toBe('E1');
    expect(r.add({ ...base, charStart: 0, charEnd: 5 })).toBe('E1');
    expect(r.add({ ...base, charStart: 6, charEnd: 9 })).toBe('E2');
    expect(r.add({ ...base, charStart: null, charEnd: null })).toBe('E3');
    expect(r.add({ ...base, charStart: null, charEnd: null })).toBe('E4'); // unverified are never merged
    expect(Object.keys(r.toRecord())).toEqual(['E1', 'E2', 'E3', 'E4']);
    expect(r.get('E2')?.handle).toBe('E2');
  });
});
