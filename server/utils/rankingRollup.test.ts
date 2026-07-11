import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  normalizeParams,
  buildRollupKey,
  updateLocalRollup,
  type NormalizedParams,
} from './rankingRollup.js';

let tmpDir: string;
let tmpFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollup-test-'));
  tmpFile = path.join(tmpDir, 'rankingRollups.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const P: NormalizedParams = {
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
  loras: [
    { name: 'alpha', weight: 0.7 },
    { name: 'zeta', weight: 0.8 },
  ],
  refiner: '',
  refinerSwitchAt: 0.8,
  vae: '',
};

describe('normalizeParams (server)', () => {
  it('strips hash suffix from model', () => {
    const p = normalizeParams({ model: 'foo.safetensors [abcdef1234]', width: 512, height: 768 });
    expect(p.model).toBe('foo.safetensors');
  });

  it('sorts loras by name and preserves weights', () => {
    const p = normalizeParams({
      loras: [{ name: 'zeta', weight: 0.8 }, { name: 'alpha', weight: 0.7 }],
    });
    expect(p.loras).toEqual([
      { name: 'alpha', weight: 0.7 },
      { name: 'zeta', weight: 0.8 },
    ]);
  });

  it('defaults weight=1 when omitted', () => {
    const p = normalizeParams({ loras: [{ name: 'alpha' }] });
    expect(p.loras).toEqual([{ name: 'alpha', weight: 1 }]);
  });

  it('extracts steps/cfg/hires-detail/refiner-switch fields', () => {
    const p = normalizeParams({
      steps: 25,
      cfgScale: 6.5,
      enableHr: true,
      hrUpscaler: 'Latent',
      hrScale: 2,
      hrSecondPassSteps: 15,
      denoisingStrength: 0.5,
      refinerSwitchAt: 0.7,
    });
    expect(p.steps).toBe(25);
    expect(p.cfg).toBe(6.5);
    expect(p.hires).toBe(true);
    expect(p.hiresUpscaler).toBe('Latent');
    expect(p.hiresScale).toBe(2);
    expect(p.hiresSteps).toBe(15);
    expect(p.hiresDenoising).toBe(0.5);
    expect(p.refinerSwitchAt).toBe(0.7);
  });
});

describe('buildRollupKey (server)', () => {
  it('produces 64-char hex', () => {
    expect(buildRollupKey(P)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(buildRollupKey(P)).toBe(buildRollupKey(P));
  });

  it('changes when any field changes', () => {
    const alt = { ...P, sampler: 'DPM++ SDE' };
    expect(buildRollupKey(P)).not.toBe(buildRollupKey(alt));
  });

  it('changes when a lora weight changes', () => {
    const alt: NormalizedParams = {
      ...P,
      loras: [
        { name: 'alpha', weight: 0.9 },
        { name: 'zeta', weight: 0.8 },
      ],
    };
    expect(buildRollupKey(P)).not.toBe(buildRollupKey(alt));
  });

  // KNOWN: expected hash for the fixed P above — pin the value so this
  // test also asserts client/server hash-format compatibility. The client's
  // test uses the same P and must produce the same hex string.
  it('matches the expected fixed hash for P', () => {
    // computed manually via `echo -n '<canonical JSON>' | sha256sum`.
    // Update this constant if the NormalizedParams shape or serialisation changes.
    const expected = 'a1c12356a84a8c60b8868ec0d1c8f07d484188ec0888298dc6d3ccf88a7be6bb';
    expect(buildRollupKey(P)).toBe(expected);
  });
});

describe('updateLocalRollup', () => {
  it('creates the file if missing and writes one entry', () => {
    expect(fs.existsSync(tmpFile)).toBe(false);
    updateLocalRollup(tmpFile, P, 1, 0);
    const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    const hash = buildRollupKey(P);
    expect(data[hash].total).toBe(1);
    expect(data[hash].favs).toBe(0);
    expect(data[hash].params).toEqual(P);
    expect(data[hash].version).toBe(1);
  });

  it('increments an existing entry', () => {
    updateLocalRollup(tmpFile, P, 1, 0);
    updateLocalRollup(tmpFile, P, 1, 1);
    const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    const hash = buildRollupKey(P);
    expect(data[hash].total).toBe(2);
    expect(data[hash].favs).toBe(1);
  });

  it('decrements without going below zero', () => {
    updateLocalRollup(tmpFile, P, 2, 1);
    updateLocalRollup(tmpFile, P, -1, -1);
    const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    const hash = buildRollupKey(P);
    expect(data[hash].total).toBe(1);
    expect(data[hash].favs).toBe(0);
  });

  it('clamps counters at zero even if callers pass excessive negatives', () => {
    updateLocalRollup(tmpFile, P, 1, 0);
    updateLocalRollup(tmpFile, P, -5, -5);
    const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    const hash = buildRollupKey(P);
    expect(data[hash].total).toBe(0);
    expect(data[hash].favs).toBe(0);
  });

  it('preserves other entries when updating one', () => {
    const P2 = { ...P, sampler: 'DPM++ SDE' };
    updateLocalRollup(tmpFile, P, 1, 0);
    updateLocalRollup(tmpFile, P2, 1, 0);
    const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(Object.keys(data)).toHaveLength(2);
  });
});
