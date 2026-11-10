/**
 * 分组 / 文件夹置顶 — 硬契约 + 边缘覆盖
 */
import { describe, expect, it } from 'vitest';
import type { FSNode } from './fs';
import {
  browseRowsFromItems,
  filterByCategories,
  foldersFirstStable,
  groupByCategory,
  matchesTypeToken,
  nodeCategoryKey,
  presentChipCategories,
} from './groupItems';
import {
  assertBrowseRowsFolderBlock,
  assertFolderSectionExclusive,
  assertNoFolderFileInterleave,
  assertRequiresBothKindsAndPartitioned,
  assertStableWithinKind,
  kindSlot,
} from './searchGroup.contract';

function file(name: string, id = name, extra: Partial<FSNode> = {}): FSNode {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : undefined;
  return {
    id, name, kind: 'file', parentId: 'd', childrenIds: [], ext,
    size: 1, createdAt: 0, modifiedAt: 0, accessedAt: 0, tags: [], ...extra,
  };
}

function folder(name: string, id = name, extra: Partial<FSNode> = {}): FSNode {
  return {
    id, name, kind: 'folder', parentId: 'd', childrenIds: [],
    size: 0, createdAt: 0, modifiedAt: 0, accessedAt: 0, tags: [], ...extra,
  };
}

function drive(name: string, id = name): FSNode {
  return {
    id, name, kind: 'drive', parentId: 'pc', childrenIds: [],
    size: 0, createdAt: 0, modifiedAt: 0, accessedAt: 0, tags: [],
    drive: { label: name, total: 1, used: 0, format: 'NTFS' },
  };
}

function special(name: string, id = name): FSNode {
  return {
    id, name, kind: 'special', parentId: 'root', childrenIds: [],
    size: 0, createdAt: 0, modifiedAt: 0, accessedAt: 0, tags: [],
  };
}

describe('CONTRACT foldersFirstStable', () => {
  it('empty / singleton / same-kind return identity (no alloc churn)', () => {
    expect(foldersFirstStable([])).toEqual([]);
    const one = [file('a.png')];
    expect(foldersFirstStable(one)).toBe(one);
    const onlyF = [folder('A'), folder('B')];
    expect(foldersFirstStable(onlyF)).toBe(onlyF);
    const onlyFile = [file('a.png'), file('b.pdf')];
    expect(foldersFirstStable(onlyFile)).toBe(onlyFile);
  });

  it('extreme interleave F f F f F f → all folders then all files, stable', () => {
    const input = [
      folder('A', 'A'), file('1.png', '1'),
      folder('B', 'B'), file('2.pdf', '2'),
      folder('C', 'C'), file('3.zip', '3'),
    ];
    const out = foldersFirstStable(input);
    assertRequiresBothKindsAndPartitioned(out);
    assertStableWithinKind(input, out);
    expect(out.map((n) => n.id)).toEqual(['A', 'B', 'C', '1', '2', '3']);
  });

  it('leading files then folders still partitions', () => {
    const input = [file('z.png'), file('y.pdf'), folder('A'), folder('B')];
    const out = foldersFirstStable(input);
    assertRequiresBothKindsAndPartitioned(out);
    assertStableWithinKind(input, out);
    expect(out.map((n) => n.id)).toEqual(['A', 'B', 'z.png', 'y.pdf']);
  });

  it('drive + special count as folder side', () => {
    const input = [file('a.png'), drive('C:', 'C:'), special('桌面', 'desktop'), file('b.pdf')];
    const out = foldersFirstStable(input);
    assertRequiresBothKindsAndPartitioned(out);
    expect(out.slice(0, 2).every((n) => kindSlot(n) === 'folder')).toBe(true);
    expect(nodeCategoryKey(drive('C:', 'C:'))).toBe('folder');
    expect(nodeCategoryKey(special('桌面', 'desktop'))).toBe('folder');
  });

  it('unicode / duplicate display names keep distinct ids and stability', () => {
    const input = [
      file('图.png', 'f1'),
      folder('图', 'd1'),
      file('图.png', 'f2'),
      folder('图', 'd2'),
    ];
    const out = foldersFirstStable(input);
    assertStableWithinKind(input, out);
    expect(out.map((n) => n.id)).toEqual(['d1', 'd2', 'f1', 'f2']);
  });

  it('INDEX CONTRACT: omitted kind means file — must still partition (regresses D: cache mix)', () => {
    // fsIndex.upsert 会 delete kind==='file'；旧 foldersFirstStable 用 kind==='file' 导致 files=[] 原样返回
    const mkOmitting = (id: string, name: string): FSNode => {
      const n = file(name, id);
      delete (n as { kind?: string }).kind;
      return n;
    };
    const input = [mkOmitting('a', 'a.wav'), folder('B', 'B'), mkOmitting('c', 'c.py'), folder('D', 'D')];
    const out = foldersFirstStable(input);
    assertRequiresBothKindsAndPartitioned(out);
    expect(out.map((n) => n.id)).toEqual(['B', 'D', 'a', 'c']);
  });
});

