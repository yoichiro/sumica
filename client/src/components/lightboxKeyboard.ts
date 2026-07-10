// Pure resolver for lightbox keyboard shortcuts. Given the raw key/code from
// a KeyboardEvent plus the surrounding context (are we in OS fullscreen?
// which item is displayed?), it returns which action the App should dispatch.
// Extracted from App.tsx's useEffect so the mapping can be unit-tested
// without mounting the full React tree or synthesizing DOM events.

export type LightboxKeyAction =
  | { type: 'close' }
  | { type: 'navigate'; delta: number }
  | { type: 'toggleSelection' }
  | { type: 'toggleFavorite' }
  | { type: 'randomize' }
  | null;

export function resolveLightboxKey(
  key: string,
  code: string,
  hasFullscreenElement: boolean,
  lightboxIndex: number,
): LightboxKeyAction {
  if (key === 'Escape') {
    // In OS fullscreen, let the browser handle Escape (it exits fullscreen);
    // only after that will a second Escape actually close the lightbox.
    return hasFullscreenElement ? null : { type: 'close' };
  }
  if (key === 'ArrowLeft') return { type: 'navigate', delta: -1 };
  if (key === 'ArrowRight') return { type: 'navigate', delta: 1 };
  if (key === ' ' || code === 'Space') {
    // Selection and favorite are only meaningful for persisted gallery items
    // (index >= 0). The preview tab's transient generation has no id and
    // cannot be toggled — return null so callers know to no-op.
    return lightboxIndex >= 0 ? { type: 'toggleSelection' } : null;
  }
  if (key === 'f' || key === 'F') {
    return lightboxIndex >= 0 ? { type: 'toggleFavorite' } : null;
  }
  if (key === 'r' || key === 'R') {
    // Randomize only makes sense over a gallery-backed lightbox (index >= 0);
    // the preview tab's one-off image has nothing to shuffle to.
    return lightboxIndex >= 0 ? { type: 'randomize' } : null;
  }
  return null;
}
