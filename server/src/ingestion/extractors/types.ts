import type { DocumentFormat, ExtractionMethod } from '@workbench/shared';
import type { PageRecord } from '../../types.js';

export interface ExtractionOutput {
  pages: PageRecord[];
  method: ExtractionMethod;
  /** Non-fatal issues. Any warning with `degraded: true` makes the document "partial". */
  warnings: { message: string; degraded: boolean }[];
}

export interface ExtractionInput {
  bytes: Uint8Array;
  /** Pre-decoded UTF-8 text for text formats (validated by the guard). */
  text?: string;
}

/** Strategy interface: one implementation per family of formats. */
export interface DocumentExtractor {
  readonly formats: readonly DocumentFormat[];
  extract(input: ExtractionInput): Promise<ExtractionOutput>;
}

/** Thrown when a document cannot be read at all. The message is shown to the user. */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

/** Normalise line endings and strip trailing whitespace per line, keeping layout. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n');
}
