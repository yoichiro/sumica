import { describe, it, expect } from 'vitest';
import {
  SDXL_PRESETS,
  SDXL_SIZES,
  SD15_PRESETS,
  resolveSdxlDimensions,
  resolveSd15Dimensions,
  findSdxlSelection,
  findSd15Selection,
} from './presets';

// ---- SDXL ----

describe('resolveSdxlDimensions', () => {
  it('returns square dimensions for 1:1 regardless of orientation', () => {
    const p = SDXL_PRESETS.find(x => x.ratio === '1:1')!;
    for (const orient of ['landscape', 'portrait', 'square'] as const) {
      expect(resolveSdxlDimensions(p, orient, 'M')).toEqual({
        width: 1024, height: 1024, isSdxlBucket: true,
      });
    }
  });

  it('returns landscape dimensions for non-square ratios in landscape', () => {
    const p = SDXL_PRESETS.find(x => x.ratio === '3:2')!;
    const dims = resolveSdxlDimensions(p, 'landscape', 'M');
    expect(dims.width).toBe(1216);
    expect(dims.height).toBe(832);
  });

  it('swaps W↔H for non-square ratios in portrait', () => {
    const p = SDXL_PRESETS.find(x => x.ratio === '3:2')!;
    const dims = resolveSdxlDimensions(p, 'portrait', 'M');
    expect(dims.width).toBe(832);
    expect(dims.height).toBe(1216);
  });

  it('marks bucket M sizes and non-bucket S/L in isSdxlBucket', () => {
    const p = SDXL_PRESETS.find(x => x.ratio === '3:2')!;
    expect(resolveSdxlDimensions(p, 'landscape', 'M').isSdxlBucket).toBe(true);
    expect(resolveSdxlDimensions(p, 'landscape', 'S').isSdxlBucket).toBe(false);
    expect(resolveSdxlDimensions(p, 'landscape', 'L').isSdxlBucket).toBe(false);
  });
});

describe('findSdxlSelection', () => {
  it('recovers picker state from a landscape M dimension pair', () => {
    expect(findSdxlSelection(1216, 832)).toEqual({
      ratio: '3:2', orientation: 'landscape', size: 'M',
    });
  });

  it('recovers picker state from a portrait M dimension pair', () => {
    expect(findSdxlSelection(832, 1216)).toEqual({
      ratio: '3:2', orientation: 'portrait', size: 'M',
    });
  });

  it('recovers 1:1 as square regardless of size', () => {
    expect(findSdxlSelection(768, 768)?.ratio).toBe('1:1');
    expect(findSdxlSelection(768, 768)?.size).toBe('S');
    expect(findSdxlSelection(1024, 1024)?.size).toBe('M');
    expect(findSdxlSelection(1216, 1216)?.size).toBe('L');
    expect(findSdxlSelection(768, 768)?.orientation).toBe('square');
  });

  it('returns null for dimensions not in any preset', () => {
    expect(findSdxlSelection(999, 999)).toBeNull();
  });

  it('round-trips every SDXL preset via resolve → find', () => {
    for (const preset of SDXL_PRESETS) {
      for (const size of SDXL_SIZES) {
        for (const orient of ['landscape', 'portrait'] as const) {
          const dims = resolveSdxlDimensions(preset, orient, size);
          const found = findSdxlSelection(dims.width, dims.height);
          expect(found, `${preset.ratio} ${orient} ${size} = ${dims.width}×${dims.height}`).not.toBeNull();
          expect(found!.ratio).toBe(preset.ratio);
          expect(found!.size).toBe(size);
          if (preset.isSquare) {
            expect(found!.orientation).toBe('square');
          } else {
            expect(found!.orientation).toBe(orient);
          }
        }
      }
    }
  });
});

// ---- SD1.5 ----

