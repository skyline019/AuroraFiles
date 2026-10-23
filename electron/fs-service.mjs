/**
 * Windows 真盘服务（主进程）
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shell, app } from 'electron';
import {
  ensureIndexed, ensureVolumes, indexStatus, noteFsChange, backfillFrn,
  loadIndexPrefs, saveIndexPrefs,
} from './index/fsIndex.mjs';
import { searchFiles as searchFilesImpl, cancelSearch as cancelSearchImpl } from './index/searchFiles.mjs';
import * as ads from './tags-ads.mjs';
import { resolveFfmpegPath } from './ffmpegPath.mjs';

export const cancelSearch = cancelSearchImpl;
export const searchFiles = searchFilesImpl;

const execFileAsync = promisify(execFile);

function ffmpegBin() {
  return resolveFfmpegPath();
}

const DANGEROUS = new Set(
  ['C:\\Windows', 'C:\\Windows\\System32', 'C:\\Program Files', 'C:\\Program Files (x86)'].map((p) =>
    p.toLowerCase(),
  ),
);

export function normalizePath(p) {
  if (!p || typeof p !== 'string') throw new Error('无效路径');
  const n = path.win32.normalize(p);
  if (!path.win32.isAbsolute(n)) throw new Error('仅支持绝对路径');
  return n;
}

function isDangerousRoot(p) {
  const n = normalizePath(p).replace(/\\+$/, '').toLowerCase();
  return DANGEROUS.has(n) || /^[a-z]:\\windows$/i.test(n);
}

export async function listDrives() {
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const root = `${letter}:\\`;
    try {
      await fs.access(root);
      let total = 0;
      let free = 0;
      try {
        const { stdout } = await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `(Get-PSDrive -Name ${letter} -ErrorAction SilentlyContinue | Select-Object Used,Free | ConvertTo-Json -Compress)`,
          ],
          { windowsHide: true, timeout: 8000 },
        );
        const j = JSON.parse(stdout || '{}');
        const used = Number(j.Used) || 0;
        free = Number(j.Free) || 0;
        total = used + free;
      } catch {
        /* size optional */
      }
      drives.push({
        path: root,
        name: `本地磁盘 (${letter}:)`,
        letter,
        total,
        free,
        used: Math.max(0, total - free),
      });
    } catch {
      /* skip missing */
    }
  }
  return drives;
}

export function knownFolders() {
  const home = os.homedir();
  return {
    home,
    desktop: path.join(home, 'Desktop'),
    documents: path.join(home, 'Documents'),
    downloads: path.join(home, 'Downloads'),
    pictures: path.join(home, 'Pictures'),
    music: path.join(home, 'Music'),
    videos: path.join(home, 'Videos'),
  };
}

async function statEntry(full) {
  const st = await fs.stat(full);
  const name = path.basename(full) || full;
  return {
    path: full,
    name: full.match(/^[A-Za-z]:\\$/) ? full : name,
    kind: st.isDirectory() ? 'folder' : 'file',
    size: st.isFile() ? st.size : 0,
    createdAt: st.birthtimeMs || st.ctimeMs,
    modifiedAt: st.mtimeMs,
    accessedAt: st.atimeMs,
    hidden: !!(st.isFile() || st.isDirectory()) && name.startsWith('.'),
    ext: st.isFile() ? path.extname(name).replace(/^\./, '').toLowerCase() : undefined,
  };
}

export async function listDir(dirPath, { showHidden = false } = {}) {
  const dir = normalizePath(dirPath);
  const names = await fs.readdir(dir);
  const out = [];
  for (const name of names) {
    if (!showHidden && name.startsWith('.')) continue;
    const full = path.join(dir, name);
    try {
      const ent = await statEntry(full);
      // Windows hidden attribute rough: skip $RECYCLE.BIN etc unless showHidden
      if (!showHidden && (name === '$RECYCLE.BIN' || name === 'System Volume Information' || name === 'Recovery')) {
        continue;
      }
      out.push(ent);
    } catch (err) {
      out.push({
        path: full,
        name,
        kind: 'file',
        size: 0,
        createdAt: 0,
        modifiedAt: 0,
        accessedAt: 0,
        hidden: true,
        error: err?.message || String(err),
      });
    }
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base' });
  });
  return out;
}

