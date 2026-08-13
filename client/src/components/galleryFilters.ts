import type { GenerationData } from '../App';
import type { Architecture, SdModel } from './presets';
import { inferSdArchitectureFromTitle, stripHashSuffix } from './loadIntoFormState';

// Pure helpers backing the gallery filter popover. Kept as pure functions
// (no React, no state) so the filter logic can be unit-tested independently
// of the DOM. See docs/superpowers/specs/2026-07-15-history-gallery-filters-design.md.

// Model titles are normalized via stripHashSuffix everywhere the filter touches
// them, so records stored with a stale `[hash]` don't appear as separate entries
// from the same checkpoint stored without one (same failure mode ADR 16 dodged
// on the architecture side).

export type GalleryOrientation = 'landscape' | 'portrait' | 'square';

export interface GalleryFilters {
  arch: Architecture | null;
  model: string | null;
  sampler: string | null;
  // Aspect ratio in "larger:smaller" canonical form (e.g., "4:3"). Portrait
  // and landscape records with the same underlying shape collapse to the same
  // ratio string, and the orientation axis distinguishes them.
  aspectRatio: string | null;
  // 'landscape' (W>H) or 'portrait' (H>W). Square (W===H) records only match
  // the null (すべて) filter — the orientation UI never offers a 正方 option
  // because it's implicit in aspectRatio=1:1.
  orientation: Exclude<GalleryOrientation, 'square'> | null;
  // 'image' or 'video' — legacy records without a mediaType field are treated
  // as 'image' everywhere this filter is applied (see applyGalleryFilters).
  mediaType: 'image' | 'video' | null;
  // Matches records whose parentId equals this value. Only meaningful for
  // videos (which carry the source image's id as parentId), but the filter
  // itself is generic over any record shape.
  parentId: string | null;
}

// Euclidean GCD, integer-only. Returns 1 when either side is non-positive so
// callers still get a valid ratio string.
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  if (a === 0 || b === 0) return 1;
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

// Reduce W×H to its canonical "larger:smaller" ratio string. Both portrait
// and landscape shapes of the same aspect (768×1024 vs 1024×768) collapse to
// the same key ("4:3"), which the orientation filter then splits back.
export function computeAspectRatio(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
  const g = gcd(width, height);
  const larger = Math.max(width, height) / g;
  const smaller = Math.min(width, height) / g;
  return `${larger}:${smaller}`;
}

export function computeOrientation(width: number, height: number): GalleryOrientation {
  if (width > height) return 'landscape';
  if (height > width) return 'portrait';
  return 'square';
}

export function applyGalleryFilters(
  history: GenerationData[],
  filters: GalleryFilters,
  sdModels: SdModel[],
): GenerationData[] {
  return history.filter((it) => {
    // mediaType filter — legacy records without mediaType are treated as 'image'
    if (filters.mediaType !== null) {
      const recMediaType = it.mediaType ?? 'image';
      if (recMediaType !== filters.mediaType) return false;
    }
    // parentId filter — only meaningful for videos, but the filter itself is universal
    if (filters.parentId !== null && it.parentId !== filters.parentId) {
      return false;
    }
    // Arch / model / sampler are SD concepts; video records inherit these
    // fields from the parent image via `...cleanParams` in saveVideoGeneration,
    // but they don't describe the video itself. Skip them for videos so the
    // filter row on the video tab reflects only what the video is (dimensions).
    const isVideo = (it.mediaType ?? 'image') === 'video';
    if (!isVideo) {
      if (filters.model && stripHashSuffix(it.model ?? '') !== filters.model) return false;
      if (filters.sampler && it.sampler !== filters.sampler) return false;
      if (filters.arch) {
        const arch = it.modelArchitecture ?? inferSdArchitectureFromTitle(it.model ?? '', sdModels);
        if (arch !== filters.arch) return false;
      }
    }
    if (filters.aspectRatio && computeAspectRatio(it.width, it.height) !== filters.aspectRatio) return false;
    if (filters.orientation && computeOrientation(it.width, it.height) !== filters.orientation) return false;
    return true;
  });
}

// One row of the aspect ratio dropdown. `ratio` is the canonical filter key
// ("4:3"); `label` is the display string, which appends the distinct pixel
// dimensions ("4:3 (1024×768)") so the user can see "which specific shape"
// the ratio maps to. Portrait and landscape of the same underlying dimensions
// (e.g., 768×1024 and 1024×768) collapse to a single `1024×768` canonical form,
// then orientation acts as the separate axis that splits them.
export interface AspectRatioOption {
  ratio: string;
  label: string;
}

export function deriveFilterOptions(history: GenerationData[]): {
  models: string[];
  samplers: string[];
  aspectRatios: AspectRatioOption[];
  orientations: Exclude<GalleryOrientation, 'square'>[];
} {
  const models = new Set<string>();
  const samplers = new Set<string>();
  const orientations = new Set<Exclude<GalleryOrientation, 'square'>>();
  // ratio → set of canonical "larger×smaller" dimension strings
  const ratioDims = new Map<string, Set<string>>();
  for (const it of history) {
    if (it.model) models.add(stripHashSuffix(it.model));
    if (it.sampler) samplers.add(it.sampler);
    const ratio = computeAspectRatio(it.width, it.height);
    if (ratio) {
      const larger = Math.max(it.width, it.height);
      const smaller = Math.min(it.width, it.height);
      const dimKey = `${larger}×${smaller}`;
      const existing = ratioDims.get(ratio);
      if (existing) existing.add(dimKey);
      else ratioDims.set(ratio, new Set([dimKey]));
    }
    const orientation = computeOrientation(it.width, it.height);
    // Square (1:1) records don't participate in the orientation filter — the
    // aspectRatio=1:1 case already fully describes them.
    if (orientation !== 'square') orientations.add(orientation);
  }
  // Aspect ratios sorted "widest first" (largest larger/smaller quotient) so
  // 21:9, 16:9 come before 4:3, 1:1 — matches the wide→square progression a
  // user thinks in visually. Dimensions per ratio sorted "bigger first" so the
  // most substantial resolution leads when multiple exist for the same ratio.
  const aspectRatios: AspectRatioOption[] = [...ratioDims.entries()]
    .map(([ratio, dims]) => {
      const sortedDims = [...dims].sort((a, b) => {
        const [al] = a.split('×').map(Number);
        const [bl] = b.split('×').map(Number);
        return bl - al;
      });
      return { ratio, label: `${ratio} (${sortedDims.join(' / ')})` };
    })
    .sort((a, b) => ratioValue(b.ratio) - ratioValue(a.ratio));
  return {
    models: [...models].sort(),
    samplers: [...samplers].sort(),
    aspectRatios,
    orientations: [...orientations].sort(),
  };
}

function ratioValue(ratio: string): number {
  const [a, b] = ratio.split(':').map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : 0;
}

// The count reflects only filters that actually apply to the current
// media-type view. Arch/model/sampler stay in state so switching back to the
// image tab restores them, but they should not contribute to the badge on
// the video tab where applyGalleryFilters skips them.
export function countActiveFilters(filters: GalleryFilters): number {
  const isVideoTab = filters.mediaType === 'video';
  let count = 0;
  if (!isVideoTab) {
    if (filters.arch) count++;
    if (filters.model) count++;
    if (filters.sampler) count++;
  }
  if (filters.aspectRatio) count++;
  if (filters.orientation) count++;
  return count;
}
