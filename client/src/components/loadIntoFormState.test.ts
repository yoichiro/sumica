import { describe, it, expect } from 'vitest';
import {
  computeLoadIntoFormState,
  inferSdArchitectureFromTitle,
  resolveSelectedModel,
} from './loadIntoFormState';
import type { SdModel } from './presets';

const KNOWN: SdModel[] = [
  { title: 'yayoi_mix_v25-fp16.safetensors [ca28aa4a44]', type: 'sd15' },
  { title: 'mengxMixReal_v2.safetensors [a012959261]',    type: 'sd15' },
  { title: 'juggernautXL_version6Rundiffusion.safetensors [1fe6c7ec54]', type: 'sdxl' },
  { title: 'voidnoisecorexl_r1892.safetensors [e297822f59]',              type: 'sdxl' },
  { title: 'sd_xl_base_1.0.safetensors [31e35c80fc]', type: 'sdxl' },
  { title: '2758FluxAsianUtopian_v60SchnellFp8Noclip.safetensors [ed2bd39653]', type: 'flux', fluxVariant: 'schnell' },
];

describe('inferSdArchitectureFromTitle', () => {
  it('returns null for empty title', () => {
    expect(inferSdArchitectureFromTitle('', KNOWN)).toBeNull();
  });

  it('prefers the known-models list on exact-title match', () => {
    expect(inferSdArchitectureFromTitle('yayoi_mix_v25-fp16.safetensors [ca28aa4a44]', KNOWN)).toBe('sd15');
    expect(inferSdArchitectureFromTitle('juggernautXL_version6Rundiffusion.safetensors [1fe6c7ec54]', KNOWN)).toBe('sdxl');
  });

  it('falls back to the "xl"-in-name heuristic when unknown', () => {
    expect(inferSdArchitectureFromTitle('some_random_xl_model.safetensors', KNOWN)).toBe('sdxl');
    expect(inferSdArchitectureFromTitle('some_random_sd_model.safetensors', KNOWN)).toBe('sd15');
  });

  // Reproduces the specific bug behind ADR 16's deferred fix. A history record
  // saved with a *different* hash suffix (or with no suffix at all) than the
  // one the currently-loaded SD returns must still match the known entry so
  // arch=sdxl is inferred, not the /xl/i fallback that would misfire on names
  // without "xl" like tsubaki_mix or fuduki_mix.
  const KNOWN_WITH_TSUBAKI: SdModel[] = [
    ...KNOWN,
    { title: 'tsubaki_mix_v15_fp16.safetensors [09990824e3]', type: 'sdxl' },
    { title: 'fuduki_mix_v20.safetensors [ce745cd67c]',        type: 'sdxl' },
  ];

  it('matches known SDXL models even when the stored title has a different [hash] suffix', () => {
    // Historical record was saved with an older hash — the base filename is the
    // same, so we should still find the known SDXL entry and NOT fall through
    // to /xl/i (which returns false because the name lacks "xl").
    expect(
      inferSdArchitectureFromTitle('tsubaki_mix_v15_fp16.safetensors [DIFFERENTHASH]', KNOWN_WITH_TSUBAKI),
    ).toBe('sdxl');
    expect(
      inferSdArchitectureFromTitle('fuduki_mix_v20.safetensors [OTHERHASH12]', KNOWN_WITH_TSUBAKI),
    ).toBe('sdxl');
  });

  it('matches known SDXL models even when the stored title has no [hash] suffix', () => {
    expect(
      inferSdArchitectureFromTitle('tsubaki_mix_v15_fp16.safetensors', KNOWN_WITH_TSUBAKI),
    ).toBe('sdxl');
    expect(
      inferSdArchitectureFromTitle('fuduki_mix_v20.safetensors', KNOWN_WITH_TSUBAKI),
    ).toBe('sdxl');
  });

  it('still falls back to /xl/i for names without a known base match', () => {
    // Simulated legacy record with an entirely unknown filename — no known
    // base, so we correctly land on the name heuristic. Neither "tsubaki" nor
    // "fuduki" is in KNOWN here, so both go through the /xl/i test.
    expect(inferSdArchitectureFromTitle('tsubaki_mix_v15_fp16.safetensors', KNOWN)).toBe('sd15');
    expect(inferSdArchitectureFromTitle('random_model_xl.safetensors [somehash]', KNOWN)).toBe('sdxl');
  });
});

