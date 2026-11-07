import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parallelDirentWalk } from './fastWalk.mjs';

describe('parallelDirentWalk', () => {
  it(
    'enumerates nested tree faster than sequential budget and finds files',
    { timeout: 30_000 },
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-fastwalk-'));
      try {
        // Parallel create — sequential 1k writes alone can exceed Vitest's 5s on Windows CI.
        await Promise.all(
          Array.from({ length: 40 }, async (_, i) => {
            const d = path.join(root, `d${i}`);
            await fs.mkdir(d);
            await Promise.all(
              Array.from({ length: 25 }, (_, j) =>
                fs.writeFile(path.join(d, `f${j}.txt`), 'x'),
              ),
            );
          }),
        );
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
        // Walk budget (excludes fixture setup); CI Windows temp disks are slower.
        expect(ms).toBeLessThan(15_000);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );
});
