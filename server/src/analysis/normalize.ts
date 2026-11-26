import * as chrono from 'chrono-node';

/**
 * Pure, deterministic normalisers. They turn surface forms into comparable values
 * so that e.g. "£1.18m", "1,180,000" and "GBP 1180000" compare as equal.
 */

/* Money ----------------------------------------------------------------------- */

export interface Money {
  amount: number;
  currency: string | null; // ISO code when known
}

const CURRENCY_SYMBOLS: Record<string, string> = { '£': 'GBP', $: 'USD', '€': 'EUR' };
const MAGNITUDES: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  bn: 1e9,
  billion: 1e9,
};

const MONEY_RE =
  /(?:\b(GBP|USD|EUR)\s?|([£$€])\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(k|thousand|mn|m|million|bn|billion)\b)?(?:\s?(GBP|USD|EUR)\b)?/i;

export function normalizeMoney(raw: string): Money | null {
  const m = MONEY_RE.exec(raw);
  if (!m) return null;
  const [, codeBefore, symbol, num, magnitude, codeAfter] = m;
  if (!num) return null;
  const base = Number.parseFloat(num.replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const mult = magnitude ? (MAGNITUDES[magnitude.toLowerCase()] ?? 1) : 1;
  const currency =
    codeBefore?.toUpperCase() ?? (symbol ? (CURRENCY_SYMBOLS[symbol] ?? null) : null) ?? codeAfter?.toUpperCase() ?? null;
  return { amount: Math.round(base * mult * 100) / 100, currency };
}

export function formatMoney(m: Money): string {
  const symbol = Object.entries(CURRENCY_SYMBOLS).find(([, code]) => code === m.currency)?.[0] ?? '';
  const n = m.amount.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  return symbol ? `${symbol}${n}` : m.currency ? `${m.currency} ${n}` : n;
}

/* Dates ------------------------------------------------------------------------ */

function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Parse a date written in British conventions (03/02/2026 = 3 Feb 2026) to ISO. */
export function normalizeDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const results = chrono.en.GB.parse(trimmed);
  const first = results.find(
    (r) => r.start.isCertain('year') && r.start.isCertain('month') && /\d/.test(r.text) && !/\b(day|week|month|year)s?\b/i.test(r.text),
  );
  return first ? isoLocal(first.start.date()) : null;
}

export interface DateMatch {
  index: number;
  text: string;
  iso: string;
}

/** Find all fully specified dates (day, month and an explicitly written year) in free text. */
export function findDates(text: string): DateMatch[] {
  return chrono.en.GB.parse(text)
    // relative expressions ("within 28 days") are resolved against today by chrono; we only
    // want absolute dates that are literally written in the document.
    .filter((r) => /\b(?:1[89]|20)\d{2}\b/.test(r.text) || /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2}\b/.test(r.text))
    .filter((r) => r.start.isCertain('year') && r.start.isCertain('month') && r.start.isCertain('day'))
    .map((r) => ({ index: r.index, text: r.text, iso: isoLocal(r.start.date()) }));
}

/* Names & organisations --------------------------------------------------------- */

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'dame', 'mx']);

function stripDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '');
}

function tokens(s: string): string[] {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** "Mr Jonathan A. Smith" → "jonathan smith" (titles and initials removed). */
export function normalizeName(raw: string): string {
  return tokens(raw)
    .filter((t) => !TITLES.has(t) && t.length > 1)
    .join(' ');
}

const ORG_SUFFIXES = new Set(['ltd', 'limited', 'plc', 'llp', 'llc', 'inc', 'incorporated', 'co', 'company', 'corp', 'the']);

/** "Northwind Fabrications Limited" → "northwind fabrication" */
export function normalizeOrganisation(raw: string): string {
  return tokens(raw.replace(/&/g, ' and '))
    .filter((t) => !ORG_SUFFIXES.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t))
    .join(' ');
}

/* Addresses ----------------------------------------------------------------------- */

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const STREET_ABBREVIATIONS: Record<string, string> = {
  rd: 'road',
  st: 'street',
  ave: 'avenue',
  av: 'avenue',
  ln: 'lane',
  dr: 'drive',
  ct: 'court',
  pl: 'place',
  sq: 'square',
  cres: 'crescent',
};

export interface ParsedAddress {
  houseNumber: string | null;
  postcode: string | null;
  /** Remaining tokens, normalised (abbreviations expanded). */
  rest: string;
}

export function parseAddress(raw: string): ParsedAddress {
  const pc = UK_POSTCODE_RE.exec(raw);
  const postcode = pc ? `${pc[1]} ${pc[2]}`.toUpperCase() : null;
  const withoutPostcode = pc ? raw.replace(pc[0], ' ') : raw;
  const house = /\b(\d+[a-z]?)\b/i.exec(withoutPostcode);
  const houseNumber = house?.[1]?.toUpperCase() ?? null;
  const withoutHouse = house ? withoutPostcode.replace(house[0], ' ') : withoutPostcode;
  const rest = tokens(withoutHouse)
    .map((t) => STREET_ABBREVIATIONS[t] ?? t)
    .join(' ');
  return { houseNumber, postcode, rest };
}

export function findPostcodes(text: string): { index: number; text: string; normalized: string }[] {
  const re = new RegExp(UK_POSTCODE_RE.source, 'gi');
  const out: { index: number; text: string; normalized: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, text: m[0], normalized: `${m[1]} ${m[2]}`.toUpperCase() });
  }
  return out;
}

/* Identifiers, numbers, text ------------------------------------------------------- */

/** "lic 48-213" → "LIC48213" */
export function normalizeIdentifier(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** True when b is a with exactly one pair of adjacent characters swapped. */
export function isAdjacentTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const diffs: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
  if (diffs.length !== 2) return false;
  const [i, j] = diffs as [number, number];
  return j === i + 1 && a[i] === b[j] && a[j] === b[i];
}

export function normalizeNumber(raw: string): number | null {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(raw);
  if (!m) return null;
  const n = Number.parseFloat(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function normalizeFreeText(raw: string): string {
  return stripDiacritics(raw).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Normalise a field label / CSV header for matching: "Annual_Revenue (GBP)" → "annual revenue gbp" */
export function normalizeLabel(raw: string): string {
  return tokens(raw.replace(/[_-]/g, ' ')).join(' ');
}
