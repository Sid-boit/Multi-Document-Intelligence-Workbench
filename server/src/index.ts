import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/db.js';
import { Repo } from './db/repo.js';
import { createTesseractEngine, ExtractorRegistry } from './ingestion/extractors/index.js';
import { MockProvider } from './llm/mock.js';
import { OllamaProvider } from './llm/ollama.js';
import type { LlmProvider } from './llm/provider.js';
import { BlobStore } from './storage.js';

// Load .env from the repo root (or server/) if present. Real env vars take precedence.
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const config = loadConfig();
const db = openDb(config.DATABASE_PATH);
const repo = new Repo(db);
const interrupted = repo.failInterruptedAnalyses();
if (interrupted > 0) console.warn(`[startup] marked ${interrupted} interrupted analysis(es) as failed`);

const ocr = createTesseractEngine(resolve(config.OCR_CACHE_DIR));
const llm: LlmProvider =
  config.LLM_PROVIDER === 'mock'
    ? new MockProvider()
    : new OllamaProvider({ baseUrl: config.OLLAMA_BASE_URL, model: config.LLM_MODEL, timeoutMs: config.LLM_TIMEOUT_MS });

const app = createApp({
  config,
  repo,
  blobs: new BlobStore(config.STORAGE_DIR),
  extractors: ExtractorRegistry.default(ocr),
  llm,
});

const server = app.listen(config.PORT, () => {
  console.log(`[server] listening on http://localhost:${config.PORT} (LLM: ${llm.name}${llm.model ? ` / ${llm.model}` : ''})`);
});

async function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down`);
  server.close();
  await ocr.terminate().catch(() => undefined);
  db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
