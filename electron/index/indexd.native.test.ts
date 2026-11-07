import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  configureIndexDir,
  ensureIndexed,
  queryIndex,
  disposeVolumeIndex,
  indexStatus,
  refreshIndexStatus,
  flushIndexDisk,
} from './fsIndex.mjs';
import { resolveIndexdBin } from './indexdClient.mjs';
import { resetIndexPrefsCache, saveIndexPrefs } from './indexPrefs.mjs';

const bin = resolveIndexdBin();

describe.skipIf(!bin)('aurora-indexd native backend', () => {
  let tree: string;
  let idxDir: string;
  const prevBackend = process.env.AURORA_INDEX_BACKEND;

  beforeEach(async () => {
    process.env.AURORA_INDEX_BACKEND = 'native';
    tree = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-indexd-tree-'));
    idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-indexd-idx-'));
    configureIndexDir(idxDir);
    resetIndexPrefsCache();
    await saveIndexPrefs({ maxScan: 50_000, excludeNames: [] });
    await fs.mkdir(path.join(tree, 'docs'), { recursive: true });
    await fs.writeFile(path.join(tree, 'docs', 'alpha.png'), 'x');
    await fs.writeFile(path.join(tree, 'docs', 'beta.txt'), 'y');
    await fs.writeFile(path.join(tree, 'gamma.png'), 'z');
  });

  afterEach(() => {
    disposeVolumeIndex(tree);
    if (prevBackend === undefined) delete process.env.AURORA_INDEX_BACKEND;
    else process.env.AURORA_INDEX_BACKEND = prevBackend;
  });

  it('indexes without filling V8 meta and finds png', async () => {
    await ensureIndexed(tree, {
      rebuild: true,
      leanMemory: true,
      persist: true,
      waitDebt: true,
      liveFollowers: false,
      maxDepth: 4,
      maxScan: 10_000,
      indexBackend: 'native',
      walkEngine: 'js',
    });
    const st = await refreshIndexStatus(tree);
    expect(st.backend).toBe('native');
    expect(st.metaSize).toBe(0);
    expect(st.size).toBeGreaterThanOrEqual(3);
    const q = await queryIndex(tree, 'png', { maxResults: 20 });
    expect(q.items.some((i: { name?: string }) => String(i.name).includes('png'))).toBe(true);
    expect(q.source).toMatch(/native/);
  });

  it('multi-word query without FTS', async () => {
    await ensureIndexed(tree, {
      rebuild: true,
      leanMemory: true,
      persist: false,
      liveFollowers: false,
      maxDepth: 4,
      indexBackend: 'native',
      walkEngine: 'js',
    });
    const q = await queryIndex(tree, 'alpha png', { maxResults: 10 });
    expect(q.items.length).toBeGreaterThan(0);
    expect(q.items.some((i: { name?: string }) => /alpha/i.test(String(i.name)))).toBe(true);
  });

  it('persists via indexd and hydrates without meta', async () => {
    await ensureIndexed(tree, {
      rebuild: true,
      leanMemory: true,
      persist: true,
      waitDebt: true,
      waitPersist: true,
      liveFollowers: false,
      maxDepth: 4,
      maxScan: 10_000,
      indexBackend: 'native',
      walkEngine: 'js',
    });
    await flushIndexDisk(tree, { forceCompact: true });
    disposeVolumeIndex(tree);

    await ensureIndexed(tree, {
      rebuild: false,
      leanMemory: true,
      hydrateFirst: true,
      liveFollowers: false,
      waitRefresh: false,
      indexBackend: 'native',
      walkEngine: 'js',
    });
    const st = indexStatus(tree);
    expect(st.backend).toBe('native');
    expect(st.metaSize).toBe(0);
    expect(st.size).toBeGreaterThanOrEqual(3);
    expect(String(st.source)).toMatch(/hydrate|disk/);
    const q = await queryIndex(tree, 'alpha', { maxResults: 10 });
    expect(q.items.length).toBeGreaterThan(0);
  });
});

describe('js backend still default for small trees', () => {
  let tree: string;
  let idxDir: string;

  beforeEach(async () => {
    delete process.env.AURORA_INDEX_BACKEND;
    tree = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-js-tree-'));
    idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-js-idx-'));
    configureIndexDir(idxDir);
    resetIndexPrefsCache();
    await saveIndexPrefs({ maxScan: 50_000, excludeNames: [] });
    await fs.writeFile(path.join(tree, 'hello.txt'), 'hi');
  });

  afterEach(() => {
    disposeVolumeIndex(tree);
  });

  it('uses js when backend forced off', async () => {
    await ensureIndexed(tree, {
      rebuild: true,
      leanMemory: true,
      persist: false,
      liveFollowers: false,
      maxDepth: 3,
      indexBackend: 'js',
      walkEngine: 'js',
    });
    const st = indexStatus(tree);
    expect(st.backend).toBe('js');
    expect(st.size).toBeGreaterThanOrEqual(1);
  });
});
