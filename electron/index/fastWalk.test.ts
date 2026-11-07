import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parallelDirentWalk } from './fastWalk.mjs';

describe('parallelDirentWalk', () => {
  it('enumerates nested tree faster than sequential budget and finds files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-fastwalk-'));
    try {
      for (let i = 0; i < 40; i++) {
        const d = path.join(root, `d${i}`);
        await fs.mkdir(d);
        for (let j = 0; j < 25; j++) {
          await fs.writeFile(path.join(d, `f${j}.txt`), 'x');
        }
      }
      const entries: { path: string; name: string; kind: string }[] = [];
      const t0 = performance.now();
      const stats = await parallelDirentWalk(root, {
        maxDepth: 8,
        maxScan: 50_000,
        concurrency: 16,
        onEntry: (e) => entries.push(e),
      });
      const ms = performance.now() - t0;
      // 40 dirs * 25 files + 40 dirs = 1040 entries (+ root children)
      expect(stats.scanned).toBeGreaterThanOrEqual(1000);
      expect(entries.length).toBeGreaterThanOrEqual(1000);
      expect(entries.some((e) => e.name === 'f0.txt')).toBe(true);
      // smoke: should finish well under a second on temp SSD
      expect(ms).toBeLessThan(5000);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
