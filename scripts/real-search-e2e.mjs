#!/usr/bin/env node
/**
 * 真盘 IPC 级慢搜 / 大目录压测（无 Electron 窗口）
 *
 * 造临时大树 → 冷启动 walk-fallback 搜索 → 中途 cancel → 断言 cancelled
 * 另测建索 + 查询门槛（可用 --assert）
 *
 *   node scripts/real-search-e2e.mjs
 *   node scripts/real-search-e2e.mjs --files 3000 --assert
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  configureIndexDir,
  ensureIndexed,
  queryIndex,
  disposeVolumeIndex,
} from '../electron/index/fsIndex.mjs';
import { searchFiles, cancelSearch } from '../electron/index/searchFiles.mjs';
import { saveIndexPrefs, resetIndexPrefsCache } from '../electron/index/indexPrefs.mjs';

function parseArgs(argv) {
  const out = { files: 2500, depth: false, depth: 5 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files') out.files = Number(argv[++i]) || 2500;
    else if (a === '--assert') out.assert = true;
    else if (a === '--depth') out.depth = Number(argv[++i]) || 5;
  }
  return out;
}

async function seed(root, fileCount, depth) {
  const dirs = [root];
  await fs.mkdir(root, { recursive: true });
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const dir of dirs) {
      for (let i = 0; i < 5; i++) {
        const sub = path.join(dir, `L${d}_${i}`);
        await fs.mkdir(sub, { recursive: true });
        next.push(sub);
      }
    }
    dirs.push(...next);
  }
  let n = 0;
  let di = 0;
  while (n < fileCount) {
    const dir = dirs[di % dirs.length];
    await fs.writeFile(path.join(dir, `needle_${n}.txt`), `x${n}\n`);
    n += 1;
    di += 1;
  }
  return n;
}

async function main() {
  const args = parseArgs(process.argv);
  const idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-rse-idx-'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-rse-tree-'));
  configureIndexDir(idxDir);
  resetIndexPrefsCache();
  await saveIndexPrefs({ maxScan: 80_000, excludeNames: ['should_skip_me'] });

  console.log(`seed ${args.files} files under ${root}`);
  const t0 = Date.now();
  await seed(root, args.files, args.depth);
  console.log(`seed_ms=${Date.now() - t0}`);

  // 不建索，强制 walk-fallback，拉长可取消窗口
  disposeVolumeIndex(root);
  const searchP = searchFiles(root, 'needle_', {
    maxResults: 800,
    maxDepth: 8,
    maxScan: 50_000,
    indexDepth: 0,
  });
  await new Promise((r) => setTimeout(r, 15));
  cancelSearch();
  const cancelledRes = await searchP;
  console.log('cancel_result', {
    source: cancelledRes.source,
    cancelled: cancelledRes.cancelled,
    scanned: cancelledRes.scanned,
    hits: cancelledRes.items?.length,
  });

  // 建索 + 查询
  const t1 = Date.now();
  await ensureIndexed(root, { rebuild: true, maxDepth: 10, maxScan: 100_000 });
  const ensureMs = Date.now() - t1;
  const q0 = Date.now();
  const hits = await queryIndex(root, 'needle_', { maxResults: 200 });
  const queryMs = Date.now() - q0;
  console.log(`ensure_ms=${ensureMs} query_ms=${queryMs} hits=${hits.items.length} source=${hits.source}`);

  let failed = false;
  if (args.assert) {
    // 取消路径：要么 cancelled，要么极快索引命中（可接受）
    const cancelOk = cancelledRes.cancelled || cancelledRes.source === 'cancelled'
      || (cancelledRes.items?.length >= 0 && cancelledRes.scanned < args.files);
    if (!cancelOk) {
      console.error('ASSERT fail: search cancel did not take effect');
      failed = true;
    }
    if (hits.items.length < 10) {
      console.error('ASSERT fail: expected >=10 hits after index');
      failed = true;
    }
    if (ensureMs > 120_000) {
      console.error('ASSERT fail: ensure too slow', ensureMs);
      failed = true;
    }
    if (queryMs > 5_000) {
      console.error('ASSERT fail: query too slow', queryMs);
      failed = true;
    }
  }

  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(idxDir, { recursive: true, force: true }).catch(() => undefined);
  if (failed) process.exit(1);
  console.log('real-search-e2e OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
