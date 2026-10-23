/**
 * 真盘标签持久化（localStorage）—— 相对系统资源管理器的差异化能力
 */
import type { TagColor } from './fs';

const KEY = 'aurora.tags.v1';

type TagMap = Record<string, TagColor[]>;

function load(): TagMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const j = JSON.parse(raw) as TagMap;
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function save(map: TagMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function getPersistedTags(absPath: string): TagColor[] {
  const map = load();
  return map[norm(absPath)] ?? [];
}

export function setPersistedTags(absPath: string, tags: TagColor[]) {
  const map = load();
  const k = norm(absPath);
  if (!tags.length) delete map[k];
  else map[k] = [...tags];
  save(map);
}

export function togglePersistedTag(absPath: string, color: TagColor): TagColor[] {
  const cur = new Set(getPersistedTags(absPath));
  if (cur.has(color)) cur.delete(color);
  else cur.add(color);
  const next = [...cur] as TagColor[];
  setPersistedTags(absPath, next);
  return next;
}

function norm(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

/** 测试辅助 */
export function __resetTagStoreForTests() {
  try { localStorage.removeItem(KEY); } catch { /* */ }
}
