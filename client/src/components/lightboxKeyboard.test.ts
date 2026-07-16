import { describe, it, expect } from 'vitest';
import { resolveLightboxKey } from './lightboxKeyboard';

describe('resolveLightboxKey', () => {
  it('returns close for Escape when not in OS fullscreen', () => {
    expect(resolveLightboxKey('Escape', '', false, 0)).toEqual({ type: 'close' });
  });

  it('returns null for Escape when in OS fullscreen (browser handles exit first)', () => {
    expect(resolveLightboxKey('Escape', '', true, 0)).toBeNull();
  });

  it('returns navigate delta -1 for ArrowLeft', () => {
    expect(resolveLightboxKey('ArrowLeft', '', false, 0)).toEqual({ type: 'navigate', delta: -1 });
  });

  it('returns navigate delta +1 for ArrowRight', () => {
    expect(resolveLightboxKey('ArrowRight', '', false, 0)).toEqual({ type: 'navigate', delta: 1 });
  });

  it('returns toggleSelection for Space key (via key=" ")', () => {
    expect(resolveLightboxKey(' ', 'Space', false, 3)).toEqual({ type: 'toggleSelection' });
  });

  it('returns toggleSelection for Space key (via code=Space)', () => {
    expect(resolveLightboxKey('', 'Space', false, 3)).toEqual({ type: 'toggleSelection' });
  });

  it('returns null for Space when lightboxIndex is negative (e.g. preview image)', () => {
    expect(resolveLightboxKey(' ', 'Space', false, -1)).toBeNull();
  });

  it('returns toggleFavorite for lowercase f', () => {
    expect(resolveLightboxKey('f', '', false, 0)).toEqual({ type: 'toggleFavorite' });
  });

  it('returns toggleFavorite for uppercase F', () => {
    expect(resolveLightboxKey('F', '', false, 0)).toEqual({ type: 'toggleFavorite' });
  });

  it('returns null for s and S (deliberately not bound — reverted after live review)', () => {
    expect(resolveLightboxKey('s', '', false, 0)).toBeNull();
    expect(resolveLightboxKey('S', '', false, 0)).toBeNull();
  });

  it('returns toggleRandom for lowercase r', () => {
    expect(resolveLightboxKey('r', '', false, 0)).toEqual({ type: 'toggleRandom' });
  });

  it('returns toggleRandom for uppercase R', () => {
    expect(resolveLightboxKey('R', '', false, 0)).toEqual({ type: 'toggleRandom' });
  });

  it('returns null for r when lightboxIndex is negative (preview has nothing to shuffle to)', () => {
    expect(resolveLightboxKey('r', '', false, -1)).toBeNull();
  });

  it('returns null for f when lightboxIndex is negative', () => {
    expect(resolveLightboxKey('f', '', false, -1)).toBeNull();
  });

  it('returns null for unrelated keys', () => {
    expect(resolveLightboxKey('a', '', false, 0)).toBeNull();
    expect(resolveLightboxKey('Enter', '', false, 0)).toBeNull();
    expect(resolveLightboxKey('Tab', '', false, 0)).toBeNull();
  });

  it('returns null for the empty string key with no matching code', () => {
    expect(resolveLightboxKey('', '', false, 0)).toBeNull();
  });

  it('returns toggleRandom for R when gallery-backed (index >= 0)', () => {
    expect(resolveLightboxKey('r', '', false, 0)).toEqual({ type: 'toggleRandom' });
    expect(resolveLightboxKey('R', '', false, 5)).toEqual({ type: 'toggleRandom' });
  });

  it('returns null for R when index is -1 (preview tab has nothing to shuffle to)', () => {
    expect(resolveLightboxKey('r', '', false, -1)).toBeNull();
  });

  it('returns toggleSlideshow for P when gallery-backed (index >= 0)', () => {
    expect(resolveLightboxKey('p', '', false, 0)).toEqual({ type: 'toggleSlideshow' });
    expect(resolveLightboxKey('P', '', false, 3)).toEqual({ type: 'toggleSlideshow' });
  });

  it('returns null for P when index is -1 (no slideshow over a single preview image)', () => {
    expect(resolveLightboxKey('p', '', false, -1)).toBeNull();
  });

  it('routes P through even while OS fullscreen is active', () => {
    // R and P are mode toggles, not close/exit actions; unlike Escape (which
    // is gated so the browser can exit fullscreen first), these should still
    // fire while fullscreen is active.
    expect(resolveLightboxKey('p', '', true, 0)).toEqual({ type: 'toggleSlideshow' });
    expect(resolveLightboxKey('r', '', true, 0)).toEqual({ type: 'toggleRandom' });
  });
});
