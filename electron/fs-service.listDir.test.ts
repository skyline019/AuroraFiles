import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('listDir parallel', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-listdir-'));
    await fs.writeFile(path.join(dir, 'a.txt'), 'a');
    await fs.writeFile(path.join(dir, 'b.txt'), 'b');
    await fs.mkdir(path.join(dir, 'sub'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('returns folders first with metadata', async () => {
    // Import after electron mock — listDir pulls electron; use dynamic and stub
    const mod = await import('./fs-service.mjs');
    const entries = await mod.listDir(dir, { showHidden: false });
    expect(entries[0].kind).toBe('folder');
    expect(entries.map((e: { name: string }) => e.name).sort()).toEqual(['a.txt', 'b.txt', 'sub'].sort());
    const file = entries.find((e: { name: string }) => e.name === 'a.txt');
    expect(file.size).toBe(1);
    expect(file.modifiedAt).toBeGreaterThan(0);
  });
});
