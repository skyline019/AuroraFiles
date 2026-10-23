/**
 * NTFS 备用数据流（ADS）持久化标签：path:aurora.tags
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';

const STREAM = ':aurora.tags';

function normalizePath(p) {
  if (!p || typeof p !== 'string') throw new Error('无效路径');
  const n = path.win32.normalize(p);
  if (!path.win32.isAbsolute(n)) throw new Error('仅支持绝对路径');
  return n;
}

function adsPath(filePath) {
  const p = normalizePath(filePath);
  if (/^[A-Za-z]:\\?$/.test(p)) throw new Error('根路径不支持 ADS');
  return `${p}${STREAM}`;
}

export async function readAdsTags(filePath) {
  try {
    const raw = await fs.readFile(adsPath(filePath), 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function writeAdsTags(filePath, tags) {
  const p = normalizePath(filePath);
  const target = adsPath(p);
  if (!tags?.length) {
    try { await fs.unlink(target); } catch { /* */ }
    return [];
  }
  const clean = [...new Set(tags.map(String))];
  await fs.writeFile(target, JSON.stringify(clean), 'utf8');
  return clean;
}

export function adsSupported(filePath) {
  try {
    const p = normalizePath(filePath);
    if (/^[A-Za-z]:\\?$/.test(p)) return false;
    return fssync.existsSync(p) && !p.startsWith('\\\\');
  } catch {
    return false;
  }
}
