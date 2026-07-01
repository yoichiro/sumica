// Client-side thumbnail generation used by the cloud (signed-in) save path.
// Signed-out generations get their thumbnails on the server via sharp; the
// two paths produce compatible ~256px WebP files at quality ≈ 0.8.

const THUMBNAIL_MAX_DIMENSION = 256;
const THUMBNAIL_QUALITY = 0.82;

// Decode a base64 image to an HTMLImageElement so it can be drawn onto a
// canvas. Wrapped in a Promise so callers can await the load.
const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image for thumbnail'));
    img.src = dataUrl;
  });

// Some browsers (older Safari) don't support WebP encoding via canvas — the
// output silently falls back to PNG. Feature-detect by asking for a WebP data
// URL and checking the returned MIME prefix.
const canvasSupportsWebp = (() => {
  let cached: boolean | null = null;
  return (): boolean => {
    if (cached !== null) return cached;
    if (typeof document === 'undefined') return false;
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    cached = c.toDataURL('image/webp').startsWith('data:image/webp');
    return cached;
  };
})();

export type Thumbnail = {
  base64: string;      // encoded payload (no data:...;base64, prefix)
  mimeType: string;    // 'image/webp' or 'image/jpeg' (older Safari fallback)
};

// Downscale a base64 image to a 256px WebP (JPEG fallback). Preserves aspect
// ratio; never upscales. Throws when the image can't be decoded.
export async function generateThumbnail(
  base64: string,
  sourceMime: string = 'image/png',
): Promise<Thumbnail> {
  const img = await loadImage(`data:${sourceMime};base64,${base64}`);

  const scale = Math.min(
    THUMBNAIL_MAX_DIMENSION / img.width,
    THUMBNAIL_MAX_DIMENSION / img.height,
    1,
  );
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0, width, height);

  const mimeType = canvasSupportsWebp() ? 'image/webp' : 'image/jpeg';
  const dataUrl = canvas.toDataURL(mimeType, THUMBNAIL_QUALITY);
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) throw new Error('Unexpected canvas data URL shape');
  return { base64: dataUrl.slice(commaIdx + 1), mimeType };
}
