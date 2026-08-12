import { describe, expect, it } from 'vitest';
import { collectVideoParentCounts } from './videoParentIndex';

describe('collectVideoParentCounts', () => {
  it('counts videos grouped by parentId', () => {
    const counts = collectVideoParentCounts([
      { mediaType: 'video', parentId: 'a' },
      { mediaType: 'video', parentId: 'b' },
      { mediaType: 'video', parentId: 'a' },
    ]);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.size).toBe(2);
  });

  it('ignores non-video records (including legacy undefined mediaType)', () => {
    const counts = collectVideoParentCounts([
      { mediaType: 'image', parentId: 'a' },
      { mediaType: 'video', parentId: 'a' },
      { mediaType: undefined, parentId: 'a' },
      { mediaType: null, parentId: 'a' },
    ]);
    expect(counts.get('a')).toBe(1);
    expect(counts.size).toBe(1);
  });

  it('ignores video records without a usable parentId', () => {
    const counts = collectVideoParentCounts([
      { mediaType: 'video', parentId: undefined },
      { mediaType: 'video', parentId: null },
      { mediaType: 'video', parentId: '' },
      { mediaType: 'video', parentId: 'a' },
    ]);
    expect(counts.get('a')).toBe(1);
    expect(counts.size).toBe(1);
  });

  it('returns an empty map for an empty input', () => {
    expect(collectVideoParentCounts([]).size).toBe(0);
  });
});
