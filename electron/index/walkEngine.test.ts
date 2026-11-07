import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { walkVolume, resolveWalkEngine, resolveRustWalkBin } from './walkEngine.mjs';

describe('walkEngine', () => {
  it('js engine walks a small tree', async () => {
    const tree = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-we-'));
    try {
      await fs.mkdir(path.join(tree, 'sub'));
      await fs.writeFile(path.join(tree, 'a.txt'), '1');
      await fs.writeFile(path.join(tree, 'sub', 'b.txt'), '2');
      const entries: { path: string }[] = [];
      const stats = await walkVolume(tree, {
        engine: 'js',
        maxDepth: 8,
        maxScan: 1000,
        followReparse: false,
        onEntry: (e: { path: string }) => entries.push(e),
      });
      expect(stats.engine).toBe('js');
      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(resolveWalkEngine(tree, { engine: 'js' })).toBe('js');
    } finally {
      await fs.rm(tree, { recursive: true, force: true });
    }
  });

  it('rust engine streams when binary present', async () => {
    const bin = resolveRustWalkBin();
    if (!bin) {
      expect(resolveWalkEngine('E:\\', { engine: 'js' })).toBe('js');
      return;
    }
    const tree = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-we-rs-'));
    try {
      await fs.writeFile(path.join(tree, 'x.txt'), 'x');
      const entries: { path: string; name: string }[] = [];
      const stats = await walkVolume(tree, {
        engine: 'rust',
        maxDepth: 4,
        maxScan: 100,
        followReparse: false,
        onEntry: (e: { path: string; name: string }) => entries.push(e),
      });
      expect(stats.engine).toBe('rust');
      expect(entries.some((e) => e.name === 'x.txt')).toBe(true);
    } finally {
      await fs.rm(tree, { recursive: true, force: true });
    }
  });
});
