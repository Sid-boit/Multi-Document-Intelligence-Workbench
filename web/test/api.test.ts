import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/lib/api';

afterEach(() => vi.restoreAllMocks());

const respond = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status }));

describe('api client', () => {
  it('validates responses against the shared contract', async () => {
    respond({ templates: [{ id: 't', label: 'L', instruction: 'I' }] });
    await expect(api.templates()).resolves.toEqual([{ id: 't', label: 'L', instruction: 'I' }]);

    respond({ templates: [{ id: 't' }] }); // malformed
    await expect(api.templates()).rejects.toThrow();
  });

  it('surfaces the server error message and code', async () => {
    respond({ error: { code: 'VALIDATION_FAILED', message: 'Select at least one document' } }, 400);
    const err = await api.createAnalysis({ instruction: 'abc', documentIds: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: 'Select at least one document', code: 'VALIDATION_FAILED', status: 400 });
  });

  it('reports network failures in plain language', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api.listDocuments()).rejects.toThrow('Cannot reach the server');
  });

  it('uploads files as multipart form data in the "files" field', async () => {
    const spy = respond({ documents: [] }, 201);
    await api.uploadDocuments([new File(['a'], 'a.txt'), new File(['b'], 'b.csv')]);
    const [url, init] = spy.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/documents');
    expect((init.body as FormData).getAll('files')).toHaveLength(2);
  });

  it('handles 204 No Content on delete', async () => {
    respond(undefined, 204);
    await expect(api.deleteDocument('id')).resolves.toBeUndefined();
  });
});