describe('computeLoadIntoFormState — SDXL images', () => {
  it('resolves an SDXL 1024×1024 image to arch=sdxl, 1:1 M', () => {
    const s = computeLoadIntoFormState(
      { width: 1024, height: 1024, model: 'juggernautXL_version6Rundiffusion.safetensors [1fe6c7ec54]' },
      KNOWN,
    );
    expect(s.archToSet).toBe('sdxl');
    expect(s.width).toBe(1024);
    expect(s.height).toBe(1024);
    expect(s.sdxlPicker).toEqual({ ratio: '1:1', orientation: 'square', size: 'M' });
    expect(s.sd15Picker).toBeNull();
  });

  it('resolves an SDXL 1216×832 image to arch=sdxl, 3:2 landscape M', () => {
    const s = computeLoadIntoFormState(
      { width: 1216, height: 832, model: 'juggernautXL_version6Rundiffusion.safetensors [1fe6c7ec54]' },
      KNOWN,
    );
    expect(s.archToSet).toBe('sdxl');
    expect(s.sdxlPicker).toEqual({ ratio: '3:2', orientation: 'landscape', size: 'M' });
  });

  it('resolves an SDXL 832×1216 image to arch=sdxl, 3:2 portrait M', () => {
    const s = computeLoadIntoFormState(
      { width: 832, height: 1216, model: 'juggernautXL_version6Rundiffusion.safetensors [1fe6c7ec54]' },
      KNOWN,
    );
    expect(s.archToSet).toBe('sdxl');
    expect(s.sdxlPicker).toEqual({ ratio: '3:2', orientation: 'portrait', size: 'M' });
  });

  it('leaves sdxlPicker null when SDXL dimensions do not match any preset', () => {
    const s = computeLoadIntoFormState(
      { width: 999, height: 555, model: 'juggernautXL_version6Rundiffusion.safetensors [1fe6c7ec54]' },
      KNOWN,
    );
    expect(s.archToSet).toBe('sdxl');
    expect(s.width).toBe(999);
    expect(s.height).toBe(555);
    expect(s.sdxlPicker).toBeNull();
  });
});

describe('computeLoadIntoFormState — SD1.5 images', () => {
  it('resolves an SD1.5 512×512 image to arch=sd15, 1:1 S', () => {
    const s = computeLoadIntoFormState(
      { width: 512, height: 512, model: 'yayoi_mix_v25-fp16.safetensors [ca28aa4a44]' },
      KNOWN,
    );
    expect(s.archToSet).toBe('sd15');
    expect(s.width).toBe(512);
    expect(s.height).toBe(512);
    expect(s.sd15Picker).toEqual({ ratio: '1:1', orientation: 'square', size: 'S' });
    expect(s.sdxlPicker).toBeNull();
  });

  it('resolves an SD1.5 768×512 image to arch=sd15, 3:2 landscape M', () => {
    const s = computeLoadIntoFormState(
      { width: 768, height: 512, model: 'mengxMixReal_v2.safetensors [a012959261]' },
      KNOWN,
    );
    expect(s.archToSet).toBe('sd15');
    expect(s.sd15Picker).toEqual({ ratio: '3:2', orientation: 'landscape', size: 'M' });
  });

  it('resolves an SD1.5 1024×768 image to arch=sd15, 4:3 landscape M', () => {
    const s = computeLoadIntoFormState(
      { width: 1024, height: 768, model: 'mengxMixReal_v2.safetensors [a012959261]' },
      KNOWN,
    );
    expect(s.archToSet).toBe('sd15');
    expect(s.sd15Picker).toEqual({ ratio: '4:3', orientation: 'landscape', size: 'M' });
  });

  it('resolves an SD1.5 512×768 image to arch=sd15, 3:2 portrait M', () => {
    const s = computeLoadIntoFormState(
      { width: 512, height: 768, model: 'mengxMixReal_v2.safetensors [a012959261]' },
      KNOWN,
    );
    expect(s.archToSet).toBe('sd15');
    expect(s.sd15Picker).toEqual({ ratio: '3:2', orientation: 'portrait', size: 'M' });
  });

  it('resolves an SD1.5 1024×1024 image to arch=sd15, 1:1 L', () => {
    const s = computeLoadIntoFormState(
      { width: 1024, height: 1024, model: 'yayoi_mix_v25-fp16.safetensors [ca28aa4a44]' },
      KNOWN,
    );
    expect(s.archToSet).toBe('sd15');
    expect(s.sd15Picker).toEqual({ ratio: '1:1', orientation: 'square', size: 'L' });
  });
});

