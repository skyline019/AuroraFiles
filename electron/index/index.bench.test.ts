/**
 * 轻量集成压测（临时树），CI 可跑；完整盘用 npm run test:index-bench
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  configureIndexDir,
  ensureIndexed,
  queryIndex,
  indexStatus,
  softRefresh,
  disposeVolumeIndex,
  noteFsChange,
  flushIndexDisk,
} from './fsIndex.mjs';
import { Metrics, gaugesFromStatus } from './metrics.mjs';

describe('index integration bench (temp disk)', () => {
  let tree: string;
  let idxDir: string;

  beforeEach(async () => {
    tree = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-itree-'));
    idxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurora-iidx-'));
    configureIndexDir(idxDir);
    await fs.mkdir(path.join(tree, 'docs'), { recursive: true });
    for (let i = 0; i < 120; i++) {
      await fs.writeFile(path.join(tree, 'docs', `note_${i}.md`), `n${i}`, 'utf8');
    }
    await fs.writeFile(path.join(tree, 'readme.txt'), 'hello report', 'utf8');
  });

  afterEach(async () => {
    disposeVolumeIndex(tree);
    await fs.rm(tree, { recursive: true, force: true });
    await fs.rm(idxDir, { recursive: true, force: true });
  });

  it('build → query → persist → hydrate → mutate softRefresh', async () => {
    const m = new Metrics('it');
    const endFull = m.start('full');
    await ensureIndexed(tree, { rebuild: true, maxDepth: 8, maxScan: 50_000 });
    endFull();

    const st1 = indexStatus(tree);
    expect(st1.ready).toBe(true);
    expect(st1.size).toBeGreaterThan(100);
    Object.assign(m.gauges, gaugesFromStatus(st1));

    const endQ = m.start('query');
    const res = await queryIndex(tree, 'note_', { maxResults: 50 });
    endQ();
    expect(res.items.length).toBeGreaterThan(0);

    await flushIndexDisk(tree, { forceCompact: true });
    disposeVolumeIndex(tree);

    const endH = m.start('hydrate');
    await ensureIndexed(tree, { maxDepth: 8, maxScan: 50_000 });
    endH();
    expect(indexStatus(tree).size).toBeGreaterThan(100);

    const add = path.join(tree, 'docs', 'external_hit.md');
    await fs.writeFile(add, 'x', 'utf8');
    const st = await fs.stat(add);
    noteFsChange(tree, add, {
      path: add,
      name: 'external_hit.md',
      kind: 'file',
      size: st.size,
      modifiedAt: st.mtimeMs,
      frn: st.ino != null ? String(st.ino) : undefined,
    });
    await softRefresh(tree);
    const hit = await queryIndex(tree, 'external_hit', { maxResults: 20 });
    expect(hit.items.some((i) => i.path.toLowerCase().includes('external_hit'))).toBe(true);

    const report = m.report();
    expect(report.timings.full!.avg).toBeGreaterThan(0);
    expect(report.timings.query!.avg).toBeGreaterThanOrEqual(0);
    // 指标可序列化
    expect(JSON.stringify(report).length).toBeGreaterThan(50);
  }, 60_000);
});
