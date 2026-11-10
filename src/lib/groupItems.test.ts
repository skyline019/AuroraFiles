import { describe, expect, it } from 'vitest';
import type { FSNode } from './fs';
import {
  browseRowsFromItems,
  filterByCategories,
  flattenGrouped,
  groupByCategory,
  matchesTypeToken,
  presentChipCategories,
} from './groupItems';

function file(name: string, id = name): FSNode {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : undefined;
  return {
    id,
    name,
    kind: 'file',
    parentId: 'd',
    childrenIds: [],
    ext,
    size: 1,
    createdAt: 0,
    modifiedAt: 0,
    accessedAt: 0,
    tags: [],
  };
}

function folder(name: string, id = name): FSNode {
  return {
    id,
    name,
    kind: 'folder',
    parentId: 'd',
    childrenIds: [],
    size: 0,
    createdAt: 0,
    modifiedAt: 0,
    accessedAt: 0,
    tags: [],
  };
}

describe('filterByCategories', () => {
  const items = [folder('A'), file('a.png'), file('b.pdf'), file('c.txt')];

  it('empty filter keeps all', () => {
    expect(filterByCategories(items, []).length).toBe(4);
    expect(filterByCategories(items, null as unknown as []).length).toBe(4);
  });

  it('keeps folders and matching files', () => {
    const out = filterByCategories(items, ['image']);
    expect(out.map((n) => n.name).sort()).toEqual(['A', 'a.png']);
  });

  it('can drop folders', () => {
    const out = filterByCategories(items, ['pdf'], { keepFolders: false });
    expect(out.map((n) => n.name)).toEqual(['b.pdf']);
  });
});

describe('groupByCategory / flatten', () => {
  it('orders folder then image then pdf', () => {
    const items = [file('z.pdf'), file('a.png'), folder('Docs')];
    const sections = groupByCategory(items);
    expect(sections.map((s) => s.key)).toEqual(['folder', 'image', 'pdf']);
    expect(sections[0].label).toBe('文件夹');
  });

  it('flatten omits items when collapsed', () => {
    const sections = groupByCategory([file('a.png'), file('b.png'), folder('D')]);
    const rows = flattenGrouped(sections, new Set(['image']));
    expect(rows.filter((r) => r.t === 'header').length).toBe(2);
    expect(rows.filter((r) => r.t === 'item').map((r) => (r as { node: FSNode }).node.name)).toEqual(['D']);
  });

  it('browseRowsFromItems flat mode', () => {
    const items = [file('a.png')];
    expect(browseRowsFromItems(items, false)).toEqual([{ t: 'item', node: items[0] }]);
  });
});

describe('presentChipCategories', () => {
  it('only returns categories present, in chip order', () => {
    const chips = presentChipCategories([file('a.zip'), file('b.png'), folder('F')]);
    expect(chips).toEqual(['image', 'archive']);
  });
});

describe('matchesTypeToken', () => {
  it('matches extension and aliases', () => {
    expect(matchesTypeToken(file('x.pdf'), 'pdf')).toBe(true);
    expect(matchesTypeToken(file('x.png'), '图片')).toBe(true);
    expect(matchesTypeToken(file('x.png'), 'doc')).toBe(false);
    expect(matchesTypeToken(folder('F'), 'pdf')).toBe(false);
  });
});
