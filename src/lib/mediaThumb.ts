/**
 * 画廊 / 网格缩略图：难解码图与视频封面经 ffmpeg，带 LRU + 并发上限。
 */
import { api, isElectron } from './aurora';
import { needsFfmpegImageDecode } from './mediaDecode';
import { extOf } from './fs';

const MAX_CACHE = 96;
const MAX_CONCURRENT = 3;
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
let active = 0;
const waiters: Array<() => void> = [];

function cacheSet(key: string, value: string | null) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

function releaseSlot() {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

function realPathOf(nodeId: string): string | null {
  if (/^[A-Za-z]:[\\/]/.test(nodeId)) return nodeId;
  return null;
}

export function auroraFileUrl(absPath: string): string {
  const slash = absPath.replace(/\\/g, '/');
  return `aurora-file:///${slash}`;
}

/** 图片缩略：原生扩展直接协议；难解码走 ffmpeg（maxEdge 512） */
export async function resolveImageThumbUrl(
  nodeId: string,
  name: string,
  embedded?: string | null,
): Promise<string | null> {
  if (embedded) return embedded;
  const abs = realPathOf(nodeId);
  if (!abs || !isElectron()) return null;

  const ext = extOf(name);
  if (!needsFfmpegImageDecode(ext)) {
    return auroraFileUrl(abs);
  }

  const key = `img512:${abs}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = withSlot(async () => {
    try {
      const r = await api().imagePreview(abs, { maxEdge: 512 });
      const url = r?.url || null;
      cacheSet(key, url);
      return url;
    } catch {
      cacheSet(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  });
  inflight.set(key, job);
  return job;
}

/** 视频封面缩略（maxEdge 512） */
export async function resolveVideoThumbUrl(nodeId: string): Promise<string | null> {
  const abs = realPathOf(nodeId);
  if (!abs || !isElectron()) return null;

  const key = `vid512:${abs}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = withSlot(async () => {
    try {
      const r = await api().videoPoster(abs, { maxEdge: 512 });
      const url = r?.url || null;
      cacheSet(key, url);
      return url;
    } catch {
      cacheSet(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  });
  inflight.set(key, job);
  return job;
}

export function clearMediaThumbCache(absPath?: string) {
  if (!absPath) {
    cache.clear();
    inflight.clear();
    return;
  }
  const norm = absPath.replace(/\\/g, '/').toLowerCase();
  for (const k of [...cache.keys()]) {
    if (k.toLowerCase().includes(norm)) cache.delete(k);
  }
  for (const k of [...inflight.keys()]) {
    if (k.toLowerCase().includes(norm)) inflight.delete(k);
  }
}
