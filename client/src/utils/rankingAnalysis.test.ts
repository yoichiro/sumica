import { describe, it, expect } from 'vitest';
import { rankRecipes, type RankingRollup } from './rankingAnalysis';

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

function rollup(hash: string, total: number, favs: number, updatedAt = 0): RankingRollup {
  return { hash, params: { ...P, model: hash }, total, favs, updatedAt };
}

describe('rankRecipes', () => {
  it('filters out recipes with zero favorites', () => {
    const out = rankRecipes([rollup('a', 5, 0), rollup('b', 5, 1)]);
    expect(out.map((r) => r.hash)).toEqual(['b']);
  });

  it('sorts by favs desc; larger fav count comes first regardless of total', () => {
    // 'many-attempts': 100 attempts, 2 favs. 'few-attempts': 3 attempts, 3 favs.
    // Under Wilson, 'many-attempts' might have won on evidence; under ADR 35's
    // absolute-favs rule, 'few-attempts' wins because 3 keepers > 2 keepers.
    const out = rankRecipes([rollup('many-attempts', 100, 2), rollup('few-attempts', 3, 3)]);
    expect(out.map((r) => r.hash)).toEqual(['few-attempts', 'many-attempts']);
  });

  it('tie-breaks equal fav counts by updatedAt desc (recent activity wins)', () => {
    const out = rankRecipes([
      rollup('older', 10, 3, 100),
      rollup('newer', 10, 3, 200),
    ]);
    expect(out.map((r) => r.hash)).toEqual(['newer', 'older']);
  });

  it('caps the output length at topN', () => {
    const many = Array.from({ length: 15 }, (_, i) => rollup(`r${i}`, 5, i + 1));
    const out = rankRecipes(many, 10);
    expect(out).toHaveLength(10);
  });

  it('handles empty input', () => {
    expect(rankRecipes([])).toEqual([]);
  });

  it('does not crash on rollups with 0 total (they are filtered by fav=0 anyway)', () => {
    expect(rankRecipes([rollup('x', 0, 0)])).toEqual([]);
  });

  it('applies default topN=10 when omitted', () => {
    const many = Array.from({ length: 15 }, (_, i) => rollup(`r${i}`, 5, i + 1));
    const out = rankRecipes(many);
    expect(out).toHaveLength(10);
  });

  it('does not mutate the input array', () => {
    const input: RankingRollup[] = [rollup('a', 5, 1, 100), rollup('b', 5, 3, 200)];
    const snapshot = [...input];
    rankRecipes(input);
    expect(input).toEqual(snapshot);
  });
});
