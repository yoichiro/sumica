import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createInitialVideoProgress,
  estimateVideoProgress,
  computeOverallProgress,
  estimateRemainingSeconds,
  estimateComfyFractionByTime,
  loadLastComfyDurationSeconds,
  saveLastComfyDurationSeconds,
  DEFAULT_EXPECTED_COMFY_SECONDS,
  STAGE_RANGES,
  VIDEO_HEAVY_NODE_COUNT,
} from './videoProgress';

describe('estimateVideoProgress', () => {
  it('returns 0 for the initial state (nothing executed yet)', () => {
    expect(estimateVideoProgress(createInitialVideoProgress())).toBe(0);
  });

  it('returns 1/N per completed heavy node with no intra-node contribution', () => {
    const state = createInitialVideoProgress();
    state.executedNodes.add('a');
    state.executedNodes.add('b');
    expect(estimateVideoProgress(state, 10)).toBeCloseTo(0.2, 5);
  });

  it('adds intra-node contribution proportional to stepValue/stepMax within the current node slot', () => {
    const state = createInitialVideoProgress();
    state.executedNodes.add('a');
    state.currentNode = 'b';
    state.stepValue = 5;
    state.stepMax = 10;
    // 1 completed node (0.1) + half of the current node's slot (0.05) = 0.15
    expect(estimateVideoProgress(state, 10)).toBeCloseTo(0.15, 5);
  });

  it('ignores intra-node contribution when stepMax is 0 (no progress event yet)', () => {
    const state = createInitialVideoProgress();
    state.executedNodes.add('a');
    state.currentNode = 'b';
    state.stepValue = 3;
    state.stepMax = 0;
    expect(estimateVideoProgress(state, 10)).toBeCloseTo(0.1, 5);
  });

  it('ignores intra-node contribution when currentNode is null', () => {
    const state = createInitialVideoProgress();
    state.executedNodes.add('a');
    state.currentNode = null;
    state.stepValue = 5;
    state.stepMax = 10;
    expect(estimateVideoProgress(state, 10)).toBeCloseTo(0.1, 5);
  });

  it('clamps to 1 even if executed nodes overshoot the total (workflow constant drift)', () => {
    const state = createInitialVideoProgress();
    for (let i = 0; i < 20; i++) state.executedNodes.add(`n${i}`);
    expect(estimateVideoProgress(state, 10)).toBe(1);
  });

  it('returns 0 when totalHeavyNodes is 0 or negative (defensive)', () => {
    const state = createInitialVideoProgress();
    state.executedNodes.add('a');
    expect(estimateVideoProgress(state, 0)).toBe(0);
    expect(estimateVideoProgress(state, -5)).toBe(0);
  });

  it('uses the module-level default when totalHeavyNodes is omitted', () => {
    const state = createInitialVideoProgress();
    state.executedNodes.add('a');
    // 1 / VIDEO_HEAVY_NODE_COUNT
    expect(estimateVideoProgress(state)).toBeCloseTo(1 / VIDEO_HEAVY_NODE_COUNT, 5);
  });
});

describe('computeOverallProgress', () => {
  it('advances through the pipeline: each named stage lands at its band top', () => {
    // Non-comfy stages are punctual — they jump to the top of their band.
    expect(computeOverallProgress('preparing', 0)).toBeCloseTo(STAGE_RANGES.preparing[1], 5);
    expect(computeOverallProgress('uploaded_source', 0)).toBeCloseTo(STAGE_RANGES.uploaded_source[1], 5);
    expect(computeOverallProgress('submitted', 0)).toBeCloseTo(STAGE_RANGES.submitted[1], 5);
    expect(computeOverallProgress('fetching_video', 0)).toBeCloseTo(STAGE_RANGES.fetching_video[1], 5);
    expect(computeOverallProgress('extracting_poster', 0)).toBeCloseTo(STAGE_RANGES.extracting_poster[1], 5);
    expect(computeOverallProgress('saving', 0)).toBeCloseTo(STAGE_RANGES.saving[1], 5);
  });

  it('scales the comfy stage linearly by the ComfyUI fraction', () => {
    const [lo, hi] = STAGE_RANGES.comfy;
    expect(computeOverallProgress('comfy', 0)).toBeCloseTo(lo, 5);
    expect(computeOverallProgress('comfy', 0.5)).toBeCloseTo(lo + (hi - lo) * 0.5, 5);
    expect(computeOverallProgress('comfy', 1)).toBeCloseTo(hi, 5);
  });

  it('clamps the comfy fraction to [0, 1] on drift', () => {
    const [lo, hi] = STAGE_RANGES.comfy;
    expect(computeOverallProgress('comfy', -0.5)).toBeCloseTo(lo, 5);
    expect(computeOverallProgress('comfy', 1.5)).toBeCloseTo(hi, 5);
  });

  it('returns 0 for unknown or empty stages', () => {
    expect(computeOverallProgress('', 0.5)).toBe(0);
    expect(computeOverallProgress('unknown-stage', 0.5)).toBe(0);
  });

  it('produces a monotonically non-decreasing sequence through the whole pipeline', () => {
    const values = [
      computeOverallProgress('preparing', 0),
      computeOverallProgress('uploaded_source', 0),
      computeOverallProgress('submitted', 0),
      computeOverallProgress('comfy', 0),
      computeOverallProgress('comfy', 0.5),
      computeOverallProgress('comfy', 1),
      computeOverallProgress('fetching_video', 0),
      computeOverallProgress('extracting_poster', 0),
      computeOverallProgress('saving', 0),
    ];
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
    expect(values[values.length - 1]).toBeCloseTo(1, 5);
  });
});