describe('computeLoadIntoFormState — unknown model fallback', () => {
  it('picks sdxl via "xl"-in-name when model is not in known list', () => {
    const s = computeLoadIntoFormState(
      { width: 1024, height: 1024, model: 'unknown_xl_v1.safetensors [abcdef1234]' },
      [], // empty known list
    );
    expect(s.archToSet).toBe('sdxl');
    expect(s.sdxlPicker?.ratio).toBe('1:1');
  });

  it('picks sd15 via name heuristic when model is not in known list', () => {
    const s = computeLoadIntoFormState(
      { width: 512, height: 512, model: 'unknown_realistic_v1.safetensors' },
      [],
    );
    expect(s.archToSet).toBe('sd15');
    expect(s.sd15Picker?.ratio).toBe('1:1');
  });

  it('returns archToSet=null when model is empty', () => {
    const s = computeLoadIntoFormState(
      { width: 512, height: 512, model: '' },
      KNOWN,
    );
    expect(s.archToSet).toBeNull();
    expect(s.sdxlPicker).toBeNull();
    expect(s.sd15Picker).toBeNull();
  });
});

describe('computeLoadIntoFormState — loaded enhanced prompt fields', () => {
  it('populates loadedPositive/loadedNegative from item', () => {
    const s = computeLoadIntoFormState(
      {
        width: 1024, height: 1024,
        model: 'juggernautXL_version6Rundiffusion.safetensors [1fe6c7ec54]',
        enhancedPrompt: 'masterpiece, (round face:1.2), detailed',
        negativePrompt: 'worst quality, blurry',
      },
      KNOWN,
    );
    expect(s.loadedPositive).toBe('masterpiece, (round face:1.2), detailed');
    expect(s.loadedNegative).toBe('worst quality, blurry');
  });

  it('falls back to empty strings when the item lacks enhancedPrompt/negativePrompt', () => {
    // Legacy records saved before the enhanced-prompt-load feature; also
    // externally imported images that never went through the enhance step.
    const s = computeLoadIntoFormState(
      { width: 512, height: 512, model: 'yayoi_mix_v25-fp16.safetensors [ca28aa4a44]' },
      KNOWN,
    );
    expect(s.loadedPositive).toBe('');
    expect(s.loadedNegative).toBe('');
  });

  it('falls back to empty string when the item has no fields at all', () => {
    // Theoretical fully-broken record: no fields at all. Should not crash.
    const s = computeLoadIntoFormState(
      { width: 512, height: 512, model: 'yayoi_mix_v25-fp16.safetensors [ca28aa4a44]' },
      KNOWN,
    );
    expect(s.loadedPositive).toBe('');
    expect(s.loadedNegative).toBe('');
  });

  it('treats empty-string enhancedPrompt/negativePrompt the same as missing', () => {
    // Explicit '' should be indistinguishable from undefined for callers.
    const s = computeLoadIntoFormState(
      {
        width: 1024, height: 1024,
        model: 'juggernautXL_version6Rundiffusion.safetensors [1fe6c7ec54]',
        enhancedPrompt: '',
        negativePrompt: '',
      },
      KNOWN,
    );
    expect(s.loadedPositive).toBe('');
    expect(s.loadedNegative).toBe('');
  });
});

