import { describe, it, expect } from 'vitest';
import { wilsonLower, rankRecipes, type RankingRollup } from './rankingAnalysis';

const P = {
  model: 'm',
  sampler: '',
  scheduler: '',
  size: '',
  steps: 0,
  cfg: 0,
  hires: false,
  hiresUpscaler: '',
  hiresScale: 0,
  hiresSteps: 0,
  hiresDenoising: 0,
  loras: [],
  refiner: '',
  refinerSwitchAt: 0,
  vae: '',
};

function rollup(hash: string, total: number, favs: number): RankingRollup {
  return { hash, params: { ...P, model: hash }, total, favs, updatedAt: 0 };
}

describe('wilsonLower', () => {
  it('returns 0 for total=0', () => {
    expect(wilsonLower(0, 0)).toBe(0);
  });

  it('approximates known values for 5/7 (~0.359)', () => {
    expect(wilsonLower(5, 7)).toBeGreaterThan(0.35);
    expect(wilsonLower(5, 7)).toBeLessThan(0.37);
  });

  it('approximates known values for 20/25 (~0.61) — larger sample is closer to raw rate', () => {
    // Wilson lower ~ 0.61; raw rate = 0.80
    expect(wilsonLower(20, 25)).toBeGreaterThan(0.60);
    expect(wilsonLower(20, 25)).toBeLessThan(0.63);
  });

  it('penalises singleton wins (1/1) — Wilson << 1.0', () => {
    expect(wilsonLower(1, 1)).toBeLessThan(0.3);
  });

  it('is monotonic non-decreasing when adding a fav without adding a loss', () => {
    expect(wilsonLower(6, 10)).toBeGreaterThan(wilsonLower(5, 10));
  });
});

describe('rankRecipes', () => {
  it('filters out entries below minSample', () => {
    const out = rankRecipes([rollup('a', 2, 1), rollup('b', 5, 1)], 3, 10);
    expect(out.map((r) => r.hash)).toEqual(['b']);
  });

  it('sorts by wilson descending; tie-break by total descending', () => {
    // Both have wilson 0 (favs=0), so tie-break puts higher total first
    const out = rankRecipes([rollup('small', 3, 0), rollup('big', 10, 0)], 3, 10);
    expect(out.map((r) => r.hash)).toEqual(['big', 'small']);
  });

  it('caps the output length at topN', () => {
    const many = Array.from({ length: 15 }, (_, i) => rollup(`r${i}`, 5, i));
    const out = rankRecipes(many, 3, 10);
    expect(out).toHaveLength(10);
  });

  it('includes rate and wilson on every row', () => {
    const out = rankRecipes([rollup('a', 4, 2)], 3, 10);
    expect(out[0]).toMatchObject({ total: 4, favs: 2, rate: 0.5 });
    expect(typeof out[0].wilson).toBe('number');
  });

  it('handles empty input', () => {
    expect(rankRecipes([], 3, 10)).toEqual([]);
  });

  it('does not crash on rollup with 0 total (filtered out by minSample)', () => {
    expect(rankRecipes([rollup('x', 0, 0)], 3, 10)).toEqual([]);
  });

  it('applies default minSample=3 and topN=10 when omitted', () => {
    const out = rankRecipes([rollup('a', 2, 1), rollup('b', 3, 1)]);
    expect(out.map((r) => r.hash)).toEqual(['b']);
  });
});
