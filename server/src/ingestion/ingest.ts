import { createHash } from 'node:crypto';
import type { DocumentSummary } from '@workbench/shared';
import type { Config } from '../config.js';
import { toSummary, type Repo } from '../db/repo.js';
import type { BlobStore } from '../storage.js';
import { chunkForOffset, chunkPages } from './chunker.js';
import { ExtractionError, type ExtractorRegistry } from './extractors/index.js';
import { extractFacts, looksLikePromptInjection } from './facts.js';
import { guardFile, sanitizeFilename } from './guard.js';

export interface IngestDeps {
  repo: Repo;
  blobs: BlobStore;
  extractors: ExtractorRegistry;
  config: Config;
}

/**
 * Ingest one uploaded file: guard → extract → cap → chunk → facts → store → persist.
 * Never throws for problems with the file itself: those become a rejected/failed
 * document with a user-facing reason, so one bad file never breaks a batch.
 */
export async function ingestFile(deps: IngestDeps, originalName: string, bytes: Uint8Array): Promise<DocumentSummary> {
  const { repo, blobs, extractors, config } = deps;
  const displayName = sanitizeFilename(originalName);
  const base = {
    displayName,
    sizeBytes: bytes.byteLength,
    pages: [],
    chunks: [],
    facts: [],
    extractionMethod: null,
    storageKey: null,
    warnings: [],
  };

  const guard = await guardFile(originalName, bytes, config.MAX_FILE_MB * 1_048_576);
  if (!guard.ok) {
    return toSummary(
      repo.insertDocument({ ...base, format: null, mimeType: null, sha256: null, status: 'rejected', statusReason: guard.reason }),
    );
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const common = { ...base, format: guard.format, mimeType: guard.mimeType, sha256 };

  let extraction;
  try {
    extraction = await extractors.get(guard.format).extract({ bytes, ...(guard.text !== undefined ? { text: guard.text } : {}) });
  } catch (err) {
    const reason = err instanceof ExtractionError ? err.message : 'The document could not be processed.';
    if (!(err instanceof ExtractionError)) console.error(`[ingest] unexpected extraction error for ${displayName}`, err);
    return toSummary(repo.insertDocument({ ...common, status: 'failed', statusReason: reason }));
  }

  const warnings = [...extraction.warnings];

  // Cap very large documents (kept as "partial" with an explicit warning).
  let remaining = config.MAX_CHARS_PER_DOCUMENT;
  const pages = [];
  for (const p of extraction.pages) {
    if (remaining <= 0) break;
    const text = p.text.length > remaining ? p.text.slice(0, remaining) : p.text;
    remaining -= text.length;
    pages.push({ pageNo: p.pageNo, text });
  }
  if (pages.reduce((n, p) => n + p.text.length, 0) < extraction.pages.reduce((n, p) => n + p.text.length, 0)) {
    warnings.push({
      message: `Document truncated to ${config.MAX_CHARS_PER_DOCUMENT.toLocaleString('en-GB')} characters; later content was not analysed.`,
      degraded: true,
    });
  }

  if (pages.some((p) => looksLikePromptInjection(p.text))) {
    warnings.push({
      message: 'This document contains text that looks like instructions to an AI system. It is treated as data only; review its findings with care.',
      degraded: false,
    });
  }

  const chunks = chunkPages(pages, config.CHUNK_CHARS);
  const facts = pages.flatMap((p) => extractFacts(p)).flatMap((f) => {
    const chunk = chunkForOffset(chunks, f.pageNo, f.charStart);
    return chunk ? [{ ...f, chunkOrdinal: chunk.ordinal }] : [];
  });

  const storageKey = await blobs.put(bytes);
  const degraded = warnings.some((w) => w.degraded);
  try {
    return toSummary(
      repo.insertDocument({
        ...common,
        storageKey,
        status: degraded ? 'partial' : 'ready',
        statusReason: degraded ? 'Processed with warnings' : null,
        extractionMethod: extraction.method,
        warnings: warnings.map((w) => w.message),
        pages,
        chunks: chunks.map(({ ordinal, ref, pageNo, charStart, charEnd, text }) => ({ ordinal, ref, pageNo, charStart, charEnd, text })),
        facts,
      }),
    );
  } catch (err) {
    await blobs.delete(storageKey); // don't leave orphaned files behind
    throw err;
  }
}
