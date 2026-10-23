#!/usr/bin/env node
/**
 * 确保 node_modules/ffmpeg-static 内有可用二进制。
 *
 * 互斥规则（二选一，不可同时）：
 *   镜像：FFMPEG_FETCH=mirror（默认）→ npmmirror，强制无代理
 *   代理：FFMPEG_FETCH=proxy → GitHub 官方源，使用 HTTP(S)_PROXY
 *
 * 用法：node scripts/ensure-ffmpeg.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dir = path.join(root, 'node_modules', 'ffmpeg-static');
const release = 'b6.0';
const platform = process.platform;
const arch = process.arch;
const exeName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const exePath = path.join(dir, exeName);
const asset = `ffmpeg-${platform}-${arch}.gz`;

const mode = (process.env.FFMPEG_FETCH || 'mirror').toLowerCase();

function clearProxyEnv() {
  for (const k of [
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy',
  ]) {
    delete process.env[k];
  }
}

function pickUrl() {
  if (mode === 'proxy') {
    if (!process.env.HTTP_PROXY && !process.env.HTTPS_PROXY && !process.env.ALL_PROXY
      && !process.env.http_proxy && !process.env.https_proxy) {
      console.error('FFMPEG_FETCH=proxy 需要已设置 HTTP_PROXY / HTTPS_PROXY');
      process.exit(1);
    }
    return `https://github.com/eugeneware/ffmpeg-static/releases/download/${release}/${asset}`;
  }
  // mirror：清代理，走 npmmirror
  clearProxyEnv();
  return `https://cdn.npmmirror.com/binaries/ffmpeg-static/${release}/${asset}`;
}

function okExe() {
  try {
    return fs.existsSync(exePath) && fs.statSync(exePath).size > 1_000_000;
  } catch {
    return false;
  }
}

/** 本机已有完整 ffmpeg 时直接拷贝，避免重复下载 */
function tryCopyLocal() {
  const candidates = [
    process.env.FFMPEG_LOCAL,
    process.env.FFMPEG_BIN,
    // WinGet Gyan 全量包常见解压路径（仅本机缓存命中时）
    ...(process.platform === 'win32'
      ? [
          path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages'),
        ]
      : []),
  ].filter(Boolean);

  for (const c of candidates) {
    if (typeof c === 'string' && c.toLowerCase().endsWith('.exe') && fs.existsSync(c) && fs.statSync(c).size > 1_000_000) {
      fs.copyFileSync(c, exePath);
      return true;
    }
  }
  return false;
}

if (!fs.existsSync(dir)) {
  console.error('缺少 ffmpeg-static 包，请先：npm install ffmpeg-static --ignore-scripts');
  process.exit(1);
}

if (okExe()) {
  console.log(`ffmpeg ready (skip download): ${exePath} (${fs.statSync(exePath).size} bytes)`);
  process.exit(0);
}

if (tryCopyLocal() && okExe()) {
  console.log(`ffmpeg copied from local: ${exePath} (${fs.statSync(exePath).size} bytes)`);
  process.exit(0);
}

const url = pickUrl();
const gzPath = path.join(dir, asset);
console.log(`fetch [${mode}] ${url}`);

const curlArgs = ['-L', '--connect-timeout', '30', '--max-time', '600', '--retry', '3', '-o', gzPath, url];
if (mode === 'mirror') {
  curlArgs.unshift('--noproxy', '*');
}
if (fs.existsSync(gzPath) && fs.statSync(gzPath).size > 0) {
  curlArgs.splice(curlArgs.indexOf('-o'), 0, '-C', '-');
}

const r = spawnSync('curl.exe', curlArgs, { stdio: 'inherit', env: process.env });
if (r.status !== 0) {
  // fallback to curl without .exe
  const r2 = spawnSync('curl', curlArgs, { stdio: 'inherit', env: process.env });
  if (r2.status !== 0) process.exit(r2.status || 1);
}

const gz = fs.readFileSync(gzPath);
try {
  fs.writeFileSync(exePath, zlib.gunzipSync(gz));
} catch (err) {
  console.error('gunzip failed (download incomplete?):', err.message);
  process.exit(1);
}
try { fs.chmodSync(exePath, 0o755); } catch { /* win */ }
fs.unlinkSync(gzPath);
if (!okExe()) {
  console.error('ffmpeg binary still invalid after download');
  process.exit(1);
}
console.log(`ffmpeg installed: ${exePath} (${fs.statSync(exePath).size} bytes)`);
