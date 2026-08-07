import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatDownloadFilename } from './download';

describe('formatDownloadFilename', () => {
  it('formats a known JST timestamp into sumica_YYYYMMDD_HHMMSS.png', () => {
    // 2026-08-07 17:05:01 JST == 2026-08-07 08:05:01 UTC.
    // Date.UTC(year, monthIndex, day, hour, minute, second) — monthIndex is 0-based (August = 7).
    const ms = Date.UTC(2026, 7, 7, 8, 5, 1);
    expect(formatDownloadFilename(ms)).toBe('sumica_20260807_170501.png');
  });

  it('zero-pads month, day, hour, minute, and second to two digits', () => {
    // 2026-01-07 09:05:01 JST == 2026-01-07 00:05:01 UTC.
    const ms = Date.UTC(2026, 0, 7, 0, 5, 1);
    expect(formatDownloadFilename(ms)).toBe('sumica_20260107_090501.png');
  });

  describe('fallback to Date.now() for invalid timestamps', () => {
    beforeEach(() => {
      // Freeze Date.now() to 2027-03-15 04:30:45 JST == 2027-03-14 19:30:45 UTC
      // so the fallback branch is deterministic across runs and machines.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2027, 2, 14, 19, 30, 45)));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('falls back to Date.now() when timestamp is undefined', () => {
      expect(formatDownloadFilename(undefined)).toBe('sumica_20270315_043045.png');
    });

    it('falls back to Date.now() when timestamp is 0', () => {
      expect(formatDownloadFilename(0)).toBe('sumica_20270315_043045.png');
    });

    it('falls back to Date.now() when timestamp is NaN', () => {
      expect(formatDownloadFilename(NaN)).toBe('sumica_20270315_043045.png');
    });
  });
});