export async function readTextPreview(filePath, maxBytes = 200_000) {
  const p = normalizePath(filePath);
  const st = await fs.stat(p);
  if (!st.isFile()) throw new Error('不是文件');
  if (st.size > 8_000_000) throw new Error('文件过大，无法预览');
  const len = Math.min(st.size, maxBytes);
  const buf = Buffer.alloc(len);
  const fh = await fs.open(p, 'r');
  try {
    await fh.read(buf, 0, buf.length, 0);
  } finally {
    await fh.close();
  }
  // 返回 base64，由渲染进程做多编码探测
  return { base64: buf.toString('base64'), size: st.size, truncated: st.size > maxBytes };
}

export function getIndexStatus(rootPath) {
  return indexStatus(normalizePath(rootPath));
}

export async function getIndexPrefs() {
  return loadIndexPrefs();
}

export async function setIndexPrefs(partial) {
  return saveIndexPrefs(partial || {});
}

export async function buildIndex(rootPath, opts = {}) {
  return ensureIndexed(normalizePath(rootPath), opts);
}

/** 多盘建索：[{ path, removable? }] */
export async function buildIndexes(roots, opts = {}) {
  const list = (roots || [])
    .map((r) => (typeof r === 'string' ? { path: r } : r))
    .filter((r) => r?.path && !r.removable)
    .map((r) => normalizePath(r.path).slice(0, 3));
  const uniq = [...new Set(list.map((p) => p.toUpperCase()))];
  await ensureVolumes(uniq.map((p) => (p.endsWith('\\') ? p : `${p}\\`)), opts);
  // 主盘补 FRN
  if (uniq[0]) void backfillFrn(`${uniq[0]}\\`, 3000);
  return { roots: uniq };
}

export async function readTags(filePath) {
  return ads.readAdsTags(filePath);
}

export async function writeTags(filePath, tags) {
  return ads.writeAdsTags(filePath, tags);
}

export async function renameMany(entries) {
  const out = [];
  for (const { path: target, name } of entries) {
    const next = await rename(target, name);
    out.push(next);
    try {
      const root = `${next.slice(0, 2)}\\`;
      const st = await fs.stat(next);
      noteFsChange(root, next, {
        path: next,
        name: path.basename(next),
        kind: st.isDirectory() ? 'folder' : 'file',
        size: st.isFile() ? st.size : 0,
        modifiedAt: st.mtimeMs,
      });
      noteFsChange(root, target, null);
    } catch { /* */ }
  }
  return out;
}

/** Chromium 难直解的格式 → 经 ffmpeg 抽 1 帧 JPEG（预览 / 缩略共用） */
const FFMPEG_IMAGE_EXTS = new Set([
  'heic', 'heif', 'tif', 'tiff', 'avif',
  'nef', 'cr2', 'cr3', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'sr2', 'srw',
]);

/**
 * 难解码图 → JPEG data URL。
 * opts.maxEdge：最长边像素（缩略用 512，全预览用 2048）；失败返回 null。
 */
export async function convertImagePreview(filePath, opts = {}) {
  const p = normalizePath(filePath);
  const ext = path.extname(p).slice(1).toLowerCase();
  if (!FFMPEG_IMAGE_EXTS.has(ext)) {
    // 仍尝试转码（调用方误判时），但优先信任白名单
  }
  const maxEdge = Math.max(64, Math.min(4096, Number(opts.maxEdge) || 2048));
  const out = path.join(os.tmpdir(), `aurora-img-${process.pid}-${Date.now()}.jpg`);
  const scale = `scale='min(${maxEdge},iw)':-2`;
  try {
    await execFileAsync(
      ffmpegBin(),
      ['-y', '-i', p, '-frames:v', '1', '-vf', scale, '-q:v', '3', out],
      { windowsHide: true, timeout: 45000 },
    );
    const buf = await fs.readFile(out);
    return { url: `data:image/jpeg;base64,${buf.toString('base64')}`, meta: `${ext}→jpeg` };
  } catch {
    return null;
  } finally {
    try { await fs.unlink(out); } catch { /* */ }
  }
}

/** @deprecated 兼容旧 IPC 名；等同 convertImagePreview */
export async function convertHeicPreview(filePath) {
  return convertImagePreview(filePath, { maxEdge: 2048 });
}

/** 二进制预览（Office / 小图），返回 base64 */
export async function readBinaryPreview(filePath, maxBytes = 12_000_000) {
  const p = normalizePath(filePath);
  const st = await fs.stat(p);
  if (!st.isFile()) throw new Error('不是文件');
  if (st.size > maxBytes) throw new Error(`文件过大（>${Math.round(maxBytes / 1e6)}MB），无法内嵌预览`);
  const buf = await fs.readFile(p);
  return { base64: buf.toString('base64'), size: st.size, name: path.basename(p) };
}

