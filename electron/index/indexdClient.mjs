/**
 * Client for aurora-indexd (Rust resident index). Line-delimited JSON over stdio.
 * Silent upserts (no id) + barrier/request with id for sync.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export function resolveIndexdBin() {
  const name = process.platform === 'win32' ? 'aurora-indexd.exe' : 'aurora-indexd';
  const res = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  const cands = [
    process.env.AURORA_INDEXD_BIN,
    res && path.join(res, 'native', name),
    path.join(REPO_ROOT, 'native', 'indexd', 'target', 'release', name),
    path.join(REPO_ROOT, 'native', 'indexd', 'target', 'debug', name),
  ].filter(Boolean);
  for (const p of cands) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* */ }
  }
  return null;
}

export class IndexdClient {
  constructor(root) {
    this.root = root;
    this.child = null;
    this._nextId = 1;
    this._pending = new Map();
    this._alive = false;
    this._batch = [];
    this._batchBytes = 0;
    this._nodeBatch = [];
    this._nodeBatchBytes = 0;
  }

  start() {
    if (this._alive) return true;
    const bin = resolveIndexdBin();
    if (!bin) return false;
    this.child = spawn(bin, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this._alive = true;
    const rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const t = line.trim();
      if (!t) return;
      let msg;
      try {
        msg = JSON.parse(t);
      } catch {
        return;
      }
      const id = msg.id;
      if (id == null) return;
      const pend = this._pending.get(id);
      if (!pend) return;
      this._pending.delete(id);
      clearTimeout(pend.timer);
      if (msg.ok === false) pend.reject(new Error(msg.error || 'indexd_error'));
      else pend.resolve(msg);
    });
    this.child.on('exit', () => {
      this._alive = false;
      for (const [, p] of this._pending) {
        clearTimeout(p.timer);
        p.reject(new Error('indexd_exit'));
      }
      this._pending.clear();
    });
    this.child.stderr?.on('data', () => { /* swallow */ });
    return true;
  }

  stop() {
    try {
      this.child?.stdin?.end();
      this.child?.kill();
    } catch { /* */ }
    this._alive = false;
    this.child = null;
  }

  _write(obj) {
    if (!this._alive || !this.child?.stdin) throw new Error('indexd_not_running');
    this.child.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  request(cmd, fields = {}, timeoutMs = 120_000) {
    if (!this._alive) throw new Error('indexd_not_running');
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`indexd_timeout:${cmd}`));
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._write({ id, cmd, ...fields });
    });
  }

  /** Fire-and-forget upsert (no response). */
  upsertSilent(entry) {
    if (!entry?.path || !entry?.name) return;
    const e = { path: entry.path, name: entry.name };
    if (entry.kind === 'folder') e.kind = 'folder';
    if (entry.frn != null) e.frn = String(entry.frn);
    this._batch.push(e);
    this._batchBytes += e.path.length + e.name.length;
    if (this._batch.length >= 800 || this._batchBytes >= 160_000) {
      this.flushBatchSync();
    }
  }

  flushBatchSync() {
    if (!this._batch.length) return;
    const entries = this._batch;
    this._batch = [];
    this._batchBytes = 0;
    this._write({ cmd: 'upsert_batch', entries });
  }

  /**
   * Forward raw NDJSON object lines as upsert_batch without JSON.parse.
   * Each line must be a complete {"path":...,"name":...} object.
   */
  upsertRawLines(lines) {
    if (!lines?.length) return;
    this.flushBatchSync();
    // Build one stdin frame by concatenation — no per-entry objects in V8.
    let body = '{"cmd":"upsert_batch","entries":[';
    for (let i = 0; i < lines.length; i++) {
      if (i) body += ',';
      body += lines[i];
    }
    body += ']}\n';
    if (!this._alive || !this.child?.stdin) throw new Error('indexd_not_running');
    this.child.stdin.write(body);
  }

  /**
   * FRN-link ingest: raw {"name","frn","parent",...?} lines → upsert_node_batch.
   */
  upsertRawNodeLines(lines) {
    if (!lines?.length) return;
    this.flushNodeBatchSync();
    this.flushBatchSync();
    let body = '{"cmd":"upsert_node_batch","nodes":[';
    for (let i = 0; i < lines.length; i++) {
      if (i) body += ',';
      body += lines[i];
    }
    body += ']}\n';
    if (!this._alive || !this.child?.stdin) throw new Error('indexd_not_running');
    this.child.stdin.write(body);
  }

  /** Drop any leftover walk batches so V8 can reclaim before post-T1 GC. */
  releaseWalkBuffers() {
    this._batch = [];
    this._batchBytes = 0;
    this._nodeBatch = [];
    this._nodeBatchBytes = 0;
  }

  ensureRootSilent(drive, frn) {
    if (!drive) return;
    this._write({
      cmd: 'ensure_root',
      path: String(drive),
      frn: frn != null ? String(frn) : '0',
    });
  }

  upsertNodeSilent(node) {
    if (!node?.name || node.frn == null) return;
    if (!this._nodeBatch) {
      this._nodeBatch = [];
      this._nodeBatchBytes = 0;
    }
    const e = {
      name: node.name,
      frn: String(node.frn),
      parent: String(node.parent ?? 0),
    };
    if (node.kind === 'folder') e.kind = 'folder';
    this._nodeBatch.push(e);
    this._nodeBatchBytes += e.name.length + 24;
    if (this._nodeBatch.length >= 600 || this._nodeBatchBytes >= 96_000) {
      this.flushNodeBatchSync();
    }
  }

  flushNodeBatchSync() {
    if (!this._nodeBatch?.length) return;
    const nodes = this._nodeBatch;
    this._nodeBatch = [];
    this._nodeBatchBytes = 0;
    this._write({ cmd: 'upsert_node_batch', nodes });
  }

  async barrier() {
    this.flushNodeBatchSync();
    this.flushBatchSync();
    return this.request('barrier');
  }

  async removeFrn(frn) {
    return this.request('remove_frn', { frn: String(frn) });
  }

  async ping() {
    return this.request('ping', {}, 5_000);
  }

  async stats() {
    return this.request('stats');
  }

  async clear() {
    this._batch = [];
    return this.request('clear');
  }

  async query(q, { limit = 400, mode = 'prefix' } = {}) {
    return this.request('query', { q, limit, mode });
  }

  async get(pathStr) {
    return this.request('get', { path: pathStr });
  }

  async resolveFrn(frn) {
    return this.request('resolve_frn', { frn: String(frn) });
  }

  async remove(pathStr) {
    return this.request('remove', { path: pathStr });
  }

  async removePrefix(prefix) {
    return this.request('remove_prefix', { prefix });
  }

  async exportSlice(cursor, n, { lite = true } = {}) {
    return this.request('export_slice', { cursor, n, lite });
  }

  async getMany(paths) {
    return this.request('get_many', { paths });
  }

  async hydrateNdjson(file) {
    return this.request('hydrate_ndjson', { file }, 600_000);
  }

  async hydrateBin(file) {
    return this.request('hydrate_bin', { file }, 600_000);
  }

  async persist(file) {
    return this.request('persist', { file }, 600_000);
  }

  async persistBin(file) {
    return this.request('persist_bin', { file }, 600_000);
  }

  async persistDelta(file) {
    return this.request('persist_delta', { file }, 120_000);
  }

  async hydrateDelta(file) {
    return this.request('hydrate_delta', { file }, 120_000);
  }

  async normalizeSlice(n = 4000) {
    return this.request('normalize_slice', { n }, 120_000);
  }

  async normalize() {
    return this.request('normalize', {}, 600_000);
  }
}
