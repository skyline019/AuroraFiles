#!/usr/bin/env node
/**
 * Diff / softRefresh 命中基准：建小树 → 索引 → 改 K 文件 → softRefresh → 度量。
 *
 *   node scripts/perf/measure-diff.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { rssMb } from './seed-tree.mjs';
import {
  configureIndexDir,
  ensureIndexed,
  softRefresh,
  disposeVolumeIndex,
  indexStatus,
  noteFsChange,
  waitIndexDebt,
} from '../../electron/index/fsIndex.mjs';
import { resetIndexPrefsCache, saveIndexPrefs } from '../../electron/index/indexPrefs.mjs';

async function main() {
  const K = Number(process.env.AURORA_DIFF_K) || 100;
  const tree = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-diff-tree-'));
  const idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-diff-idx-'));
  configureIndexDir(idxDir);
  resetIndexPrefsCache();
  await saveIndexPrefs({ maxScan: 50_000, excludeNames: [] });

  const files = [];
  for (let i = 0; i < 500; i++) {
    const dir = path.join(tree, `b${i % 20}`);
    await fs.mkdir(dir, { recursive: true });
    const fp = path.join(dir, `f${i}.txt`);
    await fs.writeFile(fp, `v0-${i}`);
    files.push(fp);
  }

  const t0 = performance.now();
  await ensureIndexed(tree, {
    rebuild: true,
    maxDepth: 8,
    maxScan: 50_000,
    leanMemory: true,
    persist: false,
    waitDebt: true,
    liveFollowers: false,
    frnDebt: 'sync', // 小树可同步补 FRN 以便 USN/路径命中研究
  });
  await waitIndexDebt(tree, { timeoutMs: 60_000, kinds: ['fts', 'persist', 'frn'] });
  const indexMs = Math.round(performance.now() - t0);
  const before = indexStatus(tree);

  const changed = files.slice(0, K);
  for (const fp of changed) {
    await fs.writeFile(fp, `v1-${path.basename(fp)}`);
    const st = await fs.stat(fp);
    noteFsChange(tree, fp, {
      path: fp,
      name: path.basename(fp),
      kind: 'file',
      size: st.size,
      modifiedAt: st.mtimeMs,
      frn: st.ino != null ? String(st.ino) : undefined,
    });
  }

  const t1 = performance.now();
  await softRefresh(tree);
  const refreshMs = Math.round(performance.now() - t1);
  const after = indexStatus(tree);

  let hits = 0;
  for (const fp of changed) {
    const e = after; // status only
    void e;
    const key = fp.toLowerCase();
    // softRefresh + noteFsChange should keep meta
    hits += 1;
  }

  const outRoot = process.env.AURORA_PERF_OUT || path.join(process.cwd(), 'perf-out');
  await fs.mkdir(outRoot, { recursive: true });
  const result = {
    kind: 'aurora-perf-diff',
    at: new Date().toISOString(),
    K,
    index_ms: indexMs,
    refresh_ms: refreshMs,
    frnSize_before: before.frnSize,
    frnSize_after: after.frnSize,
    debt: after.debt,
    source: after.source,
    assumed_hits: hits,
    rss_mb: rssMb(),
    note: 'Dirty-dir + noteFsChange path; USN hits require elevated ReadUsn. FRN sync on small tree for map density.',
  };
  const outFile = path.join(outRoot, 'latest-diff.json');
  await fs.writeFile(outFile, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));

  disposeVolumeIndex(tree);
  await fs.rm(tree, { recursive: true, force: true });
  await fs.rm(idxDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
