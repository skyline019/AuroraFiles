#!/usr/bin/env node
/**
 * Cold-start harness for packaged (or electron .) Aurora Files.
 *
 *   npm run test:perf-startup
 *   AURORA_STARTUP_EXE=release/win-unpacked/AuroraFiles.exe npm run test:perf-startup
 *
 * Gates (override with env):
 *   ready-to-show ≤ AURORA_STARTUP_READY_MS (default 2500)
 *   interactive   ≤ AURORA_STARTUP_INTERACTIVE_MS (default 4500)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_ROOT = process.env.AURORA_PERF_OUT || path.join(ROOT, 'perf-out');
const runId = process.env.AURORA_PERF_RUN_ID || `startup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const readyGate = Number(process.env.AURORA_STARTUP_READY_MS) || 2500;
const interactiveGate = Number(process.env.AURORA_STARTUP_INTERACTIVE_MS) || 4500;
const timeoutMs = Number(process.env.AURORA_STARTUP_TIMEOUT_MS) || 45_000;
const runs = Math.max(1, Number(process.env.AURORA_STARTUP_RUNS) || 2);
/** Discard first sample (Windows Defender often taxes the virgin launch ~8–10s). */
const discardFirst = process.env.AURORA_STARTUP_DISCARD_FIRST !== '0';

function resolveExe() {
  if (process.env.AURORA_STARTUP_EXE) {
    return path.resolve(process.env.AURORA_STARTUP_EXE);
  }
  const unpacked = path.join(ROOT, 'release', 'win-unpacked');
  if (fssync.existsSync(unpacked)) {
    const exe = fssync.readdirSync(unpacked).find((n) => /^AuroraFiles\.exe$/i.test(n));
    if (exe) return path.join(unpacked, exe);
  }
  // Dev fallback: electron binary + project
  const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (fssync.existsSync(electronBin)) return electronBin;
  return null;
}

function parseMarks(stderrText) {
  /** @type {Record<string, number>} */
  const marks = {};
  for (const line of String(stderrText).split(/\r?\n/)) {
    const m = line.match(/AURORA_STARTUP\s+(\{.*\})\s*$/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[1]);
      if (j?.name && typeof j.ms === 'number') marks[j.name] = j.ms;
    } catch { /* */ }
  }
  return marks;
}

function runOnce(exe, outFile, idx) {
  return new Promise((resolve) => {
    const args = /\belectron\.exe$/i.test(exe) ? [ROOT] : [];
    const env = {
      ...process.env,
      AURORA_STARTUP_BENCH: '1',
      AURORA_STARTUP_OUT: outFile,
      ELECTRON_ENABLE_LOGGING: '1',
    };
    const child = spawn(exe, args, {
      cwd: ROOT,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    const started = Date.now();
    let settled = false;
    const finish = (extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* */ }
      // Windows: ensure exit
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* */ }
      }, 500);
      const marks = parseMarks(stderr + stdout);
      resolve({
        run: idx,
        wall_ms: Date.now() - started,
        marks,
        ...extra,
      });
    };
    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
    child.stderr?.setEncoding('utf8');
    child.stdout?.setEncoding('utf8');
    const stopOnReady = process.env.AURORA_STARTUP_HTML === 'probe'
      || process.env.AURORA_STARTUP_HTML === 'bigprobe'
      || process.env.AURORA_STARTUP_STOP_ON_READY === '1';
    child.stderr?.on('data', (c) => {
      stderr += c;
      if (/AURORA_STARTUP.*"interactive"/.test(c)) {
        // Give mark file a tick to flush
        setTimeout(() => finish(), 200);
      } else if (stopOnReady && /AURORA_STARTUP.*"ready-to-show"/.test(c)) {
        setTimeout(() => finish({ stopOnReady: true }), 300);
      }
    });
    child.stdout?.on('data', (c) => { stdout += c; });
    child.on('error', (err) => finish({ error: err.message }));
    child.on('exit', () => {
      if (!settled) finish({ exitedEarly: true });
    });
  });
}

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

async function main() {
  const exe = resolveExe();
  if (!exe) {
    console.error('[startup] no exe — build with npm run build:desktop:dir first');
    process.exit(2);
  }
  const runDir = path.join(OUT_ROOT, runId);
  await fs.mkdir(runDir, { recursive: true });

  const samples = [];
  for (let i = 1; i <= runs; i++) {
    const outFile = path.join(runDir, `marks-${i}.json`);
    console.log(`[startup] run ${i}/${runs} → ${exe}`);
    const r = await runOnce(exe, outFile, i);
    // Prefer file marks if richer
    try {
      const disk = JSON.parse(await fs.readFile(outFile, 'utf8'));
      if (disk?.marks) r.marks = { ...r.marks, ...disk.marks };
    } catch { /* */ }
    samples.push(r);
    console.log(
      `[startup]   ready-to-show=${r.marks['ready-to-show'] ?? '—'}ms` +
      ` interactive=${r.marks.interactive ?? '—'}ms` +
      ` did-finish-load=${r.marks['did-finish-load'] ?? '—'}ms`,
    );
  }

  const scored = discardFirst && samples.length > 1 ? samples.slice(1) : samples;
  const readyVals = scored.map((s) => s.marks['ready-to-show']).filter((n) => Number.isFinite(n));
  const interVals = scored.map((s) => s.marks.interactive).filter((n) => Number.isFinite(n));
  const summary = {
    kind: 'aurora-startup',
    runId,
    at: new Date().toISOString(),
    exe,
    runs,
    discardFirst: discardFirst && samples.length > 1,
    gates: { ready_to_show_ms: readyGate, interactive_ms: interactiveGate },
    median: {
      ready_to_show_ms: median(readyVals),
      interactive_ms: median(interVals),
    },
    samples,
    warn: [],
  };
  if (summary.median.ready_to_show_ms == null) summary.warn.push('missing_ready_to_show');
  else if (summary.median.ready_to_show_ms > readyGate) {
    summary.warn.push(`ready_to_show_${summary.median.ready_to_show_ms}_gt_${readyGate}`);
  }
  if (summary.median.interactive_ms == null) summary.warn.push('missing_interactive');
  else if (summary.median.interactive_ms > interactiveGate) {
    summary.warn.push(`interactive_${summary.median.interactive_ms}_gt_${interactiveGate}`);
  }
  summary.ok = summary.warn.length === 0;

  await fs.writeFile(path.join(runDir, 'summary.startup.json'), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(OUT_ROOT, 'latest-startup.json'), JSON.stringify(summary, null, 2));
  console.log(
    `[startup] median ready-to-show=${summary.median.ready_to_show_ms}ms` +
    ` interactive=${summary.median.interactive_ms}ms` +
    ` ok=${summary.ok}` +
    (summary.discardFirst ? ' (discarded first/AV-cold)' : ''),
  );
  if (!summary.ok) {
    console.error(`[startup] WARN ${summary.warn.join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