describe('Flux records', () => {
  it('trusts modelArchitecture: flux and populates fluxPicker from dimensions', () => {
    const item = {
      width: 1024, height: 1024,
      model: '2758FluxAsianUtopian_v60SchnellFp8Noclip.safetensors [ed2bd39653]',
      modelArchitecture: 'flux' as const,
    };
    const s = computeLoadIntoFormState(item, KNOWN);
    expect(s.archToSet).toBe('flux');
    expect(s.fluxPicker).toEqual({ ratio: '1:1', orientation: 'square', size: 'M' });
    expect(s.sdxlPicker).toBeNull();
    expect(s.sd15Picker).toBeNull();
  });

  it('falls back to inferSdArchitectureFromTitle when modelArchitecture is absent (legacy record)', () => {
    const item = {
      width: 1024, height: 1024,
      model: 'sd_xl_base_1.0.safetensors [31e35c80fc]',
      // no modelArchitecture
    };
    const s = computeLoadIntoFormState(item, KNOWN);
    expect(s.archToSet).toBe('sdxl');
  });

  it('fluxPicker is null for non-preset Flux dimensions and falls through to defaults', () => {
    const item = {
      width: 999, height: 999,
      model: 'some-flux.safetensors',
      modelArchitecture: 'flux' as const,
    };
    const s = computeLoadIntoFormState(item, KNOWN);
    expect(s.archToSet).toBe('flux');
    expect(s.fluxPicker).toBeNull(); // Caller applies Flux default (1:1 M)
  });
});

// Regression tests for the "loadIntoForm doesn't restore model name" bug: SD's
// /sdapi/v1/sd-models returns titles with a "[hash]" suffix, but the same file
// can carry a different hash between the record's save time and now. The
// arch-toggle useEffect and loadIntoForm's own model set used strict equality
// against sdModels titles, so any hash drift silently fell back to the first
// model of the target arch. resolveSelectedModel normalizes on stripHashSuffix
// and rebinds to the current sdModels entry so the dropdown reflects the
// stored model.
describe('resolveSelectedModel', () => {
  it('preserves the current title when the candidate matches on hash', () => {
    // Same title as sdModels → returned verbatim.
    expect(
      resolveSelectedModel('yayoi_mix_v25-fp16.safetensors [ca28aa4a44]', 'sd15', KNOWN),
    ).toBe('yayoi_mix_v25-fp16.safetensors [ca28aa4a44]');
  });

  it('rebinds to the current sdModels title when the candidate has a stale hash', () => {
    // Candidate has an old/different hash — the base filename matches sdModels'
    // yayoi entry, so the returned value MUST be sdModels' current title, not
    // the candidate itself (otherwise the <select> value has no matching option).
    expect(
      resolveSelectedModel('yayoi_mix_v25-fp16.safetensors [OLDHASH]', 'sd15', KNOWN),
    ).toBe('yayoi_mix_v25-fp16.safetensors [ca28aa4a44]');
  });

  it('rebinds to the current sdModels title when the candidate has no hash at all', () => {
    // Ranking recipes strip the hash (normalizeParams before hashing) — bare
    // filenames must still resolve to the currently-loaded checkpoint.
    expect(
      resolveSelectedModel('juggernautXL_version6Rundiffusion.safetensors', 'sdxl', KNOWN),
    ).toBe('juggernautXL_version6Rundiffusion.safetensors [1fe6c7ec54]');
  });

  it('falls back to the first model of the target arch when no base match exists', () => {
    // Candidate names a checkpoint that isn't loaded any more — return the
    // first sdModels entry of targetArch. Order of KNOWN puts yayoi first for sd15.
    expect(
      resolveSelectedModel('some_uninstalled_model.safetensors [abc]', 'sd15', KNOWN),
    ).toBe('yayoi_mix_v25-fp16.safetensors [ca28aa4a44]');
  });

  it('scopes the base match to the target arch (does not cross architectures)', () => {
    // A model whose base filename only exists under sd15 must NOT be resolved
    // when targetArch is 'flux' — the caller just flipped to Flux, so the
    // fallback must land on a Flux model, never on the sd15 file.
    expect(
      resolveSelectedModel('yayoi_mix_v25-fp16.safetensors [ca28aa4a44]', 'flux', KNOWN),
    ).toBe('2758FluxAsianUtopian_v60SchnellFp8Noclip.safetensors [ed2bd39653]');
  });

  it('returns the first target-arch model when the candidate is empty', () => {
    expect(resolveSelectedModel('', 'flux', KNOWN)).toBe(
      '2758FluxAsianUtopian_v60SchnellFp8Noclip.safetensors [ed2bd39653]',
    );
  });

  it('returns empty when no target-arch models exist and the candidate is empty', () => {
    // Empty sdModels — nothing to fall back to.
    expect(resolveSelectedModel('', 'flux', [])).toBe('');
  });
});
