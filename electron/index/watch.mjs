/**
 * 外部变更捕获：Windows fs.watch({ recursive }) ≈ ReadDirectoryChangesW
 * 同时累积脏目录，供 soft refresh 只扫局部。
 */
import fs from 'node:fs';
import path from 'node:path';
import fsp from 'node:fs/promises';

const SKIP_NAME = /(?:^|\\|\/)(?:\$recycle\.bin|system volume information|node_modules|\.git|windowsapps)(?:\\|\/|$)/i;

/** @type {Map<string, { watcher: import('node:fs').FSWatcher, pending: Map<string, number>, dirtyDirs: Set<string>, timer: NodeJS.Timeout | null }>} */
const watches = new Map();

function volKey(root) {
  return String(root).replace(/\\+$/, '').toLowerCase();
}

/**
 * @param {string} root
 * @param {(absPath: string, entry: object | null) => void} onChange
 * @param {(dirPath: string) => void} [onDirtyDir]
 */
export function startVolumeWatch(root, onChange, onDirtyDir) {
  const key = volKey(root);
  stopVolumeWatch(root);
  const rootNorm = String(root).replace(/\\+$/, '') + path.sep;
  const pending = new Map();
  /** @type {Set<string>} */
  const dirtyDirs = new Set();
  let timer = null;
  let watcher;

  const markDirty = (abs) => {
    const dir = path.dirname(abs).toLowerCase();
    dirtyDirs.add(dir);
    onDirtyDir?.(dir);
  };

  const flush = () => {
    timer = null;
    const batch = [...pending.entries()];
    pending.clear();
    void (async () => {
      for (const [abs, kind] of batch) {
        if (SKIP_NAME.test(abs)) continue;
        markDirty(abs);
        if (kind === 1) {
          onChange(abs, null);
          continue;
        }
        try {
          const st = await fsp.stat(abs);
          onChange(abs, {
            path: abs,
            name: path.basename(abs),
            kind: st.isDirectory() ? 'folder' : 'file',
            size: st.isFile() ? st.size : 0,
            modifiedAt: st.mtimeMs,
            frn: st.ino != null ? String(st.ino) : undefined,
          });
          if (st.isDirectory()) dirtyDirs.add(abs.toLowerCase());
        } catch {
          onChange(abs, null);
        }
      }
    })();
  };

  const schedule = (abs) => {
    pending.set(abs, 0);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 180);
  };

  try {
    watcher = fs.watch(rootNorm, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const abs = path.isAbsolute(filename)
        ? filename
        : path.join(rootNorm, filename);
      if (SKIP_NAME.test(abs)) return;
      schedule(abs);
    });
  } catch {
    return false;
  }

  watcher.on('error', () => {
    stopVolumeWatch(root);
  });

  watches.set(key, { watcher, pending, dirtyDirs, timer });
  return true;
}

/** 取出并清空脏目录集合 */
export function takeDirtyDirs(root) {
  const w = watches.get(volKey(root));
  if (!w) return [];
  const dirs = [...w.dirtyDirs];
  w.dirtyDirs.clear();
  return dirs;
}

export function peekDirtyDirs(root) {
  const w = watches.get(volKey(root));
  return w ? [...w.dirtyDirs] : [];
}

export function stopVolumeWatch(root) {
  const key = volKey(root);
  const w = watches.get(key);
  if (!w) return;
  try { w.watcher.close(); } catch { /* */ }
  if (w.timer) clearTimeout(w.timer);
  watches.delete(key);
}

export function isWatching(root) {
  return watches.has(volKey(root));
}
