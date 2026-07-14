import type { GenerationData } from '../App';
import type { SdModel } from './presets';
import { inferSdArchitectureFromTitle } from './loadIntoFormState';

// Pure helpers backing the gallery filter popover. Kept as pure functions
// (no React, no state) so the filter logic can be unit-tested independently
// of the DOM. See docs/superpowers/specs/2026-07-15-history-gallery-filters-design.md.

export interface GalleryFilters {
  arch: 'sdxl' | 'sd15' | null;
  model: string | null;
  sampler: string | null;
}

export function applyGalleryFilters(
  history: GenerationData[],
  filters: GalleryFilters,
  sdModels: SdModel[],
): GenerationData[] {
  return history.filter((it) => {
    if (filters.model && it.model !== filters.model) return false;
    if (filters.sampler && it.sampler !== filters.sampler) return false;
    if (filters.arch) {
      const arch = inferSdArchitectureFromTitle(it.model ?? '', sdModels);
      if (arch !== filters.arch) return false;
    }
    return true;
  });
}

export function deriveFilterOptions(history: GenerationData[]): {
  models: string[];
  samplers: string[];
} {
  const models = new Set<string>();
  const samplers = new Set<string>();
  for (const it of history) {
    if (it.model) models.add(it.model);
    if (it.sampler) samplers.add(it.sampler);
  }
  return {
    models: [...models].sort(),
    samplers: [...samplers].sort(),
  };
}

export function countActiveFilters(filters: GalleryFilters): number {
  let count = 0;
  if (filters.arch) count++;
  if (filters.model) count++;
  if (filters.sampler) count++;
  return count;
}
