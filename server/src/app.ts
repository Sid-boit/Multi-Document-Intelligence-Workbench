import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { HealthResponse } from '@workbench/shared';
import type { Config } from './config.js';
import type { Repo } from './db/repo.js';
import { errorHandler, AppError } from './errors.js';
import type { ExtractorRegistry } from './ingestion/extractors/index.js';
import type { LlmProvider } from './llm/provider.js';
import { analysesRouter, templatesRouter } from './routes/analyses.js';
import { documentsRouter } from './routes/documents.js';
import type { BlobStore } from './storage.js';
import { SUPPORTED_LABEL } from './ingestion/guard.js';

export interface AppDeps {
  config: Config;
  repo: Repo;
  blobs: BlobStore;
  extractors: ExtractorRegistry;
  llm: LlmProvider;
  now?: () => Date;
  onJob?: (job: Promise<void>) => void;
  /** Disable rate limiting (tests). */
  rateLimit?: boolean;
}

/** Builds the Express app from its dependencies (no globals → easy to test). */
export function createApp(deps: AppDeps): Express {
  const { config, repo, llm } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN }));
  app.use(express.json({ limit: '100kb' }));

  if (deps.rateLimit !== false) {
    const tooMany = { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } };
    app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, message: tooMany }));
    app.use('/api/analyses', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: tooMany, skip: (r) => r.method !== 'POST' }));
  }

  app.get('/api/health', async (_req, res) => {
    let db: 'ok' | 'error' = 'ok';
    try {
      repo.ping();
    } catch {
      db = 'error';
    }
    const reachable = await llm.health();
    const body: HealthResponse = {
      ok: db === 'ok',
      db,
      llm: { provider: llm.name, model: llm.model, reachable },
      limits: { maxFileMb: config.MAX_FILE_MB, maxFiles: config.MAX_FILES_PER_UPLOAD, formats: SUPPORTED_LABEL.split(', ') },
    };
    res.json(body);
  });

  app.use('/api/documents', documentsRouter(deps));
  app.use('/api/analyses', analysesRouter(deps));
  app.use('/api/templates', templatesRouter());

  app.use('/api', (_req, _res, next) => next(AppError.notFound('Endpoint')));
  app.use(errorHandler({ maxFileMb: config.MAX_FILE_MB, maxFiles: config.MAX_FILES_PER_UPLOAD }));
  return app;
}
