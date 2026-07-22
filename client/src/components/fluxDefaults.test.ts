import { describe, it, expect } from 'vitest';
import { computeFluxDefaults, type FluxDefaultsOverrides, type FluxCurrentValues } from './fluxDefaults';

const NO_OVERRIDES: FluxDefaultsOverrides = {
  stepsUserOverride: false,
  cfgUserOverride: false,
  samplerUserOverride: false,
  schedulerUserOverride: false,
};

const ARBITRARY_CURRENT: FluxCurrentValues = {
  steps: 12,
  cfg: 7,
  sampler: 'DPM++ 2M',
  scheduler: 'Karras',
};

describe('computeFluxDefaults', () => {
  it('applies schnell defaults when no overrides and variant is schnell', () => {
    const result = computeFluxDefaults('schnell', NO_OVERRIDES, ARBITRARY_CURRENT);
    expect(result).toEqual({ steps: 4, cfg: 1.0, sampler: 'Euler', scheduler: 'Simple' });
  });

  it('applies dev defaults when no overrides and variant is dev', () => {
    const result = computeFluxDefaults('dev', NO_OVERRIDES, ARBITRARY_CURRENT);
    expect(result).toEqual({ steps: 25, cfg: 3.5, sampler: 'Euler', scheduler: 'Simple' });
  });

  it('treats undefined variant as schnell', () => {
    const result = computeFluxDefaults(undefined, NO_OVERRIDES, ARBITRARY_CURRENT);
    expect(result).toEqual({ steps: 4, cfg: 1.0, sampler: 'Euler', scheduler: 'Simple' });
  });

  it('preserves per-field values when the corresponding override is true', () => {
    const overrides: FluxDefaultsOverrides = {
      stepsUserOverride: true,
      cfgUserOverride: false,
      samplerUserOverride: false,
      schedulerUserOverride: false,
    };
    const result = computeFluxDefaults('schnell', overrides, { ...ARBITRARY_CURRENT, steps: 12 });
    // steps is preserved (12), everything else takes schnell defaults.
    expect(result).toEqual({ steps: 12, cfg: 1.0, sampler: 'Euler', scheduler: 'Simple' });
  });

  it('preserves all fields when all overrides are true', () => {
    const overrides: FluxDefaultsOverrides = {
      stepsUserOverride: true,
      cfgUserOverride: true,
      samplerUserOverride: true,
      schedulerUserOverride: true,
    };
    const result = computeFluxDefaults('dev', overrides, ARBITRARY_CURRENT);
    expect(result).toEqual(ARBITRARY_CURRENT);
  });
});
