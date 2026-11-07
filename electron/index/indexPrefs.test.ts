import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureIndexDir } from './persist.mjs';
import {
  clampMaxScan,
  effectiveSkipSet,
  loadIndexPrefs,
  normalizeExcludeNames,
  saveIndexPrefs,
  resetIndexPrefsCache,
  BUILTIN_SKIP,
} from './indexPrefs.mjs';

describe('indexPrefs', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-prefs-'));
    resetIndexPrefsCache();
    configureIndexDir(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('clamps maxScan (0 = unlimited)', async () => {
    const { resolveScanLimit, UNLIMITED_SCAN } = await import('./indexPrefs.mjs');
    expect(clampMaxScan(100)).toBe(5_000);
    expect(clampMaxScan(9e9)).toBe(50_000_000);
    expect(clampMaxScan(0)).toBe(0);
    expect(clampMaxScan(-1)).toBe(0);
    expect(clampMaxScan(80_000)).toBe(80_000);
    expect(clampMaxScan(2_000_000)).toBe(2_000_000);
    expect(resolveScanLimit(0)).toBe(UNLIMITED_SCAN);
    expect(resolveScanLimit(60_000)).toBe(60_000);
  });

  it('migrates legacy defaults 120000 / 2M → unlimited (0)', async () => {
    const fs = await import('node:fs/promises');
    const { getIndexDir } = await import('./persist.mjs');
    const p = path.join(getIndexDir(), 'index-prefs.json');
    await fs.writeFile(p, JSON.stringify({ maxScan: 120000, excludeNames: [] }), 'utf8');
    resetIndexPrefsCache();
    expect((await loadIndexPrefs()).maxScan).toBe(0);
    await fs.writeFile(p, JSON.stringify({ maxScan: 2_000_000, excludeNames: [] }), 'utf8');
    resetIndexPrefsCache();
    expect((await loadIndexPrefs()).maxScan).toBe(0);
  });

  it('persists maxScan and exclude names', async () => {
    const saved = await saveIndexPrefs({
      maxScan: 60_000,
      excludeNames: ['Vendor', 'vendor', 'bad/path', 'node_modules', '  .cache  '],
      indexTrack: 'perf',
    });
    expect(saved.maxScan).toBe(60_000);
    expect(saved.excludeNames).toEqual(['vendor', 'node_modules', '.cache']);
    expect(saved.indexTrack).toBe('perf');
    const loaded = await loadIndexPrefs();
    expect(loaded.maxScan).toBe(60_000);
    expect(loaded.excludeNames).toContain('.cache');
    expect(loaded.indexTrack).toBe('perf');
  });

  it('merges builtin skip with user excludes', async () => {
    await saveIndexPrefs({ excludeNames: ['MyCache'] });
    const set = effectiveSkipSet(await loadIndexPrefs());
    expect(set.has('node_modules')).toBe(true);
    expect(set.has('mycache')).toBe(true);
    expect(set.has('appdata')).toBe(true);
    expect(BUILTIN_SKIP.length).toBeGreaterThan(8);
  });

  it('normalizeExcludeNames drops path segments', () => {
    expect(normalizeExcludeNames(['ok', 'a\\b', '../x', ''])).toEqual(['ok']);
  });
});
