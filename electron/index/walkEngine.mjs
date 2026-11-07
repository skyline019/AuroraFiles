/**
 * Pluggable volume walk: mft (C++ USN Enum) | rust | js
 * Priority: AURORA_WALK_ENGINE > bakeoff verdict mft=adopt > rust_walk=adopt > js
 * Fallback chain on failure: mft → rust → js
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parallelDirentWalk } from './fastWalk.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function rustBinCandidates() {
  const name = process.platform === 'win32' ? 'aurora-walk-bench.exe' : 'aurora-walk-bench';
  const res = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  return [
    process.env.AURORA_WALK_BIN,
    res && path.join(res, 'native', name),
    path.join(REPO_ROOT, 'native', 'walk-bench', 'target', 'release', name),
    path.join(REPO_ROOT, 'native', 'walk-bench', 'target', 'debug', name),
  ].filter(Boolean);
}

function mftBinCandidates() {
  const res = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  return [
    process.env.AURORA_MFT_BIN,
    res && path.join(res, 'native', 'aurora-mft-enum.exe'),
    path.join(REPO_ROOT, 'native', 'mft-enum', 'build', 'Release', 'aurora-mft-enum.exe'),
    path.join(REPO_ROOT, 'native', 'mft-enum', 'build', 'Debug', 'aurora-mft-enum.exe'),
  ].filter(Boolean);
}

function firstExisting(cands) {
  for (const p of cands) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch { /* */ }
  }
  return null;
}

export function resolveRustWalkBin() {
  return firstExisting(rustBinCandidates());
}

export function resolveMftWalkBin() {
  return firstExisting(mftBinCandidates());
}

