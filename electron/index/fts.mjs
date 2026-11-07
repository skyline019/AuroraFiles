/**
 * SQLite FTS5 侧车：大库名称/路径检索；与内存结构并存。
 * 支持事务流式写入（beginRebuild/insertFast/endRebuild），避免全量数组尖峰。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { getIndexDir } from './persist.mjs';

const require = createRequire(import.meta.url);
/** @type {typeof import('node:sqlite').DatabaseSync | null} */
let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  DatabaseSync = null;
}

function volumeId(root) {
  const m = String(root).match(/^([A-Za-z]):/);
  return (m ? m[1] : 'vol').toLowerCase();
}

function dbPath(root) {
  return path.join(getIndexDir(), `${volumeId(root)}.fts.sqlite`);
}

export function ftsAvailable() {
  return !!DatabaseSync;
}

export class FtsIndex {
  /**
   * @param {string} root
   */
  constructor(root) {
    this.root = root;
    this.db = null;
    this.ok = false;
    this._inRebuild = false;
    this._batch = 0;
    if (!DatabaseSync) return;
    try {
      fs.mkdirSync(getIndexDir(), { recursive: true });
      this.db = new DatabaseSync(dbPath(root));
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA cache_size = -2000;
        PRAGMA temp_store = MEMORY;
        CREATE VIRTUAL TABLE IF NOT EXISTS files USING fts5(
          path UNINDEXED,
          name,
          tokenize = 'unicode61'
        );
      `);
      // Compat: older DBs had path_text; prefer slim 2-col insert, fall back if needed.
      let ins = null;
      try {
        ins = this.db.prepare('INSERT INTO files(path, name) VALUES (?, ?)');
        this._ftsCols = 2;
      } catch {
        ins = this.db.prepare('INSERT INTO files(path, name, path_text) VALUES (?, ?, ?)');
        this._ftsCols = 3;
      }
      this.ins = ins;
      this.del = this.db.prepare('DELETE FROM files WHERE path = ?');
      this.clr = this.db.prepare('DELETE FROM files');
      this.q = this.db.prepare(
        'SELECT path, name FROM files WHERE files MATCH ? LIMIT ?',
      );
      this.cnt = this.db.prepare('SELECT count(*) AS n FROM files');
      this.ok = true;
    } catch {
      this.close();
      this.ok = false;
    }
  }

  close() {
    try {
      if (this._inRebuild) {
        try { this.db?.exec?.('COMMIT'); } catch { /* */ }
        this._inRebuild = false;
      }
      this.db?.close?.();
    } catch { /* */ }
    this.db = null;
    this.ok = false;
  }

  clear() {
    if (!this.ok) return;
    try { this.clr.run(); } catch { /* */ }
  }

  /** 开始流式重建（清空 + BEGIN） */
  beginRebuild() {
    if (!this.ok) return false;
    if (this._inRebuild) return true;
    try {
      this.db.exec('BEGIN');
      this.clr.run();
      this._inRebuild = true;
      this._batch = 0;
      return true;
    } catch {
      try { this.db.exec('ROLLBACK'); } catch { /* */ }
      this._inRebuild = false;
      return false;
    }
  }

  /**
   * 事务内快速插入（不先 DELETE；用于 rebuild）
   * @returns {boolean}
   */
  insertFast(entry) {
    if (!this.ok || !entry?.path) return false;
    try {
      if (this._ftsCols === 3) {
        this.ins.run(entry.path, entry.name || '', String(entry.path).toLowerCase());
      } else {
        this.ins.run(entry.path, entry.name || '');
      }
      this._batch += 1;
      return true;
    } catch {
      return false;
    }
  }

  endRebuild() {
    if (!this.ok || !this._inRebuild) return false;
    try {
      this.db.exec('COMMIT');
      this._inRebuild = false;
      this._batch = 0;
      return true;
    } catch {
      try { this.db.exec('ROLLBACK'); } catch { /* */ }
      this._inRebuild = false;
      return false;
    }
  }

  /** 当前事务内已插入条数 */
  rebuildBatch() {
    return this._batch;
  }

  upsert(entry) {
    if (!this.ok || !entry?.path) return;
    if (this._inRebuild) {
      this.insertFast(entry);
      return;
    }
    try {
      this.del.run(entry.path);
      if (this._ftsCols === 3) {
        this.ins.run(entry.path, entry.name || '', String(entry.path).toLowerCase());
      } else {
        this.ins.run(entry.path, entry.name || '');
      }
    } catch { /* */ }
  }

  remove(absPath) {
    if (!this.ok || !absPath) return;
    try { this.del.run(absPath); } catch { /* */ }
  }

  rebuild(entries) {
    if (!this.ok) return;
    if (!this.beginRebuild()) return;
    try {
      for (const e of entries) {
        if (!e?.path) continue;
        this.insertFast(e);
      }
      this.endRebuild();
    } catch {
      try { this.db.exec('ROLLBACK'); } catch { /* */ }
      this._inRebuild = false;
    }
  }

  /**
   * 按预算从 iterator/数组切片写入（错峰清偿用）
   * @param {Iterable<object>} entries
   * @param {{ ops?: number, already?: number }} opts
   * @returns {number} 本片写入数
   */
  insertSlice(entries, opts = {}) {
    if (!this.ok) return 0;
    const ops = Number(opts.ops) > 0 ? Number(opts.ops) : 400;
    let skip = Number(opts.already) || 0;
    let n = 0;
    let i = 0;
    for (const e of entries) {
      if (i < skip) {
        i += 1;
        continue;
      }
      if (n >= ops) break;
      if (!e?.path) {
        i += 1;
        continue;
      }
      if (!this._inRebuild) {
        try {
          this.del.run(e.path);
          if (this._ftsCols === 3) {
            this.ins.run(e.path, e.name || '', String(e.path).toLowerCase());
          } else {
            this.ins.run(e.path, e.name || '');
          }
        } catch { /* */ }
      } else {
        this.insertFast(e);
      }
      n += 1;
      i += 1;
    }
    return n;
  }

  /**
   * @returns {{ path: string, name: string }[]}
   */
  search(needle, limit = 400) {
    if (!this.ok || !needle) return [];
    const tokens = String(needle)
      .toLowerCase()
      .split(/[\s\\/]+/)
      .map((t) => t.replace(/["*'^]/g, ''))
      .filter((t) => t.length >= 1);
    if (!tokens.length) return [];
    const match = tokens.map((t) => `"${t}"*`).join(' AND ');
    try {
      return this.q.all(match, limit);
    } catch {
      try {
        return this.q.all(tokens.map((t) => `"${t}"`).join(' AND '), limit);
      } catch {
        return [];
      }
    }
  }

  size() {
    if (!this.ok) return 0;
    try { return Number(this.cnt.get()?.n) || 0; } catch { return 0; }
  }
}
