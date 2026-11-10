/**
 * presentDeepHits 硬契约：筛选 × 置顶 × 边缘
 */
import { describe, expect, it } from 'vitest';
import type { FSNode, TabState } from './fs';
import { presentDeepHits } from './store';
import { browseRowsFromItems, foldersFirstStable } from './groupItems';
import {
  assertBrowseRowsFolderBlock,
  assertFolderSectionExclusive,
  assertNoFolderFileInterleave,
  assertRequiresBothKindsAndPartitioned,
  assertStableWithinKind,
  kindSlot,
} from './searchGroup.contract';
import { groupByCategory } from './groupItems';

function file(id: string, name: string, extra: Partial<FSNode> = {}): FSNode {
  return {
    id, name, kind: 'file', parentId: 'd', childrenIds: [],
    ext: name.includes('.') ? name.split('.').pop()!.toLowerCase() : undefined,
    size: 1, createdAt: 0, modifiedAt: 0, accessedAt: 0, tags: [], ...extra,
  };
}

function folder(id: string, name: string, extra: Partial<FSNode> = {}): FSNode {
  return {
    id, name, kind: 'folder', parentId: 'd', childrenIds: [],
    size: 0, createdAt: 0, modifiedAt: 0, accessedAt: 0, tags: [], ...extra,
  };
}

function tab(patch: Partial<TabState> = {}): TabState {
  return {
    id: 't',
    history: [{ t: 'node', id: 'd' }],
    hi: 0,
    view: 'list',
    sortKey: 'name',
    sortDir: 'asc',
    iconSize: 76,
    selection: [],
    renaming: null,
    search: '图',
    showHidden: false,
    galleryFilesOnly: true,
    categoryFilter: [],
    groupByCategory: false,
    collapsedCategories: [],
    ...patch,
  };
}

