#!/usr/bin/env node
/**
 * 真实盘集成压测 + 指标
 *
 * 用法:
 *   node scripts/index-bench.mjs                  # 临时树 ~4k 文件
 *   node scripts/index-bench.mjs --files 8000
 *   node scripts/index-bench.mjs --root D:\some\folder   # 扫已有目录（只读建索+查询，不造文件）
 *   node scripts/index-bench.mjs --json out.json
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  configureIndexDir,
  ensureIndexed,
  queryIndex,
  indexStatus,
  softRefresh,
  disposeVolumeIndex,
  noteFsChange,
  backfillFrn,
  flushIndexDisk,
} from '../electron/index/fsIndex.mjs';
import { Metrics, gaugesFromStatus } from '../electron/index/metrics.mjs';

function parseArgs(argv) {
  const out = { files: 4000, depth: null, json: null, depth: 4, keep: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files') out.files = Number(argv[++i]) || 4000;
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--depth') out.depth = Number(argv[++i]) || 4;
    else if (a === '--keep') out.keep = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

async function seedTree(root, fileCount, depth) {
  let created = 0;
  const dirs = [root];
  await fs.mkdir(root, { recursive: true });
  // 先铺目录层
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const dir of dirs) {
      for (let i = 0; i < 6; i++) {
        const sub = path.join(dir, `dir_${d}_${i}`);
        await fs.mkdir(sub, { recursive: true });
        next.push(sub);
      }
    }
    dirs.push(...next);
  }
  let di = 0;
  while (created < fileCount) {
    const dir = dirs[di % dirs.length];
    const fp = path.join(dir, `file_${created}_report.txt`);
    await fs.writeFile(fp, `payload ${created}\n`, 'utf8');
    created += 1;
    di += 1;
  }
  return created;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  delete process.env.AURORA_DEBUG_USN;
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/index-bench.mjs [--files N] [--root PATH] [--json out.json] [--keep]`);
    process.exit(0);
  }

  const metrics = new Metrics('aurora-index-bench');
  const indexDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-bench-idx-'));
  configureIndexDir(indexDir);

  let root;
  let owned = false;
  if (args.root) {
    root = path.resolve(args.root);
    if (!fssync.existsSync(root)) {
      console.error('root not found:', root);
      process.exit(1);
    }
    metrics.gauge('mode', 'existing-root');
  } else {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-bench-tree-'));
    owned = true;
    metrics.gauge('mode', 'seeded-temp');
    const endSeed = metrics.start('seed_tree');
    const n = await seedTree(root, args.files, args.depth);
    endSeed();
    metrics.gauge('seeded_files', n);
  }

  const vol = root; // 用目录自身作「卷根」（非盘符也可）
  metrics.gauge('root', vol);
  metrics.gauge('indexDir', indexDir);

  try {
    // 1) 全量建索
    const endFull = metrics.start('ensure_full');
    await ensureIndexed(vol, { rebuild: true, maxDepth: 12, maxScan: 200_000 });
    endFull();
    let st = indexStatus(vol);
    Object.assign(metrics.gauges, Object.fromEntries(
      Object.entries(gaugesFromStatus(st)).map(([k, v]) => [`after_full.${k}`, v]),
    ));

    // 2) 查询延迟
    const queries = [
      'file_',
      'report',
      'dir_1',
      'file_1 report',
      'zzz_not_exist_qqq',
    ];
    for (const q of queries) {
      const end = metrics.start('query');
      const res = await queryIndex(vol, q, { maxResults: 200 });
      end();
      metrics.gauge(`query.${q}.hits`, res.items.length);
      metrics.gauge(`query.${q}.source`, res.source || '');
      metrics.gauge(`query.${q}.cached`, !!res.cached);
    }
    // 热词二次（缓存）
    {
      const end = metrics.start('query_cached');
      await queryIndex(vol, 'report', { maxResults: 200 });
      end();
    }

    // 3) FRN 回填
    const endFrn = metrics.start('backfill_frn');
    const frnN = await backfillFrn(vol, 5_000);
    endFrn();
    metrics.gauge('frn_backfilled', frnN);

    // 4) 落盘 flush + 冷启动 hydrate
    const endFlush = metrics.start('flush_disk');
    await flushIndexDisk(vol, { forceCompact: true });
    endFlush();
    disposeVolumeIndex(vol);

    const endHydrate = metrics.start('ensure_hydrate');
    await ensureIndexed(vol, { maxDepth: 12, maxScan: 200_000 });
    endHydrate();
    st = indexStatus(vol);
    metrics.gauge('hydrate.size', st.size);
    metrics.gauge('hydrate.source', st.source);
    metrics.gauge('hydrate.diskBytes', st.disk?.bytes ?? 0);

    // 5) 外部变更 + soft refresh（仅 seeded 模式写盘）
    let correctness = { added: false, removed: false };
    if (owned) {
      const addPath = path.join(vol, `bench_external_${Date.now()}.txt`);
      const victim = [...(await fs.readdir(vol))]
        .map((n) => path.join(vol, n))
        .find((p) => {
          try { return fssync.statSync(p).isFile(); } catch { return false; }
        });

      await fs.writeFile(addPath, 'external\n', 'utf8');
      const stAdd = await fs.stat(addPath);
      noteFsChange(vol, addPath, {
        path: addPath,
        name: path.basename(addPath),
        kind: 'file',
        size: stAdd.size,
        modifiedAt: stAdd.mtimeMs,
        frn: stAdd.ino != null ? String(stAdd.ino) : undefined,
      });

      if (victim) {
        await fs.unlink(victim);
        noteFsChange(vol, victim, null);
      }

      const endSoft = metrics.start('soft_refresh');
      await softRefresh(vol);
      endSoft();
      await sleep(50);

      const hitAdd = await queryIndex(vol, path.basename(addPath).slice(0, 12), { maxResults: 50 });
      correctness.added = hitAdd.items.some((i) => i.path.toLowerCase() === addPath.toLowerCase());
      if (victim) {
        const hitRm = await queryIndex(vol, path.basename(victim), { maxResults: 50 });
        correctness.removed = !hitRm.items.some((i) => i.path.toLowerCase() === victim.toLowerCase());
      } else {
        correctness.removed = true;
      }
    }
    metrics.gauge('correctness.added', correctness.added);
    metrics.gauge('correctness.removed', correctness.removed);

    st = indexStatus(vol);
    Object.assign(metrics.gauges, Object.fromEntries(
      Object.entries(gaugesFromStatus(st)).map(([k, v]) => [`final.${k}`, v]),
    ));

    const report = metrics.report();
    report.pass = owned
      ? correctness.added && correctness.removed
      : (st.size > 0 && report.timings.ensure_full?.avg > 0);

    console.log(metrics.print());
    console.log(`pass: ${report.pass}`);

    if (args.json) {
      await fs.writeFile(args.json, JSON.stringify(report, null, 2), 'utf8');
      console.log('wrote', args.json);
    }

    disposeVolumeIndex(vol);
    process.exitCode = report.pass ? 0 : 2;
  } finally {
    if (owned && !args.keep) {
      try { await fs.rm(root, { recursive: true, force: true }); } catch { /* */ }
    }
    if (!args.keep) {
      try { await fs.rm(indexDir, { recursive: true, force: true }); } catch { /* */ }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
