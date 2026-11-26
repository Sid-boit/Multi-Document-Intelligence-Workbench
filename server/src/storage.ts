import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Stores original uploads under random UUID names (no extension, owner-only permissions)
 * in a directory that is never served statically. User filenames never touch the filesystem.
 */
export class BlobStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  async put(bytes: Uint8Array): Promise<string> {
    const key = randomUUID();
    await writeFile(this.pathFor(key), bytes, { mode: 0o600, flag: 'wx' });
    return key;
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error('Invalid storage key');
    return join(this.dir, key);
  }
}
