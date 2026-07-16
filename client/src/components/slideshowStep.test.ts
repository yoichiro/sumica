import { describe, it, expect } from 'vitest';
import { nextSlideshowIndex } from './slideshowStep';

describe('nextSlideshowIndex', () => {
  it('advances by 1 in sequential mode', () => {
    expect(nextSlideshowIndex(0, 5, false)).toBe(1);
    expect(nextSlideshowIndex(3, 5, false)).toBe(4);
  });

  it('wraps to the first index at the end in sequential mode', () => {
    expect(nextSlideshowIndex(4, 5, false)).toBe(0);
  });

  it('returns the current index unchanged when totalCount <= 1', () => {
    // A slideshow with 0 or 1 items has nowhere to advance; the timer callback
    // treats an unchanged return as a no-op.
    expect(nextSlideshowIndex(0, 0, false)).toBe(0);
    expect(nextSlideshowIndex(0, 1, false)).toBe(0);
    expect(nextSlideshowIndex(0, 1, true)).toBe(0);
  });

  it('never returns the current index in random mode (boundary rand=0)', () => {
    // rand=0 → pick=0. If current=2, pick(0) < current(2) so returned as-is.
    expect(nextSlideshowIndex(2, 5, true, () => 0)).toBe(0);
  });

  it('bumps past the current index in random mode when rand collides', () => {
    // rand=0.5 → pick=Math.floor(0.5*4)=2. current=2 collides → returns 2+1=3.
    expect(nextSlideshowIndex(2, 5, true, () => 0.5)).toBe(3);
  });

  it('returns the last index in random mode at the top of the range', () => {
    // rand=0.99 → pick=Math.floor(0.99*4)=3. current=2, pick(3) >= current(2) → returns 4.
    expect(nextSlideshowIndex(2, 5, true, () => 0.99)).toBe(4);
  });

  it('excludes the current index across many random draws', () => {
    // Sample 100 pseudo-random ticks and verify current is never re-picked.
    let seed = 1;
    const prng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 100; i++) {
      const next = nextSlideshowIndex(3, 10, true, prng);
      expect(next).not.toBe(3);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(10);
    }
  });
});
