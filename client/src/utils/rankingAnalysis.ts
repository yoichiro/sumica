// Pure ranking logic for the favorite-recipe feature. Given a set of
// rollup counters, produces a Top-N list sorted by absolute favorite
// count (favs) in descending order.
//
// ADR 35 supersedes the earlier Wilson-lower-bound approach: in Sumica's
// actual workflow, users generate large batches speculatively ("throw
// stuff at the wall") and star only the ones they like, so `total`
// (attempt count) mostly reflects patience, not recipe quality. Only
// `favs` measures how many keepers a recipe has produced, which is what
// the user cares about. Ties break by `updatedAt` desc so the most
// recently favorited recipe surfaces first among equals.

import type { NormalizedParams } from './rankingRollup';

export interface RankingRollup {
  hash: string;
  params: NormalizedParams;
  total: number;
  favs: number;
  updatedAt: number;
  version?: number;
}

export type RankedRecipe = RankingRollup;

export function rankRecipes(
  rollups: RankingRollup[],
  topN = 10,
): RankedRecipe[] {
  return rollups
    .filter((r) => r.favs >= 1)
    .slice()
    .sort((a, b) => b.favs - a.favs || b.updatedAt - a.updatedAt)
    .slice(0, topN);
}
