/**
 * 日用边角烟测：布局框选 + 批重命名规则 + 索引结构联动契约
 */
import { describe, expect, it } from 'vitest';
import { computeGridMetrics, hitTestMarquee, totalGridHeight, visibleIndexRange } from './gridLayout';
import { applyBatchName } from './batchRename';
import { RbTree } from '../../shared/rbTree.mjs';
import { PathSkipList } from '../../shared/pathSkip.mjs';

describe('e2e smoke: grid selection after virtualization', () => {
  it('marquee still hits off-screen rows via geometry', () => {
    const m = computeGridMetrics(900, 64);
    const count = 2000;
    const ids = Array.from({ length: count }, (_, i) => `f-${i}`);
    // 滚到很下面
    const mid = visibleIndexRange(totalGridHeight(count, m) * 0.5, 400, count, m, 0);
    expect(mid.start).toBeGreaterThan(100);
    // 框选第 0 行（虚拟化后未挂载）仍应命中
    const first = hitTestMarquee(count, ids, { x: m.padding, y: m.padding, w: m.cellW * 2, h: m.cellH }, m);
    expect(first.length).toBeGreaterThan(0);
    expect(first[0]).toBe('f-0');
  });
});

describe('e2e smoke: batch rename + index update contract', () => {
  it('rename pattern then reindex by name tree', () => {
    const names = ['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg'].map((n, i) =>
      applyBatchName(n, i, { preset: 'datePrefix' }, new Date('2026-10-23')),
    );
    expect(names.every((n) => n.startsWith('20261023_'))).toBe(true);

    const tree = new RbTree();
    const skip = new PathSkipList();
    names.forEach((n) => {
      const p = `c:\\photos\\${n}`;
      tree.insert(`${n.toLowerCase()}\0${p}`, { path: p, name: n });
      skip.insert(p.toLowerCase(), { path: p, name: n });
    });
    const found = [...tree.rangeByPrefix('20261023')];
    expect(found).toHaveLength(3);
    expect([...skip.byPathPrefix('c:\\photos')]).toHaveLength(3);
  });
});
