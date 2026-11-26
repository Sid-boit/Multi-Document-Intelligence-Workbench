import { describe, expect, it } from 'vitest';
import { guardFile, sanitizeFilename } from '../src/ingestion/guard.js';
import { sample } from './helpers.js';

const MB = 1_048_576;
const bytes = (s: string | Buffer) => new Uint8Array(typeof s === 'string' ? Buffer.from(s) : s);

describe('guardFile', () => {
  it('accepts real PDF, PNG, CSV, TXT and MD files and reports the detected type', async () => {
    await expect(guardFile('a.pdf', bytes(sample('application_form.pdf')), 15 * MB)).resolves.toMatchObject({ ok: true, format: 'pdf', mimeType: 'application/pdf' });
    await expect(guardFile('a.PNG', bytes(sample('licence_certificate.png')), 15 * MB)).resolves.toMatchObject({ ok: true, format: 'png' });
    await expect(guardFile('a.csv', bytes(sample('financials_2025.csv')), 15 * MB)).resolves.toMatchObject({ ok: true, format: 'csv' });
    await expect(guardFile('a.txt', bytes('hello world'), 15 * MB)).resolves.toMatchObject({ ok: true, format: 'txt', text: 'hello world' });
    await expect(guardFile('a.md', bytes('# Title'), 15 * MB)).resolves.toMatchObject({ ok: true, format: 'md' });
  });

  it('rejects unsupported extensions, including files without one', async () => {
    await expect(guardFile('notes.docx', bytes('PK\x03\x04....'), MB)).resolves.toMatchObject({ ok: false, code: 'unsupported_type' });
    await expect(guardFile('README', bytes('text'), MB)).resolves.toMatchObject({ ok: false, code: 'unsupported_type' });
  });

  it('rejects an executable disguised as a PDF (magic bytes win over the extension)', async () => {
    const r = await guardFile('invoice.pdf', bytes(sample('invalid/fake_invoice.pdf')), MB);
    expect(r).toMatchObject({ ok: false, code: 'content_mismatch' });
    if (!r.ok) expect(r.reason).toContain('application/x-msdownload');
  });

  it('rejects a binary file disguised as text', async () => {
    await expect(guardFile('data.csv', bytes(sample('licence_certificate.png')), MB)).resolves.toMatchObject({ ok: false, code: 'content_mismatch' });
    await expect(guardFile('data.txt', bytes(Buffer.from([0x61, 0x00, 0x62])), MB)).resolves.toMatchObject({ ok: false, code: 'binary_text' });
  });

  it('rejects text that is not UTF-8', async () => {
    await expect(guardFile('latin1.txt', bytes(sample('invalid/latin1_notes.txt')), MB)).resolves.toMatchObject({ ok: false, code: 'bad_encoding' });
  });

  it('rejects empty and whitespace-only files', async () => {
    await expect(guardFile('empty.txt', new Uint8Array(), MB)).resolves.toMatchObject({ ok: false, code: 'empty' });
    await expect(guardFile('blank.txt', bytes('  \n\t '), MB)).resolves.toMatchObject({ ok: false, code: 'empty' });
  });

  it('rejects files over the size limit with a readable reason', async () => {
    const r = await guardFile('big.txt', bytes('x'.repeat(2048)), 1024);
    expect(r).toMatchObject({ ok: false, code: 'too_large' });
  });

  it('strips a UTF-8 byte-order mark', async () => {
    const r = await guardFile('bom.txt', bytes('\uFEFFhello'), MB);
    expect(r).toMatchObject({ ok: true, text: 'hello' });
  });
});

describe('sanitizeFilename', () => {
  it('keeps only the base name (no path traversal)', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\x\\report.pdf')).toBe('report.pdf');
  });

  it('removes control characters and bidi overrides used to disguise extensions', () => {
    expect(sanitizeFilename('invoice\u202Efdp.exe')).toBe('invoicefdp.exe');
    expect(sanitizeFilename('a\u0000b\nc.txt')).toBe('abc.txt');
  });

  it('caps length and falls back to a safe default', () => {
    expect(sanitizeFilename(`${'a'.repeat(300)}.txt`)).toHaveLength(200);
    expect(sanitizeFilename('..')).toBe('document');
    expect(sanitizeFilename('')).toBe('document');
  });
});
