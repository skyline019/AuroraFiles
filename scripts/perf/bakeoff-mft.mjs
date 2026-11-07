/**
 * Run C++ aurora-mft-enum for bakeoff rows.
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fssync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const MFT_DIR = path.join(REPO, 'native', 'mft-enum');
const MFT_BIN = path.join(MFT_DIR, 'build', 'Release', 'aurora-mft-enum.exe');

export function resolveMftBin() {
  if (process.env.AURORA_MFT_BIN && fssync.existsSync(process.env.AURORA_MFT_BIN)) {
    return process.env.AURORA_MFT_BIN;
  }
  if (fssync.existsSync(MFT_BIN)) return MFT_BIN;
  return null;
}

export async function ensureMftRelease() {
  const existing = resolveMftBin();
  if (existing) {
    const src = path.join(MFT_DIR, 'src', 'main.cpp');
    if (fssync.existsSync(src) && fssync.statSync(existing).mtimeMs >= fssync.statSync(src).mtimeMs) {
      return existing;
    }
  }
  console.log('[bakeoff] cmake build Release (native/mft-enum)…');
  await execFileAsync(
    'cmake',
    ['-S', MFT_DIR, '-B', path.join(MFT_DIR, 'build'), '-G', 'Visual Studio 18 2026', '-A', 'x64'],
    { windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
  );
  await execFileAsync(
    'cmake',
    ['--build', path.join(MFT_DIR, 'build'), '--config', 'Release'],
    { windowsHide: true, timeout: 300_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const bin = resolveMftBin();
  if (!bin) throw new Error('mft_bin_missing');
  return bin;
}

/**
 * @param {string} bin
 * @param {string} root
 * @param {'count'|'store'|'stream'} mode
 * @param {{ maxScan?: number }} opts
 */
export function runMftMode(bin, root, mode, opts = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '--root', root,
      '--mode', mode,
      '--max-scan', String(opts.maxScan || 5_000_000),
    ];
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        let line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
        if (mode === 'stream') {
          const m = stderr.split(/\r?\n/).find((l) => l.startsWith('__AURORA_WALK_SUMMARY__'));
          if (m) line = m.slice('__AURORA_WALK_SUMMARY__'.length);
        }
        if (!line) {
          resolve({
            engine: 'mft-cxx',
            mode,
            ok: false,
            error: `no_stdout code=${code} stderr=${stderr.slice(0, 200)}`,
            verdict_hint: 'mft=defer',
          });
          return;
        }
        const row = JSON.parse(line);
        const eps = row.entries_per_s || 0;
        const ms = row.ms || 0;
        const adopt = row.ok && (eps >= 250_000 || (row.count > 0 && ms > 0 && ms <= 5000 && mode === 'store'));
        row.verdict_hint = !row.ok
          ? (row.error === 'skipped_no_priv' ? 'mft=defer' : 'mft=defer')
          : (adopt ? 'mft=adopt' : 'mft=defer');
        resolve(row);
      } catch (e) {
        reject(e);
      }
    });
  });
}
