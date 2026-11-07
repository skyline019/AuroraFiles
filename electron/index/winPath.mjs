/**
 * Windows 深路径：>260 字符用 \\?\ 扩展前缀访问；索引里仍存普通绝对路径。
 */
import path from 'node:path';

/** 逻辑路径 → 可安全传给 fs 的路径 */
export function fsPath(absPath) {
  const raw = String(absPath || '');
  // CI / unit tests on Linux: keep POSIX paths. win32.normalize('/tmp/x') → '\tmp\x' (ENOENT).
  if (process.platform !== 'win32') return path.normalize(raw);
  const n = path.win32.normalize(raw);
  try {
    return path.toNamespacedPath(n);
  } catch {
    return n;
  }
}

/** 去掉 \\?\ / \\?\UNC\ 前缀，得到展示/索引用路径 */
export function logicalPath(p) {
  const s = String(p || '');
  if (s.startsWith('\\\\?\\UNC\\')) return `\\\\${s.slice(8)}`;
  if (s.startsWith('\\\\?\\')) return s.slice(4);
  return s;
}