describe('resolveSd15Dimensions', () => {
  it('returns 1:1 dimensions for each square size', () => {
    const p = SD15_PRESETS.find(x => x.ratio === '1:1')!;
    expect(resolveSd15Dimensions(p, 'square', 'S')).toEqual({ width: 512,  height: 512  });
    expect(resolveSd15Dimensions(p, 'square', 'M')).toEqual({ width: 768,  height: 768  });
    expect(resolveSd15Dimensions(p, 'square', 'L')).toEqual({ width: 1024, height: 1024 });
  });

  it('returns landscape M for non-square regardless of size arg', () => {
    const p = SD15_PRESETS.find(x => x.ratio === '3:2')!;
    // SD1.5 non-square presets only expose M — size arg is ignored.
    expect(resolveSd15Dimensions(p, 'landscape', 'S')).toEqual({ width: 768, height: 512 });
    expect(resolveSd15Dimensions(p, 'landscape', 'M')).toEqual({ width: 768, height: 512 });
    expect(resolveSd15Dimensions(p, 'landscape', 'L')).toEqual({ width: 768, height: 512 });
  });

  it('swaps W↔H for non-square ratios in portrait', () => {
    const p = SD15_PRESETS.find(x => x.ratio === '3:2')!;
    expect(resolveSd15Dimensions(p, 'portrait', 'M')).toEqual({ width: 512, height: 768 });
  });
});

describe('findSd15Selection', () => {
  it('recovers 1:1 sizes distinctly (S=512, M=768, L=1024)', () => {
    expect(findSd15Selection(512, 512)).toEqual({ ratio: '1:1', orientation: 'square', size: 'S' });
    expect(findSd15Selection(768, 768)).toEqual({ ratio: '1:1', orientation: 'square', size: 'M' });
    expect(findSd15Selection(1024, 1024)).toEqual({ ratio: '1:1', orientation: 'square', size: 'L' });
  });

  it('recovers non-square landscape as M orientation=landscape', () => {
    expect(findSd15Selection(768, 512)).toEqual({ ratio: '3:2', orientation: 'landscape', size: 'M' });
    expect(findSd15Selection(1024, 768)).toEqual({ ratio: '4:3', orientation: 'landscape', size: 'M' });
    expect(findSd15Selection(1024, 512)).toEqual({ ratio: '2:1', orientation: 'landscape', size: 'M' });
    expect(findSd15Selection(1024, 576)).toEqual({ ratio: '16:9', orientation: 'landscape', size: 'M' });
    expect(findSd15Selection(640, 512)).toEqual({ ratio: '5:4', orientation: 'landscape', size: 'M' });
    expect(findSd15Selection(640, 384)).toEqual({ ratio: '5:3', orientation: 'landscape', size: 'M' });
  });

  it('recovers non-square portrait as swapped W↔H', () => {
    expect(findSd15Selection(512, 768)).toEqual({ ratio: '3:2', orientation: 'portrait', size: 'M' });
    expect(findSd15Selection(768, 1024)).toEqual({ ratio: '4:3', orientation: 'portrait', size: 'M' });
    expect(findSd15Selection(512, 1024)).toEqual({ ratio: '2:1', orientation: 'portrait', size: 'M' });
  });

  it('returns null for dimensions not in any preset', () => {
    expect(findSd15Selection(999, 999)).toBeNull();
    expect(findSd15Selection(700, 500)).toBeNull();
  });

  it('round-trips every SD1.5 preset via resolve → find', () => {
    for (const preset of SD15_PRESETS) {
      const sizes = preset.isSquare ? SDXL_SIZES : (['M'] as const);
      const orientations = preset.isSquare ? (['square'] as const) : (['landscape', 'portrait'] as const);
      for (const size of sizes) {
        for (const orient of orientations) {
          const dims = resolveSd15Dimensions(preset, orient, size);
          const found = findSd15Selection(dims.width, dims.height);
          expect(found, `${preset.ratio} ${orient} ${size} = ${dims.width}×${dims.height}`).not.toBeNull();
          expect(found!.ratio).toBe(preset.ratio);
          if (preset.isSquare) {
            expect(found!.size).toBe(size);
            expect(found!.orientation).toBe('square');
          } else {
            expect(found!.orientation).toBe(orient);
          }
        }
      }
    }
  });
});
