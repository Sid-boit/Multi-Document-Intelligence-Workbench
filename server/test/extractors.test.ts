import { describe, expect, it } from 'vitest';
import { CsvExtractor } from '../src/ingestion/extractors/csv.js';
import { ImageExtractor } from '../src/ingestion/extractors/image.js';
import { ExtractorRegistry } from '../src/ingestion/extractors/index.js';
import { PdfExtractor } from '../src/ingestion/extractors/pdf.js';
import { TextExtractor } from '../src/ingestion/extractors/text.js';
import { ExtractionError } from '../src/ingestion/extractors/types.js';
import { fakeOcr, sample } from './helpers.js';

const u8 = (b: Buffer) => new Uint8Array(b);

describe('PdfExtractor', () => {
  it('extracts text page by page from the text layer', async () => {
    const out = await new PdfExtractor().extract({ bytes: u8(sample('application_form.pdf')) });
    expect(out.method).toBe('text-layer');
    expect(out.pages.map((p) => p.pageNo)).toEqual([1, 2]);
    expect(out.pages[0]!.text).toContain('Applicant name: Jonathan A. Smith');
    expect(out.pages[1]!.text).toContain('Signature date:');
    expect(out.warnings).toEqual([]);
  });

  it('throws a user-facing ExtractionError for a corrupt PDF', async () => {
    await expect(new PdfExtractor().extract({ bytes: u8(sample('invalid/corrupt.pdf')) })).rejects.toThrow(ExtractionError);
  });
});

describe('ImageExtractor', () => {
  it('returns OCR text as a single page', async () => {
    const out = await new ImageExtractor(fakeOcr).extract({ bytes: new Uint8Array([1]) });
    expect(out.method).toBe('ocr');
    expect(out.pages[0]!.text).toContain('Licence number: LIC-48231');
    expect(out.warnings).toEqual([]);
  });

  it('flags low-confidence OCR as degraded', async () => {
    const out = await new ImageExtractor(async () => ({ text: 'blurry text', confidence: 31 })).extract({ bytes: new Uint8Array([1]) });
    expect(out.warnings).toEqual([{ message: expect.stringContaining('Low OCR confidence (31%)'), degraded: true }]);
  });

  it('fails when no text is found or the engine errors', async () => {
    await expect(new ImageExtractor(async () => ({ text: '  ', confidence: 90 })).extract({ bytes: new Uint8Array([1]) })).rejects.toThrow(/No readable text/);
    await expect(
      new ImageExtractor(async () => {
        throw new Error('bad image');
      }).extract({ bytes: new Uint8Array([1]) }),
    ).rejects.toThrow(ExtractionError);
  });
});

describe('CsvExtractor', () => {
  const ex = new CsvExtractor();

  it('renders each row with its column names so every cell is quotable', async () => {
    const out = await ex.extract({ bytes: new Uint8Array(), text: 'company,revenue\nAcme Ltd,100\nBeta plc,200\n' });
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0]!.text).toBe('Columns: company, revenue\nRow 1: company=Acme Ltd; revenue=100\nRow 2: company=Beta plc; revenue=200');
    expect(out.method).toBe('native');
  });

  it('reports malformed rows as warnings rather than failing', async () => {
    const out = await ex.extract({ bytes: new Uint8Array(), text: 'a,b\n1,2\n3,4,5\n' });
    expect(out.warnings.length).toBeGreaterThan(0);
    expect(out.warnings[0]!.degraded).toBe(true);
  });

  it('fails for a CSV without data rows', async () => {
    await expect(ex.extract({ bytes: new Uint8Array(), text: 'a,b\n' })).rejects.toThrow(/no data rows/);
  });
});

describe('TextExtractor', () => {
  it('normalises line endings and keeps a single page', async () => {
    const out = await new TextExtractor().extract({ bytes: new Uint8Array(), text: 'line one\r\nline two   \r\n' });
    expect(out.pages).toEqual([{ pageNo: 1, text: 'line one\nline two' }]);
  });
});

describe('ExtractorRegistry', () => {
  it('maps every supported format to an extractor', () => {
    const reg = ExtractorRegistry.default(fakeOcr);
    expect(reg.get('pdf')).toBeInstanceOf(PdfExtractor);
    expect(reg.get('jpeg')).toBeInstanceOf(ImageExtractor);
    expect(reg.get('png')).toBeInstanceOf(ImageExtractor);
    expect(reg.get('csv')).toBeInstanceOf(CsvExtractor);
    expect(reg.get('md')).toBeInstanceOf(TextExtractor);
  });
});
