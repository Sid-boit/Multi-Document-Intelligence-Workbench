import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/db.js';
import { Repo } from '../src/db/repo.js';
import { BlobStore } from '../src/storage.js';

describe('config', () => {
  it('applies defaults and coerces numbers', () => {
    const c = loadConfig({ PORT: '5000', MAX_FILE_MB: '' });
    expect(c.PORT).toBe(5000);
    expect(c.MAX_FILE_MB).toBe(15);
    expect(c.LLM_PROVIDER).toBe('ollama');
  });

  it('fails fast with a readable message on invalid values', () => {
    expect(() => loadConfig({ LLM_PROVIDER: 'gpt' })).toThrow(/LLM_PROVIDER/);
    expect(() => loadConfig({ OLLAMA_BASE_URL: 'not a url' })).toThrow(/OLLAMA_BASE_URL/);
  });
});

describe('BlobStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blobs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('stores files under random names with owner-only permissions and deletes them', async () => {
    const store = new BlobStore(dir);
    const key = await store.put(new TextEncoder().encode('secret'));
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(join(dir, key), 'utf8')).toBe('secret');
    expect(statSync(join(dir, key)).mode & 0o777).toBe(0o600);
    await store.delete(key);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses keys that could escape the storage directory', async () => {
    await expect(new BlobStore(dir).delete('../../etc/passwd')).rejects.toThrow(/Invalid storage key/);
  });
});

describe('Repo', () => {
  it('persists a document with pages, chunks and facts, and cascades deletes', () => {
    const repo = new Repo(openDb(':memory:'));
    const doc = repo.insertDocument({
      displayName: 'a.txt',
      format: 'txt',
      mimeType: 'text/plain',
      sizeBytes: 10,
      sha256: 'x',
      storageKey: null,
      status: 'ready',
      statusReason: null,
      extractionMethod: 'native',
      warnings: ['w1'],
      pages: [{ pageNo: 1, text: 'Name: Bob' }],
      chunks: [{ ordinal: 0, ref: 'p1-c1', pageNo: 1, charStart: 0, charEnd: 9, text: 'Name: Bob' }],
      facts: [{ chunkOrdinal: 0, pageNo: 1, type: 'labelled_field', label: 'Name', rawValue: 'Bob', normalized: null, charStart: 6, charEnd: 9 }],
    });
    expect(doc).toMatchObject({ status: 'ready', pageCount: 1, charCount: 9, warnings: ['w1'] });
    expect(repo.getChunks(doc.id)).toHaveLength(1);
    expect(repo.getFacts(doc.id)[0]).toMatchObject({ label: 'Name', rawValue: 'Bob' });

    repo.deleteDocument(doc.id);
    expect(repo.getDocument(doc.id)).toBeNull();
    expect(repo.getChunks(doc.id)).toEqual([]);
    expect(repo.getFacts(doc.id)).toEqual([]);
  });

  it('tracks analysis progress and fails analyses interrupted by a restart', () => {
    const repo = new Repo(openDb(':memory:'));
    const doc = repo.insertDocument({
      displayName: 'a.txt', format: 'txt', mimeType: 'text/plain', sizeBytes: 1, sha256: 'x', storageKey: null,
      status: 'ready', statusReason: null, extractionMethod: 'native', warnings: [], pages: [], chunks: [], facts: [],
    });
    const id = repo.createAnalysis({ instruction: 'Compare', templateId: null, documentIds: [doc.id], provider: 'mock', model: null, promptVersion: 'v1' });
    expect(repo.getAnalysis(id)).toMatchObject({ status: 'queued', documents: [{ id: doc.id, alias: 'D1', name: 'a.txt' }] });
    repo.setDocumentProgress(id, doc.id, 'running');
    expect(repo.getAnalysis(id)!.progress.perDocument[doc.id]).toBe('running');
    expect(repo.failInterruptedAnalyses()).toBe(1);
    expect(repo.getAnalysis(id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/restart/) });
  });
});
