import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LlmDocExtraction } from '@workbench/shared';
import { MockProvider } from '../src/llm/mock.js';
import { OllamaProvider } from '../src/llm/ollama.js';
import { LlmInvalidOutputError, LlmUnavailableError } from '../src/llm/provider.js';
import { fallbackPlan } from '../src/analysis/templates.js';

const Schema = z.object({ answer: z.string(), score: z.number() });

function ollamaReplying(...contents: string[]) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: { content: contents.shift() ?? '' } }), { status: 200 }));
  return { fetchImpl, llm: new OllamaProvider({ baseUrl: 'http://ollama', model: 'm', timeoutMs: 1000, fetchImpl }) };
}

describe('OllamaProvider', () => {
  it('sends a JSON-schema constrained, deterministic request and validates the reply', async () => {
    const { fetchImpl, llm } = ollamaReplying('{"answer":"ok","score":1}');
    await expect(llm.generate({ stage: 'plan', system: 's', user: 'u', schema: Schema })).resolves.toEqual({ answer: 'ok', score: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://ollama/api/chat');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'm', stream: false, think: false, options: { temperature: 0 } });
    expect(body.format).toMatchObject({ type: 'object', required: ['answer', 'score'] });
    expect(body.format.$schema).toBeUndefined();
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
  });

  it('repairs once by feeding the validation error back to the model', async () => {
    const { fetchImpl, llm } = ollamaReplying('{"answer":"ok"}', '```json\n{"answer":"ok","score":2}\n```');
    await expect(llm.generate({ stage: 'plan', system: 's', user: 'u', schema: Schema })).resolves.toEqual({ answer: 'ok', score: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const second = JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(second.messages.at(-1).content).toMatch(/score/);
  });

  it('gives up with LlmInvalidOutputError after the repair attempt', async () => {
    const { llm } = ollamaReplying('not json', '{"still":"wrong"}');
    await expect(llm.generate({ stage: 'extract', system: 's', user: 'u', schema: Schema })).rejects.toBeInstanceOf(LlmInvalidOutputError);
  });

  it('reports connection failures and missing models as LlmUnavailableError', async () => {
    const down = new OllamaProvider({
      baseUrl: 'http://ollama',
      model: 'm',
      timeoutMs: 1000,
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(down.generate({ stage: 'plan', system: 's', user: 'u', schema: Schema })).rejects.toThrow(LlmUnavailableError);

    const missing = new OllamaProvider({ baseUrl: 'http://ollama', model: 'm', timeoutMs: 1000, fetchImpl: async () => new Response('model not found', { status: 404 }) });
    await expect(missing.generate({ stage: 'plan', system: 's', user: 'u', schema: Schema })).rejects.toThrow(/ollama pull m/);
  });

  it('times out slow requests', async () => {
    const slow = new OllamaProvider({
      baseUrl: 'http://ollama',
      model: 'm',
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })))),
    });
    await expect(slow.generate({ stage: 'plan', system: 's', user: 'u', schema: Schema })).rejects.toThrow(/timed out/);
  });

  it('health() checks that the configured model is installed', async () => {
    const tags = (names: string[]) => async () => new Response(JSON.stringify({ models: names.map((name) => ({ name })) }));
    expect(await new OllamaProvider({ baseUrl: 'x', model: 'qwen3.5:9b', timeoutMs: 1, fetchImpl: tags(['qwen3.5:9b']) }).health()).toBe(true);
    expect(await new OllamaProvider({ baseUrl: 'x', model: 'qwen3.5:9b', timeoutMs: 1, fetchImpl: tags(['other']) }).health()).toBe(false);
  });
});

describe('MockProvider', () => {
  it('produces schema-valid, deterministic extraction from the structured context', async () => {
    const mock = new MockProvider();
    const out = await mock.generate({
      stage: 'extract',
      system: '',
      user: '',
      schema: LlmDocExtraction,
      context: {
        attributes: fallbackPlan().attributes,
        document: {
          chunks: [{ id: 'c1', documentId: 'd', ordinal: 0, ref: 'p1-c1', pageNo: 1, charStart: 0, charEnd: 30, text: 'Licence number: LIC-1234' }],
          facts: [{ id: 'f1', documentId: 'd', chunkId: 'c1', pageNo: 1, type: 'labelled_field', label: 'Licence number', rawValue: 'LIC-1234', normalized: null, charStart: 16, charEnd: 24 }],
        },
      },
    });
    expect(out.values.find((v) => v.attribute === 'licence_number')).toEqual({ attribute: 'licence_number', status: 'found', value: 'LIC-1234', chunkRef: 'p1-c1', quote: 'LIC-1234' });
    expect(out.values.find((v) => v.attribute === 'address')?.status).toBe('not_found');
  });
});
