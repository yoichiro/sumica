import { describe, it, expect } from 'vitest';
import {
  applyGalleryFilters,
  deriveFilterOptions,
  countActiveFilters,
  type GalleryFilters,
} from './galleryFilters';
import type { GenerationData } from '../App';
import type { SdModel } from './presets';

const ALL_NULL: GalleryFilters = { arch: null, model: null, sampler: null };

function mkRecord(overrides: Partial<GenerationData>): GenerationData {
  return {
    originalPrompt: '',
    enhancedPrompt: '',
    negativePrompt: '',
    width: 512,
    height: 512,
    steps: 20,
    cfgScale: 7,
    model: null,
    imageUrl: 'x',
    timestamp: 0,
    createdAt: '',
    backendMode: 'local',
    ...overrides,
  };
}

const KNOWN_MODELS: SdModel[] = [
  { title: 'juggernautXL.safetensors [abc]', type: 'sdxl' },
  { title: 'mengxMixReal.safetensors [xyz]', type: 'sd15' },
];

describe('applyGalleryFilters', () => {
  it('returns all when every filter is null', () => {
    const history = [mkRecord({ model: 'a' }), mkRecord({ model: 'b' })];
    expect(applyGalleryFilters(history, ALL_NULL, [])).toEqual(history);
  });

  it('filters by exact model title', () => {
    const history = [
      mkRecord({ model: 'a' }),
      mkRecord({ model: 'b' }),
      mkRecord({ model: 'a' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, model: 'a' }, []);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.model === 'a')).toBe(true);
  });

  it('filters by exact sampler', () => {
    const history = [
      mkRecord({ sampler: 'Euler a' }),
      mkRecord({ sampler: 'DPM++ 2M' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, sampler: 'Euler a' }, []);
    expect(out).toHaveLength(1);
    expect(out[0].sampler).toBe('Euler a');
  });

  it('filters by arch=sdxl using sdModels', () => {
    const history = [
      mkRecord({ model: 'juggernautXL.safetensors [abc]' }),
      mkRecord({ model: 'mengxMixReal.safetensors [xyz]' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, arch: 'sdxl' }, KNOWN_MODELS);
    expect(out).toHaveLength(1);
    expect(out[0].model).toContain('juggernautXL');
  });

  it('filters by arch=sd15 using sdModels', () => {
    const history = [
      mkRecord({ model: 'juggernautXL.safetensors [abc]' }),
      mkRecord({ model: 'mengxMixReal.safetensors [xyz]' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, arch: 'sd15' }, KNOWN_MODELS);
    expect(out).toHaveLength(1);
    expect(out[0].model).toContain('mengxMixReal');
  });

  it('falls back to xl-in-name heuristic when sdModels is empty', () => {
    const history = [
      mkRecord({ model: 'someXLModel.safetensors' }),
      mkRecord({ model: 'plainModel.safetensors' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, arch: 'sdxl' }, []);
    expect(out).toHaveLength(1);
    expect(out[0].model).toContain('XL');
  });

  it('applies arch + model + sampler as AND', () => {
    const history = [
      mkRecord({ model: 'juggernautXL.safetensors [abc]', sampler: 'Euler a' }),
      mkRecord({ model: 'juggernautXL.safetensors [abc]', sampler: 'DPM++ 2M' }),
      mkRecord({ model: 'mengxMixReal.safetensors [xyz]', sampler: 'Euler a' }),
    ];
    const filters: GalleryFilters = {
      arch: 'sdxl',
      model: 'juggernautXL.safetensors [abc]',
      sampler: 'Euler a',
    };
    const out = applyGalleryFilters(history, filters, KNOWN_MODELS);
    expect(out).toHaveLength(1);
    expect(out[0].sampler).toBe('Euler a');
    expect(out[0].model).toContain('juggernautXL');
  });

  it('returns empty array when input is empty', () => {
    expect(applyGalleryFilters([], ALL_NULL, [])).toEqual([]);
    expect(applyGalleryFilters([], { ...ALL_NULL, model: 'x' }, [])).toEqual([]);
  });
});

describe('deriveFilterOptions', () => {
  it('returns sorted distinct models and samplers', () => {
    const history = [
      mkRecord({ model: 'z-model', sampler: 'DPM++ 2M' }),
      mkRecord({ model: 'a-model', sampler: 'Euler a' }),
      mkRecord({ model: 'z-model', sampler: 'Euler a' }),
    ];
    const opts = deriveFilterOptions(history);
    expect(opts.models).toEqual(['a-model', 'z-model']);
    expect(opts.samplers).toEqual(['DPM++ 2M', 'Euler a']);
  });

  it('excludes null and empty-string values', () => {
    const history = [
      mkRecord({ model: null, sampler: undefined }),
      mkRecord({ model: '', sampler: '' }),
      mkRecord({ model: 'ok-model', sampler: 'ok-sampler' }),
    ];
    const opts = deriveFilterOptions(history);
    expect(opts.models).toEqual(['ok-model']);
    expect(opts.samplers).toEqual(['ok-sampler']);
  });
});

describe('countActiveFilters', () => {
  it('returns 0 when all filters are null', () => {
    expect(countActiveFilters(ALL_NULL)).toBe(0);
  });

  it('returns 1 when a single filter is set', () => {
    expect(countActiveFilters({ ...ALL_NULL, arch: 'sdxl' })).toBe(1);
    expect(countActiveFilters({ ...ALL_NULL, model: 'x' })).toBe(1);
    expect(countActiveFilters({ ...ALL_NULL, sampler: 'y' })).toBe(1);
  });

  it('returns 3 when all filters are set', () => {
    expect(countActiveFilters({ arch: 'sd15', model: 'x', sampler: 'y' })).toBe(3);
  });
});
