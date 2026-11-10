import { describe, expect, it } from 'vitest';
import { clearMediaThumbCache, mediaThumbCacheSize } from './mediaThumb';

describe('mediaThumb cache', () => {
  it('clear empties LRU', () => {
    clearMediaThumbCache();
    expect(mediaThumbCacheSize()).toBe(0);
  });
});
