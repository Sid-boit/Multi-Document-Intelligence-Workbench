import type { DocumentFormat, DocumentStatus, ExtractionMethod } from '@workbench/shared';

/** Server-side domain types (not part of the public API). */

export interface PageRecord {
  pageNo: number;
  text: string;
}

export interface ChunkRecord {
  id: string;
  documentId: string;
  ordinal: number;
  ref: string;
  pageNo: number;
  charStart: number;
  charEnd: number;
  text: string;
}

export const FACT_TYPES = [
  'labelled_field',
  'blank_field',
  'table_cell',
  'date',
  'money',
  'identifier',
  'email',
  'phone',
  'postcode',
] as const;
export type FactType = (typeof FACT_TYPES)[number];

export interface FactRecord {
  id: string;
  documentId: string;
  chunkId: string;
  pageNo: number;
  type: FactType;
  label: string | null;
  rawValue: string;
  normalized: string | null;
  charStart: number;
  charEnd: number;
}

export interface DocumentRecord {
  id: string;
  displayName: string;
  format: DocumentFormat | null;
  mimeType: string | null;
  sizeBytes: number;
  sha256: string | null;
  storageKey: string | null;
  status: DocumentStatus;
  statusReason: string | null;
  extractionMethod: ExtractionMethod | null;
  pageCount: number | null;
  charCount: number;
  warnings: string[];
  createdAt: string;
}

/** Everything the analysis pipeline needs to know about one document. */
export interface LoadedDocument {
  doc: DocumentRecord;
  alias: string;
  pages: PageRecord[];
  chunks: ChunkRecord[];
  facts: FactRecord[];
}
