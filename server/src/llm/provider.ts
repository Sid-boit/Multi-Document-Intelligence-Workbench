import type { z } from 'zod';

export type LlmStage = 'plan' | 'extract' | 'synthesise';

export interface GenerateRequest<T> {
  stage: LlmStage;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /**
   * Structured view of the same inputs. Ignored by real models; used by the
   * deterministic MockProvider so tests and offline demos behave sensibly.
   */
  context?: unknown;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly name: 'ollama' | 'mock';
  readonly model: string | null;
  generate<T>(req: GenerateRequest<T>): Promise<T>;
  health(): Promise<boolean>;
}

/** The model server cannot be reached (not running, wrong URL, timed out). */
export class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

/** The model answered, but not with valid JSON for the schema (after a repair attempt). */
export class LlmInvalidOutputError extends Error {
  constructor(
    message: string,
    readonly raw?: string,
  ) {
    super(message);
    this.name = 'LlmInvalidOutputError';
  }
}
