// Pure ranking logic for the favorite-recipe feature. Given a set of
// rollup counters, produces a Top-N list sorted by the Wilson 95% CI
// lower bound of the binomial proportion (favs / total). Wilson lower
// bound is the standard "how do I rank things by percentage when sample
// sizes vary" trick — a 1/1 lucky-hit gets a much lower lower-bound than
// a 20/25 well-established recipe, so the ranking rewards evidence, not
// luck.

import type { NormalizedParams } from './rankingRollup';

export interface RankingRollup {
  hash: string;
  params: NormalizedParams;
  total: number;
  favs: number;
  updatedAt: number;
  version?: number;
}

export interface RankedRecipe extends RankingRollup {
  rate: number;
  wilson: number;
}

export function wilsonLower(favs: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = favs / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return (centre - spread) / denom;
}

export function rankRecipes(
  rollups: RankingRollup[],
  minSample = 3,
  topN = 10,
): RankedRecipe[] {
  return rollups
    .filter((r) => r.total >= minSample)
    .map((r) => ({
      ...r,
      rate: r.favs / r.total,
      wilson: wilsonLower(r.favs, r.total),
    }))
    .sort((a, b) => b.wilson - a.wilson || b.total - a.total)
    .slice(0, topN);
}
