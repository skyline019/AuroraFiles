/**
 * 索引策略偏好：maxScan / 额外排除目录名（持久化到 userData）
 *
 * maxScan === 0 → 无上限（walk 侧用 Number.MAX_SAFE_INTEGER）
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { getIndexDir } from './persist.mjs';
import { normalizeTrackId } from './indexTrack.mjs';

/** 默认无上限：0 表示不截断 */
export const DEFAULT_MAX_SCAN = 0;
export const MIN_MAX_SCAN = 5_000;
/** 用户填正数时的软顶（防误填天文数字）；0 不受此限 */
export const MAX_MAX_SCAN = 50_000_000;
/** walk / ensureIndexed 实际使用的「无上限」哨兵 */
export const UNLIMITED_SCAN = Number.MAX_SAFE_INTEGER;

/** 高压整卷：仅跳过无法安全枚举的目录（含隐藏项 / 回收站都扫） */
export const MINIMAL_SKIP = [
  'system volume information',
];

/** 内置永不索引的目录名（小写）——含 Windows 用户配置里的毒目录/联接名 */
export const BUILTIN_SKIP = [
  '$recycle.bin', 'system volume information', 'node_modules', '.git',
  'windows', 'windowsapps', '$windows.~bt', 'recovery',
  // 用户配置：AppData 与历史联接名（否则扫 C:\\Users\\x 会卡死）
  'appdata', 'application data', 'local settings', 'local low',
  'cookies', 'recent', 'sendto', 'start menu', 'templates',
  'nethood', 'printhood', 'temporary internet files',
  'cache', '.cache', '.npm', '.nuget', '.local',
  'inetcache', 'packages', 'msixvc', 'code cache', 'gpucache',
];

const DEFAULT_PREFS = {
  maxScan: DEFAULT_MAX_SCAN,
  /** 用户追加的排除目录名（相对名，非路径） */
  excludeNames: [],
  /** ui=保交互；perf=冲吞吐 */
  indexTrack: 'ui',
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

/**
 * 规范化用户输入的 maxScan。
 * 0 / 负数 / Infinity / 'unlimited' → 0（无上限）
 * 正数夹到 [MIN_MAX_SCAN, MAX_MAX_SCAN]
 */
export function clampMaxScan(n) {
  if (n === 0 || n === '0' || n === Infinity || n === 'unlimited') return 0;
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MAX_SCAN;
  if (v < 0) return 0;
  if (v === 0) return 0;
  return Math.min(MAX_MAX_SCAN, Math.max(MIN_MAX_SCAN, Math.round(v)));
}

/** 供 walk 使用：0 → UNLIMITED_SCAN */
export function resolveScanLimit(maxScan) {
  const v = maxScan == null ? DEFAULT_MAX_SCAN : Number(maxScan);
  if (!Number.isFinite(v) || v <= 0) return UNLIMITED_SCAN;
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

/**
 * 历史默认 12 万 / 200 万会悄悄截断大盘；升级到无上限。
 * 用户显式改过的其它正数保留。
 */
function migrateMaxScan(raw) {
  if (raw == null) return DEFAULT_MAX_SCAN;
  const n = Number(raw);
  if (n === 120_000 || n === 2_000_000) return 0;
  return clampMaxScan(n);
}

export async function loadIndexPrefs() {
  invalidateIfDirChanged();
  if (cached) return { ...cached, excludeNames: [...cached.excludeNames] };
  try {
    const raw = await fs.readFile(prefsPath(), 'utf8');
    const j = JSON.parse(raw);
    cached = {
      maxScan: migrateMaxScan(j.maxScan),
      excludeNames: normalizeExcludeNames(j.excludeNames),
      indexTrack: normalizeTrackId(j.indexTrack ?? DEFAULT_PREFS.indexTrack),
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
    indexTrack: partial.indexTrack != null
      ? normalizeTrackId(partial.indexTrack)
      : (cur.indexTrack || 'ui'),
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
      maxScan: migrateMaxScan(j.maxScan),
      excludeNames: normalizeExcludeNames(j.excludeNames),
      indexTrack: normalizeTrackId(j.indexTrack ?? DEFAULT_PREFS.indexTrack),
    };
  } catch {
    cached = { ...DEFAULT_PREFS, excludeNames: [] };
  }
  return cached;
}

/**
 * @param {object} [prefs]
 * @param {'builtin'|'minimal'|'none'} [mode]
 */
export function effectiveSkipSet(prefs = getIndexPrefsSync(), mode = 'builtin') {
  const extra = prefs?.excludeNames || [];
  if (mode === 'none') return new Set(extra.map((n) => String(n).toLowerCase()));
  if (mode === 'minimal') return new Set([...MINIMAL_SKIP, ...extra.map((n) => String(n).toLowerCase())]);
  return new Set([...BUILTIN_SKIP, ...extra]);
}

/** 返回 walk 可用的扫描上限（0 prefs → UNLIMITED_SCAN） */
export function effectiveMaxScan(optsMax, prefs = getIndexPrefsSync()) {
  if (optsMax != null && Number.isFinite(Number(optsMax))) {
    return resolveScanLimit(clampMaxScan(optsMax));
  }
  return resolveScanLimit(prefs.maxScan);
}