describe('estimateRemainingSeconds', () => {
  it('returns null for the first 5 seconds even if progress is present', () => {
    expect(estimateRemainingSeconds(0, 0.2)).toBeNull();
    expect(estimateRemainingSeconds(3, 0.5)).toBeNull();
    expect(estimateRemainingSeconds(4.9, 0.5)).toBeNull();
  });

  it('returns null when progress is at or below the noisy floor', () => {
    expect(estimateRemainingSeconds(30, 0)).toBeNull();
    expect(estimateRemainingSeconds(30, 0.005)).toBeNull();
    expect(estimateRemainingSeconds(30, 0.01)).toBeNull();
  });

  it('returns null when progress is at or above the near-done ceiling', () => {
    expect(estimateRemainingSeconds(120, 0.99)).toBeNull();
    expect(estimateRemainingSeconds(120, 1)).toBeNull();
    expect(estimateRemainingSeconds(120, 1.5)).toBeNull();
  });

  it('linearly extrapolates in the stable range: elapsed*(1-p)/p', () => {
    // Halfway → remaining equals elapsed.
    expect(estimateRemainingSeconds(60, 0.5)).toBe(60);
    // 25% done → remaining is 3x elapsed.
    expect(estimateRemainingSeconds(30, 0.25)).toBe(90);
    // 80% done → remaining is (1 - 0.8) / 0.8 = 0.25x elapsed.
    expect(estimateRemainingSeconds(120, 0.8)).toBe(30);
  });

  it('rounds to the nearest whole second (no fractional flicker)', () => {
    // 60 * (1 - 0.3) / 0.3 = 140 exactly.
    expect(estimateRemainingSeconds(60, 0.3)).toBe(140);
    // 60 * 0.66 / 0.33 = 120 exactly.
    expect(estimateRemainingSeconds(60, 0.33)).toBe(122);
  });
});

describe('estimateComfyFractionByTime', () => {
  it('returns 0 before any time has elapsed', () => {
    expect(estimateComfyFractionByTime(0, 100)).toBe(0);
    expect(estimateComfyFractionByTime(-5, 100)).toBe(0);
  });

  it('scales linearly through the expected duration', () => {
    expect(estimateComfyFractionByTime(50, 100)).toBeCloseTo(0.5, 5);
    expect(estimateComfyFractionByTime(25, 100)).toBeCloseTo(0.25, 5);
    expect(estimateComfyFractionByTime(75, 100)).toBeCloseTo(0.75, 5);
  });

  it('reaches 1 at the expected duration', () => {
    expect(estimateComfyFractionByTime(100, 100)).toBe(1);
  });

  it('clamps to 1 when we overshoot the estimate (previous run was faster)', () => {
    expect(estimateComfyFractionByTime(200, 100)).toBe(1);
    expect(estimateComfyFractionByTime(9999, 100)).toBe(1);
  });

  it('returns 0 defensively when the expected duration is zero or negative', () => {
    expect(estimateComfyFractionByTime(60, 0)).toBe(0);
    expect(estimateComfyFractionByTime(60, -50)).toBe(0);
  });

  it('exposes a sensible DEFAULT_EXPECTED_COMFY_SECONDS for the first-run case', () => {
    expect(DEFAULT_EXPECTED_COMFY_SECONDS).toBeGreaterThan(0);
  });
});

describe('localStorage helpers', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });
  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  it('returns null when nothing has been written yet', () => {
    expect(loadLastComfyDurationSeconds()).toBeNull();
  });

  it('round-trips a positive number through save + load', () => {
    saveLastComfyDurationSeconds(217.5);
    expect(loadLastComfyDurationSeconds()).toBe(217.5);
  });

  it('ignores non-finite or non-positive writes so the reader never sees garbage', () => {
    saveLastComfyDurationSeconds(NaN);
    expect(loadLastComfyDurationSeconds()).toBeNull();
    saveLastComfyDurationSeconds(0);
    expect(loadLastComfyDurationSeconds()).toBeNull();
    saveLastComfyDurationSeconds(-30);
    expect(loadLastComfyDurationSeconds()).toBeNull();
  });

  it('returns null when the stored value is corrupted (not a number)', () => {
    globalThis.localStorage?.setItem('sumica.videoLastComfyDurationSeconds', 'not-a-number');
    expect(loadLastComfyDurationSeconds()).toBeNull();
  });
});
