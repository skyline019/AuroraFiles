#!/usr/bin/env node
/**
 * 真盘当前位置深搜冒烟（默认 E:\canvas，查询「问」）
 *
 *   node scripts/real-search-cwd.mjs
 *   node scripts/real-search-cwd.mjs --root E:\canvas --query 问 --assert --max-ms 8000
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { configureIndexDir } from '../electron/index/persist.mjs';
import { resetIndexPrefsCache } from '../electron/index/indexPrefs.mjs';
import { disposeVolumeIndex } from '../electron/index/fsIndex.mjs';
import { searchFiles, volumeRootOf } from '../electron/index/searchFiles.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const root = path.resolve(arg('--root', process.env.AURORA_SEARCH_ROOT || 'E:\\canvas'));
const query = arg('--query', process.env.AURORA_SEARCH_QUERY || '问');
const assert = process.argv.includes('--assert');
const maxMs = Number(arg('--max-ms', '15000')) || 15_000;

const idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-cwd-search-'));
configureIndexDir(idxDir);
resetIndexPrefsCache();

try {
  await fs.access(root);
} catch {
  console.error(`root missing: ${root}`);
  process.exit(assert ? 2 : 0);
}

disposeVolumeIndex(volumeRootOf(root));

const t0 = performance.now();
const res = await searchFiles(root, query, {
  maxDepth: 64,
  maxScan: 0,
  maxResults: 100,
  // 真盘冒烟：先不依赖本机持久索引，验证并行 walk 任意词召回
  forceWalk: true,
  indexDepth: 0,
});
const ms = Math.round(performance.now() - t0);

const names = (res.items || []).map((it) => it.name);
console.log(JSON.stringify({
  root,
  query,
  ms,
  source: res.source,
  scanned: res.scanned,
  hits: names.length,
  truncated: !!res.truncated,
  sample: names.slice(0, 10),
}, null, 2));

await fs.rm(idxDir, { recursive: true, force: true }).catch(() => undefined);

if (assert) {
  if (!names.length) {
    console.error('ASSERT fail: no hits');
    process.exit(1);
  }
  if (ms > maxMs) {
    console.error(`ASSERT fail: too slow ${ms}ms > ${maxMs}`);
    process.exit(1);
  }
  console.log('ASSERT ok');
}
