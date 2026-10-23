import { describe, expect, it } from 'vitest';
import { RbTree } from './rbTree.mjs';
import { PathSkipList } from './pathSkip.mjs';

describe('RbTree', () => {
  it('inserts and prefix-ranges in order', () => {
    const t = new RbTree();
    t.insert('note.md\0a', { name: 'note.md' });
    t.insert('notes.txt\0b', { name: 'notes.txt' });
    t.insert('readme.md\0c', { name: 'readme.md' });
    t.insert('alpha.txt\0d', { name: 'alpha.txt' });
    const hits = [...t.rangeByPrefix('note')].map((x) => x.key.split('\0')[0]);
    expect(hits).toEqual(['note.md', 'notes.txt']);
  });

  it('contains matches name head only', () => {
    const t = new RbTree();
    t.insert('report.pdf\0c:\\users\\x\\report.pdf', { name: 'report.pdf' });
    t.insert('other.txt\0c:\\report\\other.txt', { name: 'other.txt' });
    const hits = [...t.contains('report')].map((x) => x.value.name);
    expect(hits).toContain('report.pdf');
    expect(hits).not.toContain('other.txt');
  });
});

describe('PathSkipList', () => {
  it('jumps to path prefix', () => {
    const s = new PathSkipList();
    s.insert('c:\\users\\a\\docs\\a.txt', { name: 'a.txt' });
    s.insert('c:\\users\\a\\docs\\b.txt', { name: 'b.txt' });
    s.insert('c:\\users\\a\\pics\\c.jpg', { name: 'c.jpg' });
    const docs = [...s.byPathPrefix('c:\\users\\a\\docs')];
    expect(docs).toHaveLength(2);
  });

  it('converges path segments', () => {
    const s = new PathSkipList();
    s.insert('c:\\users\\bob\\docs\\q1.xlsx', { name: 'q1.xlsx' });
    s.insert('c:\\users\\bob\\docs\\q2.xlsx', { name: 'q2.xlsx' });
    s.insert('c:\\users\\ann\\docs\\x.xlsx', { name: 'x.xlsx' });
    const hits = s.convergeSegments(['c:', 'users', 'bob', 'docs']);
    expect(hits.every((h) => h.key.includes('\\bob\\docs'))).toBe(true);
    expect(hits.length).toBe(2);
  });
});
