// Filename generator + browser download trigger for saving generated images
// from the Lightbox. Split into a pure function (unit tested) and a DOM
// side-effect function (not unit tested — same pattern as `utils/thumbnail.ts`).

// Build a "sumica_YYYYMMDD_HHMMSS.png" filename from a unix millisecond
// timestamp, always rendered in JST (UTC+9) so the value is deterministic
// regardless of the user's OS timezone. Invalid input (undefined / 0 / NaN
// / negative) falls back to Date.now() so a filename is always producible.
export function formatDownloadFilename(timestamp: number | undefined): string {
  const validMs =
    typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
      ? timestamp
      : Date.now();
  // Shift UTC ms by +9 hours and then read via getUTC* to obtain JST wall
  // clock values without touching the machine's local timezone.
  const d = new Date(validMs + 9 * 60 * 60 * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `sumica_${yyyy}${mm}${dd}_${hh}${mi}${ss}.png`;
}
