import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { PageText } from '@workbench/shared';
import { AppError } from '../errors.js';
import { toSummary } from '../db/repo.js';
import { ingestFile, type IngestDeps } from '../ingestion/ingest.js';

const IdParam = z.object({ id: z.string().uuid('Invalid document id') });
const PageParams = IdParam.extend({ n: z.coerce.number().int().min(1).max(100_000) });

export function documentsRouter(deps: IngestDeps): Router {
  const { repo, blobs, config } = deps;
  const router = Router();

  // Files are held in memory only until validated. Multer's hard cap is 2× the per-file
  // limit; files between 1× and 2× are rejected individually by the guard with a reason.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.MAX_FILE_MB * 2 * 1_048_576, files: config.MAX_FILES_PER_UPLOAD, fields: 5, parts: config.MAX_FILES_PER_UPLOAD + 5 },
    defParamCharset: 'utf8',
  });

  router.post('/', upload.array('files', config.MAX_FILES_PER_UPLOAD), async (req, res) => {
    const files = (req.files ?? []) as Express.Multer.File[];
    if (files.length === 0) throw AppError.validation('No files received. Upload one or more files in the "files" field.');
    const documents = [];
    for (const f of files) documents.push(await ingestFile(deps, f.originalname, new Uint8Array(f.buffer)));
    res.status(201).json({ documents });
  });

  router.get('/', (_req, res) => {
    res.json({ documents: repo.listDocuments().map(toSummary) });
  });

  router.get('/:id', (req, res) => {
    const { id } = IdParam.parse(req.params);
    const doc = repo.getDocument(id);
    if (!doc) throw AppError.notFound('Document');
    res.json({ document: toSummary(doc) });
  });

  router.get('/:id/pages/:n', (req, res) => {
    const { id, n } = PageParams.parse(req.params);
    const doc = repo.getDocument(id);
    if (!doc) throw AppError.notFound('Document');
    const page = repo.getPage(id, n);
    if (!page) throw AppError.notFound('Page');
    const body: PageText = { documentId: id, pageNo: page.pageNo, pageCount: doc.pageCount ?? 1, text: page.text };
    res.json(body);
  });

  router.delete('/:id', async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const deleted = repo.deleteDocument(id);
    if (!deleted) throw AppError.notFound('Document');
    if (deleted.storageKey) await blobs.delete(deleted.storageKey);
    res.status(204).end();
  });

  return router;
}
