/**
 * Media IO helpers: long-path (\\?\) + ffmpeg-safe ASCII temp for non-ASCII paths.
 * Windows ffmpeg often fails on UTF-8/CJK argv; copy/link to a short ASCII temp first.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fsPath } from './index/winPath.mjs';

export { fsPath };

/** Path contains non-ASCII (CJK / fullwidth / etc.) */
export function hasNonAscii(p) {
  return /[^\u0000-\u007f]/.test(String(p || ''));
}

/**
 * Disk path for Node/Electron APIs (\\?\ when needed).
 * @param {string} absPath
 */
export function diskPath(absPath) {
  return fsPath(absPath);
}

/**
 * Prepare an input path safe for ffmpeg CLI argv on Windows.
 * @returns {Promise<{ path: string, cleanup: () => Promise<void> }>}
 */
export async function ffmpegInputPath(absPath) {
  const disk = diskPath(absPath);
  if (!hasNonAscii(absPath)) {
    return { path: disk, cleanup: async () => {} };
  }
  const ext = path.extname(absPath) || '.bin';
  const safeExt = /^\.[A-Za-z0-9]{1,8}$/.test(ext) ? ext : '.bin';
  const tmp = path.join(
    os.tmpdir(),
    `aurora-ffin-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${safeExt}`,
  );
  await fs.copyFile(disk, tmp);
  return {
    path: tmp,
    cleanup: async () => {
      try { await fs.unlink(tmp); } catch { /* */ }
    },
  };
}
