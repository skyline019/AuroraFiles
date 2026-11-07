import { describe, it, expect } from 'vitest';
import {
  configureIndexDir,
  ensureIndexed,
  queryIndex,
  disposeVolumeIndex,
  waitIndexDebt,
  indexStatus,
} from './fsIndex.mjs';
import { resetIndexPrefsCache, saveIndexPrefs } from './indexPrefs.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('lean nameKey + slim entries', () => {
  it('same-name different paths both searchable; memEstimate present', async () => {
    const tree = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-nk-'));
    const idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-nk-idx-'));
    configureIndexDir(idxDir);
    resetIndexPrefsCache();
    await saveIndexPrefs({ maxScan: 20_000, excludeNames: [] });
    try {
      await fs.mkdir(path.join(tree, 'a'));
      await fs.mkdir(path.join(tree, 'b'));
      await fs.writeFile(path.join(tree, 'a', 'dup.txt'), '1');
      await fs.writeFile(path.join(tree, 'b', 'dup.txt'), '2');
      await ensureIndexed(tree, {
        rebuild: true,
        leanMemory: true,
        persist: false,
        waitDebt: true,
        liveFollowers: false,
        maxDepth: 6,
      });
      await waitIndexDebt(tree, { timeoutMs: 30_000 });
      const q = await queryIndex(tree, 'dup', { maxResults: 20 });
      const paths = q.items.map((i: { path: string }) => i.path.toLowerCase());
      expect(paths.some((p) => p.includes(`${path.sep}a${path.sep}`.toLowerCase()) || p.includes('\\a\\'))).toBe(true);
      expect(paths.some((p) => p.includes(`${path.sep}b${path.sep}`.toLowerCase()) || p.includes('\\b\\'))).toBe(true);
      const st = indexStatus(tree);
      expect(st.memEstimate?.entries).toBeGreaterThanOrEqual(2);
      expect(st.memEstimate?.approx_mb).toBeGreaterThanOrEqual(0);
      // lean + FTS：不建 byName；同名驻留池应去重
      if (st.fts?.ok) {
        expect(st.byNameSize).toBe(0);
        expect(st.namePoolSize).toBeGreaterThan(0);
        expect(st.namePoolSize).toBeLessThanOrEqual(st.memEstimate.entries);
      }
      for (const it of q.items as { path: string; kind?: string }[]) {
        expect(it.path).toBe(it.path.toLowerCase());
        if (it.kind) expect(it.kind).toBe('folder');
      }
    } finally {
      disposeVolumeIndex(tree);
      await fs.rm(tree, { recursive: true, force: true });
      await fs.rm(idxDir, { recursive: true, force: true });
    }
  });
});
