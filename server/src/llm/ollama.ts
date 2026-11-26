import { z } from 'zod';
import { LlmInvalidOutputError, LlmUnavailableError, type GenerateRequest, type LlmProvider } from './provider.js';

interface OllamaOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  numCtx?: number;
  fetchImpl?: typeof fetch;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const ChatResponse = z.object({ message: z.object({ content: z.string() }) });

/**
 * Ollama provider using structured outputs: the zod schema is converted to JSON Schema
 * and passed as `format`, so decoding is constrained to the schema. The response is
 * still validated with zod, with one repair attempt that feeds the errors back.
 */
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OllamaOptions) {
    this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async generate<T>(req: GenerateRequest<T>): Promise<T> {
    const jsonSchema = z.toJSONSchema(req.schema);
    delete (jsonSchema as Record<string, unknown>).$schema;

    const messages: ChatMessage[] = [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ];

    const first = await this.chat(messages, jsonSchema, req.signal);
    const firstTry = parse(first, req.schema);
    if (firstTry.ok) return firstTry.value;

    // One repair attempt: show the model its output and what was wrong with it.
    const repaired = await this.chat(
      [
        ...messages,
        { role: 'assistant', content: first },
        {
          role: 'user',
          content: `Your previous reply was not valid: ${firstTry.error}. Reply again with ONLY a JSON object that matches the required schema.`,
        },
      ],
      jsonSchema,
      req.signal,
    );
    const secondTry = parse(repaired, req.schema);
    if (secondTry.ok) return secondTry.value;
    throw new LlmInvalidOutputError(`Model output did not match the ${req.stage} schema: ${secondTry.error}`, repaired);
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return false;
      const body = (await res.json()) as { models?: { name: string }[] };
      return (body.models ?? []).some((m) => m.name === this.model || m.name === `${this.model}:latest`);
    } catch {
      return false;
    }
  }

  private async chat(messages: ChatMessage[], format: unknown, signal?: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(this.opts.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          think: false,
          format,
          messages,
          options: { temperature: 0, seed: 7, num_ctx: this.opts.numCtx ?? 16_384 },
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? `timed out after ${this.opts.timeoutMs} ms` : 'connection failed';
      throw new LlmUnavailableError(`Local AI (Ollama) is not reachable at ${this.opts.baseUrl}: ${reason}. Start Ollama or set LLM_PROVIDER=mock.`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 404) {
        throw new LlmUnavailableError(`Model "${this.model}" is not available in Ollama. Run: ollama pull ${this.model}`);
      }
      throw new LlmUnavailableError(`Ollama returned HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const body = ChatResponse.safeParse(await res.json());
    if (!body.success) throw new LlmInvalidOutputError('Unexpected response shape from Ollama.');
    return body.data.message.content;
  }
}

function parse<T>(raw: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(raw));
  } catch {
    return { ok: false, error: 'response is not valid JSON' };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; '),
  };
}

function stripFences(raw: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(raw);
  return m?.[1] ?? raw;
}
