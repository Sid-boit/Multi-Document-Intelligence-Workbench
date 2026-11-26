import { createWorker, type Worker } from 'tesseract.js';
import { ExtractionError, normalizeText, type DocumentExtractor, type ExtractionOutput } from './types.js';

export interface OcrResult {
  text: string;
  /** Mean confidence, 0–100. */
  confidence: number;
}

/** OCR engine abstraction so tests (and future cloud OCR) can plug in. */
export type OcrEngine = (bytes: Uint8Array) => Promise<OcrResult>;

const LOW_CONFIDENCE = 60;

/** Tesseract-backed OCR engine. The worker is created lazily and reused. */
export function createTesseractEngine(cachePath: string): OcrEngine & { terminate: () => Promise<void> } {
  let worker: Promise<Worker> | null = null;
  const getWorker = () => (worker ??= createWorker('eng', 1, { cachePath }));
  const engine = async (bytes: Uint8Array): Promise<OcrResult> => {
    const w = await getWorker();
    const { data } = await w.recognize(Buffer.from(bytes));
    return { text: data.text, confidence: data.confidence };
  };
  return Object.assign(engine, {
    terminate: async () => {
      if (worker) await (await worker).terminate();
      worker = null;
    },
  });
}

export class ImageExtractor implements DocumentExtractor {
  readonly formats = ['png', 'jpeg'] as const;

  constructor(private readonly ocr: OcrEngine) {}

  async extract({ bytes }: { bytes: Uint8Array }): Promise<ExtractionOutput> {
    let result: OcrResult;
    try {
      result = await this.ocr(bytes);
    } catch {
      throw new ExtractionError('The image could not be read (corrupt or unsupported image data).');
    }
    const text = normalizeText(result.text).trim();
    if (text.length < 3) throw new ExtractionError('No readable text was found in the image.');
    const warnings =
      result.confidence < LOW_CONFIDENCE
        ? [
            {
              message: `Low OCR confidence (${Math.round(result.confidence)}%). Extracted values may contain errors.`,
              degraded: true,
            },
          ]
        : [];
    return { pages: [{ pageNo: 1, text }], method: 'ocr', warnings };
  }
}
