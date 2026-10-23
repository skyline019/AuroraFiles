/**
 * 索引策略偏好：maxScan / 额外排除目录名（持久化到 userData）
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { getIndexDir } from './persist.mjs';

export const DEFAULT_MAX_SCAN = 120_000;
export const MIN_MAX_SCAN = 5_000;
export const MAX_MAX_SCAN = 2_000_000;

/** 内置永不索引的目录名（小写） */
export const BUILTIN_SKIP = [
  '$recycle.bin', 'system volume information', 'node_modules', '.git',
  'windows', 'windowsapps', '$windows.~bt', 'recovery',
];

const DEFAULT_PREFS = {
  maxScan: DEFAULT_MAX_SCAN,
  /** 用户追加的排除目录名（相对名，非路径） */
  excludeNames: [],
};

let cached = null;
let cachedDir = null;

function prefsPath() {
  return path.join(getIndexDir(), 'index-prefs.json');
}

function invalidateIfDirChanged() {
  const dir = getIndexDir();
  if (cachedDir !== dir) {
    cached = null;
    cachedDir = dir;
  }
}

/** 测试用 */
export function resetIndexPrefsCache() {
  cached = null;
  cachedDir = null;
}

export function clampMaxScan(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MAX_SCAN;
  return Math.min(MAX_MAX_SCAN, Math.max(MIN_MAX_SCAN, Math.round(v)));
}

export function normalizeExcludeNames(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const name = String(raw || '').trim().toLowerCase();
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.slice(0, 64);
}

export async function loadIndexPrefs() {
  invalidateIfDirChanged();
  if (cached) return { ...cached, excludeNames: [...cached.excludeNames] };
  try {
    const raw = await fs.readFile(prefsPath(), 'utf8');
    const j = JSON.parse(raw);
    cached = {
      maxScan: clampMaxScan(j.maxScan ?? DEFAULT_MAX_SCAN),
      excludeNames: normalizeExcludeNames(j.excludeNames),
    };
  } catch {
    cached = { ...DEFAULT_PREFS, excludeNames: [] };
  }
  return { ...cached, excludeNames: [...cached.excludeNames] };
}

export async function saveIndexPrefs(partial = {}) {
  const cur = await loadIndexPrefs();
  const next = {
    maxScan: partial.maxScan != null ? clampMaxScan(partial.maxScan) : cur.maxScan,
    excludeNames: partial.excludeNames != null
      ? normalizeExcludeNames(partial.excludeNames)
      : cur.excludeNames,
  };
  cached = next;
  await fs.mkdir(path.dirname(prefsPath()), { recursive: true });
  await fs.writeFile(prefsPath(), JSON.stringify(next, null, 2), 'utf8');
  return { ...next, excludeNames: [...next.excludeNames] };
}

/** 同步读取（建索热路径）；文件不存在时用默认 */
export function getIndexPrefsSync() {
  invalidateIfDirChanged();
  if (cached) return cached;
  try {
    const raw = fssync.readFileSync(prefsPath(), 'utf8');
    const j = JSON.parse(raw);
    cached = {
      maxScan: clampMaxScan(j.maxScan ?? DEFAULT_MAX_SCAN),
      excludeNames: normalizeExcludeNames(j.excludeNames),
    };
  } catch {
    cached = { ...DEFAULT_PREFS, excludeNames: [] };
  }
  return cached;
}

export function effectiveSkipSet(prefs = getIndexPrefsSync()) {
  return new Set([...BUILTIN_SKIP, ...(prefs.excludeNames || [])]);
}

export function effectiveMaxScan(optsMax, prefs = getIndexPrefsSync()) {
  if (optsMax != null && Number.isFinite(Number(optsMax))) return clampMaxScan(optsMax);
  return prefs.maxScan || DEFAULT_MAX_SCAN;
}