/** 把绝对路径编码为 aurora-file:// 主机路径 */
export function toAuroraFileUrl(filePath) {
  const p = normalizePath(filePath);
  // aurora-file:///C:/Users/...
  const slash = p.replace(/\\/g, '/');
  return `aurora-file:///${slash}`;
}

export function fromAuroraFileUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'aurora-file:') throw new Error('协议错误');
    // pathname is /C:/... or /C%3A/...
    let pathname = decodeURIComponent(u.pathname || '');
    if (pathname.startsWith('/') && /^[A-Za-z]:/.test(pathname.slice(1))) {
      pathname = pathname.slice(1);
    }
    return normalizePath(pathname.replace(/\//g, '\\'));
  } catch (err) {
    throw new Error(`无效的文件 URL：${err?.message || err}`);
  }
}

/**
 * 若本机有 ffmpeg，抽取视频约第 1 秒封面为 JPEG data URL。
 * opts.maxEdge 默认 512（画廊缩略）；全预览可传更大。
 */
export async function videoPoster(filePath, opts = {}) {
  const p = normalizePath(filePath);
  const st = await fs.stat(p);
  if (!st.isFile()) throw new Error('不是文件');
  const maxEdge = Math.max(64, Math.min(2048, Number(opts.maxEdge) || 512));
  const out = path.join(os.tmpdir(), `aurora-poster-${process.pid}-${Date.now()}.jpg`);
  const scale = `scale='min(${maxEdge},iw)':-2`;
  const bin = ffmpegBin();
  try {
    await execFileAsync(
      bin,
      ['-y', '-ss', '1', '-i', p, '-frames:v', '1', '-vf', scale, '-q:v', '4', out],
      { windowsHide: true, timeout: 20000 },
    );
    const buf = await fs.readFile(out);
    return { url: `data:image/jpeg;base64,${buf.toString('base64')}` };
  } catch {
    // 部分短片不足 1s：回退到第 0 帧
    try {
      await execFileAsync(
        bin,
        ['-y', '-i', p, '-frames:v', '1', '-vf', scale, '-q:v', '4', out],
        { windowsHide: true, timeout: 20000 },
      );
      const buf = await fs.readFile(out);
      return { url: `data:image/jpeg;base64,${buf.toString('base64')}` };
    } catch {
      return null;
    }
  } finally {
    try { await fs.unlink(out); } catch { /* ignore */ }
  }
}

function volumeRootOf(absPath) {
  const m = String(absPath).match(/^([A-Za-z]:)/);
  return m ? `${m[1]}\\` : null;
}

async function touchIndexPath(absPath) {
  const root = volumeRootOf(absPath);
  if (!root) return;
  try {
    const st = await fs.stat(absPath);
    noteFsChange(root, absPath, {
      path: absPath,
      name: path.basename(absPath),
      kind: st.isDirectory() ? 'folder' : 'file',
      size: st.isFile() ? st.size : 0,
      modifiedAt: st.mtimeMs,
      frn: st.ino != null ? String(st.ino) : undefined,
    });
  } catch {
    noteFsChange(root, absPath, null);
  }
}

export async function mkdir(parent, name) {
  const dest = path.join(normalizePath(parent), name);
  await fs.mkdir(dest, { recursive: false });
  await touchIndexPath(dest);
  return dest;
}

