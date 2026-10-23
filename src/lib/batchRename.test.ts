import { describe, expect, it } from 'vitest';
import { applyBatchName } from './batchRename';

describe('applyBatchName', () => {
  const now = new Date('2026-10-23T12:00:00');

  it('sequences with padding', () => {
    expect(applyBatchName('a.png', 0, { preset: 'sequence', start: 1 }, now)).toBe('a-001.png');
    expect(applyBatchName('a.png', 9, { preset: 'sequence', start: 1 }, now)).toBe('a-010.png');
  });

  it('adds date prefix', () => {
    expect(applyBatchName('shot.jpg', 0, { preset: 'datePrefix' }, now)).toBe('20261023_shot.jpg');
  });

  it('replaces substring', () => {
    expect(applyBatchName('IMG_001.JPG', 0, { preset: 'replace', find: 'IMG_', replaceWith: 'Photo_' }, now))
      .toBe('Photo_001.JPG');
  });

  it('supports custom pattern tokens', () => {
    expect(applyBatchName('doc.txt', 2, { preset: 'sequence', pattern: '{date}-{name}-{n}{ext}' }, now))
      .toBe('20261023-doc-003.txt');
  });
});
