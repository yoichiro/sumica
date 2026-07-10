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
  hires: true,
  loras: ['alpha', 'zeta'],
  refiner: '',
  vae: '',
};

describe('normalizeParams (server)', () => {
  it('strips hash suffix from model', () => {
    const p = normalizeParams({ model: 'foo.safetensors [abcdef1234]', width: 512, height: 768 });
    expect(p.model).toBe('foo.safetensors');
  });

  it('sorts loras', () => {
    const p = normalizeParams({ loras: [{ name: 'zeta' }, { name: 'alpha' }] });
    expect(p.loras).toEqual(['alpha', 'zeta']);
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

  // KNOWN: expected hash for the fixed P above — pin the value so this
  // test also asserts client/server hash-format compatibility. The client's
  // test uses the same P and must produce the same hex string.
  it('matches the expected fixed hash for P', () => {
    // computed manually via `echo -n '<canonical JSON>' | sha256sum`.
    // Update this constant if the NormalizedParams shape or serialisation changes.
    const expected = 'd8217d823537a550fae6ea4cd21c5796a444ca19282ba06b8b2cf1703b67771c';
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
