import { findDates, findPostcodes, normalizeIdentifier, normalizeMoney } from '../analysis/normalize.js';
import type { FactType, PageRecord } from '../types.js';

/**
 * Deterministic fact extraction (no AI). Everything found here is tier "extracted":
 * it is read verbatim from the page and carries exact character offsets.
 */

export interface ExtractedFact {
  type: FactType;
  label: string | null;
  rawValue: string;
  normalized: string | null;
  pageNo: number;
  charStart: number; // offsets within the page text
  charEnd: number;
}

const LABEL_LINE_RE = /^(\s*(?:[-*•]\s+)?(?:\*\*)?)([A-Za-z][A-Za-z0-9 ()/&',.#-]{0,48}?)(?:\*\*)?\s*:(?:\*\*)?[ \t]*(.*)$/;
const CSV_ROW_RE = /^Row \d+: /;
const BLANK_VALUE_RE = /^(?:[_.\-–—\s]*|\[?\s*(?:blank|none|not provided|n\/a|tbc)\s*\]?)$/i;
const MONEY_GLOBAL_RE =
  /(?:\b(?:GBP|USD|EUR)\s?|[£$€]\s?)\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s?(?:k|thousand|mn|m|million|bn|billion)\b)?|\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?(?:GBP|USD|EUR)\b/gi;
const IDENTIFIER_RE = /\b[A-Z]{2,5}-\d{3,}\b|\b[A-Z]{2,5}\d{5,}\b/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(?:\+44\s?\d{2,4}|\b0\d{2,4})[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;

function* matches(re: RegExp, text: string): Generator<RegExpExecArray> {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = global.exec(text)) !== null) {
    if (m[0].length === 0) global.lastIndex++;
    else yield m;
  }
}

export function extractFacts(page: PageRecord): ExtractedFact[] {
  const { text, pageNo } = page;
  const facts: ExtractedFact[] = [];

  // 1. Line-based: "Label: Value" form fields, blank form fields and CSV rows.
  let offset = 0;
  for (const line of text.split('\n')) {
    if (CSV_ROW_RE.test(line)) {
      facts.push(...csvCells(line, offset, pageNo));
    } else if (!line.startsWith('Columns: ')) {
      const m = LABEL_LINE_RE.exec(line);
      const label = m?.[2]?.trim();
      if (m && label && label.split(/\s+/).length <= 6 && !/^https?$/i.test(label)) {
        const rawValue = (m[3] ?? '').replace(/\*\*$/, '').trim();
        const labelStart = offset + (m[1]?.length ?? 0);
        if (BLANK_VALUE_RE.test(rawValue)) {
          facts.push({
            type: 'blank_field',
            label,
            rawValue: line.trim(),
            normalized: null,
            pageNo,
            charStart: labelStart,
            charEnd: offset + line.trimEnd().length,
          });
        } else {
          const valueStart = offset + line.indexOf(rawValue, (m[1]?.length ?? 0) + label.length);
          facts.push({
            type: 'labelled_field',
            label,
            rawValue,
            normalized: null,
            pageNo,
            charStart: valueStart,
            charEnd: valueStart + rawValue.length,
          });
        }
      }
    }
    offset += line.length + 1;
  }

  // 2. Typed entities anywhere in the text.
  for (const m of matches(MONEY_GLOBAL_RE, text)) {
    const money = normalizeMoney(m[0]);
    if (money) facts.push(entity('money', m, pageNo, JSON.stringify(money)));
  }
  for (const d of findDates(text)) {
    facts.push({ type: 'date', label: null, rawValue: d.text, normalized: d.iso, pageNo, charStart: d.index, charEnd: d.index + d.text.length });
  }
  for (const m of matches(IDENTIFIER_RE, text)) facts.push(entity('identifier', m, pageNo, normalizeIdentifier(m[0])));
  for (const m of matches(EMAIL_RE, text)) facts.push(entity('email', m, pageNo, m[0].toLowerCase()));
  for (const m of matches(PHONE_RE, text)) facts.push(entity('phone', m, pageNo, m[0].replace(/[\s-]/g, '')));
  for (const p of findPostcodes(text)) {
    facts.push({ type: 'postcode', label: null, rawValue: p.text, normalized: p.normalized, pageNo, charStart: p.index, charEnd: p.index + p.text.length });
  }

  return facts.sort((a, b) => a.charStart - b.charStart);
}

function entity(type: FactType, m: RegExpExecArray, pageNo: number, normalized: string | null): ExtractedFact {
  return { type, label: null, rawValue: m[0], normalized, pageNo, charStart: m.index, charEnd: m.index + m[0].length };
}

/** "Row 1: company=Acme; revenue=100" → one table_cell fact per non-empty cell. */
function csvCells(line: string, lineOffset: number, pageNo: number): ExtractedFact[] {
  const out: ExtractedFact[] = [];
  const body = line.replace(CSV_ROW_RE, '');
  let cursor = line.length - body.length;
  for (const part of body.split('; ')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      const label = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (value.length > 0) {
        const valueStart = lineOffset + cursor + eq + 1 + (part.slice(eq + 1).length - part.slice(eq + 1).trimStart().length);
        out.push({ type: 'table_cell', label, rawValue: value, normalized: null, pageNo, charStart: valueStart, charEnd: valueStart + value.length });
      }
    }
    cursor += part.length + 2;
  }
  return out;
}

const INJECTION_RE =
  /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|all|earlier)\b.{0,40}\b(instructions?|prompts?|rules?)\b|\bsystem prompt\b|\byou are now\b|\bact as (an?|the) (ai|assistant|model)\b|\breport no (discrepancies|issues)\b/i;

/** Heuristic detector for text that tries to instruct an AI model. */
export function looksLikePromptInjection(text: string): boolean {
  return INJECTION_RE.test(text.replace(/\s+/g, ' '));
}
