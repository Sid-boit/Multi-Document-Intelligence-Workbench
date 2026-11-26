import { ExtractionError, normalizeText, type DocumentExtractor, type ExtractionOutput } from './types.js';

/** Plain text and Markdown: a single logical page. */
export class TextExtractor implements DocumentExtractor {
  readonly formats = ['txt', 'md'] as const;

  async extract({ text }: { bytes: Uint8Array; text?: string }): Promise<ExtractionOutput> {
    if (text === undefined) throw new ExtractionError('Text was not decoded.');
    const normalized = normalizeText(text).trim();
    if (normalized.length === 0) throw new ExtractionError('The file contains no text.');
    return { pages: [{ pageNo: 1, text: normalized }], method: 'native', warnings: [] };
  }
}
