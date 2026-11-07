/**
 * Windows 真盘服务（主进程）
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shell, app, nativeImage } from 'electron';
import * as ads from './tags-ads.mjs';
import { resolveFfmpegPath } from './ffmpegPath.mjs';
import { diskPath, ffmpegInputPath } from './mediaPath.mjs';
import {
  mimeFromPath,
  toAuroraFileUrl as encodeAuroraFileUrl,
  fromAuroraFileUrl as decodeAuroraFileUrl,
} from '../shared/auroraFileUrl.mjs';

/** Lazy: keep cold start free of index/search graph (rbTree, FTS, walk, USN…). */
let _indexMod = null;
let _searchMod = null;
async function indexMod() {
  if (!_indexMod) _indexMod = await import('./index/fsIndex.mjs');
  return _indexMod;
}
async function searchMod() {
  if (!_searchMod) _searchMod = await import('./index/searchFiles.mjs');
  return _searchMod;
}
function noteFsChange(root, absPath, ent) {
  void indexMod().then((m) => m.noteFsChange(root, absPath, ent)).catch(() => undefined);
}

export async function searchFiles(root, query, opts) {
  const m = await searchMod();
  return m.searchFiles(root, query, opts);
}
export async function cancelSearch() {
  const m = await searchMod();
  return m.cancelSearch();
}

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
  // Product is Windows; POSIX absolute paths allowed only so Linux CI unit tests can touch tmp dirs.
  if (process.platform !== 'win32') {
    const n = path.normalize(p);
    if (!path.isAbsolute(n)) throw new Error('仅支持绝对路径');
    return n;
  }
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
  // Parallel letter probes + fs.statfs — avoid per-drive PowerShell (cold start killer)
  const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  await Promise.all(
    letters.map(async (letter) => {
      const root = `${letter}:\\`;
      try {
        await fs.access(root);
      } catch {
        return;
      }
      let total = 0;
      let free = 0;
      try {
        if (typeof fs.statfs === 'function') {
          const st = await fs.statfs(root);
          const bsize = Number(st.bsize) || 0;
          const blocks = Number(st.blocks) || 0;
          const bavail = Number(st.bavail ?? st.bfree) || 0;
          total = bsize * blocks;
          free = bsize * bavail;
        }
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
    }),
  );
  drives.sort((a, b) => a.letter.localeCompare(b.letter));
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
  const st = await fs.stat(diskPath(full));
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

const LIST_STAT_CONCURRENCY = 48;
const SKIP_DIR_NAMES = new Set(['$recycle.bin', 'system volume information', 'recovery']);

/**
 * 目录列举：Dirent 过滤 + 有限并发 stat（避免串行 N 次拖死进夹）。
 */
export async function listDir(dirPath, { showHidden = false } = {}) {
  const dir = normalizePath(dirPath);
  const ents = await fs.readdir(diskPath(dir), { withFileTypes: true });
  /** @type {import('node:fs').Dirent[]} */
  const filtered = [];
  for (const ent of ents) {
    const name = ent.name;
    if (!showHidden && name.startsWith('.')) continue;
    if (!showHidden && SKIP_DIR_NAMES.has(name.toLowerCase())) continue;
    filtered.push(ent);
  }

  const out = new Array(filtered.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= filtered.length) return;
      const ent = filtered[i];
      const name = ent.name;
      const full = path.join(dir, name);
      try {
        const st = await fs.stat(diskPath(full));
        const isDir = st.isDirectory();
        const isFile = st.isFile();
        out[i] = {
          path: full,
          name: full.match(/^[A-Za-z]:\\$/) ? full : name,
          kind: isDir ? 'folder' : 'file',
          size: isFile ? st.size : 0,
          createdAt: st.birthtimeMs || st.ctimeMs,
          modifiedAt: st.mtimeMs,
          accessedAt: st.atimeMs,
          hidden: name.startsWith('.'),
          ext: isFile ? path.extname(name).replace(/^\./, '').toLowerCase() : undefined,
        };
      } catch (err) {
        // Dirent 已知类型时仍可画出列表，避免单个坏链拖垮整夹
        const isDir = typeof ent.isDirectory === 'function' && ent.isDirectory();
        out[i] = {
          path: full,
          name,
          kind: isDir ? 'folder' : 'file',
          size: 0,
          createdAt: 0,
          modifiedAt: 0,
          accessedAt: 0,
          hidden: true,
          error: err?.message || String(err),
        };
      }
    }
  };

  const nWorkers = Math.min(LIST_STAT_CONCURRENCY, Math.max(1, filtered.length));
  await Promise.all(Array.from({ length: nWorkers }, () => worker()));

  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base' });
  });
  return out;
}

