// Aggregator: given a bag of records, build a Map<parentId, count> of how
// many mediaType='video' records point at each parent image. Isolated as a
// pure function so both the Firebase subscription callback and the local
// (signed-out) mode's in-memory history can feed it, and so the gallery
// badge behavior is unit-testable without spinning up Firestore.
export function collectVideoParentCounts(
  records: ReadonlyArray<{ mediaType?: string | null; parentId?: string | null }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (r.mediaType !== 'video') continue;
    if (typeof r.parentId !== 'string' || r.parentId.length === 0) continue;
    counts.set(r.parentId, (counts.get(r.parentId) ?? 0) + 1);
  }
  return counts;
}