describe('CONTRACT filterByCategories', () => {
  const pool = [
    folder('Dir'),
    file('a.png'),
    file('b.pdf'),
    file('c.txt'),
    drive('D:', 'D:'),
  ];

  it('undefined/empty/null filter → passthrough', () => {
    expect(filterByCategories(pool, undefined)).toBe(pool);
    expect(filterByCategories(pool, null)).toEqual(pool);
    expect(filterByCategories(pool, []).length).toBe(pool.length);
  });

  it('default keepFolders=false drops folder AND drive', () => {
    const out = filterByCategories(pool, ['image']);
    expect(out.every((n) => n.kind === 'file')).toBe(true);
    expect(out.map((n) => n.name)).toEqual(['a.png']);
  });

  it('keepFolders=true retains folder+drive but never other categories', () => {
    const out = filterByCategories(pool, ['pdf'], { keepFolders: true });
    expect(out.map((n) => n.id).sort()).toEqual(['D:', 'Dir', 'b.pdf'].sort());
    expect(out.some((n) => n.name === 'a.png')).toBe(false);
  });

  it('multi-category filter is AND of membership (union of wanted cats)', () => {
    const out = filterByCategories(pool, ['image', 'pdf']);
    expect(out.map((n) => n.name).sort()).toEqual(['a.png', 'b.pdf']);
  });

  it('unknown category → empty when no keepFolders', () => {
    expect(filterByCategories(pool, ['font'] as never)).toEqual([]);
  });
});

describe('CONTRACT groupByCategory / browseRows', () => {
  it('every folder lives only in folder section — never leaks into type sections', () => {
    const items = [
      folder('A'), folder('B'),
      file('a.png'), file('b.pdf'), file('c.docx'), file('d.mp3'),
      drive('E:', 'E:'), special('回收站', 'trash'),
    ];
    const sections = groupByCategory(items);
    assertFolderSectionExclusive(sections);
    expect(sections[0]?.key).toBe('folder');
    expect(sections.find((s) => s.key === 'folder')!.items).toHaveLength(4);
  });

  it('browseRows flat mode preserves input order exactly', () => {
    const items = [file('z.png'), folder('A'), file('a.pdf')];
    const rows = browseRowsFromItems(items, false);
    expect(rows.every((r) => r.t === 'item')).toBe(true);
    expect(rows.map((r) => (r as { node: FSNode }).node.id)).toEqual(['z.png', 'A', 'a.pdf']);
  });

  it('browseRows grouped: folder block then types; collapse drops items only', () => {
    const items = [file('a.png'), folder('D'), file('b.pdf'), folder('E')];
    const rows = browseRowsFromItems(items, true, ['image']);
    assertBrowseRowsFolderBlock(rows);
    const headers = rows.filter((r) => r.t === 'header');
    expect(headers.map((h) => h.key)).toEqual(['folder', 'image', 'pdf']);
    const imageHdr = headers.find((h) => h.key === 'image')!;
    expect(imageHdr.collapsed).toBe(true);
    expect(rows.filter((r) => r.t === 'item').map((r) => (r as { node: FSNode }).node.id))
      .toEqual(['D', 'E', 'b.pdf']);
  });

  it('empty items → empty sections / rows', () => {
    expect(groupByCategory([])).toEqual([]);
    expect(browseRowsFromItems([], true)).toEqual([]);
    expect(browseRowsFromItems([], false)).toEqual([]);
  });
});

describe('CONTRACT presentChipCategories / matchesTypeToken edges', () => {
  it('chips never include folder; order follows CHIP_ORDER not discovery order', () => {
    const chips = presentChipCategories([
      file('z.zip'), file('a.png'), folder('F'), file('m.mp3'), file('x.pdf'),
    ]);
    expect(chips).toEqual(['image', 'pdf', 'audio', 'archive']);
    expect(chips.includes('folder' as never)).toBe(false);
  });

  it('type token: empty/whitespace always true; folders never match type', () => {
    expect(matchesTypeToken(file('a.png'), '')).toBe(true);
    expect(matchesTypeToken(file('a.png'), '  ')).toBe(true);
    expect(matchesTypeToken(folder('F'), 'image')).toBe(false);
    expect(matchesTypeToken(folder('F'), 'png')).toBe(false);
    expect(matchesTypeToken(file('a.PNG'), '.png')).toBe(true);
  });
});

describe('CONTRACT composed: foldersFirst then groupBy never interleaves', () => {
  it('pipeline used by deep search UI', () => {
    const ranked = [
      file('1.png'), folder('A'), file('2.pdf'), folder('B'), file('3.docx'),
    ];
    const ordered = foldersFirstStable(ranked);
    assertNoFolderFileInterleave(ordered);
    const sections = groupByCategory(ordered);
    assertFolderSectionExclusive(sections);
    const rows = browseRowsFromItems(ordered, true);
    assertBrowseRowsFolderBlock(rows);
  });
});