export async function readTextPreview(filePath, maxBytes = 200_000) {
  const p = normalizePath(filePath);
  const st = await fs.stat(diskPath(p));
  if (!st.isFile()) throw new Error('不是文件');
  if (st.size > 8_000_000) throw new Error('文件过大，无法预览');
  const len = Math.min(st.size, maxBytes);
  const buf = Buffer.alloc(len);
  const fh = await fs.open(diskPath(p), 'r');
  try {
    await fh.read(buf, 0, buf.length, 0);
  } finally {
    await fh.close();
  }
  // 返回 base64，由渲染进程做多编码探测
  return { base64: buf.toString('base64'), size: st.size, truncated: st.size > maxBytes };
}

export async function getIndexStatus(rootPath) {
  const m = await indexMod();
  return m.indexStatus(normalizePath(rootPath));
}

export async function getIndexPrefs() {
  const m = await indexMod();
  return m.loadIndexPrefs();
}

export async function setIndexPrefs(partial) {
  const m = await indexMod();
  return m.saveIndexPrefs(partial || {});
}

export async function buildIndex(rootPath, opts = {}) {
  const m = await indexMod();
  // IPC 默认 UI 轨；压测脚本请显式 track:'perf' / maxPerf:true
  return m.ensureIndexed(normalizePath(rootPath), { track: 'ui', ...opts });
}

