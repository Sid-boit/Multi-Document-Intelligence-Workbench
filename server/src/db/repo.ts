import { randomUUID } from 'node:crypto';
import {
  AnalysisPlan,
  AnalysisProgress,
  AnalysisResult,
  type AnalysisListItem,
  type AnalysisStatus,
  type AnalysisView,
  type DocumentFormat,
  type DocumentStatus,
  type DocumentSummary,
  type ExtractionMethod,
} from '@workbench/shared';
import type { Db } from './db.js';
import type { ChunkRecord, DocumentRecord, FactRecord, FactType, PageRecord } from '../types.js';

/* Row shapes as stored in SQLite ------------------------------------------------ */

interface DocumentRow {
  id: string;
  display_name: string;
  format: string | null;
  mime_type: string | null;
  size_bytes: number;
  sha256: string | null;
  storage_key: string | null;
  status: string;
  status_reason: string | null;
  extraction_method: string | null;
  page_count: number | null;
  char_count: number;
  warnings: string;
  created_at: string;
}

interface ChunkRow {
  id: string;
  document_id: string;
  ordinal: number;
  ref: string;
  page_no: number;
  char_start: number;
  char_end: number;
  text: string;
}

interface FactRow {
  id: string;
  document_id: string;
  chunk_id: string;
  page_no: number;
  type: string;
  label: string | null;
  raw_value: string;
  normalized: string | null;
  char_start: number;
  char_end: number;
}

interface AnalysisRow {
  id: string;
  instruction: string;
  template_id: string | null;
  status: string;
  progress: string;
  plan: string | null;
  result: string | null;
  error: string | null;
  provider: string;
  model: string | null;
  prompt_version: string;
  created_at: string;
  completed_at: string | null;
}

const toDocument = (r: DocumentRow): DocumentRecord => ({
  id: r.id,
  displayName: r.display_name,
  format: r.format as DocumentFormat | null,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  sha256: r.sha256,
  storageKey: r.storage_key,
  status: r.status as DocumentStatus,
  statusReason: r.status_reason,
  extractionMethod: r.extraction_method as ExtractionMethod | null,
  pageCount: r.page_count,
  charCount: r.char_count,
  warnings: JSON.parse(r.warnings) as string[],
  createdAt: r.created_at,
});

const toChunk = (r: ChunkRow): ChunkRecord => ({
  id: r.id,
  documentId: r.document_id,
  ordinal: r.ordinal,
  ref: r.ref,
  pageNo: r.page_no,
  charStart: r.char_start,
  charEnd: r.char_end,
  text: r.text,
});

const toFact = (r: FactRow): FactRecord => ({
  id: r.id,
  documentId: r.document_id,
  chunkId: r.chunk_id,
  pageNo: r.page_no,
  type: r.type as FactType,
  label: r.label,
  rawValue: r.raw_value,
  normalized: r.normalized,
  charStart: r.char_start,
  charEnd: r.char_end,
});

export function toSummary(d: DocumentRecord): DocumentSummary {
  return {
    id: d.id,
    displayName: d.displayName,
    format: d.format,
    sizeBytes: d.sizeBytes,
    status: d.status,
    statusReason: d.statusReason,
    extractionMethod: d.extractionMethod,
    pageCount: d.pageCount,
    charCount: d.charCount,
    warnings: d.warnings,
    createdAt: d.createdAt,
  };
}

export interface NewDocument {
  displayName: string;
  format: DocumentFormat | null;
  mimeType: string | null;
  sizeBytes: number;
  sha256: string | null;
  storageKey: string | null;
  status: DocumentStatus;
  statusReason: string | null;
  extractionMethod: ExtractionMethod | null;
  warnings: string[];
  pages: PageRecord[];
  chunks: Omit<ChunkRecord, 'id' | 'documentId'>[];
  /** Facts reference chunks by ordinal, resolved to ids on insert. */
  facts: (Omit<FactRecord, 'id' | 'documentId' | 'chunkId'> & { chunkOrdinal: number })[];
}

export interface LlmCallRecord {
  analysisId: string | null;
  stage: string;
  provider: string;
  model: string | null;
  cacheKey: string;
  durationMs: number;
  outcome: 'ok' | 'invalid_output' | 'unavailable' | 'error';
  output: unknown;
}

/** Thin, typed data-access layer. All SQL is parameterised. */
export class Repo {
  constructor(private readonly db: Db) {}