export async function rename(target, newName) {
  const src = normalizePath(target);
  if (/[\\/:*?"<>|]/.test(newName)) throw new Error('非法文件名');
  const dest = path.join(path.dirname(src), newName);
  await fs.rename(src, dest);
  const root = volumeRootOf(src);
  if (root) noteFsChange(root, src, null);
  await touchIndexPath(dest);
  return dest;
}

export async function copyPaths(sources, destDir) {
  const dest = normalizePath(destDir);
  const results = [];
  for (const s of sources) {
    const src = normalizePath(s);
    const base = path.basename(src);
    let out = path.join(dest, base);
    let i = 1;
    while (fssync.existsSync(out)) {
      const ext = path.extname(base);
      const stem = path.basename(base, ext);
      out = path.join(dest, i === 1 ? `${stem} 副本${ext}` : `${stem} 副本 ${i}${ext}`);
      i++;
    }
    await fs.cp(src, out, { recursive: true, errorOnExist: false, force: false });
    results.push(out);
    await touchIndexPath(out);
  }
  return results;
}

export async function movePaths(sources, destDir) {
  const dest = normalizePath(destDir);
  const results = [];
  for (const s of sources) {
    const src = normalizePath(s);
    if (isDangerousRoot(src)) throw new Error(`拒绝移动系统目录：${src}`);
    const base = path.basename(src);
    let out = path.join(dest, base);
    let i = 1;
    while (fssync.existsSync(out)) {
      const ext = path.extname(base);
      const stem = path.basename(base, ext);
      out = path.join(dest, i === 1 ? `${stem} 副本${ext}` : `${stem} 副本 ${i}${ext}`);
      i++;
    }
    try {
      await fs.rename(src, out);
    } catch {
      await fs.cp(src, out, { recursive: true });
      await fs.rm(src, { recursive: true, force: true });
    }
    results.push(out);
    const root = volumeRootOf(src);
    if (root) noteFsChange(root, src, null);
    await touchIndexPath(out);
  }
  return results;
}

export async function trashPaths(paths) {
  const ok = [];
  const failed = [];
  for (const p of paths) {
    const src = normalizePath(p);
    if (isDangerousRoot(src)) {
      failed.push({ path: src, error: '拒绝删除系统关键目录' });
      continue;
    }
    try {
      await shell.trashItem(src);
      ok.push(src);
      const root = volumeRootOf(src);
      if (root) noteFsChange(root, src, null);
    } catch (err) {
      failed.push({ path: src, error: err?.message || String(err) });
    }
  }
  return { ok, failed };
}

export async function deleteForever(paths) {
  const ok = [];
  const failed = [];
  for (const p of paths) {
    const src = normalizePath(p);
    if (isDangerousRoot(src)) {
      failed.push({ path: src, error: '拒绝永久删除系统关键目录' });
      continue;
    }
    try {
      await fs.rm(src, { recursive: true, force: true });
      ok.push(src);
      const root = volumeRootOf(src);
      if (root) noteFsChange(root, src, null);
    } catch (err) {
      failed.push({ path: src, error: err?.message || String(err) });
    }
  }
  return { ok, failed };
}

export async function openPath(p) {
  const src = normalizePath(p);
  const err = await shell.openPath(src);
  if (err) throw new Error(err);
}

export async function showInFolder(p) {
  shell.showItemInFolder(normalizePath(p));
}

/**
 * 用指定方式打开：default | reveal | notepad | code | picker
 */
export async function openWith(filePath, app = 'default') {
  const p = normalizePath(filePath);
  const st = await fs.stat(p);
  if (!st.isFile() && app !== 'reveal' && app !== 'default') {
    // 文件夹只允许默认打开 / 显示
    if (app !== 'default') throw new Error('该打开方式仅支持文件');
  }
  switch (app) {
    case 'default':
      return openPath(p);
    case 'reveal':
      showInFolder(p);
      return;
    case 'notepad':
      await execFileAsync('notepad.exe', [p], { windowsHide: false });
      return;
    case 'code':
      try {
        await execFileAsync('code.cmd', ['-g', p], { windowsHide: true, shell: true, timeout: 15000 });
      } catch {
        try {
          await execFileAsync('code', ['-g', p], { windowsHide: true, shell: true, timeout: 15000 });
        } catch {
          throw new Error('未找到 VS Code（请确认已安装并将 code 加入 PATH）');
        }
      }
      return;
    case 'picker':
      // Windows「打开方式」对话框
      await execFileAsync('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', p], { windowsHide: false });
      return;
    default:
      throw new Error(`未知打开方式：${app}`);
  }
}

export function appInfo() {
  return {
    name: app.getName(),
    version: app.getVersion(),
    userData: app.getPath('userData'),
    platform: process.platform,
    elevated: process.argv.includes('--elevated') || process.env.AURORA_ELEVATED === '1',
  };
}

/**
 * 以管理员重新启动（UAC）。成功发起后退出当前进程。
 */
export async function relaunchElevated() {
  if (process.platform !== 'win32') throw new Error('仅 Windows 支持提升权限');
  const exe = process.execPath;
  const args = process.defaultApp
    ? [process.argv[1], ...process.argv.slice(2).filter((a) => a !== '--elevated'), '--elevated']
    : [...process.argv.slice(1).filter((a) => a !== '--elevated'), '--elevated'];
  const argList = args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
  const ps = `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -Verb RunAs -ArgumentList '${argList.replace(/'/g, "''")}'`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    windowsHide: true,
    timeout: 15000,
  });
  setTimeout(() => app.quit(), 400);
  return { ok: true };
}
