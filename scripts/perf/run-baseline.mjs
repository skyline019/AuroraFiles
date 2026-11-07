#!/usr/bin/env node
/**
 * Full baseline: backend matrix, then prints UI command (Playwright runs separately for screenshots).
 *
 *   node scripts/perf/run-baseline.mjs
 *   node scripts/perf/run-baseline.mjs --backend-only
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function main() {
  const backendOnly = process.argv.includes('--backend-only');
  const out = process.env.AURORA_PERF_OUT || path.join(root, 'perf-out');
  console.log('=== Aurora perf baseline ===');
  await run('node', [path.join('scripts', 'perf', 'measure-backend.mjs')], {
    AURORA_PERF_OUT: out,
  });
  if (backendOnly) return;
  console.log('=== UI / screenshots (Playwright) ===');
  await run('npx', ['playwright', 'test', 'e2e/perf-baseline.spec.ts'], {
    AURORA_PERF_OUT: out,
  });
  console.log('Baseline complete. Inspect', out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
