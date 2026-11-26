import type { DocumentFormat } from '@workbench/shared';
import { CsvExtractor } from './csv.js';
import { ImageExtractor, type OcrEngine } from './image.js';
import { PdfExtractor } from './pdf.js';
import { TextExtractor } from './text.js';
import type { DocumentExtractor } from './types.js';

export * from './types.js';
export { createTesseractEngine, type OcrEngine, type OcrResult } from './image.js';

/** Registry: maps each supported format to its extractor. Adding a format = adding one class. */
export class ExtractorRegistry {
  private readonly byFormat = new Map<DocumentFormat, DocumentExtractor>();

  constructor(extractors: DocumentExtractor[]) {
    for (const ex of extractors) for (const f of ex.formats) this.byFormat.set(f, ex);
  }

  get(format: DocumentFormat): DocumentExtractor {
    const ex = this.byFormat.get(format);
    if (!ex) throw new Error(`No extractor registered for ${format}`);
    return ex;
  }

  static default(ocr: OcrEngine): ExtractorRegistry {
    return new ExtractorRegistry([new PdfExtractor(), new ImageExtractor(ocr), new CsvExtractor(), new TextExtractor()]);
  }
}
