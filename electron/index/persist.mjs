/**
 * 索引落盘 v3：基线 NDJSON + 追加 delta（避免每次全量重写抖 I/O）
 * 条目过多时仍可 compact 回基线；后续可换 SQLite 而不改调用方。
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const VERSION = 3;
/** delta 行数超过此值 → compact */
const COMPACT_DELTA_LINES = 2_000;
/** delta 文件字节超过此值 → compact */
const COMPACT_DELTA_BYTES = 1_500_000;

let INDEX_DIR = path.join(os.homedir(), '.aurora-files', 'index');

export function configureIndexDir(dir) {
  if (dir) INDEX_DIR = dir;
}

export function getIndexDir() {
  return INDEX_DIR;
}

function volumeId(root) {
  const m = String(root).match(/^([A-Za-z]):/);
  return (m ? m[1] : 'vol').toLowerCase();
}

function pathsFor(root) {
  const id = volumeId(root);
  return {
    dir: INDEX_DIR,
    meta: path.join(INDEX_DIR, `${id}.meta.json`),
    data: path.join(INDEX_DIR, `${id}.ndjson`),
    delta: path.join(INDEX_DIR, `${id}.delta.ndjson`),
  };
}

function parseNdjson(text) {
  const entries = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return entries;
}

function applyDeltaOps(map, ops) {
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    if (op.op === 'del' && op.p) {
      map.delete(String(op.p).toLowerCase());
    } else if (op.op === 'upsert' && op.e?.path) {
      map.set(String(op.e.path).toLowerCase(), op.e);
    } else if (op.path && op.name) {
      // v2 兼容：纯 entry 行
      map.set(String(op.path).toLowerCase(), op);
    }
  }
}

export async function loadIndexDisk(root) {
  const p = pathsFor(root);
  try {
    const metaRaw = await fs.readFile(p.meta, 'utf8');
    const meta = JSON.parse(metaRaw);
    if (meta.version !== 2 && meta.version !== VERSION) return null;

    const map = new Map();
    try {
      const data = await fs.readFile(p.data, 'utf8');
      for (const e of parseNdjson(data)) {
        if (e?.path) map.set(String(e.path).toLowerCase(), e);
      }
    } catch { /* no base */ }

    let deltaLines = 0;
    try {
      const deltaText = await fs.readFile(p.delta, 'utf8');
      const ops = parseNdjson(deltaText);
      deltaLines = ops.length;
      applyDeltaOps(map, ops);
    } catch { /* no delta */ }

    return {
      meta: { ...meta, version: VERSION, deltaLines },
      entries: [...map.values()],
    };
  } catch {
    return null;
  }
}

async function writeAtomic(file, body) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, file);
}

/**
 * 全量写基线并清空 delta（建索完成 / compact）
 */
export async function saveIndexDisk(root, {
  entries,
  scanned,
  usn,
  dirMtimes,
}) {
  const p = pathsFor(root);
  await fs.mkdir(p.dir, { recursive: true });
  const meta = {
    version: VERSION,
    root: String(root).replace(/\\+$/, '') + '\\',
    savedAt: Date.now(),
    scanned,
    size: entries.length,
    usn: usn || null,
    dirMtimes: dirMtimes || {},
    deltaLines: 0,
  };
  const body = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
  await writeAtomic(p.data, body);
  try { await fs.writeFile(p.delta, '', 'utf8'); } catch { /* */ }
  await writeAtomic(p.meta, JSON.stringify(meta));
  return meta;
}

/**
 * 仅追加 delta，避免整卷重写。返回是否建议 compact。
 */
export async function appendIndexDelta(root, ops, metaPatch = {}) {
  if (!ops?.length) return { appended: 0, shouldCompact: false };
  const p = pathsFor(root);
  await fs.mkdir(p.dir, { recursive: true });
  const chunk = ops.map((o) => JSON.stringify(o)).join('\n') + '\n';
  await fs.appendFile(p.delta, chunk, 'utf8');

  let meta = {};
  try {
    meta = JSON.parse(await fs.readFile(p.meta, 'utf8'));
  } catch {
    meta = { version: VERSION, root: String(root).replace(/\\+$/, '') + '\\' };
  }
  const deltaLines = (Number(meta.deltaLines) || 0) + ops.length;
  meta = {
    ...meta,
    ...metaPatch,
    version: VERSION,
    savedAt: Date.now(),
    deltaLines,
  };
  await writeAtomic(p.meta, JSON.stringify(meta));

  let deltaBytes = 0;
  try { deltaBytes = (await fs.stat(p.delta)).size; } catch { /* */ }
  const shouldCompact = deltaLines >= COMPACT_DELTA_LINES || deltaBytes >= COMPACT_DELTA_BYTES;
  return { appended: ops.length, shouldCompact, deltaLines, deltaBytes };
}

export function diskCacheStat(root) {
  const p = pathsFor(root);
  try {
    const st = fssync.statSync(p.data);
    const meta = JSON.parse(fssync.readFileSync(p.meta, 'utf8'));
    let deltaBytes = 0;
    let deltaLines = meta.deltaLines || 0;
    try {
      deltaBytes = fssync.statSync(p.delta).size;
    } catch { /* */ }
    return {
      exists: true,
      bytes: st.size + deltaBytes,
      baseBytes: st.size,
      deltaBytes,
      deltaLines,
      savedAt: meta.savedAt,
      size: meta.size,
      usn: meta.usn,
    };
  } catch {
    return { exists: false };
  }
}

export { COMPACT_DELTA_LINES, COMPACT_DELTA_BYTES };
