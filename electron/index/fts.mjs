/**
 * SQLite FTS5 侧车：大库名称/路径检索；与内存结构并存。
 * 使用 Node 内置 node:sqlite（Electron 37 / Node 22+）。
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
    if (!DatabaseSync) return;
    try {
      fs.mkdirSync(getIndexDir(), { recursive: true });
      this.db = new DatabaseSync(dbPath(root));
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE VIRTUAL TABLE IF NOT EXISTS files USING fts5(
          path UNINDEXED,
          name,
          path_text,
          tokenize = 'unicode61'
        );
      `);
      this.ins = this.db.prepare(
        'INSERT INTO files(path, name, path_text) VALUES (?, ?, ?)',
      );
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
    try { this.db?.close?.(); } catch { /* */ }
    this.db = null;
    this.ok = false;
  }

  clear() {
    if (!this.ok) return;
    try { this.clr.run(); } catch { /* */ }
  }

  upsert(entry) {
    if (!this.ok || !entry?.path) return;
    try {
      this.del.run(entry.path);
      this.ins.run(entry.path, entry.name || '', String(entry.path).toLowerCase());
    } catch { /* */ }
  }

  remove(absPath) {
    if (!this.ok || !absPath) return;
    try { this.del.run(absPath); } catch { /* */ }
  }

  rebuild(entries) {
    if (!this.ok) return;
    try {
      this.db.exec('BEGIN');
      this.clr.run();
      for (const e of entries) {
        if (!e?.path) continue;
        this.ins.run(e.path, e.name || '', String(e.path).toLowerCase());
      }
      this.db.exec('COMMIT');
    } catch {
      try { this.db.exec('ROLLBACK'); } catch { /* */ }
    }
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
