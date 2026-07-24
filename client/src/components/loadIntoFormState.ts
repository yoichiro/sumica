// Pure state transitions triggered by "フォームにロード" clicks. Extracted from
// App.tsx so the intent can be unit-tested without mounting the whole React tree
// or mocking Firebase/fetch. `loadIntoForm` in App.tsx delegates the interesting
// decisions to this file; the setState calls themselves stay in the component.
import {
  findSdxlSelection,
  findSd15Selection,
  findFluxSelection,
  type SdxlRatio,
  type SdxlSize,
  type SdxlOrientation,
  type Sd15Ratio,
  type FluxRatio,
  type FluxSize,
  type SdModel,
  type Architecture,
} from './presets';

export interface LoadableGenerationItem {
  width: number;
  height: number;
  model?: string | null;
  // Loaded enhanced prompt fields — all optional to keep legacy records
  // and pre-feature imports working without changes.
  enhancedPrompt?: string;
  negativePrompt?: string;
  // Ground-truth architecture from the user's toggle at generation time.
  // Absent on legacy records — computeLoadIntoFormState then falls back to
  // inferSdArchitectureFromTitle.
  modelArchitecture?: Architecture;
}

export interface LoadIntoFormState {
  // Which architecture the model belongs to. null when the item carries no
  // model info (older records) — in that case the caller leaves the toggle
  // alone.
  archToSet: Architecture | null;
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
  // Same shape for Flux. null when arch is not 'flux' or when the dimensions
  // don't map to any Flux preset (the caller then keeps/defaults the current
  // Flux picker state, e.g. 1:1 M).
  fluxPicker: {
    ratio: FluxRatio;
    orientation: SdxlOrientation;
    size: FluxSize;
  } | null;
  // Loaded enhanced prompt to seed the form's read-only panel and skip the
  // enhance step on the next generate. Empty strings when the item has no
  // enhanced prompt saved (legacy records / external imports) — the caller
  // then falls back to the normal enhance flow.
  loadedPositive: string;
  loadedNegative: string;
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

// Resolve a stored/candidate checkpoint identifier to the current sdModels
// title (with hash) it should map to. Callers pass whatever they have — a
// full "name.safetensors [hash]" from a persisted history record, a bare
// "name.safetensors" from a normalized ranking recipe, or an empty string.
//
// Matching is done on the base filename (hash suffix stripped, see
// stripHashSuffix's docstring for why history records may carry a stale or
// missing hash). When targetArch is given, the base match is scoped to
// models of that architecture — this fixes the bug where switching arch on
// loadIntoForm dropped the model back to the first model of the arch just
// because the equality-checked title was still the pre-flip one.
//
// Returns:
//   - candidate's current sdModels title when a base match is found in
//     targetArch (this is the fix: same file, hash may have changed)
//   - the first sdModels entry of targetArch as a fallback when no base match
//   - '' when there are no models of targetArch and no candidate to preserve
export function resolveSelectedModel(
  candidate: string,
  targetArch: Architecture | null,
  knownModels: SdModel[],
): string {
  const base = candidate ? stripHashSuffix(candidate) : '';
  if (base) {
    const matched = targetArch
      ? knownModels.find(m => m.type === targetArch && stripHashSuffix(m.title) === base)
      : knownModels.find(m => stripHashSuffix(m.title) === base);
    if (matched) return matched.title;
  }
  if (targetArch) {
    return knownModels.find(m => m.type === targetArch)?.title ?? '';
  }
  return candidate;
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
): Architecture | null {
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
  // Precedence: trust item.modelArchitecture when present (ground truth
  // recorded at generation time — see ADR 16); otherwise fall back to the
  // existing name/title heuristic for legacy records that predate it.
  const arch: Architecture | null = item.modelArchitecture ?? inferSdArchitectureFromTitle(item.model || '', knownModels);

  const state: LoadIntoFormState = {
    archToSet: arch,
    width: item.width,
    height: item.height,
    sdxlPicker: null,
    sd15Picker: null,
    fluxPicker: null,
    loadedPositive: '',
    loadedNegative: '',
  };

  if (arch === 'flux') {
    state.fluxPicker = findFluxSelection(item.width, item.height);
  } else if (arch === 'sdxl') {
    state.sdxlPicker = findSdxlSelection(item.width, item.height);
  } else if (arch === 'sd15') {
    state.sd15Picker = findSd15Selection(item.width, item.height);
  }

  state.loadedPositive = item.enhancedPrompt || '';
  state.loadedNegative = item.negativePrompt || '';

  return state;
}
