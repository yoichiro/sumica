// Pure helpers for the favorite-recipe ranking feature. `normalizeParams`
// canonicalises a raw generation params object into the recipe shape
// that identifies a "recipe"; `buildRollupKey` produces the SHA-256 hex
// that acts as the Firestore doc ID for the rollup counter.
//
// Extracted from firebase.ts / App.tsx callers so the hashing logic can
// be unit-tested in isolation and shared verbatim with the server-side
// counterpart (server/utils/rankingRollup.ts) — the two files intentionally
// duplicate this small amount of code because they run in different module
// systems and typechecking pipelines.
//
// See ADR 24 for the extended-dimensions redesign (the recipe shape now
// covers every form field except prompt and seed, so applying a ranked
// recipe fully restores the generation form).

import { stripHashSuffix } from '../components/loadIntoFormState';

export type NormalizedLora = {
  name: string;
  weight: number;
};

export type NormalizedParams = {
  model: string;
  sampler: string;
  scheduler: string;
  size: string;
  steps: number;
  cfg: number;
  hires: boolean;
  hiresUpscaler: string;
  hiresScale: number;
  hiresSteps: number;
  hiresDenoising: number;
  loras: readonly NormalizedLora[];
  refiner: string;
  refinerSwitchAt: number;
  vae: string;
};

// Any object with the (optional) shape of a saved generation.
type RawParams = {
  model?: string | null;
  sampler?: string;
  scheduler?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  enableHr?: boolean;
  hrUpscaler?: string;
  hrScale?: number;
  hrSecondPassSteps?: number;
  denoisingStrength?: number;
  loras?: { name: string; weight?: number }[];
  refiner?: string;
  refinerSwitchAt?: number;
  vae?: string;
};

export function normalizeParams(p: RawParams | Record<string, unknown>): NormalizedParams {
  const src = p as RawParams;
  return {
    model: stripHashSuffix(src.model || ''),
    sampler: src.sampler || '',
    scheduler: src.scheduler || '',
    size: `${src.width ?? 0}x${src.height ?? 0}`,
    steps: src.steps ?? 0,
    cfg: src.cfgScale ?? 0,
    hires: !!src.enableHr,
    hiresUpscaler: src.hrUpscaler || '',
    hiresScale: src.hrScale ?? 0,
    hiresSteps: src.hrSecondPassSteps ?? 0,
    hiresDenoising: src.denoisingStrength ?? 0,
    loras: (src.loras || [])
      .map((l) => ({ name: l.name, weight: l.weight ?? 1 }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    refiner: src.refiner || '',
    refinerSwitchAt: src.refinerSwitchAt ?? 0,
    vae: src.vae || '',
  };
}

export async function buildRollupKey(p: NormalizedParams): Promise<string> {
  // JSON.stringify preserves object key order in modern V8 for own enumerable
  // string keys inserted in code order — safe because we always build the
  // NormalizedParams object with the same key order in this file. The `loras`
  // array is sorted by `normalizeParams`, so ordering is fully deterministic.
  const canonical = JSON.stringify(p);
  const enc = new TextEncoder().encode(canonical);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
