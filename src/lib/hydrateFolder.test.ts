import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./aurora', () => ({
  api: () => ({
    listDir: vi.fn(async () => [
      {
        path: 'E:\\Agent\\a',
        name: 'a',
        kind: 'folder',
        size: 0,
        createdAt: 1,
        modifiedAt: 2,
        accessedAt: 3,
      },
      {
        path: 'E:\\Agent\\b.txt',
        name: 'b.txt',
        kind: 'file',
        size: 10,
        createdAt: 1,
        modifiedAt: 2,
        accessedAt: 3,
        ext: 'txt',
      },
    ]),
    readTags: vi.fn(async () => []),
  }),
  isElectron: () => true,
  REAL_DEMO: '__demo__',
}));

import { hydrateFolder } from './realFs';
import type { FSNode } from './fs';

describe('hydrateFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('patches only touched keys (does not drop unrelated nodes)', async () => {
    const nodes: Record<string, FSNode> = {
      'E:\\Agent': {
        id: 'E:\\Agent',
        name: 'Agent',
        kind: 'folder',
        parentId: 'E:\\',
        childrenIds: [],
        size: 0,
        createdAt: 0,
        modifiedAt: 0,
        accessedAt: 0,
        tags: [],
      },
      'E:\\Other\\keep': {
        id: 'E:\\Other\\keep',
        name: 'keep',
        kind: 'file',
        parentId: 'E:\\Other',
        childrenIds: [],
        size: 1,
        createdAt: 0,
        modifiedAt: 0,
        accessedAt: 0,
        tags: [],
      },
    };
    const next = await hydrateFolder(nodes, 'E:\\Agent', false, null);
    expect(next['E:\\Other\\keep']).toBe(nodes['E:\\Other\\keep']);
    expect(next['E:\\Agent'].childrenIds).toContain('E:\\Agent\\a');
    expect(next['E:\\Agent\\b.txt'].kind).toBe('file');
  });
});