  ping(): boolean {
    return this.db.prepare('SELECT 1 AS ok').get() !== undefined;
  }

  /* Documents ------------------------------------------------------------------- */

  insertDocument(input: NewDocument): DocumentRecord {
    const id = randomUUID();
    const charCount = input.pages.reduce((n, p) => n + p.text.length, 0);
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO documents (id, display_name, format, mime_type, size_bytes, sha256, storage_key, status,
             status_reason, extraction_method, page_count, char_count, warnings)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.displayName,
          input.format,
          input.mimeType,
          input.sizeBytes,
          input.sha256,
          input.storageKey,
          input.status,
          input.statusReason,
          input.extractionMethod,
          input.pages.length > 0 ? input.pages.length : null,
          charCount,
          JSON.stringify(input.warnings),
        );
      const insPage = this.db.prepare('INSERT INTO pages (document_id, page_no, text) VALUES (?, ?, ?)');
      for (const p of input.pages) insPage.run(id, p.pageNo, p.text);

      const insChunk = this.db.prepare(
        `INSERT INTO chunks (id, document_id, ordinal, ref, page_no, char_start, char_end, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const chunkIds = new Map<number, string>();
      for (const c of input.chunks) {
        const cid = randomUUID();
        chunkIds.set(c.ordinal, cid);
        insChunk.run(cid, id, c.ordinal, c.ref, c.pageNo, c.charStart, c.charEnd, c.text);
      }

      const insFact = this.db.prepare(
        `INSERT INTO facts (id, document_id, chunk_id, page_no, type, label, raw_value, normalized, char_start, char_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const f of input.facts) {
        const chunkId = chunkIds.get(f.chunkOrdinal);
        if (!chunkId) continue;
        insFact.run(randomUUID(), id, chunkId, f.pageNo, f.type, f.label, f.rawValue, f.normalized, f.charStart, f.charEnd);
      }
    });
    tx();
    const created = this.getDocument(id);
    if (!created) throw new Error('Document insert failed');
    return created;
  }

  getDocument(id: string): DocumentRecord | null {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow | undefined;
    return row ? toDocument(row) : null;
  }

  listDocuments(): DocumentRecord[] {
    const rows = this.db.prepare('SELECT * FROM documents ORDER BY created_at DESC, rowid DESC').all() as DocumentRow[];
    return rows.map(toDocument);
  }

  getPage(documentId: string, pageNo: number): PageRecord | null {
    const row = this.db
      .prepare('SELECT page_no, text FROM pages WHERE document_id = ? AND page_no = ?')
      .get(documentId, pageNo) as { page_no: number; text: string } | undefined;
    return row ? { pageNo: row.page_no, text: row.text } : null;
  }

  getPages(documentId: string): PageRecord[] {
    const rows = this.db
      .prepare('SELECT page_no, text FROM pages WHERE document_id = ? ORDER BY page_no')
      .all(documentId) as { page_no: number; text: string }[];
    return rows.map((r) => ({ pageNo: r.page_no, text: r.text }));
  }

  getChunks(documentId: string): ChunkRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY ordinal')
      .all(documentId) as ChunkRow[];
    return rows.map(toChunk);
  }

  getFacts(documentId: string): FactRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM facts WHERE document_id = ? ORDER BY page_no, char_start')
      .all(documentId) as FactRow[];
    return rows.map(toFact);
  }

  /** Deletes the document (cascades to pages/chunks/facts) and returns its storage key. */
  deleteDocument(id: string): { storageKey: string | null } | null {
    const doc = this.getDocument(id);
    if (!doc) return null;
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    return { storageKey: doc.storageKey };
  }

  /* Analyses -------------------------------------------------------------------- */

  createAnalysis(input: {
    instruction: string;
    templateId: string | null;
    documentIds: string[];
    provider: string;
    model: string | null;
    promptVersion: string;
  }): string {
    const id = randomUUID();
    const progress: AnalysisProgress = {
      perDocument: Object.fromEntries(input.documentIds.map((d) => [d, 'pending' as const])),
    };
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO analyses (id, instruction, template_id, status, progress, provider, model, prompt_version)
           VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`,
        )
        .run(id, input.instruction, input.templateId, JSON.stringify(progress), input.provider, input.model, input.promptVersion);
      const ins = this.db.prepare(
        'INSERT INTO analysis_documents (analysis_id, document_id, alias, position) VALUES (?, ?, ?, ?)',
      );
      input.documentIds.forEach((docId, i) => ins.run(id, docId, `D${i + 1}`, i));
    });
    tx();
    return id;
  }

  getAnalysisDocuments(analysisId: string): { documentId: string; alias: string; name: string }[] {
    return this.db
      .prepare(
        `SELECT ad.document_id AS documentId, ad.alias AS alias, d.display_name AS name
         FROM analysis_documents ad JOIN documents d ON d.id = ad.document_id
         WHERE ad.analysis_id = ? ORDER BY ad.position`,
      )
      .all(analysisId) as { documentId: string; alias: string; name: string }[];
  }

  setAnalysisStatus(id: string, status: AnalysisStatus): void {
    this.db.prepare('UPDATE analyses SET status = ? WHERE id = ?').run(status, id);
  }

  setAnalysisPlan(id: string, plan: AnalysisPlan): void {
    this.db.prepare('UPDATE analyses SET plan = ? WHERE id = ?').run(JSON.stringify(plan), id);
  }

  setDocumentProgress(id: string, documentId: string, state: AnalysisProgress['perDocument'][string]): void {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare('SELECT progress FROM analyses WHERE id = ?').get(id) as { progress: string } | undefined;
      if (!row) return;
      const progress = AnalysisProgress.parse(JSON.parse(row.progress));
      progress.perDocument[documentId] = state;
      this.db.prepare('UPDATE analyses SET progress = ? WHERE id = ?').run(JSON.stringify(progress), id);
    });
    tx();
  }

  completeAnalysis(id: string, result: AnalysisResult): void {
    this.db
      .prepare(
        `UPDATE analyses SET status = 'completed', result = ?, error = NULL,
           completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
      .run(JSON.stringify(result), id);
  }

  failAnalysis(id: string, message: string): void {
    this.db
      .prepare(
        `UPDATE analyses SET status = 'failed', error = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
      .run(message, id);
  }

  getAnalysis(id: string): AnalysisView | null {
    const row = this.db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as AnalysisRow | undefined;
    if (!row) return null;
    const docs = this.getAnalysisDocuments(id);
    return {
      id: row.id,
      instruction: row.instruction,
      templateId: row.template_id,
      status: row.status as AnalysisStatus,
      progress: AnalysisProgress.parse(JSON.parse(row.progress)),
      documents: docs.map((d) => ({ id: d.documentId, alias: d.alias, name: d.name })),
      plan: row.plan ? AnalysisPlan.parse(JSON.parse(row.plan)) : null,
      result: row.result ? AnalysisResult.parse(JSON.parse(row.result)) : null,
      error: row.error,
      provider: row.provider,
      model: row.model,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  listAnalyses(limit = 20): AnalysisListItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, instruction, status, created_at, completed_at FROM analyses ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(limit) as Pick<AnalysisRow, 'id' | 'instruction' | 'status' | 'created_at' | 'completed_at'>[];
    return rows.map((r) => ({
      id: r.id,
      instruction: r.instruction,
      status: r.status as AnalysisStatus,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    }));
  }

  /** Marks analyses left running by a previous process as failed. */
  failInterruptedAnalyses(): number {
    return this.db
      .prepare(
        `UPDATE analyses SET status = 'failed', error = 'Interrupted by a server restart. Please run it again.'
         WHERE status NOT IN ('completed','failed')`,
      )
      .run().changes;
  }

  /* LLM audit / cache ----------------------------------------------------------- */

  recordLlmCall(c: LlmCallRecord): void {
    this.db
      .prepare(
        `INSERT INTO llm_calls (id, analysis_id, stage, provider, model, cache_key, duration_ms, outcome, output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        c.analysisId,
        c.stage,
        c.provider,
        c.model,
        c.cacheKey,
        c.durationMs,
        c.outcome,
        c.output === undefined ? null : JSON.stringify(c.output),
      );
  }

  getCachedLlmOutput(cacheKey: string): unknown {
    const row = this.db
      .prepare(`SELECT output FROM llm_calls WHERE cache_key = ? AND outcome = 'ok' ORDER BY created_at DESC LIMIT 1`)
      .get(cacheKey) as { output: string | null } | undefined;
    return row?.output ? (JSON.parse(row.output) as unknown) : undefined;
  }
}