describe('CONTRACT presentDeepHits', () => {
  it('empty hits / missing ids / deleted → empty or skip', () => {
    const nodes: Record<string, FSNode> = {
      a: file('a', '图.png'),
      gone: { ...file('gone', '图-gone.png'), deleted: true },
    };
    expect(presentDeepHits(nodes, [], tab())).toEqual([]);
    expect(presentDeepHits(nodes, ['missing', 'gone'], tab()).map((n) => n.id)).toEqual([]);
    expect(presentDeepHits(nodes, ['a', 'missing', 'gone'], tab()).map((n) => n.id)).toEqual(['a']);
  });

  it('interleaved relevance → folders first; stable within kind', () => {
    const nodes: Record<string, FSNode> = {
      a: file('a', '图-a.png'),
      b: folder('b', '图库'),
      c: file('c', '图-c.pdf'),
      d: folder('d', '图纸'),
      e: file('e', '图-e.docx'),
    };
    const hits = ['a', 'b', 'c', 'd', 'e'];
    const ranked = hits.map((id) => nodes[id]);
    const out = presentDeepHits(nodes, hits, tab());
    assertRequiresBothKindsAndPartitioned(out);
    assertStableWithinKind(ranked, out);
    expect(out.map((n) => n.id)).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('hidden files stripped unless showHidden', () => {
    const nodes: Record<string, FSNode> = {
      a: file('a', '图.png'),
      h: file('h', '图-hidden.png', { hidden: true }),
      f: folder('f', '图库'),
    };
    expect(presentDeepHits(nodes, ['a', 'h', 'f'], tab({ showHidden: false })).map((n) => n.id))
      .toEqual(['f', 'a']);
    expect(presentDeepHits(nodes, ['a', 'h', 'f'], tab({ showHidden: true })).map((n) => n.id))
      .toEqual(['f', 'a', 'h']);
  });

  it('type: token drops non-matching files; folders never match type alone', () => {
    const nodes: Record<string, FSNode> = {
      a: file('a', '图.png'),
      b: folder('b', '图库'),
      c: file('c', '图.pdf'),
    };
    // search embeds type: — presentDeepHits parses tab.search
    const out = presentDeepHits(nodes, ['a', 'b', 'c'], tab({ search: 'type:pdf' }));
    // folders don't match type token → only pdf file
    expect(out.map((n) => n.id)).toEqual(['c']);
  });

  it('type: + text keeps folders that may still be in hit list only if they pass filters', () => {
    const nodes: Record<string, FSNode> = {
      a: file('a', '报告.png'),
      b: folder('b', '报告集'),
      c: file('c', '报告.pdf'),
    };
    // type:pdf filters files; folder fails matchesTypeToken → dropped
    const out = presentDeepHits(nodes, ['a', 'b', 'c'], tab({ search: 'type:pdf 报告' }));
    expect(out.map((n) => n.id)).toEqual(['c']);
  });

  it('categoryFilter without groupBy drops folders (chip contract)', () => {
    const nodes: Record<string, FSNode> = {
      a: file('a', '图.png'),
      b: folder('b', '图库'),
      c: file('c', '图.pdf'),
    };
    const out = presentDeepHits(nodes, ['a', 'b', 'c'], tab({
      categoryFilter: ['image'],
      groupByCategory: false,
    }));
    expect(out.map((n) => n.id)).toEqual(['a']);
    expect(out.every((n) => n.kind === 'file')).toBe(true);
  });

  it('categoryFilter + groupBy keeps folders for exclusive folder section', () => {
    const nodes: Record<string, FSNode> = {
      a: file('a', '图.png'),
      b: folder('b', '图库'),
      c: file('c', '图.pdf'),
    };
    const out = presentDeepHits(nodes, ['a', 'b', 'c'], tab({
      categoryFilter: ['image'],
      groupByCategory: true,
    }));
    expect(out.map((n) => n.id)).toEqual(['b', 'a']);
    const sections = groupByCategory(out);
    assertFolderSectionExclusive(sections);
    const rows = browseRowsFromItems(out, true);
    assertBrowseRowsFolderBlock(rows);
  });

  it('only-files / only-folders hits stay unpartitioned identity-wise via foldersFirstStable', () => {
    const filesOnly = [file('a', 'a.png'), file('b', 'b.pdf')];
    const nodesF = Object.fromEntries(filesOnly.map((n) => [n.id, n]));
    const outF = presentDeepHits(nodesF, ['a', 'b'], tab({ search: 'a' }));
    // may filter by name via type? search 'a' has no type — filters only hidden/category
    expect(outF.map((n) => n.id)).toEqual(['a', 'b']);
    assertNoFolderFileInterleave(outF);

    const foldersOnly = [folder('a', '甲'), folder('b', '乙')];
    const nodesD = Object.fromEntries(foldersOnly.map((n) => [n.id, n]));
    const outD = presentDeepHits(nodesD, ['b', 'a'], tab({ search: 'x' }));
    expect(outD.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('pipeline: presentDeepHits → browseRows grouped satisfies block contract', () => {
    const nodes: Record<string, FSNode> = {
      a: file('a', '图.png'),
      b: folder('b', '图库'),
      c: file('c', '图.pdf'),
      d: folder('d', '图纸'),
      e: file('e', '图.docx'),
    };
    const out = presentDeepHits(nodes, ['a', 'b', 'c', 'd', 'e'], tab({ groupByCategory: true }));
    assertRequiresBothKindsAndPartitioned(out);
    expect(out.every((n, i, arr) => {
      if (kindSlot(n) === 'file') return arr.slice(0, i).every((x) => kindSlot(x) === 'folder' || kindSlot(x) === 'file');
      return true;
    })).toBe(true);
    assertBrowseRowsFolderBlock(browseRowsFromItems(out, true));
  });

  it('foldersFirstStable alone: single folder among many files', () => {
    const input = [
      file('1', '1.png'), file('2', '2.png'), folder('F', 'F'),
      file('3', '3.png'), file('4', '4.png'),
    ];
    const out = foldersFirstStable(input);
    assertRequiresBothKindsAndPartitioned(out);
    expect(out[0].id).toBe('F');
    assertStableWithinKind(input, out);
  });

  it('INDEX CONTRACT: nodes with omitted kind still folder-first via presentDeepHits', () => {
    const a = file('a', 'a.wav');
    const c = file('c', 'c.py');
    delete (a as { kind?: string }).kind;
    delete (c as { kind?: string }).kind;
    const nodes: Record<string, FSNode> = {
      a,
      b: folder('b', 'B'),
      c,
      d: folder('d', 'D'),
    };
    const out = presentDeepHits(nodes, ['a', 'b', 'c', 'd'], tab({ search: 'w' }));
    assertRequiresBothKindsAndPartitioned(out);
    expect(out.map((n) => n.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});
