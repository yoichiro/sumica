import type { FluxVariant } from './presets';

// Per-field flags flipping to true on the corresponding onChange in App.tsx.
// When a flag is true, computeFluxDefaults preserves the current value; when
// false, it applies the variant-appropriate default. Toggling modelTypeFilter
// or switching Flux checkpoints of different variants clears all flags in
// App.tsx (not here) so the new defaults land cleanly.
export interface FluxDefaultsOverrides {
  stepsUserOverride: boolean;
  cfgUserOverride: boolean;
  samplerUserOverride: boolean;
  schedulerUserOverride: boolean;
}

export interface FluxCurrentValues {
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

// Flux variant-specific defaults. schnell is the fast-distilled variant that
// only respects CFG=1.0 and produces good output at 1–4 steps; dev accepts
// CFG guidance and needs ~20–30 steps.
const SCHNELL_DEFAULTS: FluxCurrentValues = {
  steps: 4,
  cfg: 1.0,
  sampler: 'Euler',
  scheduler: 'simple',
};

const DEV_DEFAULTS: FluxCurrentValues = {
  steps: 25,
  cfg: 3.5,
  sampler: 'Euler',
  scheduler: 'simple',
};

// Computes what steps/cfg/sampler/scheduler should be when a Flux model is
// active. Per-field: if the user has overridden the field, keep the current
// value; otherwise return the variant default. Unknown variant (Flux checkpoint
// without variant metadata) is treated as schnell.
export function computeFluxDefaults(
  variant: FluxVariant | undefined,
  overrides: FluxDefaultsOverrides,
  current: FluxCurrentValues,
): FluxCurrentValues {
  const defaults = variant === 'dev' ? DEV_DEFAULTS : SCHNELL_DEFAULTS;
  return {
    steps: overrides.stepsUserOverride ? current.steps : defaults.steps,
    cfg: overrides.cfgUserOverride ? current.cfg : defaults.cfg,
    sampler: overrides.samplerUserOverride ? current.sampler : defaults.sampler,
    scheduler: overrides.schedulerUserOverride ? current.scheduler : defaults.scheduler,
  };
}
