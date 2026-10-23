/**
 * 解析内置 ffmpeg 可执行路径（ffmpeg-static），打包后走 asar.unpacked。
 * 解析失败时回退 PATH 上的 `ffmpeg`（仅开发兜底）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

let cached = undefined;

function unpackAsar(p) {
  if (!p) return p;
  return p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

function existsExe(p) {
  try {
    return Boolean(p) && fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

function projectFfmpegCandidates() {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const list = [
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', name),
    path.join(here, '..', 'node_modules', 'ffmpeg-static', name),
  ];
  try {
    // electron 主进程可选
    // eslint-disable-next-line import/no-extraneous-dependencies
    const electron = require('electron');
    const app = electron?.app;
    if (app?.isPackaged) {
      list.unshift(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', name));
      list.unshift(path.join(process.resourcesPath, 'ffmpeg', name));
    }
  } catch { /* 非 electron 上下文 */ }
  return list;
}

export function resolveFfmpegPath() {
  if (cached !== undefined) return cached;

  try {
    let bin = require('ffmpeg-static');
    if (typeof bin === 'string') {
      bin = unpackAsar(bin);
      if (existsExe(bin)) {
        cached = bin;
        return cached;
      }
    }
  } catch { /* optional */ }

  for (const c of projectFfmpegCandidates()) {
    if (existsExe(c)) {
      cached = c;
      return cached;
    }
  }

  cached = 'ffmpeg';
  return cached;
}

export function ffmpegSourceLabel() {
  const p = resolveFfmpegPath();
  if (p === 'ffmpeg') return 'system-path';
  if (p.includes('ffmpeg-static')) return 'bundled';
  return 'custom';
}
