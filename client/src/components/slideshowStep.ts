// Pure per-tick index selector for the lightbox slideshow. Extracted from the
// setInterval callback in App.tsx so the branching (sequential wrap vs. random
// pick with current-index exclusion) is unit-testable without mounting React.
//
// - Sequential mode: (currentIndex + 1) % totalCount — wraps at the end.
// - Random mode: pick uniformly from [0..totalCount) excluding currentIndex,
//   using a rejection-free bump: draw from totalCount-1 candidates, then
//   shift the pick past currentIndex if it collides.
// - Degenerate cases (totalCount <= 1): return currentIndex unchanged so the
//   caller can no-op on the "nothing to advance to" signal.
//
// `rand` is injected to let tests supply deterministic sequences.
export function nextSlideshowIndex(
  currentIndex: number,
  totalCount: number,
  randomMode: boolean,
  rand: () => number = Math.random,
): number {
  if (totalCount <= 1) return currentIndex;
  if (!randomMode) return (currentIndex + 1) % totalCount;
  const pick = Math.floor(rand() * (totalCount - 1));
  return pick >= currentIndex ? pick + 1 : pick;
}
