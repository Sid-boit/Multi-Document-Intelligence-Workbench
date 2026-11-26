import { fileTypeFromBuffer } from 'file-type';
import type { DocumentFormat } from '@workbench/shared';

/**
 * Upload guard – the first thing every uploaded file goes through.
 * Nothing is written to disk and nothing is parsed until a file passes here.
 *
 * Checks: extension allow-list, emptiness, size, magic-byte detection that must agree
 * with the extension (client-supplied Content-Type is ignored), and for text formats:
 * no binary signature, no NUL bytes, valid UTF-8.
 */

const EXTENSION_FORMATS: Record<string, DocumentFormat> = {
  '.pdf': 'pdf',
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.csv': 'csv',
  '.txt': 'txt',
  '.md': 'md',
};

const BINARY_MIME: Partial<Record<DocumentFormat, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
};

const TEXT_MIME: Partial<Record<DocumentFormat, string>> = {
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
};

export type GuardRejection = 'unsupported_type' | 'empty' | 'too_large' | 'content_mismatch' | 'binary_text' | 'bad_encoding';

export type GuardResult =
  | { ok: true; format: DocumentFormat; mimeType: string; text?: string }
  | { ok: false; code: GuardRejection; reason: string };

export const SUPPORTED_LABEL = 'PDF, PNG, JPG, CSV, TXT, MD';

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

export async function guardFile(name: string, bytes: Uint8Array, maxBytes: number): Promise<GuardResult> {
  const ext = extensionOf(name);
  const format = EXTENSION_FORMATS[ext];
  if (!format) {
    return {
      ok: false,
      code: 'unsupported_type',
      reason: `Unsupported file type ${ext ? `"${ext}"` : '(no extension)'}. Supported: ${SUPPORTED_LABEL}.`,
    };
  }
  if (bytes.byteLength === 0) return { ok: false, code: 'empty', reason: 'The file is empty.' };
  if (bytes.byteLength > maxBytes) {
    return {
      ok: false,
      code: 'too_large',
      reason: `File is ${(bytes.byteLength / 1_048_576).toFixed(1)} MB; the limit is ${(maxBytes / 1_048_576).toFixed(0)} MB.`,
    };
  }

  const detected = await fileTypeFromBuffer(bytes);
  const expectedBinary = BINARY_MIME[format];

  if (expectedBinary) {
    if (detected?.mime !== expectedBinary) {
      return {
        ok: false,
        code: 'content_mismatch',
        reason: `File content does not match its ${ext} extension (detected: ${detected?.mime ?? 'unknown content'}).`,
      };
    }
    return { ok: true, format, mimeType: expectedBinary };
  }

  // Text formats have no magic bytes: make sure it is not a binary file in disguise.
  if (detected) {
    return {
      ok: false,
      code: 'content_mismatch',
      reason: `File content does not match its ${ext} extension (detected: ${detected.mime}).`,
    };
  }
  if (bytes.includes(0)) {
    return { ok: false, code: 'binary_text', reason: 'The file contains binary data and is not a valid text file.' };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: 'bad_encoding', reason: 'The text is not valid UTF-8. Please re-save the file as UTF-8.' };
  }
  if (text.replace(/^﻿/, '').trim().length === 0) {
    return { ok: false, code: 'empty', reason: 'The file contains no text.' };
  }
  return { ok: true, format, mimeType: TEXT_MIME[format] ?? 'text/plain', text: text.replace(/^﻿/, '') };
}

/**
 * Make a user-supplied filename safe to *display*. It is never used to build a path:
 * files are stored under random UUIDs.
 */
export function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').normalize('NFC');
  const cleaned = base
    // control characters and Unicode bidi overrides (used to disguise extensions)
    .replace(/[\p{Cc}‎‏‪-‮⁦-⁩]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return cleaned.length > 0 && cleaned !== '.' && cleaned !== '..' ? cleaned : 'document';
}
