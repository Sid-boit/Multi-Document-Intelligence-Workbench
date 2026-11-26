import { PDFParse } from 'pdf-parse';
import { ExtractionError, normalizeText, type DocumentExtractor, type ExtractionOutput } from './types.js';

const MIN_TEXT_CHARS = 20;

/** Extracts the text layer of a PDF, page by page (keeps page numbers for provenance). */
export class PdfExtractor implements DocumentExtractor {
  readonly formats = ['pdf'] as const;

  async extract({ bytes }: { bytes: Uint8Array }): Promise<ExtractionOutput> {
    // pdf.js may transfer the underlying buffer, so give it a private copy.
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      let result;
      try {
        result = await parser.getText();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/password/i.test(msg)) throw new ExtractionError('The PDF is password-protected.');
        throw new ExtractionError('The PDF is unreadable or corrupt.');
      }

      const pages = result.pages.map((p) => ({ pageNo: p.num, text: normalizeText(p.text).trim() }));
      const totalChars = pages.reduce((n, p) => n + p.text.length, 0);
      if (pages.length === 0 || totalChars < MIN_TEXT_CHARS) {
        throw new ExtractionError(
          'No text layer found (likely a scanned PDF). OCR for scanned PDFs is not supported yet — upload page images instead.',
        );
      }

      const empty = pages.filter((p) => p.text.length === 0).map((p) => p.pageNo);
      const warnings =
        empty.length > 0 ? [{ message: `No text found on page(s) ${empty.join(', ')}.`, degraded: true }] : [];
      return { pages, method: 'text-layer', warnings };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }
}
