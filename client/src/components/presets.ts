// Aspect-ratio preset tables shared by App.tsx (main form picker + architecture
// switching effects), BatchGenerationModal, and any other UI that has to reason
// about the ratio/orientation/size axes. See ADR 10 (SDXL) and ADR 14 (SD1.5)
// for the design rationale and quality assumptions behind each entry.

export type Architecture = 'sd15' | 'sdxl';
export type SdModel = { title: string; type: Architecture };
export type SdLora = { name: string; type: Architecture | 'unknown' };

export function getArchLabel(arch: Architecture): string {
  if (arch === 'sdxl') return 'SDXL';
  return 'SD1.5';
}

// ---- SDXL ----

export type SdxlRatio = '1:1' | '4:3' | '9:7' | '3:2' | '16:9' | '21:9' | '3:1';
export type SdxlSize = 'S' | 'M' | 'L';
export type SdxlOrientation = 'landscape' | 'portrait' | 'square';

export interface SdxlSizeSpec {
  width: number;   // landscape width (or square side length)
  height: number;  // landscape height (or square side length)
  isSdxlBucket: boolean;
}

export interface SdxlPreset {
  ratio: SdxlRatio;
  label: string;
  isSquare: boolean;
  ratioIsBucket: boolean;
  sizes: Record<SdxlSize, SdxlSizeSpec>;
}

export const SDXL_SIZES: readonly SdxlSize[] = ['S', 'M', 'L'];

export const SDXL_PRESETS: readonly SdxlPreset[] = [
  {
    ratio: '1:1', label: '1:1', isSquare: true, ratioIsBucket: true,
    sizes: {
      S: { width: 768,  height: 768,  isSdxlBucket: false },
      M: { width: 1024, height: 1024, isSdxlBucket: true  },
      L: { width: 1216, height: 1216, isSdxlBucket: false },
    },
  },
  {
    ratio: '4:3', label: '4:3', isSquare: false, ratioIsBucket: false,
    sizes: {
      S: { width: 768,  height: 576,  isSdxlBucket: false },
      M: { width: 1152, height: 832,  isSdxlBucket: true  }, // SDXL 18:13 bucket
      L: { width: 1344, height: 1024, isSdxlBucket: false },
    },
  },
  {
    ratio: '9:7', label: '9:7', isSquare: false, ratioIsBucket: true,
    sizes: {
      S: { width: 896,  height: 768,  isSdxlBucket: false },
      M: { width: 1152, height: 896,  isSdxlBucket: true  },
      // 1408×1088 ≈ 9:7 (1.294 vs 1.286), ÷64 friendly, distinct from 4:3 L
      // (1344×1024). Keeps the SDXL-native 9:7 flavor at L instead of collapsing
      // onto the 4:3 approximation.
      L: { width: 1408, height: 1088, isSdxlBucket: false },
    },
  },
  {
    ratio: '3:2', label: '3:2', isSquare: false, ratioIsBucket: false,
    sizes: {
      S: { width: 1152, height: 768,  isSdxlBucket: false },
      M: { width: 1216, height: 832,  isSdxlBucket: true  }, // SDXL 19:13 bucket
      L: { width: 1344, height: 896,  isSdxlBucket: false },
    },
  },
  {
    ratio: '16:9', label: '16:9', isSquare: false, ratioIsBucket: false,
    sizes: {
      S: { width: 1024, height: 576,  isSdxlBucket: false },
      M: { width: 1344, height: 768,  isSdxlBucket: true  }, // SDXL 7:4 bucket
      L: { width: 1600, height: 896,  isSdxlBucket: false },
    },
  },
  {
    ratio: '21:9', label: '21:9', isSquare: false, ratioIsBucket: false,
    sizes: {
      S: { width: 1344, height: 576,  isSdxlBucket: false },
      M: { width: 1536, height: 640,  isSdxlBucket: true  }, // SDXL 12:5 bucket
      L: { width: 1792, height: 768,  isSdxlBucket: false },
    },
  },
  {
    ratio: '3:1', label: '3:1', isSquare: false, ratioIsBucket: true,
    sizes: {
      S: { width: 1344, height: 448,  isSdxlBucket: false },
      M: { width: 1728, height: 576,  isSdxlBucket: true  },
      L: { width: 1920, height: 640,  isSdxlBucket: false },
    },
  },
];

// (ratio, orientation, size) → concrete (width, height). Portrait swaps landscape's
// width/height; square ignores orientation and returns the stored equal-sided pair.
export function resolveSdxlDimensions(
  preset: SdxlPreset,
  orientation: SdxlOrientation,
  size: SdxlSize,
): { width: number; height: number; isSdxlBucket: boolean } {
  const spec = preset.sizes[size];
  if (preset.isSquare || orientation !== 'portrait') {
    return { width: spec.width, height: spec.height, isSdxlBucket: spec.isSdxlBucket };
  }
  return { width: spec.height, height: spec.width, isSdxlBucket: spec.isSdxlBucket };
}

