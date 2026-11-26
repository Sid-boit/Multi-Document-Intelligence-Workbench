import { describe, expect, it } from 'vitest';
import { chunkForOffset, chunkPages } from '../src/ingestion/chunker.js';
import { windowChunks } from '../src/analysis/pipeline.js';
import type { ChunkRecord } from '../src/types.js';

const para = (n: number, len = 120) => `Paragraph ${n}. ${'lorem ipsum '.repeat(Math.ceil(len / 12)).slice(0, len)}`;

describe('chunkPages', () => {
  it('keeps exact offsets: chunk text equals the page slice', () => {
    const page = { pageNo: 1, text: Array.from({ length: 20 }, (_, i) => para(i)).join('\n\n') };
    const chunks = chunkPages([page], 500);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.text).toBe(page.text.slice(c.charStart, c.charEnd));
      expect(c.text.length).toBeLessThanOrEqual(500);
    }
  });

  it('never crosses page boundaries and numbers refs per page', () => {
    const chunks = chunkPages(
      [
        { pageNo: 1, text: 'Alpha page one.' },
        { pageNo: 2, text: 'Beta page two.' },
      ],
      1000,
    );
    expect(chunks.map((c) => [c.ref, c.pageNo, c.text])).toEqual([
      ['p1-c1', 1, 'Alpha page one.'],
      ['p2-c1', 2, 'Beta page two.'],
    ]);
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1]);
  });

  it('prefers paragraph breaks over cutting mid-sentence', () => {
    const text = `${'a'.repeat(300)}\n\n${'b'.repeat(300)}`;
    const chunks = chunkPages([{ pageNo: 1, text }], 400);
    expect(chunks[0]!.text).toBe('a'.repeat(300));
    expect(chunks[1]!.text).toBe('b'.repeat(300));
  });

  it('hard-splits text without any break opportunity and skips empty pages', () => {
    const chunks = chunkPages([{ pageNo: 1, text: 'x'.repeat(1000) }, { pageNo: 2, text: '   ' }], 300);
    expect(chunks.map((c) => c.text.length)).toEqual([300, 300, 300, 100]);
    expect(chunks.every((c) => c.pageNo === 1)).toBe(true);
  });
});

describe('chunkForOffset', () => {
  it('finds the chunk containing an offset, or the closest preceding one', () => {
    const chunks = chunkPages([{ pageNo: 1, text: `${'a'.repeat(50)}\n\n\n${'b'.repeat(50)}` }], 60);
    expect(chunkForOffset(chunks, 1, 10)?.ref).toBe('p1-c1');
    expect(chunkForOffset(chunks, 1, 51)?.ref).toBe('p1-c1'); // whitespace gap
    expect(chunkForOffset(chunks, 1, 60)?.ref).toBe('p1-c2');
    expect(chunkForOffset(chunks, 2, 0)).toBeUndefined();
  });
});

describe('windowChunks (large documents)', () => {
  const mk = (n: number, len: number): ChunkRecord => ({ id: `c${n}`, documentId: 'd', ordinal: n, ref: `p1-c${n}`, pageNo: 1, charStart: 0, charEnd: len, text: 'x'.repeat(len) });

  it('groups chunks into windows that fit the character budget', () => {
    const windows = windowChunks([mk(1, 400), mk(2, 400), mk(3, 400), mk(4, 100)], 900);
    expect(windows.map((w) => w.map((c) => c.id))).toEqual([['c1', 'c2'], ['c3', 'c4']]);
  });

  it('puts an oversized chunk in its own window and handles empty input', () => {
    expect(windowChunks([mk(1, 2000), mk(2, 10)], 900).map((w) => w.length)).toEqual([1, 1]);
    expect(windowChunks([], 900)).toEqual([[]]);
  });
});
