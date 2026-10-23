/**
 * 真读 USN Journal（FSCTL_READ_USN_JOURNAL）→ frn / parentFrn / name / reason / usn
 * 脚本：usn-read.ps1（复制到 temp 再执行，兼容 asar）
 *
 * 权限：打开 \\.\C: 通常需要管理员 / SeBackupPrivilege。
 * 非提升进程返回 null，由 watch 脏目录路径兜底。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PS1_SRC = path.join(__dirname, 'usn-read.ps1');

function driveLetter(rootPath) {
  const m = String(rootPath || '').match(/^([A-Za-z]):/);
  return m ? m[1].toUpperCase() : null;
}

/**
 * @returns {Promise<{ usn: number, frn: string, parentFrn: string, reason: number, name: string }[] | null>}
 */
export async function readUsnRecords(rootPath, startUsn, max = 4000) {
  const letter = driveLetter(rootPath);
  if (!letter) return null;
  const outFile = path.join(os.tmpdir(), `aurora-usn-${process.pid}-${Date.now()}.txt`);
  const ps1 = path.join(os.tmpdir(), `aurora-usn-${process.pid}.ps1`);
  try {
    const body = await fs.readFile(PS1_SRC, 'utf8');
    await fs.writeFile(ps1, body, 'utf8');
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
        console.error('[usnRead] fail', n, String(stderr || '').slice(0, 400));
      }
      return null;
    }
    let text = '';
    try { text = await fs.readFile(outFile, 'utf8'); } catch { return []; }
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split('|');
      if (parts.length < 5) continue;
      const [usn, frn, parentFrn, reason, ...rest] = parts;
      rows.push({
        usn: Number(usn) || 0,
        frn: String(frn),
        parentFrn: String(parentFrn),
        reason: Number.parseInt(reason, 16) || 0,
        name: rest.join('|'),
      });
    }
    return rows;
  } catch (err) {
    if (process.env.AURORA_DEBUG_USN) {
      console.error('[usnRead]', err?.message, String(err?.stderr || '').slice(0, 400));
    }
    return null;
  } finally {
    try { await fs.unlink(outFile); } catch { /* */ }
    try { await fs.unlink(ps1); } catch { /* */ }
  }
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
  // 管理员重启带 --elevated：强制重探
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
