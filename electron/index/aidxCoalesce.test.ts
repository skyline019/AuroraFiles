import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  configureIndexDir,
  coalesceAidxDeltaBytes,
  ensureIndexed,
  disposeVolumeIndex,
  waitIndexDebt,
  flushIndexDisk,
  getIndex,
} from './fsIndex.mjs';
import { getIndexFilePaths } from './persist.mjs';
import { resolveIndexdBin } from './indexdClient.mjs';
import { saveIndexPrefs, resetIndexPrefsCache } from './indexPrefs.mjs';

describe('aidx coalesce', () => {
  const prevCoalesce = process.env.AURORA_AIDX_COALESCE_BYTES;
  const prevBackend = process.env.AURORA_INDEX_BACKEND;
  let tmpRoot = '';
  let idxDir = '';

  beforeEach(async () => {
    if (!resolveIndexdBin()) return;
    process.env.AURORA_INDEX_BACKEND = 'native';
    process.env.AURORA_AIDX_COALESCE_BYTES = '64'; // tiny → force coalesce after any delta
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-coalesce-tree-'));
    idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-coalesce-idx-'));
    configureIndexDir(idxDir);
    resetIndexPrefsCache();
    await saveIndexPrefs({ maxScan: 5_000, excludeNames: [] });
    for (let i = 0; i < 40; i++) {
      await fs.mkdir(path.join(tmpRoot, `d${i}`), { recursive: true });
      await fs.writeFile(path.join(tmpRoot, `d${i}`, `f${i}.txt`), 'x');
    }
  });

  afterEach(async () => {
    if (tmpRoot) disposeVolumeIndex(tmpRoot);
    if (prevCoalesce == null) delete process.env.AURORA_AIDX_COALESCE_BYTES;
    else process.env.AURORA_AIDX_COALESCE_BYTES = prevCoalesce;
    if (prevBackend == null) delete process.env.AURORA_INDEX_BACKEND;
    else process.env.AURORA_INDEX_BACKEND = prevBackend;
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    if (idxDir) await fs.rm(idxDir, { recursive: true, force: true }).catch(() => {});
  });

  it('coalesceAidxDeltaBytes reads env override', () => {
    process.env.AURORA_AIDX_COALESCE_BYTES = '12345';
    expect(coalesceAidxDeltaBytes()).toBe(12345);
    delete process.env.AURORA_AIDX_COALESCE_BYTES;
    expect(coalesceAidxDeltaBytes()).toBe(8 * 1024 * 1024);
  });

  it('space debt coalesces fat .aidx.d into base', async () => {
    if (!resolveIndexdBin()) return;
    await ensureIndexed(tmpRoot, {
      rebuild: true,
      leanMemory: true,
      persist: true,
      waitDebt: true,
      indexBackend: 'native',
      maxScan: 5_000,
      maxDepth: 4,
      skipMode: 'none',
    });
    await waitIndexDebt(tmpRoot, { timeoutMs: 30_000, kinds: ['persist', 'space'] });

    const idx = getIndex(tmpRoot);
    expect(idx?._backend).toBe('native');
    const files = getIndexFilePaths(tmpRoot);
    const deltaPath = `${files.aidx}.d`;

    // Fat sidecar above env threshold — space debt should coalesce into base
    await fs.writeFile(deltaPath, Buffer.alloc(coalesceAidxDeltaBytes() + 32, 0xab));
    expect((await fs.stat(deltaPath)).size).toBeGreaterThan(coalesceAidxDeltaBytes());

    idx.debt.owe('space', { reason: 'coalesce-test' });
    await waitIndexDebt(tmpRoot, { timeoutMs: 30_000, kinds: ['space'] });

    // After coalesce, sidecar gone and base still present
    let after = 0;
    try {
      after = (await fs.stat(deltaPath)).size;
    } catch {
      after = 0;
    }
    expect(after).toBe(0);
    expect(fssync.existsSync(files.aidx)).toBe(true);
  }, 60_000);
});
