#!/usr/bin/env node
/**
 * Same-machine bakeoff: JS Dirent vs Rust walk vs USN Enum.
 *   npm run test:perf-bakeoff
 *   node scripts/perf/run-bakeoff.mjs --volume E:\\
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { bakeoffJsWalk } from './bakeoff-walk.mjs';
import { bakeoffUsnEnum } from './bakeoff-usn-enum.mjs';
import { ensureMftRelease, runMftMode } from './bakeoff-mft.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const RUST_DIR = path.join(REPO, 'native', 'walk-bench');
const RUST_BIN = path.join(
  RUST_DIR,
  'target',
  'release',
  process.platform === 'win32' ? 'aurora-walk-bench.exe' : 'aurora-walk-bench',
);

function parseArgs(argv) {
  const out = { volume: 'E:\\', maxScan: 5_000_000, maxDepth: 64, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--volume' || a === '--root') out.volume = argv[++i];
    else if (a === '--max-scan') out.maxScan = Number(argv[++i]) || out.maxScan;
    else if (a === '--max-depth') out.maxDepth = Number(argv[++i]) || out.maxDepth;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

async function ensureRustRelease() {
  if (fssync.existsSync(RUST_BIN)) {
    const st = fssync.statSync(RUST_BIN);
    const src = path.join(RUST_DIR, 'src', 'main.rs');
    if (fssync.existsSync(src) && st.mtimeMs >= fssync.statSync(src).mtimeMs) {
      return RUST_BIN;
    }
  }
  console.log('[bakeoff] cargo build --release (native/walk-bench)…');
  await execFileAsync('cargo', ['build', '--release'], {
    cwd: RUST_DIR,
    windowsHide: true,
    timeout: 600_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!fssync.existsSync(RUST_BIN)) throw new Error(`missing binary ${RUST_BIN}`);
  return RUST_BIN;
}

function runRustMode(bin, root, mode, opts) {
  return new Promise((resolve, reject) => {
    const args = [
      '--root', root,
      '--mode', mode,
      '--max-depth', String(opts.maxDepth),
      '--max-scan', String(opts.maxScan),
      '--follow-reparse', 'true',
    ];
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
        if (!line) {
          resolve({
            engine: 'rust',
            mode,
            ok: false,
            error: `no_stdout code=${code} stderr=${stderr.slice(0, 300)}`,
          });
          return;
        }
        resolve(JSON.parse(line));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function verdictFrom(rows) {
  const jsStore = rows.find((r) => r.engine === 'js' && r.mode === 'store');
  const rustStore = rows.find((r) => r.engine === 'rust' && r.mode === 'store');
  const mftStore = rows.find((r) => r.engine === 'mft-cxx' && r.mode === 'store');
  const mftCount = rows.find((r) => r.engine === 'mft-cxx' && r.mode === 'count');
  const usn = rows.find((r) => r.engine === 'usn-enum');

  let rust_walk = 'keep_js';
  const reasons = [];
  if (jsStore?.ok && rustStore?.ok) {
    const rssRatio = rustStore.rss_mb / Math.max(jsStore.rss_mb, 1);
    const thrRatio = rustStore.entries_per_s / Math.max(jsStore.entries_per_s, 1);
    if (rssRatio <= 0.55 || thrRatio >= 1.5) {
      rust_walk = 'adopt';
      reasons.push(`rust_store rss_ratio=${rssRatio.toFixed(2)} thr_ratio=${thrRatio.toFixed(2)}`);
    } else {
      reasons.push(`rust_store below gate rss_ratio=${rssRatio.toFixed(2)} thr_ratio=${thrRatio.toFixed(2)}`);
    }
  } else {
    reasons.push('rust_or_js_store_missing');
  }

  // C++ MFT with path materialization (store) is the adopt gate
  let mft = 'defer';
  const mftRow = mftStore || mftCount;
  if (mftRow?.error === 'skipped_no_priv' || mftCount?.error === 'skipped_no_priv') {
    mft = 'defer';
    reasons.push('mft_cxx_no_priv');
  } else if (mftStore?.ok && (mftStore.count || 0) >= 100_000) {
    // Path rebuild is heavier than enum-only; ≥150k/s or ≤10s at scale ⇒ adopt
    const eps = mftStore.entries_per_s || 0;
    const ms = mftStore.ms || 0;
    const countEps = mftCount?.entries_per_s || 0;
    if (eps >= 150_000 || ms <= 10_000) {
      mft = 'adopt';
      reasons.push(`mft_store count=${mftStore.count} eps=${eps} ms=${ms} count_eps=${countEps}`);
    } else {
      mft = 'defer';
      reasons.push(`mft_store below gate eps=${eps} ms=${ms}`);
    }
  } else if (usn?.verdict_hint === 'mft=spike_ok') {
    mft = 'spike_ok';
    reasons.push('usn_ps_spike_ok_only');
  } else {
    reasons.push(`mft_${mftProbe?.error || usn?.error || 'unavailable'}`);
  }

  return {
    rust_walk,
    mft,
    engine_priority: mft === 'adopt' ? ['mft', 'rust', 'js'] : (rust_walk === 'adopt' ? ['rust', 'js'] : ['js']),
    default_combo:
      'Electron UI + Node lean/FTS/debt + WalkEngine(mft→rust→js) + hydrate-first + USN/watch; MFT C++ gated',
    reasons,
    gates: {
      rust_rss_le: 0.55,
      rust_thr_ge: 1.5,
      mft_store_eps_ge: 150_000,
      mft_store_ms_le: 10_000,
      mft_store_count_ge: 100_000,
    },
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log('Usage: node scripts/perf/run-bakeoff.mjs --volume E:\\');
    process.exit(0);
  }
  const root = path.win32.normalize(opts.volume);
  if (!fssync.existsSync(root)) {
    console.error('volume not found', root);
    process.exit(2);
  }

  const runId = `bakeoff-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outDir = path.join(REPO, 'perf-out', runId);
  await fs.mkdir(outDir, { recursive: true });
  console.log(`bakeoff → ${outDir}`);
  console.log(`volume=${root} maxScan=${opts.maxScan} depth=${opts.maxDepth}`);

  const rows = [];

  console.log('[1/8] JS count…');
  const jsCount = await bakeoffJsWalk(root, {
    mode: 'count',
    maxDepth: opts.maxDepth,
    maxScan: opts.maxScan,
  });
  rows.push(jsCount);
  console.log(`  js count ${jsCount.count} in ${jsCount.ms}ms @ ${jsCount.entries_per_s}/s rss=${jsCount.rss_mb}MB`);

  console.log('[2/8] JS store…');
  const jsStore = await bakeoffJsWalk(root, {
    mode: 'store',
    maxDepth: opts.maxDepth,
    maxScan: opts.maxScan,
  });
  rows.push(jsStore);
  console.log(`  js store ${jsStore.count} in ${jsStore.ms}ms @ ${jsStore.entries_per_s}/s rss=${jsStore.rss_mb}MB`);

  const bin = await ensureRustRelease();

  console.log('[3/8] Rust count…');
  const rustCount = await runRustMode(bin, root, 'count', opts);
  rows.push(rustCount);
  console.log(`  rust count ${rustCount.count} in ${rustCount.ms}ms @ ${rustCount.entries_per_s}/s rss=${rustCount.rss_mb}MB`);

  console.log('[4/8] Rust store…');
  const rustStore = await runRustMode(bin, root, 'store', opts);
  rows.push(rustStore);
  console.log(`  rust store ${rustStore.count} in ${rustStore.ms}ms @ ${rustStore.entries_per_s}/s rss=${rustStore.rss_mb}MB`);

  console.log('[5/8] Rust compact…');
  const rustCompact = await runRustMode(bin, root, 'compact', opts);
  rows.push(rustCompact);
  console.log(`  rust compact ${rustCompact.count} in ${rustCompact.ms}ms rss=${rustCompact.rss_mb}MB`);

  console.log('[6/8] USN Enum (PS)…');
  const usn = await bakeoffUsnEnum(root);
  rows.push(usn);
  console.log(`  usn-enum ok=${usn.ok} count=${usn.count} ms=${usn.ms} eps=${usn.entries_per_s} err=${usn.error || 'none'}`);

  const mftBin = await ensureMftRelease();
  console.log('[7/8] C++ MFT count…');
  const mftCount = await runMftMode(mftBin, root, 'count', opts);
  rows.push(mftCount);
  console.log(`  mft-cxx count ok=${mftCount.ok} count=${mftCount.count} ms=${mftCount.ms} eps=${mftCount.entries_per_s} err=${mftCount.error || 'none'}`);

  console.log('[8/8] C++ MFT store (paths)…');
  const mftStore = await runMftMode(mftBin, root, 'store', opts);
  rows.push(mftStore);
  console.log(`  mft-cxx store ok=${mftStore.ok} count=${mftStore.count} ms=${mftStore.ms} eps=${mftStore.entries_per_s} err=${mftStore.error || 'none'}`);

  const verdict = verdictFrom(rows);
  const summary = {
    kind: 'aurora-perf-bakeoff',
    runId,
    at: new Date().toISOString(),
    platform: `${process.platform} ${os.arch()}`,
    root,
    opts: { maxScan: opts.maxScan, maxDepth: opts.maxDepth },
    rows,
    verdict,
  };
  const outFile = path.join(outDir, 'summary.json');
  await fs.writeFile(outFile, JSON.stringify(summary, null, 2), 'utf8');
  await fs.writeFile(
    path.join(REPO, 'perf-out', 'latest-bakeoff.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );
  // Sticky verdict for WalkEngine default
  await fs.writeFile(
    path.join(REPO, 'perf-out', 'bakeoff-verdict.json'),
    JSON.stringify(verdict, null, 2),
    'utf8',
  );
  console.log(`verdict rust_walk=${verdict.rust_walk} mft=${verdict.mft}`);
  console.log(`wrote ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
