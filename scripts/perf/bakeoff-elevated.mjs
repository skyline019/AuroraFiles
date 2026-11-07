#!/usr/bin/env node
/**
 * Attempt MFT bakeoff under elevation.
 *   npm run test:perf-bakeoff:elevated
 *
 * If not Admin / SeBackupPrivilege: prints instructions and exits 3 (mft stays defer).
 * If elevated: runs full bakeoff (same as test:perf-bakeoff).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

async function hasBackupPriv() {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      ],
      { windowsHide: true, timeout: 10_000 },
    );
    return String(stdout).trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

async function main() {
  const elevated = await hasBackupPriv();
  if (!elevated) {
    console.log(JSON.stringify({
      ok: false,
      mft: 'defer',
      reason: 'not_elevated',
      hint: 'Open Admin PowerShell in repo, then: npm run test:perf-bakeoff -- --volume E:\\',
    }, null, 2));
    process.exit(3);
  }
  const args = process.argv.slice(2);
  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'run-bakeoff.mjs'), ...args],
    { cwd: REPO, stdio: 'inherit', windowsHide: true },
  );
  child.on('exit', (code) => process.exit(code ?? 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
