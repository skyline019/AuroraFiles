import { describe, expect, it } from 'vitest';
import { sortNodes, type FSNode } from './fs';

function file(id: string, name: string, size = 1): FSNode {
  const now = 1;
  return {
    id, name, kind: 'file', parentId: 'root', childrenIds: [], size,
    createdAt: now, modifiedAt: now, accessedAt: now, tags: [],
  };
}

describe('sortNodes', () => {
  it('sorts by name with numeric awareness', () => {
    const nodes: Record<string, FSNode> = {};
    const list = [file('a', 'file_10.txt'), file('b', 'file_2.txt'), file('c', 'file_1.txt')];
    for (const n of list) nodes[n.id] = n;
    const sorted = sortNodes(nodes, list, 'name', 'asc').map((n) => n.name);
    expect(sorted).toEqual(['file_1.txt', 'file_2.txt', 'file_10.txt']);
  });

  it('size sort does not explode on many folders', () => {
    const nodes: Record<string, FSNode> = {
      root: {
        id: 'root', name: '', kind: 'folder', parentId: null, childrenIds: [],
        size: 0, createdAt: 1, modifiedAt: 1, accessedAt: 1, tags: [],
      },
    };
    const list: FSNode[] = [];
    for (let i = 0; i < 200; i++) {
      const id = `f${i}`;
      const n: FSNode = {
        id, name: `folder_${i}`, kind: 'folder', parentId: 'root', childrenIds: [],
        size: 0, createdAt: 1, modifiedAt: 1, accessedAt: 1, tags: [],
      };
      nodes[id] = n;
      nodes.root.childrenIds.push(id);
      list.push(n);
    }
    const t0 = performance.now();
    sortNodes(nodes, list, 'size', 'asc');
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
