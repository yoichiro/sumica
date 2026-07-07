import { describe, it, expect } from 'vitest';
import { computeRangeSelectionAdd } from './rangeSelection';

describe('computeRangeSelectionAdd', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('adds all ids between anchor and target inclusive (forward direction)', () => {
    const next = computeRangeSelectionAdd('b', 'd', ids, new Set());
    expect(next).not.toBeNull();
    expect([...next!].sort()).toEqual(['b', 'c', 'd']);
  });

  it('adds all ids between anchor and target inclusive (backward direction)', () => {
    const next = computeRangeSelectionAdd('d', 'b', ids, new Set());
    expect(next).not.toBeNull();
    expect([...next!].sort()).toEqual(['b', 'c', 'd']);
  });

  it('preserves existing selections outside the range', () => {
    const current = new Set(['a', 'e']);
    const next = computeRangeSelectionAdd('b', 'c', ids, current);
    expect(next).not.toBeNull();
    expect([...next!].sort()).toEqual(['a', 'b', 'c', 'e']);
  });

  it('is a no-op logical add when the range already covers existing selections', () => {
    const current = new Set(['b', 'c']);
    const next = computeRangeSelectionAdd('a', 'd', ids, current);
    expect(next).not.toBeNull();
    expect([...next!].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('selects just one id when anchor equals target', () => {
    const next = computeRangeSelectionAdd('c', 'c', ids, new Set());
    expect(next).not.toBeNull();
    expect([...next!]).toEqual(['c']);
  });

  it('returns null when the anchor id is not in the display list', () => {
    const next = computeRangeSelectionAdd('missing', 'c', ids, new Set());
    expect(next).toBeNull();
  });

  it('returns null when the target id is not in the display list', () => {
    const next = computeRangeSelectionAdd('a', 'missing', ids, new Set());
    expect(next).toBeNull();
  });

  it('does not mutate the input selection Set', () => {
    const current = new Set(['a']);
    const next = computeRangeSelectionAdd('c', 'd', ids, current);
    expect(next).not.toBe(current);
    expect([...current]).toEqual(['a']);
  });

  it('returns the full range when anchor and target are the endpoints', () => {
    const next = computeRangeSelectionAdd('a', 'e', ids, new Set());
    expect(next).not.toBeNull();
    expect([...next!].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
