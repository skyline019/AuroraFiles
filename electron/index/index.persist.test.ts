import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  configureIndexDir,
  loadIndexDisk,
  saveIndexDisk,
  appendIndexDelta,
} from './persist.mjs';
import { usnNeedsRebuild } from './usn.mjs';
import { SegmentInvertedMap, QueryResultCache } from './segmentMap.mjs';

describe('usnNeedsRebuild', () => {
  it('first run does not force rebuild', () => {
    const d = usnNeedsRebuild(null, { journalId: '0x1', firstUsn: 10, nextUsn: 100 });
    expect(d.rebuild).toBe(false);
  });

  it('detects journal rotate', () => {
    const d = usnNeedsRebuild(
      { journalId: '0x1', nextUsn: 50 },
      { journalId: '0x2', firstUsn: 0, nextUsn: 10 },
    );
    expect(d.rebuild).toBe(true);
    expect(d.reason).toBe('journal-rotated');
  });

  it('detects usn gap', () => {
    const d = usnNeedsRebuild(
      { journalId: '0x1', nextUsn: 10 },
      { journalId: '0x1', firstUsn: 100, nextUsn: 200 },
    );
    expect(d.rebuild).toBe(true);
    expect(d.reason).toBe('usn-gap');
  });

  it('allows mtime delta when continuous', () => {
    const d = usnNeedsRebuild(
      { journalId: '0x1', nextUsn: 100 },
      { journalId: '0x1', firstUsn: 50, nextUsn: 150 },
    );
    expect(d.rebuild).toBe(false);
    expect(d.useMtimeDelta).toBe(true);
  });
});

describe('persist base + delta', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-idx-'));
    configureIndexDir(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('saves and loads ndjson + meta', async () => {
    const root = 'C:\\Users\\test';
    const entries = [
      { path: 'C:\\Users\\test\\a.txt', name: 'a.txt', kind: 'file', size: 1, modifiedAt: 1 },
      { path: 'C:\\Users\\test\\docs', name: 'docs', kind: 'folder', size: 0, modifiedAt: 2 },
    ];
    await saveIndexDisk(root, {
      entries,
      scanned: 2,
      usn: { journalId: '0xabc', nextUsn: 99, firstUsn: 1, letter: 'C' },
      dirMtimes: { 'c:\\users\\test': 123 },
    });
    const loaded = await loadIndexDisk(root);
    expect(loaded).not.toBeNull();
    expect(loaded!.entries).toHaveLength(2);
    expect(loaded!.meta.usn.journalId).toBe('0xabc');
    expect(loaded!.meta.dirMtimes['c:\\users\\test']).toBe(123);
  });

  it('applies append delta without rewriting base', async () => {
    const root = 'D:\\proj';
    await saveIndexDisk(root, {
      entries: [
        { path: 'D:\\proj\\old.txt', name: 'old.txt', kind: 'file', size: 1, modifiedAt: 1 },
      ],
      scanned: 1,
      usn: null,
      dirMtimes: {},
    });
    const before = await fs.readFile(path.join(dir, 'd.ndjson'), 'utf8');
    await appendIndexDelta(root, [
      { op: 'upsert', e: { path: 'D:\\proj\\new.txt', name: 'new.txt', kind: 'file', size: 2, modifiedAt: 2 } },
      { op: 'del', p: 'D:\\proj\\old.txt' },
    ]);
    const afterBase = await fs.readFile(path.join(dir, 'd.ndjson'), 'utf8');
    expect(afterBase).toBe(before);
    const loaded = await loadIndexDisk(root);
    const names = loaded!.entries.map((e) => e.name).sort();
    expect(names).toEqual(['new.txt']);
    expect(loaded!.meta.deltaLines).toBe(2);
  });
});

describe('SegmentInvertedMap', () => {
  it('intersects multi-segment paths', () => {
    const m = new SegmentInvertedMap();
    m.upsert('C:\\Users\\Alice\\Documents\\report.pdf');
    m.upsert('C:\\Users\\Bob\\Documents\\notes.txt');
    m.upsert('C:\\Temp\\report.pdf');
    const hits = m.intersect(['users', 'documents']);
    expect(hits).toHaveLength(2);
    expect(m.intersect(['users', 'bob', 'notes.txt'])).toEqual([
      'c:\\users\\bob\\documents\\notes.txt',
    ]);
  });

  it('removes paths cleanly', () => {
    const m = new SegmentInvertedMap();
    m.upsert('C:\\A\\B\\c.txt');
    m.remove('C:\\A\\B\\c.txt');
    expect(m.intersect(['a', 'b'])).toEqual([]);
  });
});

describe('QueryResultCache', () => {
  it('evicts oldest beyond capacity', () => {
    const c = new QueryResultCache(2);
    c.set('a', { items: [], truncated: false, source: 't' });
    c.set('b', { items: [], truncated: false, source: 't' });
    c.set('c', { items: [], truncated: false, source: 't' });
    expect(c.get('a')).toBeNull();
    expect(c.get('b')).not.toBeNull();
    expect(c.get('c')).not.toBeNull();
  });
});
