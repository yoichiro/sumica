import { describe, expect, it } from 'vitest';
import { CLIENT_SEED_MAX, resolveVideoSeed } from './videoSeed';

describe('resolveVideoSeed', () => {
  it('returns the locked value verbatim when locked, regardless of randomFn', () => {
    expect(resolveVideoSeed(12345, true, () => 0.5)).toBe(12345);
    expect(resolveVideoSeed(0, true)).toBe(0);
    expect(resolveVideoSeed(CLIENT_SEED_MAX - 1, true)).toBe(CLIENT_SEED_MAX - 1);
  });

  it('mints a fresh seed derived from randomFn when unlocked', () => {
    expect(resolveVideoSeed(999, false, () => 0.5)).toBe(Math.floor(0.5 * CLIENT_SEED_MAX));
    expect(resolveVideoSeed(999, false, () => 0.25)).toBe(Math.floor(0.25 * CLIENT_SEED_MAX));
  });

  it('yields 0 at the lower boundary (randomFn returns 0)', () => {
    expect(resolveVideoSeed(999, false, () => 0)).toBe(0);
  });

  it('stays within [0, CLIENT_SEED_MAX) at the upper boundary', () => {
    const almostOne = resolveVideoSeed(999, false, () => 0.9999999999);
    expect(almostOne).toBeGreaterThanOrEqual(0);
    expect(almostOne).toBeLessThan(CLIENT_SEED_MAX);
  });

  it('never returns a negative value (the whole point of this fix)', () => {
    for (let i = 0; i < 20; i++) {
      const s = resolveVideoSeed(999, false);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(s)).toBe(true);
    }
  });
});
