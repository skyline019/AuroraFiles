import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureIndexDir } from './persist.mjs';
import { FtsIndex, ftsAvailable } from './fts.mjs';

describe('FtsIndex', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-fts-'));
    configureIndexDir(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('skips gracefully when sqlite unavailable', () => {
    if (!ftsAvailable()) {
      const f = new FtsIndex('C:\\');
      expect(f.ok).toBe(false);
      expect(f.search('x')).toEqual([]);
    }
  });

  it('indexes and matches name/path tokens', () => {
    if (!ftsAvailable()) return;
    const f = new FtsIndex('C:\\Work');
    expect(f.ok).toBe(true);
    f.upsert({ path: 'C:\\Work\\Docs\\Report2024.pdf', name: 'Report2024.pdf' });
    f.upsert({ path: 'C:\\Work\\Notes\\todo.txt', name: 'todo.txt' });
    const hits = f.search('report');
    expect(hits.some((h) => h.name.toLowerCase().includes('report'))).toBe(true);
    f.remove('C:\\Work\\Docs\\Report2024.pdf');
    expect(f.search('report').length).toBe(0);
    f.close();
  });

  it('rebuilds in transaction', () => {
    if (!ftsAvailable()) return;
    const f = new FtsIndex('D:\\x');
    f.rebuild([
      { path: 'D:\\x\\a.ts', name: 'a.ts' },
      { path: 'D:\\x\\b.ts', name: 'b.ts' },
    ]);
    expect(f.size()).toBe(2);
    f.close();
  });
});
