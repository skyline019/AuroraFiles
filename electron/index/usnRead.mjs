/**
 * 真读 USN Journal（FSCTL_READ_USN_JOURNAL）→ frn / parentFrn / name / reason / usn
 *
 * Prefer native `aurora-mft-enum --mode usn-read` (no PowerShell).
 * Fallback: usn-read.ps1 when binary missing.
 *
 * 权限：打开 \\.\C: 通常需要管理员 / SeBackupPrivilege。
 * 非提升进程返回 null，由 watch 脏目录路径兜底。
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PS1_SRC = path.join(__dirname, 'usn-read.ps1');

function driveLetter(rootPath) {
  const m = String(rootPath || '').match(/^([A-Za-z]):/);
  return m ? m[1].toUpperCase() : null;
}

function resolveMftUsnBin() {
  const res = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  const cands = [
    process.env.AURORA_MFT_BIN,
    res && path.join(res, 'native', 'aurora-mft-enum.exe'),
    path.join(REPO_ROOT, 'native', 'mft-enum', 'build', 'Release', 'aurora-mft-enum.exe'),
    path.join(REPO_ROOT, 'native', 'mft-enum', 'build', 'Debug', 'aurora-mft-enum.exe'),
  ].filter(Boolean);
  for (const p of cands) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* */ }
  }
  return null;
}

function parseUsnLine(line) {
  const t = String(line || '').trim();
  if (!t || t.startsWith('{') || t.startsWith('__')) return null;
  const parts = t.split('|');
  if (parts.length < 5) return null;
  const [usn, frn, parentFrn, reason, ...rest] = parts;
  return {
    usn: Number(usn) || 0,
    frn: String(frn),
    parentFrn: String(parentFrn),
    reason: Number.parseInt(reason, 16) || 0,
    name: rest.join('|'),
  };
}

/**
 * Native path: spawn mft-enum usn-read, parse stdout lines.
 * @returns {Promise<{ usn: number, frn: string, parentFrn: string, reason: number, name: string }[] | null>}
 */
async function readUsnNative(letter, startUsn, max) {
  const bin = resolveMftUsnBin();
  if (!bin) return null;
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      [
        '--root', `${letter}:\\`,
        '--mode', 'usn-read',
        '--start-usn', String(Math.max(0, Number(startUsn) || 0)),
        '--max-scan', String(max),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const rows = [];
    let stderr = '';
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* */ }
      finish(rows.length ? rows : null);
    }, 20_000);
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (c) => { stderr += c; });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const row = parseUsnLine(line);
      if (row) rows.push(row);
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      rl.close();
      if (code === 3 || /skipped_no_priv/.test(stderr)) {
        finish(null);
        return;
      }
      // code 0 or partial rows OK; empty with error → null
      if (code && code !== 0 && rows.length === 0) {
        finish(null);
        return;
      }
      finish(rows);
    });
  });
}

async function readUsnPowershell(letter, startUsn, max) {
  const outFile = path.join(os.tmpdir(), `aurora-usn-${process.pid}-${Date.now()}.txt`);
  const ps1 = path.join(os.tmpdir(), `aurora-usn-${process.pid}.ps1`);
  try {
    const body = await fsp.readFile(PS1_SRC, 'utf8');
    await fsp.writeFile(ps1, body, 'utf8');
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', ps1,
        '-Drive', `${letter}:`,
        '-StartUsn', String(Math.max(0, Number(startUsn) || 0)),
        '-OutFile', outFile,
        '-Max', String(max),
      ],
      { windowsHide: true, timeout: 25000, maxBuffer: 4 * 1024 * 1024 },
    );
    const n = Number(String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop());
    if (!Number.isFinite(n) || n < 0) {
      if (process.env.AURORA_DEBUG_USN) {
        console.error('[usnRead] ps fail', n, String(stderr || '').slice(0, 400));
      }
      return null;
    }
    let text = '';
    try { text = await fsp.readFile(outFile, 'utf8'); } catch { return []; }
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      const row = parseUsnLine(line);
      if (row) rows.push(row);
    }
    return rows;
  } catch (err) {
    if (process.env.AURORA_DEBUG_USN) {
      console.error('[usnRead] ps', err?.message, String(err?.stderr || '').slice(0, 400));
    }
    return null;
  } finally {
    try { await fsp.unlink(outFile); } catch { /* */ }
    try { await fsp.unlink(ps1); } catch { /* */ }
  }
}

/**
 * @returns {Promise<{ usn: number, frn: string, parentFrn: string, reason: number, name: string }[] | null>}
 */
export async function readUsnRecords(rootPath, startUsn, max = 4000) {
  const letter = driveLetter(rootPath);
  if (!letter) return null;
  const native = await readUsnNative(letter, startUsn, max);
  if (native !== null) return native;
  return readUsnPowershell(letter, startUsn, max);
}

export function usnIsDelete(reason) {
  return (reason & 0x00000200) !== 0;
}

/** 当前进程是否可能读到 USN（探测一次并缓存） */
let _usnReadable = undefined;
export function resetUsnProbe() {
  _usnReadable = undefined;
}
export async function probeUsnReadable(rootPath = 'C:\\', { force = false } = {}) {
  if (!force && _usnReadable !== undefined) return _usnReadable;
  if (process.argv.includes('--elevated') || process.env.AURORA_ELEVATED === '1') {
    force = true;
  }
  const live = await queryNextUsnOnly(rootPath);
  const rows = await readUsnRecords(rootPath, live ?? 0, 1);
  _usnReadable = rows !== null;
  return _usnReadable;
}

async function queryNextUsnOnly(rootPath) {
  try {
    const { stdout } = await execFileAsync(
      'fsutil.exe',
      ['usn', 'queryjournal', `${driveLetter(rootPath)}:`],
      { windowsHide: true, timeout: 5000 },
    );
    const m = String(stdout).match(/Next Usn\s*:\s*(0x[0-9a-fA-F]+|\d+)/i)
      || String(stdout).match(/下一[^\n]*Usn\s*:\s*(0x[0-9a-fA-F]+|\d+)/i);
    if (!m) return 0;
    const v = m[1];
    return String(v).startsWith('0x') ? Number.parseInt(v, 16) : Number(v);
  } catch {
    return 0;
  }
}
