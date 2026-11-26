import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app.js';
import { testConfig, type Config } from '../src/config.js';
import { openDb } from '../src/db/db.js';
import { Repo } from '../src/db/repo.js';
import { ExtractorRegistry, type OcrEngine } from '../src/ingestion/extractors/index.js';
import { MockProvider } from '../src/llm/mock.js';
import type { LlmProvider } from '../src/llm/provider.js';
import { BlobStore } from '../src/storage.js';

export const SAMPLES_DIR = resolve(import.meta.dirname, '../../samples');

export function sample(name: string): Buffer {
  return readFileSync(join(SAMPLES_DIR, name));
}

/** Deterministic OCR stand-in so tests stay fast and offline. Returns the certificate text. */
export const fakeOcr: OcrEngine = async () => ({
  text: [
    'NORTHWIND LICENSING AUTHORITY',
    'TRADING LICENCE CERTIFICATE',
    'Licence holder: Northwind Fabrication Ltd',
    'Licence number: LIC-48231',
    'Issue date: 01/04/2023',
    'Expiry date: 31/03/2026',
    'Registered premises: 14 Harbour Road, Bristol BS1 4QA',
  ].join('\n'),
  confidence: 91,
});

export function createTestApp(opts: { llm?: LlmProvider; config?: Partial<Config>; ocr?: OcrEngine } = {}) {
  const storageDir = mkdtempSync(join(tmpdir(), 'workbench-test-'));
  const config = testConfig({ STORAGE_DIR: storageDir, ...opts.config });
  const db = openDb(':memory:');
  const repo = new Repo(db);
  const jobs: Promise<void>[] = [];
  const app = createApp({
    config,
    repo,
    blobs: new BlobStore(storageDir),
    extractors: ExtractorRegistry.default(opts.ocr ?? fakeOcr),
    llm: opts.llm ?? new MockProvider(),
    now: () => new Date('2026-11-26T12:00:00Z'),
    onJob: (j) => jobs.push(j),
    rateLimit: false,
  });
  return {
    app,
    repo,
    storageDir,
    /** Wait for all background analyses started so far. */
    settle: () => Promise.all(jobs),
    cleanup: () => {
      db.close();
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}
