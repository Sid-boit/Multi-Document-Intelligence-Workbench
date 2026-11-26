import Papa from 'papaparse';
import { ExtractionError, type DocumentExtractor, type ExtractionOutput } from './types.js';

/**
 * CSV is rendered as one text line per row ("Row 2: company=…; revenue=…").
 * This keeps every cell quotable, so evidence can be verified verbatim, while the
 * column names travel with each value.
 */
export class CsvExtractor implements DocumentExtractor {
  readonly formats = ['csv'] as const;

  async extract({ text }: { bytes: Uint8Array; text?: string }): Promise<ExtractionOutput> {
    if (text === undefined) throw new ExtractionError('CSV text was not decoded.');
    const parsed = Papa.parse<Record<string, string>>(text.trim(), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
    });
    const headers = (parsed.meta.fields ?? []).filter((h) => h.length > 0);
    if (headers.length === 0) throw new ExtractionError('The CSV has no header row.');
    if (parsed.data.length === 0) throw new ExtractionError('The CSV has a header but no data rows.');

    const lines = [`Columns: ${headers.join(', ')}`];
    parsed.data.forEach((row, i) => {
      const cells = headers.map((h) => `${h}=${(row[h] ?? '').toString().trim()}`);
      lines.push(`Row ${i + 1}: ${cells.join('; ')}`);
    });

    const warnings = parsed.errors.slice(0, 5).map((e) => ({
      message: `CSV row ${(e.row ?? 0) + 1}: ${e.message}`,
      degraded: true,
    }));
    if (parsed.errors.length > 5) {
      warnings.push({ message: `…and ${parsed.errors.length - 5} more CSV parse issues.`, degraded: true });
    }
    return { pages: [{ pageNo: 1, text: lines.join('\n') }], method: 'native', warnings };
  }
}
