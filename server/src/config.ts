import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_PATH: z.string().default('./var/workbench.db'),
  STORAGE_DIR: z.string().default('./var/uploads'),
  OCR_CACHE_DIR: z.string().default('./var/tesseract'),
  MAX_FILE_MB: z.coerce.number().positive().max(100).default(15),
  MAX_FILES_PER_UPLOAD: z.coerce.number().int().positive().max(50).default(10),
  MAX_CHARS_PER_DOCUMENT: z.coerce.number().int().positive().default(500_000),
  CHUNK_CHARS: z.coerce.number().int().min(300).max(20_000).default(2500),
  MAP_CHAR_BUDGET: z.coerce.number().int().min(1000).default(12_000),
  LLM_PROVIDER: z.enum(['ollama', 'mock']).default('ollama'),
  OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
  LLM_MODEL: z.string().min(1).default('qwen3.5:9b'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  LLM_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Parse configuration from an env-like object. Fails fast with a readable message. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Treat empty strings as "unset" so `.env` lines like `FOO=` fall back to defaults.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = ConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}

/** Defaults suitable for tests (mock LLM, in-memory DB). */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({}), LLM_PROVIDER: 'mock', DATABASE_PATH: ':memory:', ...overrides };
}
