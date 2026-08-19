// Filename generator + browser download trigger for saving generated images
// from the Lightbox. Split into a pure function (unit tested) and a DOM
// side-effect function (not unit tested — same pattern as `utils/thumbnail.ts`).

// Build a "sumica_YYYYMMDD_HHMMSS.<ext>" filename from a unix millisecond
// timestamp, always rendered in JST (UTC+9) so the value is deterministic
// regardless of the user's OS timezone. Invalid input (undefined / 0 / NaN
// / negative) falls back to Date.now() so a filename is always producible.
// The extension follows mediaType: 'video' → .mp4, otherwise → .png (the
// default so existing image callers keep their pre-video behavior).
export function formatDownloadFilename(
  timestamp: number | undefined,
  mediaType: 'image' | 'video' = 'image',
): string {
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
  const ext = mediaType === 'video' ? 'mp4' : 'png';
  return `sumica_${yyyy}${mm}${dd}_${hh}${mi}${ss}.${ext}`;
}

// Trigger a browser download of a Blob using the objectURL → <a download> →
// revoke pattern. This lets callers pick their own Blob source (fetch for
// same-origin URLs, Firebase Storage SDK's getBlob for cross-origin Firebase
// URLs the fetch API cannot reach without bucket CORS configuration) and
// hand the final Blob here for the actual save step.
export function saveBlobAs(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Fetch a remote image URL and trigger a browser download. Used for
// same-origin URLs (local /api/outputs/*) and any URL whose response
// carries CORS headers. Firebase Storage tokenized URLs do NOT ship with
// permissive CORS by default — callers holding a Firebase storagePath
// should use the SDK's getBlob path instead of this helper (see
// firebase.ts:getStorageBlob). Throws on network/decode failure.
export async function downloadImage(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  saveBlobAs(blob, filename);
}
