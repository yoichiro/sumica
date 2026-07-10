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

  it('returns toggleFavorite for lowercase s (the new binding this task adds)', () => {
    expect(resolveLightboxKey('s', '', false, 0)).toEqual({ type: 'toggleFavorite' });
  });

  it('returns toggleFavorite for uppercase S (the new binding this task adds)', () => {
    expect(resolveLightboxKey('S', '', false, 0)).toEqual({ type: 'toggleFavorite' });
  });

  it('returns null for s when lightboxIndex is negative (e.g. preview image has no persistence)', () => {
    expect(resolveLightboxKey('s', '', false, -1)).toBeNull();
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
});
