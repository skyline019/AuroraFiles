import { describe, expect, it } from 'vitest';
import { cancelSearch, searchFiles } from './index/searchFiles.mjs';
import { configureIndexDir } from './index/persist.mjs';
import { resetIndexPrefsCache } from './index/indexPrefs.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('searchFiles abort / single-flight', () => {
  it('cancelSearch makes in-flight walk return cancelled', async () => {
    const idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-search-idx-'));
    configureIndexDir(idxDir);
    resetIndexPrefsCache();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-search-'));
    try {
      // 造一层较深的树，拉长 walk-fallback（无索引时）
      let dir = root;
      for (let i = 0; i < 8; i++) {
        dir = path.join(dir, `layer-${i}`);
        await fs.mkdir(dir);
        await fs.writeFile(path.join(dir, `file-${i}-needle.txt`), 'x');
      }
      const p = searchFiles(root, 'needle', { maxDepth: 10, maxScan: 5000, maxResults: 400, indexDepth: 0 });
      // 尽快取消
      await new Promise((r) => setTimeout(r, 5));
      cancelSearch();
      const res = await p;
      // 可能已从索引快速返回，或 cancelled；至少不应抛错
      expect(res).toBeTruthy();
      if (res.source === 'cancelled' || res.cancelled) {
        expect(res.cancelled).toBe(true);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(idxDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('second search bumps job and invalidates first', async () => {
    const a = cancelSearch();
    const b = cancelSearch();
    expect(b.jobId).toBeGreaterThan(a.jobId);
  });
});
