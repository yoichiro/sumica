import { describe, it, expect } from 'vitest';
import { normalizeParams, buildRollupKey } from './rankingRollup';

describe('normalizeParams', () => {
  it('strips the SD hash-suffix from model title', () => {
    const p = normalizeParams({ model: 'foo.safetensors [abcdef1234]', width: 512, height: 768 });
    expect(p.model).toBe('foo.safetensors');
  });

  it('produces "WxH" for the size field', () => {
    const p = normalizeParams({ width: 512, height: 768 });
    expect(p.size).toBe('512x768');
  });

  it('sorts loras by name and preserves each weight', () => {
    const p = normalizeParams({
      loras: [{ name: 'zeta', weight: 0.8 }, { name: 'alpha', weight: 0.7 }],
    });
    expect(p.loras).toEqual([
      { name: 'alpha', weight: 0.7 },
      { name: 'zeta', weight: 0.8 },
    ]);
  });

  it('defaults weight=1 when a lora entry omits it', () => {
    const p = normalizeParams({ loras: [{ name: 'alpha' }] });
    expect(p.loras).toEqual([{ name: 'alpha', weight: 1 }]);
  });

  it('defaults empty strings / zeros for missing optional fields', () => {
    const p = normalizeParams({});
    expect(p.sampler).toBe('');
    expect(p.scheduler).toBe('');
    expect(p.refiner).toBe('');
    expect(p.vae).toBe('');
    expect(p.loras).toEqual([]);
    expect(p.hires).toBe(false);
    expect(p.model).toBe('');
    expect(p.steps).toBe(0);
    expect(p.cfg).toBe(0);
    expect(p.hiresUpscaler).toBe('');
    expect(p.hiresScale).toBe(0);
    expect(p.hiresSteps).toBe(0);
    expect(p.hiresDenoising).toBe(0);
    expect(p.refinerSwitchAt).toBe(0);
  });

  it('coerces enableHr truthiness to boolean', () => {
    expect(normalizeParams({ enableHr: true }).hires).toBe(true);
    expect(normalizeParams({ enableHr: false }).hires).toBe(false);
    expect(normalizeParams({ enableHr: undefined }).hires).toBe(false);
  });

  it('extracts hires detail fields when Hires.fix is enabled', () => {
    const p = normalizeParams({
      enableHr: true,
      hrUpscaler: 'Latent',
      hrScale: 2,
      hrSecondPassSteps: 15,
      denoisingStrength: 0.5,
    });
    expect(p.hires).toBe(true);
    expect(p.hiresUpscaler).toBe('Latent');
    expect(p.hiresScale).toBe(2);
    expect(p.hiresSteps).toBe(15);
    expect(p.hiresDenoising).toBe(0.5);
  });

  it('extracts steps, cfg, refiner switch-at', () => {
    const p = normalizeParams({ steps: 25, cfgScale: 6.5, refinerSwitchAt: 0.7 });
    expect(p.steps).toBe(25);
    expect(p.cfg).toBe(6.5);
    expect(p.refinerSwitchAt).toBe(0.7);
  });
});

describe('buildRollupKey', () => {
  const base = {
    model: 'foo.safetensors',
    sampler: 'Euler a',
    scheduler: 'Karras',
    size: '512x768',
    steps: 20,
    cfg: 7,
    hires: true,
    hiresUpscaler: 'Latent',
    hiresScale: 2,
    hiresSteps: 0,
    hiresDenoising: 0.5,
    loras: [{ name: 'alpha', weight: 0.7 }, { name: 'zeta', weight: 0.8 }],
    refiner: '',
    refinerSwitchAt: 0.8,
    vae: '',
  } as const;

  it('produces a 64-char lowercase hex string', async () => {
    const h = await buildRollupKey(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic (same input → same hash)', async () => {
    const h1 = await buildRollupKey(base);
    const h2 = await buildRollupKey(base);
    expect(h1).toBe(h2);
  });

  it('is invariant to LoRA order (input already sorted by normalizeParams)', async () => {
    const h1 = await buildRollupKey({ ...base, loras: [{ name: 'alpha', weight: 0.7 }, { name: 'zeta', weight: 0.8 }] });
    const h2 = await buildRollupKey({ ...base, loras: [{ name: 'alpha', weight: 0.7 }, { name: 'zeta', weight: 0.8 }] });
    expect(h1).toBe(h2);
  });

  it('changes when any field changes', async () => {
    const h1 = await buildRollupKey(base);
    const h2 = await buildRollupKey({ ...base, sampler: 'DPM++ SDE' });
    const h3 = await buildRollupKey({ ...base, hires: false });
    const h4 = await buildRollupKey({ ...base, size: '512x1024' });
    const h5 = await buildRollupKey({ ...base, steps: 25 });
    const h6 = await buildRollupKey({ ...base, cfg: 6 });
    const h7 = await buildRollupKey({ ...base, hiresUpscaler: 'ESRGAN' });
    const h8 = await buildRollupKey({ ...base, hiresScale: 1.5 });
    const h9 = await buildRollupKey({ ...base, hiresSteps: 15 });
    const h10 = await buildRollupKey({ ...base, hiresDenoising: 0.7 });
    const h11 = await buildRollupKey({ ...base, refinerSwitchAt: 0.7 });
    const h12 = await buildRollupKey({ ...base, loras: [{ name: 'alpha', weight: 0.9 }, { name: 'zeta', weight: 0.8 }] });
    expect(new Set([h1, h2, h3, h4, h5, h6, h7, h8, h9, h10, h11, h12]).size).toBe(12);
  });

  it('matches the pinned expected hash for a known P (must match server test)', async () => {
    const P = {
      model: 'foo.safetensors',
      sampler: 'Euler a',
      scheduler: 'Karras',
      size: '512x768',
      steps: 20,
      cfg: 7,
      hires: true,
      hiresUpscaler: 'Latent',
      hiresScale: 2,
      hiresSteps: 0,
      hiresDenoising: 0.5,
      loras: [{ name: 'alpha', weight: 0.7 }, { name: 'zeta', weight: 0.8 }],
      refiner: '',
      refinerSwitchAt: 0.8,
      vae: '',
    };
    const expected = 'a1c12356a84a8c60b8868ec0d1c8f07d484188ec0888298dc6d3ccf88a7be6bb';
    expect(await buildRollupKey(P)).toBe(expected);
  });
});
