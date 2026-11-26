import type { PageRecord } from '../types.js';

export interface PlannedChunk {
  ordinal: number;
  ref: string; // "p{page}-c{n}"
  pageNo: number;
  charStart: number; // offsets within the page text
  charEnd: number;
  text: string;
}

/**
 * Split pages into chunks of at most `maxChars`, never crossing a page boundary.
 * Prefers to break at a blank line, then a newline, then a sentence end, then a space.
 * Offsets are exact (chunk.text === page.text.slice(charStart, charEnd)), which is what
 * lets evidence be located precisely later.
 */
export function chunkPages(pages: PageRecord[], maxChars: number): PlannedChunk[] {
  const chunks: PlannedChunk[] = [];
  let ordinal = 0;
  for (const page of pages) {
    const text = page.text;
    let start = 0;
    let n = 0;
    while (start < text.length) {
      // skip leading whitespace so chunks start on content
      while (start < text.length && /\s/.test(text[start] ?? '')) start++;
      if (start >= text.length) break;
      let end = Math.min(start + maxChars, text.length);
      if (end < text.length) end = findBreak(text, start, end);
      const slice = text.slice(start, end);
      const trimmedEnd = start + slice.trimEnd().length;
      if (trimmedEnd > start) {
        n++;
        chunks.push({
          ordinal: ordinal++,
          ref: `p${page.pageNo}-c${n}`,
          pageNo: page.pageNo,
          charStart: start,
          charEnd: trimmedEnd,
          text: text.slice(start, trimmedEnd),
        });
      }
      start = end;
    }
  }
  return chunks;
}

function findBreak(text: string, start: number, hardEnd: number): number {
  const minEnd = start + Math.floor((hardEnd - start) * 0.5);
  const window = text.slice(minEnd, hardEnd);
  const candidates: RegExp[] = [/\n\s*\n/g, /\n/g, /[.!?]\s/g, /\s/g];
  for (const re of candidates) {
    let last = -1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(window)) !== null) last = m.index + m[0].length;
    if (last > 0) return minEnd + last;
  }
  return hardEnd;
}

/** Find the chunk containing a page offset (used to attach facts to chunks). */
export function chunkForOffset<T extends { pageNo: number; charStart: number; charEnd: number }>(
  chunks: T[],
  pageNo: number,
  offset: number,
): T | undefined {
  const onPage = chunks.filter((c) => c.pageNo === pageNo);
  return (
    onPage.find((c) => offset >= c.charStart && offset < c.charEnd) ??
    // offset fell in inter-chunk whitespace: use the closest preceding chunk
    [...onPage].reverse().find((c) => c.charStart <= offset) ??
    onPage[0]
  );
}