function loadBakeoffVerdict() {
  try {
    const p = path.join(REPO_ROOT, 'perf-out', 'bakeoff-verdict.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function isVolumeRoot(root) {
  const s = String(root).replace(/[/\\]+$/, '');
  return /^[A-Za-z]:$/.test(s);
}

/**
 * @param {string} root
 * @param {{ engine?: string, forceEngine?: string }} opts
 * @returns {'mft'|'rust'|'js'}
 */
export function resolveWalkEngine(root, opts = {}) {
  const forced = opts.forceEngine || opts.engine || process.env.AURORA_WALK_ENGINE;
  if (forced === 'js' || forced === 'rust' || forced === 'mft') {
    if (forced === 'rust' && !resolveRustWalkBin()) return 'js';
    if (forced === 'mft' && !resolveMftWalkBin()) {
      return resolveRustWalkBin() ? 'rust' : 'js';
    }
    return forced;
  }
  if (!isVolumeRoot(root)) return 'js';
  const verdict = loadBakeoffVerdict();
  // Prefer sticky engine_priority (FRN-link mft→indexd typically leads when elevated)
  const priority = Array.isArray(verdict?.engine_priority) ? verdict.engine_priority : null;
  if (priority?.length) {
    for (const eng of priority) {
      if (eng === 'mft' && verdict?.mft === 'adopt' && resolveMftWalkBin()) return 'mft';
      if (eng === 'rust' && (verdict?.rust_walk === 'adopt' || resolveRustWalkBin()) && resolveRustWalkBin()) {
        return 'rust';
      }
      if (eng === 'js') return 'js';
    }
  }
  if (verdict?.mft === 'adopt' && resolveMftWalkBin()) return 'mft';
  if (verdict?.rust_walk === 'adopt' && resolveRustWalkBin()) return 'rust';
  if (resolveRustWalkBin()) return 'rust';
  return 'js';
}

/**
 * @param {string} root
 * @param {object} opts
 */
export async function walkVolume(root, opts = {}) {
  const engine = resolveWalkEngine(root, opts);
  if (engine === 'mft') {
    try {
      return await mftStreamWalk(root, opts);
    } catch (err) {
      if (typeof opts.onEngineFallback === 'function') {
        opts.onEngineFallback({ from: 'mft', to: 'rust', error: String(err?.message || err) });
      }
      try {
        return await rustStreamWalk(root, opts);
      } catch (err2) {
        if (typeof opts.onEngineFallback === 'function') {
          opts.onEngineFallback({ from: 'rust', to: 'js', error: String(err2?.message || err2) });
        }
        const stats = await parallelDirentWalk(root, opts);
        return { ...stats, engine: 'js' };
      }
    }
  }
  if (engine === 'rust') {
    try {
      return await rustStreamWalk(root, opts);
    } catch (err) {
      if (typeof opts.onEngineFallback === 'function') {
        opts.onEngineFallback({ from: 'rust', to: 'js', error: String(err?.message || err) });
      }
      const stats = await parallelDirentWalk(root, opts);
      return { ...stats, engine: 'js' };
    }
  }
  const stats = await parallelDirentWalk(root, opts);
  return { ...stats, engine: 'js' };
}

function streamChildWalk(bin, args, root, opts, engineName) {
  const maxScan = opts.maxScan ?? 5_000_000;
  const onEntry = opts.onEntry;
  const aborted = opts.aborted || (() => false);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let scanned = 0;
    let settled = false;
    let summary = null;
    let lastProgressAt = 0;
    const progressMs = opts.maxPerf ? 250 : 400;
    let stderrBuf = '';

    const finish = (extra = {}) => {
      if (settled) return;
      settled = true;
      resolve({
        scanned,
        timedOut: false,
        hitMax: scanned >= maxScan,
        concurrency: 0,
        engine: engineName,
        ...extra,
        summary,
      });
    };

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk;
      const lines = String(chunk).split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith('__AURORA_WALK_SUMMARY__')) {
          try {
            summary = JSON.parse(line.slice('__AURORA_WALK_SUMMARY__'.length));
          } catch { /* */ }
        }
      }
    });

    const onRawLine = typeof opts.onRawLine === 'function' ? opts.onRawLine : null;
    const onStreamMeta = typeof opts.onStreamMeta === 'function' ? opts.onStreamMeta : null;
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (aborted()) {
        try { child.kill(); } catch { /* */ }
        return;
      }
      const t = line.trim();
      if (!t) return;
      // Ignore JSON summary accidentally on stdout
      if (t.startsWith('{"engine"')) return;
      // stream-nodes meta (root_frn / drive) — not an entry
      if (t.includes('"fmt"') && (t.includes('"frn"') || t.includes('root_frn'))) {
        if (onStreamMeta) {
          try { onStreamMeta(JSON.parse(t)); } catch { /* */ }
        }
        return;
      }
      // Native indexd path: forward raw NDJSON without JSON.parse (avoids 1M V8 objects)
      if (onRawLine) {
        onRawLine(t);
        scanned += 1;
      } else {
        let entry;
        try {
          entry = JSON.parse(t);
        } catch {
          return;
        }
        if (!entry?.path || !entry?.name) return;
        if (entry.frn != null) entry.frn = String(entry.frn);
        onEntry?.(entry, { isDir: entry.kind === 'folder' });
        scanned += 1;
      }

      const now = Date.now();
      if (typeof opts.onProgress === 'function' && now - lastProgressAt >= progressMs) {
        lastProgressAt = now;
        opts.onProgress({ scanned, queued: 0 });
      }
      if (typeof opts.onIdle === 'function' && scanned % 4096 === 0) {
        try { opts.onIdle(); } catch { /* */ }
      }
      if (scanned >= maxScan) {
        try { child.kill(); } catch { /* */ }
      }
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('close', (code) => {
      rl.close();
      if (aborted()) {
        finish({ aborted: true });
        return;
      }
      if (code && code !== 0 && scanned === 0) {
        const noPriv = /skipped_no_priv/.test(stderrBuf) || code === 3;
        if (!settled) {
          settled = true;
          reject(new Error(noPriv ? `${engineName}_no_priv` : `${engineName}_exit_${code}`));
        }
        return;
      }
      finish({ exitCode: code });
    });
  });
}

export async function rustStreamWalk(root, opts = {}) {
  const bin = resolveRustWalkBin();
  if (!bin) throw new Error('rust_walk_bin_missing');
  const maxDepth = opts.maxDepth ?? 64;
  const maxScan = opts.maxScan ?? 5_000_000;
  const followReparse = opts.followReparse === true;
  const args = [
    '--root', path.win32.normalize(root),
    '--mode', 'stream',
    '--max-depth', String(maxDepth),
    '--max-scan', String(maxScan),
    '--follow-reparse', followReparse ? 'true' : 'false',
  ];
  return streamChildWalk(bin, args, root, opts, 'rust');
}

export async function mftStreamWalk(root, opts = {}) {
  const bin = resolveMftWalkBin();
  if (!bin) throw new Error('mft_walk_bin_missing');
  const maxScan = opts.maxScan ?? 5_000_000;
  // onRawLine → FRN-link stream (no path materialization); onEntry needs full paths
  const mode = (typeof opts.onRawLine === 'function' || opts.nodeStream === true)
    ? 'stream-nodes'
    : 'stream';
  const args = [
    '--root', path.win32.normalize(root),
    '--mode', mode,
    '--max-scan', String(maxScan),
  ];
  return streamChildWalk(bin, args, root, opts, 'mft');
}
