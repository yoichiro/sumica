// Compute the new selection Set when the user Shift+clicks a gallery tile.
// The "anchor" is the tile whose select checkbox was last clicked; the
// "target" is the tile whose checkbox is being Shift+clicked now. Returns the
// existing selection plus every id between anchor and target (inclusive), in
// the order they appear in `displayIds`. Direction-agnostic: anchor may be
// before or after target in the array. Returns `null` when either endpoint
// isn't in `displayIds` — the caller should fall back to a plain single
// toggle in that case.
export function computeRangeSelectionAdd(
  anchorId: string,
  targetId: string,
  displayIds: readonly string[],
  currentSelection: ReadonlySet<string>,
): Set<string> | null {
  const anchorIdx = displayIds.indexOf(anchorId);
  const targetIdx = displayIds.indexOf(targetId);
  if (anchorIdx === -1 || targetIdx === -1) return null;

  const [lo, hi] = anchorIdx <= targetIdx
    ? [anchorIdx, targetIdx]
    : [targetIdx, anchorIdx];

  const next = new Set(currentSelection);
  for (let i = lo; i <= hi; i++) next.add(displayIds[i]);
  return next;
}