/** 多盘建索：[{ path, removable? }] */
export async function buildIndexes(roots, opts = {}) {
  const m = await indexMod();
  const list = (roots || [])
    .map((r) => (typeof r === 'string' ? { path: r } : r))
    .filter((r) => r?.path && !r.removable)
    .map((r) => normalizePath(r.path).slice(0, 3));
  const uniq = [...new Set(list.map((p) => p.toUpperCase()))];
  await m.ensureVolumes(uniq.map((p) => (p.endsWith('\\') ? p : `${p}\\`)), { track: 'ui', ...opts });
  // 主盘补 FRN
  if (uniq[0]) void m.backfillFrn(`${uniq[0]}\\`, 3000);
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

/** Chromium 难直解的格式 → 优先 nativeImage，再 ffmpeg 抽帧 JPEG */
const FFMPEG_IMAGE_EXTS = new Set([
  'heic', 'heif', 'tif', 'tiff', 'avif',
  'nef', 'cr2', 'cr3', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'sr2', 'srw',
]);

/**
 * 任意图片 → JPEG data URL（JPG/WebP/BMP 等走 nativeImage；HEIC/TIFF/RAW 走 ffmpeg）。
 * opts.maxEdge：最长边像素（缩略 512，全预览 2048）；失败返回 null。
 */
export async function convertImagePreview(filePath, opts = {}) {
  const p = normalizePath(filePath);
  const disk = diskPath(p);
  const ext = path.extname(p).slice(1).toLowerCase();
  const maxEdge = Math.max(64, Math.min(4096, Number(opts.maxEdge) || 2048));

  // 1) Electron nativeImage — JPG/PNG/WebP/BMP/GIF；用 \\?\ 路径以支持长路径/CJK
  try {
    let img = nativeImage.createFromPath(disk);
    if (img.isEmpty()) {
      // 部分 WebP/路径：先读字节再解码
      const raw = await fs.readFile(disk);
      img = nativeImage.createFromBuffer(raw);
    }
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      const long = Math.max(width, height);
      if (long > maxEdge && long > 0) {
        const scale = maxEdge / long;
        img = img.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: 'better',
        });
      }
      const buf = img.toJPEG(85);
      if (buf?.byteLength && buf[0] === 0xff && buf[1] === 0xd8) {
        return {
          url: `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}`,
          meta: `${ext}→jpeg(native)`,
        };
      }
    }
  } catch { /* fall through to ffmpeg */ }

  // 2) ffmpeg（HEIC/TIFF/AVIF/RAW；CJK 路径先拷到 ASCII 临时文件）
  const out = path.join(os.tmpdir(), `aurora-img-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  const scale = `scale=w='min(iw,${maxEdge})':h=-2`;
  const input = await ffmpegInputPath(p);
  try {
    await execFileAsync(
      ffmpegBin(),
      ['-y', '-i', input.path, '-frames:v', '1', '-update', '1', '-vf', scale, '-q:v', '3', out],
      { windowsHide: true, timeout: 45000 },
    );
    const buf = await fs.readFile(out);
    if (!buf.length || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    return { url: `data:image/jpeg;base64,${buf.toString('base64')}`, meta: `${ext}→jpeg` };
  } catch {
    return null;
  } finally {
    await input.cleanup();
    try { await fs.unlink(out); } catch { /* */ }
  }
}

export { FFMPEG_IMAGE_EXTS };

/** @deprecated 兼容旧 IPC 名；等同 convertImagePreview */
export async function convertHeicPreview(filePath) {
  return convertImagePreview(filePath, { maxEdge: 2048 });
}

/** 二进制预览（Office / 小图），返回 base64 */
export async function readBinaryPreview(filePath, maxBytes = 12_000_000) {
  const p = normalizePath(filePath);
  const st = await fs.stat(diskPath(p));
  if (!st.isFile()) throw new Error('不是文件');
  if (st.size > maxBytes) throw new Error(`文件过大（>${Math.round(maxBytes / 1e6)}MB），无法内嵌预览`);
  const buf = await fs.readFile(diskPath(p));
  return { base64: buf.toString('base64'), size: st.size, name: path.basename(p) };
}

/** 把绝对路径编码为 aurora-file://（分段 percent-encode） */
export function toAuroraFileUrl(filePath) {
  return encodeAuroraFileUrl(normalizePath(filePath));
}

export function fromAuroraFileUrl(url) {
  try {
    return normalizePath(decodeAuroraFileUrl(url));
  } catch (err) {
    throw new Error(`无效的文件 URL：${err?.message || err}`);
  }
}

export { mimeFromPath };

/**
 * 若本机有 ffmpeg，抽取视频约第 1 秒封面为 JPEG data URL。
 * opts.maxEdge 默认 512（画廊缩略）；全预览可传更大。
 */
export async function videoPoster(filePath, opts = {}) {
  const p = normalizePath(filePath);
  const st = await fs.stat(diskPath(p));
  if (!st.isFile()) throw new Error('不是文件');
  const maxEdge = Math.max(64, Math.min(2048, Number(opts.maxEdge) || 512));
  const out = path.join(os.tmpdir(), `aurora-poster-${process.pid}-${Date.now()}.jpg`);
  const scale = `scale=w='min(iw,${maxEdge})':h=-2`;
  const bin = ffmpegBin();
  const input = await ffmpegInputPath(p);
  try {
    await execFileAsync(
      bin,
      ['-y', '-ss', '1', '-i', input.path, '-frames:v', '1', '-update', '1', '-vf', scale, '-q:v', '4', out],
      { windowsHide: true, timeout: 20000 },
    );
    const buf = await fs.readFile(out);
    return { url: `data:image/jpeg;base64,${buf.toString('base64')}` };
  } catch {
    // 部分短片不足 1s：回退到第 0 帧
    try {
      await execFileAsync(
        bin,
        ['-y', '-i', input.path, '-frames:v', '1', '-update', '1', '-vf', scale, '-q:v', '4', out],
        { windowsHide: true, timeout: 20000 },
      );
      const buf = await fs.readFile(out);
      return { url: `data:image/jpeg;base64,${buf.toString('base64')}` };
    } catch {
      return null;
    }
  } finally {
    await input.cleanup();
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
