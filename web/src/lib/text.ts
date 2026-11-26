import { SUPPORTED_EXTENSIONS } from '@workbench/shared';

export interface HighlightParts {
  before: string;
  match: string;
  after: string;
}

/**
 * Split page text around the evidence span. If offsets are missing (unverified
 * evidence) fall back to a case-insensitive search for the quote; if that fails too,
 * nothing is highlighted.
 */
export function splitForHighlight(text: string, start: number | null, end: number | null, quote?: string): HighlightParts | null {
  if (start !== null && end !== null && start >= 0 && end > start && start < text.length) {
    const e = Math.min(end, text.length);
    return { before: text.slice(0, start), match: text.slice(start, e), after: text.slice(e) };
  }
  if (quote && quote.trim().length > 2) {
    const i = text.toLowerCase().indexOf(quote.trim().toLowerCase());
    if (i >= 0) return { before: text.slice(0, i), match: text.slice(i, i + quote.trim().length), after: text.slice(i + quote.trim().length) };
  }
  return null;
}

export interface PrecheckResult {
  accepted: File[];
  rejected: { name: string; reason: string }[];
}

/** Client-side pre-check for fast feedback. The server remains the authority. */
export function precheckFiles(files: File[], limits: { maxFileMb: number; maxFiles: number }): PrecheckResult {
  const accepted: File[] = [];
  const rejected: PrecheckResult['rejected'] = [];
  for (const f of files) {
    const ext = f.name.includes('.') ? f.name.slice(f.name.lastIndexOf('.')).toLowerCase() : '';
    if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
      // Still sent to the server so the user sees a consistent, recorded rejection.
      accepted.push(f);
    } else if (f.size > limits.maxFileMb * 1_048_576) {
      rejected.push({ name: f.name, reason: `Larger than ${limits.maxFileMb} MB` });
    } else {
      accepted.push(f);
    }
  }
  if (accepted.length > limits.maxFiles) {
    for (const f of accepted.splice(limits.maxFiles)) rejected.push({ name: f.name, reason: `At most ${limits.maxFiles} files per upload` });
  }
  return { accepted, rejected };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}
