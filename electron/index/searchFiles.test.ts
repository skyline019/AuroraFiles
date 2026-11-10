import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureIndexDir } from './persist.mjs';
import { resetIndexPrefsCache } from './indexPrefs.mjs';
import { disposeVolumeIndex, getIndex } from './fsIndex.mjs';
import { isPathUnder, searchFiles, volumeRootOf } from './searchFiles.mjs';

describe('searchFiles helpers', () => {
  it('volumeRootOf', () => {
    if (process.platform === 'win32') {
      expect(volumeRootOf('E:\\Agent\\foo')).toMatch(/^E:\\$/i);
      expect(volumeRootOf('e:/x')).toMatch(/^E:\\$/i);
    } else {
      expect(volumeRootOf('/tmp/a')).toBe('/');
    }
  });

  it('isPathUnder', () => {
    if (process.platform === 'win32') {
      expect(isPathUnder('E:\\a\\b', 'E:\\a')).toBe(true);
      expect(isPathUnder('E:\\a', 'E:\\a')).toBe(true);
      expect(isPathUnder('E:\\other', 'E:\\a')).toBe(false);
    } else {
      expect(isPathUnder('/tmp/a/b', '/tmp/a')).toBe(true);
      expect(isPathUnder('/tmp/z', '/tmp/a')).toBe(false);
    }
  });
});

describe('searchFiles deep walk', () => {
  let idxDir: string;
  let root: string;

  beforeEach(async () => {
    idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-search-idx-'));
    configureIndexDir(idxDir);
    resetIndexPrefsCache();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-search-deep-'));
  });

  afterEach(async () => {
    try {
      disposeVolumeIndex(volumeRootOf(root));
    } catch { /* */ }
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(idxDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('finds files deeper than legacy cap of 6', async () => {
    let dir = root;
    for (let i = 0; i < 12; i++) {
      dir = path.join(dir, `d${i}`);
      await fs.mkdir(dir);
    }
    const deepFile = path.join(dir, 'unique-needle-xyz.txt');
    await fs.writeFile(deepFile, 'x');

    const res = await searchFiles(root, 'unique-needle-xyz', {
      maxDepth: 64,
      maxScan: 0,
      maxResults: 50,
      indexDepth: 0,
      forceWalk: true,
    });
    expect(res.source).toBe('walk-fallback');
    expect(res.items.some((it) => it.path === deepFile || it.name.includes('unique-needle-xyz'))).toBe(true);
    expect(res.scanned).toBeGreaterThan(12);
  });

  it('scopes results to current folder when walking', async () => {
    const a = path.join(root, 'keep');
    const b = path.join(root, 'other');
    await fs.mkdir(a);
    await fs.mkdir(b);
    await fs.writeFile(path.join(a, 'scope-hit.txt'), '1');
    await fs.writeFile(path.join(b, 'scope-hit.txt'), '1');

    const res = await searchFiles(a, 'scope-hit', {
      forceWalk: true,
      indexDepth: 0,
      maxDepth: 8,
      maxScan: 1000,
    });
    expect(res.items.length).toBe(1);
    expect(isPathUnder(res.items[0].path, a)).toBe(true);
  });

  it('CJK miss on ready-empty index falls back to deep walk', async () => {
    const deep = path.join(root, '层1', '层2');
    await fs.mkdir(deep, { recursive: true });
    const hit = path.join(deep, '问卷汇总.docx');
    await fs.writeFile(hit, 'x');

    const vol = volumeRootOf(root);
    const idx = getIndex(vol);
    idx.ready = true;
    idx.building = false;
    // meta / native 皆空 → 索引「就绪但搜不到」

    const res = await searchFiles(root, '问', {
      indexDepth: 0,
      maxDepth: 16,
      maxScan: 5000,
      maxResults: 50,
    });
    expect(res.source).toBe('walk-fallback');
    expect(res.items.some((it) => it.name.includes('问'))).toBe(true);
  });
});
