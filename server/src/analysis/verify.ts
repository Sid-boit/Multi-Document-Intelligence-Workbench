import { distance } from 'fastest-levenshtein';
import type { Evidence, Verification } from '@workbench/shared';
import type { LoadedDocument } from '../types.js';
import { normalizeDate, normalizeMoney } from './normalize.js';

/**
 * Provenance verification. Every quote the model returns is located in the actual
 * document text in code. Located quotes get exact character offsets (used for
 * highlighting); quotes that cannot be found are marked "unverified".
 */

interface NormMap {
  norm: string;
  /** map[i] = index in the original string of normalised char i */
  map: number[];
}

const CHAR_MAP: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"',
  '–': '-', '—': '-', '−': '-',
  ' ': ' ',
};

/** Case-fold, unify quotes/dashes, collapse whitespace – keeping a map back to the original. */
export function normalizeWithMap(s: string): NormMap {
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const raw = s[i] ?? '';
    const c = (CHAR_MAP[raw] ?? raw).normalize('NFKC').toLowerCase();
    if (/\s/.test(c)) {
      if (norm.length > 0 && !norm.endsWith(' ')) {
        norm += ' ';
        map.push(i);
      }
      continue;
    }
    for (const ch of c) {
      norm += ch;
      map.push(i);
    }
  }
  return { norm, map };
}

export interface Located {
  start: number;
  end: number;
  verification: Exclude<Verification, 'unverified'>;
}

const FUZZY_MIN_LENGTH = 12;
const FUZZY_THRESHOLD = 0.88;
const FUZZY_MAX_HAYSTACK = 60_000;

/** Find `quote` in `haystack`: exact (after normalisation) first, then fuzzy (OCR noise). */
export function locateQuote(quote: string, haystack: string): Located | null {
  const q = normalizeWithMap(quote).norm.trim();
  if (q.length < 2) return null;
  const h = normalizeWithMap(haystack);

  const idx = h.norm.indexOf(q);
  if (idx >= 0) return toLocated(h, idx, q.length, 'exact');

  if (q.length < FUZZY_MIN_LENGTH || h.norm.length < q.length || h.norm.length > FUZZY_MAX_HAYSTACK) return null;
  let best = { score: 0, idx: -1 };
  for (let i = 0; i + q.length <= h.norm.length; i++) {
    const window = h.norm.slice(i, i + q.length);
    const score = 1 - distance(q, window) / q.length;
    if (score > best.score) best = { score, idx: i };
  }
  return best.score >= FUZZY_THRESHOLD ? toLocated(h, best.idx, q.length, 'fuzzy') : null;
}

function toLocated(h: NormMap, idx: number, len: number, verification: Located['verification']): Located {
  const start = h.map[idx] ?? 0;
  const end = (h.map[idx + len - 1] ?? start) + 1;
  return { start, end, verification };
}

/** Does the quote actually contain the value (textually, or as the same amount / date)? */
export function quoteSupportsValue(quote: string, value: string): boolean {
  const nq = normalizeWithMap(quote).norm;
  const nv = normalizeWithMap(value).norm.trim();
  if (nv.length === 0 || nq.includes(nv)) return true;
  const mv = normalizeMoney(value);
  const mq = normalizeMoney(quote);
  if (mv && mq && mv.amount === mq.amount) return true;
  const dv = normalizeDate(value);
  return dv !== null && dv === normalizeDate(quote);
}

const MONEY_OR_NUMBER_RE = /(?:\b(?:GBP|USD|EUR)\s?|[£$€]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|thousand|mn|m|million|bn|billion)\b)?/gi;

/**
 * Return the value exactly as written in the source. Models sometimes reformat values
 * (e.g. "1180000" → "$1,180,000"); if the literal text is not in the quote but an
 * equivalent amount/date is, the source spelling is used instead.
 */
export function literalValue(sourceText: string, value: string): string {
  const nv = normalizeWithMap(value).norm.trim();
  if (nv.length === 0 || normalizeWithMap(sourceText).norm.includes(nv)) return value;
  const date = normalizeDate(value);
  if (date) {
    for (const piece of sourceText.split(/[\n;,]/)) {
      if (normalizeDate(piece) === date) return piece.replace(/^[^:=]*[:=]\s*/, '').trim();
    }
    return value;
  }
  const money = normalizeMoney(value);
  if (money) {
    for (const m of sourceText.matchAll(MONEY_OR_NUMBER_RE)) {
      const found = normalizeMoney(m[0]);
      if (found && found.amount === money.amount) return m[0].trim();
    }
  }
  return value;
}

