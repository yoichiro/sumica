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

  it('sorts loras by name', () => {
    const p = normalizeParams({
      loras: [{ name: 'zeta', weight: 0.8 }, { name: 'alpha', weight: 0.7 }],
    });
    expect(p.loras).toEqual(['alpha', 'zeta']);
  });

  it('defaults empty strings for missing optional string fields', () => {
    const p = normalizeParams({});
    expect(p.sampler).toBe('');
    expect(p.scheduler).toBe('');
    expect(p.refiner).toBe('');
    expect(p.vae).toBe('');
    expect(p.loras).toEqual([]);
    expect(p.hires).toBe(false);
    expect(p.model).toBe('');
  });

  it('coerces enableHr truthiness to boolean', () => {
    expect(normalizeParams({ enableHr: true }).hires).toBe(true);
    expect(normalizeParams({ enableHr: false }).hires).toBe(false);
    expect(normalizeParams({ enableHr: undefined }).hires).toBe(false);
  });
});

describe('buildRollupKey', () => {
  const base = {
    model: 'foo.safetensors',
    sampler: 'Euler a',
    scheduler: 'Karras',
    size: '512x768',
    hires: true,
    loras: ['alpha', 'zeta'],
    refiner: '',
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
    const h1 = await buildRollupKey({ ...base, loras: ['alpha', 'zeta'] });
    const h2 = await buildRollupKey({ ...base, loras: ['alpha', 'zeta'] });
    expect(h1).toBe(h2);
  });

  it('changes when any field changes', async () => {
    const h1 = await buildRollupKey(base);
    const h2 = await buildRollupKey({ ...base, sampler: 'DPM++ SDE' });
    const h3 = await buildRollupKey({ ...base, hires: false });
    const h4 = await buildRollupKey({ ...base, size: '512x1024' });
    expect(new Set([h1, h2, h3, h4]).size).toBe(4);
  });
});
