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

// Strip the trailing ` [xxxxxxxxxx]` short-hash suffix from a checkpoint title
// so equality tests survive hash changes. SD attaches a short model hash to
// the title (typically 10 hex chars, e.g. `foo.safetensors [ce745cd67c]`), and
// history records saved at different points in time can carry different hash
// values — or none at all — for the *same* underlying file. Normalizing to the
// base filename lets a stored `foo.safetensors [OLDHASH]` still find the
// currently-loaded `foo.safetensors [NEWHASH]` entry. The bracketed content is
// matched permissively (any non-`]` chars) rather than strict hex, since we
// only need to strip trailing bracketed suffixes — anchoring at end-of-string
// guarantees we don't accidentally clip brackets that live inside the name.
export function stripHashSuffix(title: string): string {
  return title.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
}

// Infer SDXL vs SD1.5 from a checkpoint title. Prefers the known-models list
// (populated by the safetensors header analysis in ADR 9); falls back to the
// "xl"-in-name heuristic (ADR 3) when the model isn't currently loaded.
// Returns null for empty title.
//
// The known-list match compares the base filename (stripping `[hash]`) so
// history records saved with a different or missing short-hash still resolve
// to the correct architecture — see ADR 16 for the failure mode this dodges.
export function inferSdArchitectureFromTitle(
  title: string,
  knownModels: SdModel[],
): 'sd15' | 'sdxl' | null {
  if (!title) return null;
  const base = stripHashSuffix(title);
  const known = knownModels.find(m => stripHashSuffix(m.title) === base);
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