export interface Candidate {
  quote: string | null;
  value: string | null;
  chunkRef: string | null;
}

export interface VerifiedLocation {
  pageNo: number;
  charStart: number | null;
  charEnd: number | null;
  quote: string;
  verification: Verification;
}

/** Expand a span to its surrounding line (max ~200 chars) for a readable quote. */
function lineContext(text: string, start: number, end: number): string {
  const ls = Math.max(text.lastIndexOf('\n', start - 1) + 1, start - 100);
  const nl = text.indexOf('\n', end);
  const le = Math.min(nl === -1 ? text.length : nl, end + 100);
  return text.slice(ls, le).trim();
}

/**
 * Verify a model-provided (quote, value, chunkRef) against one document.
 * Search order: cited chunk → whole document (recovers a wrong chunk ref) → the
 * bare value (recovers a paraphrased quote) → unverified.
 */
export function verifyCandidate(c: Candidate, doc: Pick<LoadedDocument, 'chunks' | 'pages'>): VerifiedLocation {
  const chunk = c.chunkRef ? doc.chunks.find((ch) => ch.ref === c.chunkRef) : undefined;

  const search = (needle: string): { pageNo: number; loc: Located } | null => {
    if (chunk) {
      const loc = locateQuote(needle, chunk.text);
      if (loc) return { pageNo: chunk.pageNo, loc: { ...loc, start: loc.start + chunk.charStart, end: loc.end + chunk.charStart } };
    }
    for (const page of doc.pages) {
      const loc = locateQuote(needle, page.text);
      if (loc) return { pageNo: page.pageNo, loc };
    }
    return null;
  };

  const pageText = (pageNo: number) => doc.pages.find((p) => p.pageNo === pageNo)?.text ?? '';

  if (c.quote && c.quote.trim().length > 0) {
    const hit = search(c.quote);
    if (hit) {
      const text = pageText(hit.pageNo);
      const actual = text.slice(hit.loc.start, hit.loc.end);
      if (!c.value || quoteSupportsValue(actual, c.value)) {
        return { pageNo: hit.pageNo, charStart: hit.loc.start, charEnd: hit.loc.end, quote: actual, verification: hit.loc.verification };
      }
    }
  }

  if (c.value && c.value.trim().length > 0) {
    const hit = search(c.value);
    if (hit) {
      const text = pageText(hit.pageNo);
      return {
        pageNo: hit.pageNo,
        charStart: hit.loc.start,
        charEnd: hit.loc.end,
        quote: lineContext(text, hit.loc.start, hit.loc.end),
        verification: hit.loc.verification,
      };
    }
  }

  return {
    pageNo: chunk?.pageNo ?? doc.pages[0]?.pageNo ?? 1,
    charStart: null,
    charEnd: null,
    quote: (c.quote ?? c.value ?? '').slice(0, 300),
    verification: 'unverified',
  };
}

/** Assigns stable short handles (E1, E2, …) and de-duplicates identical spans. */
export class EvidenceRegistry {
  private readonly items = new Map<string, Evidence>();
  private readonly bySpan = new Map<string, string>();

  add(e: Omit<Evidence, 'handle'>): string {
    const spanKey =
      e.charStart !== null ? `${e.documentId}|${e.pageNo}|${e.charStart}|${e.charEnd}|${e.attribute ?? ''}` : null;
    if (spanKey) {
      const existing = this.bySpan.get(spanKey);
      if (existing) return existing;
    }
    const handle = `E${this.items.size + 1}`;
    this.items.set(handle, { ...e, handle });
    if (spanKey) this.bySpan.set(spanKey, handle);
    return handle;
  }

  get(handle: string): Evidence | undefined {
    return this.items.get(handle);
  }

  has(handle: string): boolean {
    return this.items.has(handle);
  }

  toRecord(): Record<string, Evidence> {
    return Object.fromEntries(this.items);
  }
}