// Reverse-map a raw (width, height) back to preset coordinates. Used to seed the
// SDXL picker from the currently-held width/height state (e.g. after switching
// architectures). Returns null when no preset matches — the caller then falls back
// to a default (1:1 / square / M).
export function findSdxlSelection(
  width: number,
  height: number,
): { ratio: SdxlRatio; orientation: SdxlOrientation; size: SdxlSize } | null {
  for (const preset of SDXL_PRESETS) {
    for (const size of SDXL_SIZES) {
      const spec = preset.sizes[size];
      if (preset.isSquare) {
        if (spec.width === width && spec.height === height) {
          return { ratio: preset.ratio, orientation: 'square', size };
        }
      } else {
        if (spec.width === width && spec.height === height) {
          return { ratio: preset.ratio, orientation: 'landscape', size };
        }
        if (spec.height === width && spec.width === height) {
          return { ratio: preset.ratio, orientation: 'portrait', size };
        }
      }
    }
  }
  return null;
}

// ---- SD1.5 ----

export type Sd15Ratio = '1:1' | '5:4' | '4:3' | '3:2' | '5:3' | '16:9' | '2:1';

export interface Sd15SizeSpec {
  width: number;
  height: number;
}

export interface Sd15Preset {
  ratio: Sd15Ratio;
  label: string;
  isSquare: boolean;
  // For 1:1: S, M, L all defined. For non-square: only M — S/L absent so the
  // size toggle can hide itself when the picker is on a non-square ratio.
  sizes: {
    S?: Sd15SizeSpec;
    M: Sd15SizeSpec;
    L?: Sd15SizeSpec;
  };
}

export const SD15_PRESETS: readonly Sd15Preset[] = [
  {
    ratio: '1:1', label: '1:1', isSquare: true,
    sizes: {
      S: { width: 512,  height: 512  },
      M: { width: 768,  height: 768  },
      L: { width: 1024, height: 1024 },
    },
  },
  {
    ratio: '5:4', label: '5:4', isSquare: false,
    sizes: { M: { width: 640,  height: 512 } },
  },
  {
    ratio: '4:3', label: '4:3', isSquare: false,
    sizes: { M: { width: 1024, height: 768 } },
  },
  {
    ratio: '3:2', label: '3:2', isSquare: false,
    sizes: { M: { width: 768,  height: 512 } },
  },
  {
    ratio: '5:3', label: '5:3', isSquare: false,
    sizes: { M: { width: 640,  height: 384 } },
  },
  {
    ratio: '16:9', label: '16:9', isSquare: false,
    sizes: { M: { width: 1024, height: 576 } },
  },
  {
    ratio: '2:1', label: '2:1', isSquare: false,
    sizes: { M: { width: 1024, height: 512 } },
  },
];

// (ratio, orientation, size) → concrete (width, height) for SD1.5. Non-square
// ratios only have an M size regardless of what `size` is passed. Portrait
// orientation swaps landscape's W↔H.
export function resolveSd15Dimensions(
  preset: Sd15Preset,
  orientation: SdxlOrientation,
  size: SdxlSize,
): { width: number; height: number } {
  if (preset.isSquare) {
    const spec = preset.sizes[size] ?? preset.sizes.M;
    return { width: spec.width, height: spec.height };
  }
  const M = preset.sizes.M;
  if (orientation === 'portrait') {
    return { width: M.height, height: M.width };
  }
  return { width: M.width, height: M.height };
}

// Reverse-map a raw (width, height) back to SD1.5 picker coordinates. Used to
// seed the picker on architecture switches and loadIntoForm. Returns null when
// the dimensions don't match any preset (e.g. legacy freeform-picker records).
export function findSd15Selection(
  width: number,
  height: number,
): { ratio: Sd15Ratio; orientation: SdxlOrientation; size: SdxlSize } | null {
  for (const preset of SD15_PRESETS) {
    if (preset.isSquare) {
      for (const size of SDXL_SIZES) {
        const spec = preset.sizes[size];
        if (spec && spec.width === width && spec.height === height) {
          return { ratio: preset.ratio, orientation: 'square', size };
        }
      }
    } else {
      const M = preset.sizes.M;
      if (M.width === width && M.height === height) {
        return { ratio: preset.ratio, orientation: 'landscape', size: 'M' };
      }
      if (M.height === width && M.width === height) {
        return { ratio: preset.ratio, orientation: 'portrait', size: 'M' };
      }
    }
  }
  return null;
}

