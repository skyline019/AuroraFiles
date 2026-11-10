import { describe, expect, it } from 'vitest';
import type { FSNode } from './fs';
import {
  browseRowsFromItems,
  filterByCategories,
  flattenGrouped,
  foldersFirstStable,
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

  it('drops folders by default so chips are not polluted', () => {
    const out = filterByCategories(items, ['image']);
    expect(out.map((n) => n.name)).toEqual(['a.png']);
  });

  it('can keep folders for grouped mode', () => {
    const out = filterByCategories(items, ['pdf'], { keepFolders: true });
    expect(out.map((n) => n.name).sort()).toEqual(['A', 'b.pdf']);
  });
});

describe('groupByCategory / flatten', () => {
  it('orders folder then image then pdf', () => {
    const items = [file('z.pdf'), file('a.png'), folder('Docs')];
    const sections = groupByCategory(items);
    expect(sections.map((s) => s.key)).toEqual(['folder', 'image', 'pdf']);
    expect(sections[0].label).toBe('文件夹');
  });

  it('puts all folders into a single folder section', () => {
    const items = [folder('A'), folder('B'), file('a.png'), file('b.pdf')];
    const sections = groupByCategory(items);
    const folderSec = sections.find((s) => s.key === 'folder')!;
    expect(folderSec.items.map((n) => n.name).sort()).toEqual(['A', 'B']);
    for (const s of sections) {
      if (s.key === 'folder') continue;
      expect(s.items.every((n) => n.kind === 'file')).toBe(true);
    }
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

describe('foldersFirstStable', () => {
  it('keeps folders before files without reshuffling within each kind', () => {
    const a = file('a.png');
    const b = folder('B');
    const c = file('c.pdf');
    const d = folder('D');
    // relevance-like interleaved input
    const out = foldersFirstStable([a, b, c, d]);
    expect(out.map((n) => n.name)).toEqual(['B', 'D', 'a.png', 'c.pdf']);
  });

  it('is a no-op when only one kind', () => {
    const onlyFiles = [file('a.png'), file('b.pdf')];
    expect(foldersFirstStable(onlyFiles)).toBe(onlyFiles);
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
