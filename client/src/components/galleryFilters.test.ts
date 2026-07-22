import { describe, it, expect } from 'vitest';
import {
  applyGalleryFilters,
  deriveFilterOptions,
  countActiveFilters,
  type GalleryFilters,
} from './galleryFilters';
import type { GenerationData } from '../App';
import type { SdModel } from './presets';

const ALL_NULL: GalleryFilters = { arch: null, model: null, sampler: null, aspectRatio: null, orientation: null };

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

  it('filters by arch=flux using sdModels', () => {
    const knownModelsWithFlux: SdModel[] = [
      ...KNOWN_MODELS,
      { title: 'fluxDev.safetensors [fff]', type: 'flux' },
    ];
    const history = [
      mkRecord({ model: 'juggernautXL.safetensors [abc]' }),
      mkRecord({ model: 'fluxDev.safetensors [fff]' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, arch: 'flux' }, knownModelsWithFlux);
    expect(out).toHaveLength(1);
    expect(out[0].model).toContain('fluxDev');
  });

  it('prefers persisted modelArchitecture over title inference when present', () => {
    // A record's modelArchitecture is ground truth recorded at generation time
    // (ADR 16 / ADR 42); it should win even if the checkpoint title/known-model
    // lookup would otherwise resolve differently (e.g. a renamed or unlisted model).
    const history = [
      mkRecord({ model: 'renamedCheckpoint.safetensors', modelArchitecture: 'flux' }),
      mkRecord({ model: 'renamedCheckpoint.safetensors' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, arch: 'flux' }, []);
    expect(out).toHaveLength(1);
    expect(out[0].modelArchitecture).toBe('flux');
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
    // The model filter carries the stripped title (that's what deriveFilterOptions
    // hands to the dropdown and what the popover writes back to filters.model).
    const history = [
      mkRecord({ model: 'juggernautXL.safetensors [abc]', sampler: 'Euler a' }),
      mkRecord({ model: 'juggernautXL.safetensors [abc]', sampler: 'DPM++ 2M' }),
      mkRecord({ model: 'mengxMixReal.safetensors [xyz]', sampler: 'Euler a' }),
    ];
    const filters: GalleryFilters = {
      arch: 'sdxl',
      model: 'juggernautXL.safetensors',
      sampler: 'Euler a',
      aspectRatio: null,
      orientation: null,
    };
    const out = applyGalleryFilters(history, filters, KNOWN_MODELS);
    expect(out).toHaveLength(1);
    expect(out[0].sampler).toBe('Euler a');
    expect(out[0].model).toContain('juggernautXL');
  });

  it('matches records with and without a [hash] suffix under the same stripped filter value', () => {
    // Older records may carry `[hash]`, newer ones may not — both should match
    // the same stripped filter value that the dropdown offers.
    const history = [
      mkRecord({ model: 'coolModel.safetensors [abc]' }),
      mkRecord({ model: 'coolModel.safetensors' }),
      mkRecord({ model: 'otherModel.safetensors [def]' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, model: 'coolModel.safetensors' }, []);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.model?.startsWith('coolModel.safetensors'))).toBe(true);
  });

  it('filters by aspect ratio (portrait and landscape shapes of the same ratio both match)', () => {
    const history = [
      mkRecord({ width: 768, height: 1024 }),   // portrait 4:3
      mkRecord({ width: 1024, height: 768 }),   // landscape 4:3
      mkRecord({ width: 512, height: 1024 }),   // portrait 2:1
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, aspectRatio: '4:3' }, []);
    expect(out).toHaveLength(2);
    expect(out.map((r) => `${r.width}x${r.height}`).sort()).toEqual(['1024x768', '768x1024']);
  });

  it('filters by orientation independently of aspect ratio', () => {
    const history = [
      mkRecord({ width: 768, height: 1024 }),   // portrait
      mkRecord({ width: 1024, height: 768 }),   // landscape
      mkRecord({ width: 512, height: 512 }),    // square (should not match either)
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, orientation: 'landscape' }, []);
    expect(out).toHaveLength(1);
    expect(out[0].width).toBe(1024);
    expect(out[0].height).toBe(768);
  });

  it('combines aspect ratio + orientation as AND', () => {
    const history = [
      mkRecord({ width: 768, height: 1024 }),   // portrait 4:3 ✓
      mkRecord({ width: 1024, height: 768 }),   // landscape 4:3 ✗ (wrong orientation)
      mkRecord({ width: 384, height: 512 }),    // portrait 4:3 (smaller) ✓
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, aspectRatio: '4:3', orientation: 'portrait' }, []);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.height > r.width)).toBe(true);
  });

  it('square records match only when neither aspectRatio nor orientation filter (or aspectRatio=1:1) is applied', () => {
    const history = [mkRecord({ width: 768, height: 768 })];
    // Square + orientation=landscape → 0 (square isn't landscape)
    expect(applyGalleryFilters(history, { ...ALL_NULL, orientation: 'landscape' }, [])).toHaveLength(0);
    // Square + aspectRatio=1:1 → matches
    expect(applyGalleryFilters(history, { ...ALL_NULL, aspectRatio: '1:1' }, [])).toHaveLength(1);
    // Square + no filters → matches
    expect(applyGalleryFilters(history, ALL_NULL, [])).toHaveLength(1);
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

  it('collapses hash-suffixed variants of the same base title into one distinct entry', () => {
    // Same base filename with different [hash] suffixes (or none) should show
    // up once in the dropdown — otherwise the user sees three visually-identical
    // options for what is effectively the same checkpoint.
    const history = [
      mkRecord({ model: 'foo.safetensors [abc]' }),
      mkRecord({ model: 'foo.safetensors [def]' }),
      mkRecord({ model: 'foo.safetensors' }),
      mkRecord({ model: 'bar.safetensors [xyz]' }),
    ];
    const opts = deriveFilterOptions(history);
    expect(opts.models).toEqual(['bar.safetensors', 'foo.safetensors']);
  });

  it('extracts distinct aspect ratios sorted widest-first, collapsing portrait/landscape of the same shape', () => {
    const history = [
      mkRecord({ width: 768, height: 1024 }),   // portrait 4:3 → 1024×768 canonical
      mkRecord({ width: 1024, height: 768 }),   // landscape 4:3 → 1024×768 canonical (same)
      mkRecord({ width: 512, height: 512 }),    // 1:1
      mkRecord({ width: 1920, height: 1080 }),  // 16:9
    ];
    const opts = deriveFilterOptions(history);
    // widest first: 16:9 (1.777), 4:3 (1.333), 1:1 (1.0). Label = "ratio (larger×smaller)".
    expect(opts.aspectRatios).toEqual([
      { ratio: '16:9', label: '16:9 (1920×1080)' },
      { ratio: '4:3', label: '4:3 (1024×768)' },
      { ratio: '1:1', label: '1:1 (512×512)' },
    ]);
  });

  it('lists multiple pixel dimensions per aspect ratio bigger-first when the ratio spans several sizes', () => {
    const history = [
      mkRecord({ width: 512, height: 512 }),
      mkRecord({ width: 1024, height: 1024 }),
      mkRecord({ width: 768, height: 768 }),
    ];
    const opts = deriveFilterOptions(history);
    expect(opts.aspectRatios).toEqual([
      { ratio: '1:1', label: '1:1 (1024×1024 / 768×768 / 512×512)' },
    ]);
  });

  it('extracts distinct orientations excluding square', () => {
    const history = [
      mkRecord({ width: 768, height: 1024 }),   // portrait
      mkRecord({ width: 1024, height: 768 }),   // landscape
      mkRecord({ width: 512, height: 512 }),    // square (excluded)
    ];
    const opts = deriveFilterOptions(history);
    expect(opts.orientations.sort()).toEqual(['landscape', 'portrait']);
  });

  it('returns empty orientations when only square records exist', () => {
    const history = [mkRecord({ width: 768, height: 768 })];
    const opts = deriveFilterOptions(history);
    expect(opts.orientations).toEqual([]);
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
    expect(countActiveFilters({ ...ALL_NULL, aspectRatio: '4:3' })).toBe(1);
    expect(countActiveFilters({ ...ALL_NULL, orientation: 'landscape' })).toBe(1);
  });

  it('returns 5 when every filter is set', () => {
    expect(countActiveFilters({
      arch: 'sd15',
      model: 'x',
      sampler: 'y',
      aspectRatio: '4:3',
      orientation: 'portrait',
    })).toBe(5);
  });
});
