// Pure helpers for the video-generation progress display in PreviewPanel.
// The upstream (ComfyUI) emits per-node WebSocket events that the server
// forwards over SSE; the client accumulates them in the VideoProgressState
// slice below, and PreviewPanel derives its label + bar from these helpers.

export type VideoProgressState = {
  // Node id currently executing, as reported by ComfyUI's `executing` event.
  // null while queued or between nodes.
  currentNode: string | null;
  // The `progress` event's value/max for the current node (0/0 before the
  // first tick, so callers should guard against divide-by-zero via helpers
  // below rather than reading these directly).
  stepValue: number;
  stepMax: number;
  // Unique node ids we've seen become the executing node so far. Used as the
  // coarse "how many big chunks of the workflow are done" estimator — the
  // bundled i2v.json is a linear-ish DAG so this rises monotonically. A
  // `Set` here because the same node id can be reported multiple times when
  // ComfyUI toggles state, and we only want to count the first time.
  executedNodes: Set<string>;
};

export function createInitialVideoProgress(): VideoProgressState {
  return {
    currentNode: null,
    stepValue: 0,
    stepMax: 0,
    executedNodes: new Set(),
  };
}

// The bundled workflow (server/workflows/i2v.json) has 64 nodes, but many are
// pure-config nodes (loaders, mxSliders, prompt text) that ComfyUI runs
// instantly and never emit a visible progress event. The ~14 heavy nodes
// (samplers, decoders, upscalers, audio, video combine) are what the user
// waits on. We over-estimate slightly so the bar doesn't hit 100% before the
// final poster-extract/save stages — it's better to feel "almost done" than
// to sit stuck at 100% for a few seconds. Adjust if the workflow changes.
export const VIDEO_HEAVY_NODE_COUNT = 14;

// Overall progress ∈ [0, 1]: each completed heavy node contributes 1/N of
// the bar; the currently-executing node contributes (stepValue/stepMax) *
// 1/N. Clamped so partial-node overshoots and the very last stages don't
// go past 1. This is the ComfyUI-stage-only figure; the pipeline-wide
// progress bar uses `computeOverallProgress` below to weight it against
// the pre- and post-ComfyUI stages.
export function estimateVideoProgress(
  state: VideoProgressState,
  totalHeavyNodes: number = VIDEO_HEAVY_NODE_COUNT,
): number {
  if (totalHeavyNodes <= 0) return 0;
  const completed = state.executedNodes.size;
  const perNode = 1 / totalHeavyNodes;
  const intra =
    state.stepMax > 0 && state.currentNode !== null
      ? (state.stepValue / state.stepMax) * perNode
      : 0;
  const raw = completed * perNode + intra;
  return Math.max(0, Math.min(1, raw));
}

// Pipeline-wide progress bands. Each named SSE stage owns a contiguous
// slice of the [0, 1] bar. The `comfy` band is the widest because ComfyUI
// dominates wall-clock time; its interior is filled by scaling
// `estimateVideoProgress` between `lo` and `hi`. Non-comfy stages jump the
// bar directly to their `hi` so the user sees discrete "we moved on" ticks
// rather than a bar that only crawls during ComfyUI. Keep bands non-overlapping
// and monotonically increasing.
export const STAGE_RANGES: Record<string, [number, number]> = {
  preparing: [0.00, 0.03],
  uploaded_source: [0.03, 0.05],
  uploaded_reference: [0.05, 0.07],
  submitted: [0.07, 0.10],
  comfy: [0.10, 0.85],
  fetching_video: [0.85, 0.90],
  extracting_poster: [0.90, 0.95],
  saving: [0.95, 1.00],
};

export function computeOverallProgress(stage: string, comfyFraction: number): number {
  const range = STAGE_RANGES[stage];
  if (!range) return 0;
  const [lo, hi] = range;
  if (stage === 'comfy') {
    const clamped = Math.max(0, Math.min(1, comfyFraction));
    return lo + (hi - lo) * clamped;
  }
  // Non-comfy stages are punctual: as soon as we enter them, the bar
  // jumps to the top of the band.
  return hi;
}

// Remaining-seconds estimate from linear extrapolation of the current bar
// position. Returns null in ranges where the estimate would be misleading:
// - elapsed < 5s: not enough samples, division by tiny `elapsed × (1 - p)`
// - progress ≤ 0.01: dividing by a near-zero denominator explodes
// - progress ≥ 0.99: we're basically done, showing "残り 0 秒" flickers
// Callers can render "—" or hide the chip when null is returned.
export function estimateRemainingSeconds(elapsed: number, progress: number): number | null {
  if (elapsed < 5) return null;
  if (progress <= 0.01) return null;
  if (progress >= 0.99) return null;
  return Math.round((elapsed * (1 - progress)) / progress);
}

// Time-based fraction of the comfy stage: purely wall-clock. Used together
// with the last-known duration (see localStorage helpers below) so the bar
// crawls smoothly from 0 → 1 across the comfy band no matter how many
// executing events ComfyUI fires per second.
export const DEFAULT_EXPECTED_COMFY_SECONDS = 180;

export function estimateComfyFractionByTime(
  comfyElapsedSeconds: number,
  expectedSeconds: number,
): number {
  if (expectedSeconds <= 0) return 0;
  if (comfyElapsedSeconds <= 0) return 0;
  return Math.max(0, Math.min(1, comfyElapsedSeconds / expectedSeconds));
}

// localStorage key for the most-recent comfy stage duration. Persisting
// across sessions is the whole point — the first video of a fresh session
// still benefits from the previous day's timing.
const LAST_COMFY_DURATION_KEY = 'sumica.videoLastComfyDurationSeconds';

// Reads the last recorded comfy duration in seconds. Returns null when
// localStorage is unavailable or the key hasn't been written yet, so
// callers can fall back to DEFAULT_EXPECTED_COMFY_SECONDS.
export function loadLastComfyDurationSeconds(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_COMFY_DURATION_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLastComfyDurationSeconds(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  try {
    globalThis.localStorage?.setItem(LAST_COMFY_DURATION_KEY, String(seconds));
  } catch {
    // ignore quota / privacy-mode failures — this is a UX-only estimate
  }
}
