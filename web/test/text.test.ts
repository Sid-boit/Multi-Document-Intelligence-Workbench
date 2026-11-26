import { describe, expect, it } from 'vitest';
import { formatBytes, precheckFiles, splitForHighlight } from '../src/lib/text';

describe('splitForHighlight', () => {
  const text = 'Applicant name: Jonathan A. Smith\nLicence: LIC-48213';

  it('splits around exact offsets', () => {
    expect(splitForHighlight(text, 16, 33)).toEqual({ before: 'Applicant name: ', match: 'Jonathan A. Smith', after: '\nLicence: LIC-48213' });
  });

  it('falls back to searching for the quote when offsets are missing', () => {
    expect(splitForHighlight(text, null, null, 'lic-48213')?.match).toBe('LIC-48213');
  });

  it('returns null when nothing can be highlighted', () => {
    expect(splitForHighlight(text, null, null, 'not present')).toBeNull();
    expect(splitForHighlight(text, 500, 600)).toBeNull();
  });

  it('clamps an end offset past the text', () => {
    expect(splitForHighlight('abc', 1, 99)).toEqual({ before: 'a', match: 'bc', after: '' });
  });
});

describe('precheckFiles', () => {
  const file = (name: string, size: number) => new File([new Uint8Array(size)], name);
  const limits = { maxFileMb: 1, maxFiles: 2 };

  it('rejects oversize files locally', () => {
    const r = precheckFiles([file('big.pdf', 2 * 1_048_576), file('ok.txt', 10)], limits);
    expect(r.accepted.map((f) => f.name)).toEqual(['ok.txt']);
    expect(r.rejected).toEqual([{ name: 'big.pdf', reason: 'Larger than 1 MB' }]);
  });

  it('still sends unsupported types so the server records the reason', () => {
    expect(precheckFiles([file('notes.docx', 10)], limits).accepted).toHaveLength(1);
  });

  it('enforces the per-upload file count', () => {
    const r = precheckFiles([file('a.txt', 1), file('b.txt', 1), file('c.txt', 1)], limits);
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected[0]).toEqual({ name: 'c.txt', reason: 'At most 2 files per upload' });
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1_048_576)).toBe('3.0 MB');
  });
});
