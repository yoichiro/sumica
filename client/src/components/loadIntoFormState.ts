// Pure state transitions triggered by "フォームにロード" clicks. Extracted from
// App.tsx so the intent can be unit-tested without mounting the whole React tree
// or mocking Firebase/fetch. `loadIntoForm` in App.tsx delegates the interesting
// decisions to this file; the setState calls themselves stay in the component.
import {
  findSdxlSelection,
  findSd15Selection,
  type SdxlRatio,
  type SdxlSize,
  type SdxlOrientation,
  type Sd15Ratio,
  type SdModel,
} from './presets';

export interface LoadableGenerationItem {
  width: number;
  height: number;
  model?: string | null;
}

export interface LoadIntoFormState {
  // Which architecture the model belongs to. null when the item carries no
  // model info (older records) — in that case the caller leaves the toggle
  // alone.
  archToSet: 'sd15' | 'sdxl' | null;
  // Concrete pixel dimensions to apply.
  width: number;
  height: number;
  // Picker state to apply when archToSet === 'sdxl'. null when arch is not
  // 'sdxl' or when the dimensions don't map to any SDXL preset (in which case
  // the caller keeps the current SDXL picker state untouched).
  sdxlPicker: {
    ratio: SdxlRatio;
    orientation: SdxlOrientation;
    size: SdxlSize;
  } | null;
  // Same shape for SD1.5.
  sd15Picker: {
    ratio: Sd15Ratio;
    orientation: SdxlOrientation;
    size: SdxlSize;
  } | null;
}

// Infer SDXL vs SD1.5 from a checkpoint title. Prefers the known-models list
// (populated by the safetensors header analysis in ADR 9); falls back to the
// "xl"-in-name heuristic (ADR 3) when the model isn't currently loaded.
// Returns null for empty title.
export function inferSdArchitectureFromTitle(
  title: string,
  knownModels: SdModel[],
): 'sd15' | 'sdxl' | null {
  if (!title) return null;
  const known = knownModels.find(m => m.title === title);
  if (known) return known.type;
  return /xl/i.test(title) ? 'sdxl' : 'sd15';
}

// Compute the picker+dimensions transition to apply for a "フォームにロード" click.
export function computeLoadIntoFormState(
  item: LoadableGenerationItem,
  knownModels: SdModel[],
): LoadIntoFormState {
  const arch = inferSdArchitectureFromTitle(item.model || '', knownModels);

  const state: LoadIntoFormState = {
    archToSet: arch,
    width: item.width,
    height: item.height,
    sdxlPicker: null,
    sd15Picker: null,
  };

  if (arch === 'sdxl') {
    state.sdxlPicker = findSdxlSelection(item.width, item.height);
  } else if (arch === 'sd15') {
    state.sd15Picker = findSd15Selection(item.width, item.height);
  }

  return state;
}
