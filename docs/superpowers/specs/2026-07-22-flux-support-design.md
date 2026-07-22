# Flux Support & 3-Way Architecture — Design Spec

- Date: 2026-07-22
- Status: approved for implementation planning
- Related ADRs: [[adr-0009-safetensors-header-sdxl-detection]], [[adr-0016-defer-sdxl-misclassification-fix]], [[adr-0029-sd-sdxl-architecture-ui-handling]], [[adr-0010-sdxl-ratio-orientation-size-preset]], [[adr-0014-sd15-ratio-orientation-size-preset]]

## Context

Sumica currently classifies checkpoints as either SDXL or "not SDXL (= SD1.5)" via `isSdxlCheckpoint()` in `server/index.ts`. Flux checkpoints (e.g. `2758FluxAsianUtopian_v60SchnellFp8Noclip.safetensors`) fall into the `sd15` bucket by default, which was explicitly documented as intentional in ADR-9 and flagged as "future work" in ADR-29 ("SD3・Flux・Sana 等が広まると、2 値トグルでは足りなくなる可能性があります").

The user runs AUTOMATIC1111 v1.10+ at `E:\stable-diffusion-webui\`, which natively supports Flux. Header inspection of the current checkpoint confirmed it is a real Flux [schnell] fp8 with LoRA merges baked in (776 tensors, `model.diffusion_model.double_blocks/single_blocks/img_in/txt_in/vector_in/time_in` DiT pattern, ComfyUI metadata references `flux1-schnell.safetensors`). Users generating with this checkpoint via Sumica get suboptimal defaults (SD1.5 preset table with 512² picker, CFG 7 default, non-empty negative prompt, `(phrase:weight)` emphasis in the LLM output — none of which Flux benefits from).

ADR-16 also deferred a related fix: when `isSdxlCheckpoint()` falls back to the name heuristic (e.g. remote SD environment where header read fails), non-"XL"-named SDXL checkpoints are misclassified as SD1.5, breaking the "load into form" flow. The recommended fix (case A) was to persist `modelArchitecture` on each generation record — a change that naturally combines with Flux support since both touch the same metadata shape.

This spec covers the full stack change to add Flux as a first-class third architecture, including the ADR-16 persistence fix.

## Goals

1. Classify Flux checkpoints (and their variant: schnell vs dev) accurately at the server.
2. Introduce a 3-way `modelTypeFilter: 'sd15' | 'sdxl' | 'flux'` toggle that acts as the single source of truth for model picker, preset table, batch scope, and default value application — following ADR-29's design.
3. Deliver Flux-appropriate UX defaults: steps=4 (schnell) / 25 (dev), CFG=1.0 (schnell) / 3.5 (dev), Euler + Simple sampler, negative prompt disabled.
4. Emit an LLM system prompt variant for Flux that produces natural-language prompts (no `(phrase:weight)` emphasis) and always returns an empty negative.
5. Persist `modelArchitecture` on every new generation, solving ADR-16's SDXL misclassification bug as a side effect.
6. Keep the existing SD1.5 and SDXL UX untouched.

## Non-Goals

- Detection of Flux LoRA training rank/quantization details beyond `'flux'` classification.
- Distinct picker layout for schnell vs dev (they share the same `FLUX_PRESETS`; only default steps/CFG differ).
- Runtime editing of Flux vs SD1.5 vs SDXL on a per-generation basis without touching the model dropdown (out of scope; user picks a model → arch is derived).
- SD.Next / reForge / ComfyUI compatibility beyond AUTOMATIC1111 v1.10+.
- Backfilling `modelArchitecture` on existing Firestore/local records. Legacy records fall back to the current heuristic path unchanged.
- Refiner / external VAE / Hires.fix support for Flux (Flux uses a different upscaling / VAE flow — deferred).

## Architecture

### Common type

```typescript
type Architecture = 'sd15' | 'sdxl' | 'flux';
type FluxVariant = 'schnell' | 'dev';
```

Every layer (server API, client state, persisted metadata) uses this same union. `fluxVariant` accompanies model info at the API/UI layer but is not persisted (it is derivable from the checkpoint at any time, and default values are applied at model-select time, not at load-into-form time).

### Server: `classifyCheckpointArch`

Replaces `isSdxlCheckpoint(filename, title): Promise<boolean>` with:

```typescript
async function classifyCheckpointArch(
  filename: string | undefined,
  title: string
): Promise<{ type: Architecture; fluxVariant?: FluxVariant }>
```

**Detection order (header path)**: read the `.safetensors` header (same 8-byte length prefix + JSON pattern as the existing implementation), then:

1. If any key starts with `model.diffusion_model.double_blocks.` → **`flux`**.
   - Read `header.__metadata__` (a nested JSON object under the top-level key `__metadata__`). Stringify it and check for `/flux1?[-_]?dev/i` → `fluxVariant: 'dev'`; otherwise → `fluxVariant: 'schnell'` (the default because schnell is the far more common distilled variant, and the current confirmed user model is schnell).
2. Else if any key starts with `conditioner.embedders.` → **`sdxl`** (unchanged).
3. Else → **`sd15`** (unchanged).

**Fallback path (header read fails, no filename, or file unreachable)**: name heuristic on `title.toLowerCase()`:

1. If `title` contains `"flux"` → `flux`; if it also contains `"dev"` → `fluxVariant: 'dev'`, else `fluxVariant: 'schnell'`.
2. Else if `title` contains `"xl"` → `sdxl`.
3. Else → `sd15`.

The fallback path is intentionally permissive — it is only reached in error conditions (as in ADR-9), and the user always has the toggle as a manual override (ADR-29).

### API surface

- **`GET /api/sd-models`**: each `models[i]` gains a `fluxVariant?: FluxVariant` field alongside the existing `type` field (now `Architecture` union instead of `'sd15' | 'sdxl'`). Response shape:
  ```json
  {
    "models": [
      { "title": "...", "type": "flux", "fluxVariant": "schnell" },
      { "title": "...", "type": "sdxl" },
      { "title": "...", "type": "sd15" }
    ],
    "current": "..."
  }
  ```
- **`GET /api/sd-loras`**: each lora's `type` gains `'flux'` as a possible value. `classifyLoraArchitecture()` (`server/index.ts:696`) checks `modelspec.architecture` for `"flux"` substring or `ss_base_model_version` starting with `flux1` → `'flux'`. Falls through to existing SDXL/SD1.5 checks. Unknown remains as-is.
- **`POST /api/enhance`**: body gains optional `arch?: Architecture`. When `arch === 'flux'`, the Flux LLM system prompt is used; otherwise the current SD system prompt is used (backwards compatible — legacy clients or omitted field defaults to SD).
- **`POST /api/generate`**: body gains optional `modelArchitecture?: Architecture`. When present, it is persisted onto the generation record (both Firebase-persist path and local-save path). Absent means legacy behavior — no field written on the record.

### Client: 3-way toggle & Flux picker

`modelTypeFilter` state expands from `'sd15' | 'sdxl'` to `Architecture`. The ControlPanel segment tab renders three buttons (SD1.5 / SDXL / Flux). No other structural change to the toggle — the existing `.filter(m => m.type === modelTypeFilter)` scoping in ControlPanel and BatchGenerationModal already generalizes.

**New Flux state (App.tsx)**: `selectedFluxRatio`, `selectedFluxOrientation`, `selectedFluxSize`, mirroring the SDXL trio.

**New `FLUX_PRESETS`** (`client/src/components/presets.ts`): same 7-ratio × 3-orientation × 3-size shape as SDXL. Dimensions match SDXL_PRESETS numerically because Flux is also 1MP-native, but the "bucket" concept is different — Flux was not trained with aspect-ratio buckets, so all sizes carry `isFluxNative: boolean` (true only for M sizes, marking the ≈1MP recommendation). 1:1 M = 1024×1024.

```typescript
export type FluxRatio = '1:1' | '4:3' | '9:7' | '3:2' | '16:9' | '21:9' | '3:1';
export type FluxSize = 'S' | 'M' | 'L';

export interface FluxSizeSpec {
  width: number;
  height: number;
  isFluxNative: boolean;
}

export interface FluxPreset {
  ratio: FluxRatio;
  label: string;
  isSquare: boolean;
  sizes: Record<FluxSize, FluxSizeSpec>;
}

export const FLUX_PRESETS: readonly FluxPreset[] = [
  { ratio: '1:1',  label: '1:1',  isSquare: true,
    sizes: { S: { width: 768,  height: 768,  isFluxNative: false },
             M: { width: 1024, height: 1024, isFluxNative: true  },
             L: { width: 1216, height: 1216, isFluxNative: false } } },
  { ratio: '4:3',  label: '4:3',  isSquare: false,
    sizes: { S: { width: 768,  height: 576,  isFluxNative: false },
             M: { width: 1152, height: 832,  isFluxNative: true  },
             L: { width: 1344, height: 1024, isFluxNative: false } } },
  { ratio: '9:7',  label: '9:7',  isSquare: false,
    sizes: { S: { width: 896,  height: 768,  isFluxNative: false },
             M: { width: 1152, height: 896,  isFluxNative: true  },
             L: { width: 1408, height: 1088, isFluxNative: false } } },
  { ratio: '3:2',  label: '3:2',  isSquare: false,
    sizes: { S: { width: 1152, height: 768,  isFluxNative: false },
             M: { width: 1216, height: 832,  isFluxNative: true  },
             L: { width: 1344, height: 896,  isFluxNative: false } } },
  { ratio: '16:9', label: '16:9', isSquare: false,
    sizes: { S: { width: 1024, height: 576,  isFluxNative: false },
             M: { width: 1344, height: 768,  isFluxNative: true  },
             L: { width: 1600, height: 896,  isFluxNative: false } } },
  { ratio: '21:9', label: '21:9', isSquare: false,
    sizes: { S: { width: 1344, height: 576,  isFluxNative: false },
             M: { width: 1536, height: 640,  isFluxNative: true  },
             L: { width: 1792, height: 768,  isFluxNative: false } } },
  { ratio: '3:1',  label: '3:1',  isSquare: false,
    sizes: { S: { width: 1344, height: 448,  isFluxNative: false },
             M: { width: 1728, height: 576,  isFluxNative: true  },
             L: { width: 1920, height: 640,  isFluxNative: false } } },
];

export function resolveFluxDimensions(
  preset: FluxPreset,
  orientation: 'landscape' | 'portrait' | 'square',
  size: FluxSize
): { width: number; height: number; isFluxNative: boolean };

export function findFluxSelection(
  width: number,
  height: number
): { ratio: FluxRatio; orientation: 'landscape' | 'portrait' | 'square'; size: FluxSize } | null;
```

The functions have identical structure to `resolveSdxlDimensions` / `findSdxlSelection`.

**`useEffect` branching for the 3-way toggle** (App.tsx around lines 825–892): the existing SD1.5 and SDXL branches are unchanged. A Flux branch is added that mirrors the SDXL branch but reads from Flux state and `FLUX_PRESETS`.

### Flux-specific UX

When `modelTypeFilter === 'flux'`:

- **Steps default**: `selectedModel`'s `fluxVariant === 'dev'` → 25; otherwise (schnell or unknown) → 4.
- **CFG default**: dev → 3.5; schnell → 1.0.
- **Sampler default**: `Euler` with `Simple` scheduler.
- **Auto-apply defaults**: when `modelTypeFilter` becomes `flux` OR `selectedModel` changes to a Flux model, the defaults above are applied — unless the user has manually touched the field. This "did-touch" tracking does not exist elsewhere in App.tsx today, so Flux support introduces per-field override flags (`stepsUserOverride`, `cfgUserOverride`, `samplerUserOverride`, `schedulerUserOverride`) that flip to `true` on the corresponding `onChange`. Toggling `modelTypeFilter` (or switching between two Flux checkpoints of different variants) clears these flags so the new arch/variant defaults land cleanly.
- **Negative prompt**: `<textarea disabled>` with a note in i18n reading "Flux モデルでは negative prompt は使用しません" / "Negative prompt is not used with Flux models". The stored value on the textarea remains untouched (so switching back to SD1.5/SDXL restores it), but it is not sent to `/api/generate`.
- **VAE picker**: hidden (only shown for `modelTypeFilter === 'sdxl'` today; add a `!== 'flux'` guard is redundant since the trigger is SDXL-only).
- **Refiner**: hidden (same rationale).
- **Hires.fix**: hidden in Flux mode. Wrap the `{/* Hires.fix */}` section in `ControlPanel.tsx:681` with `{p.modelTypeFilter !== 'flux' && (…)}`. When Flux is active, related state (`hiresFixEnabled`, `hiresScale`, etc.) is not sent to `/api/generate` because the enabled flag drives the payload construction (already the case today).
- **LoRA**: unchanged UI. Flux LoRAs are tagged `type: 'flux'` and will now correctly trigger the "matches / mismatched" bar in ControlPanel when combined with Flux vs SD1.5/SDXL scoping.

### LLM system prompt for Flux

Added variant selected inside `enhancePrompt(userPrompt: string, arch: Architecture = 'sd15')`. When `arch === 'flux'`:

```
You are an expert prompt engineer for FLUX image generation.

Flux uses a T5 text encoder which understands NATURAL LANGUAGE prompts.
Do NOT use Stable Diffusion emphasis syntax like (phrase:weight) — that
syntax does not exist in Flux and will be treated as literal text.

Instead, translate the user's concept into fluent, descriptive English
sentences that read like natural writing. Include the subject, action,
setting, lighting, mood, and camera / composition / style as prose.
Prefer 2–5 sentences over a comma-separated tag list.

Emphasis: when the user uses natural-language emphasis cues in Japanese
(かなり / めっちゃ / とびっきり / 強く / 極めて / 完全に etc.) or
English (very / strongly / extremely / prominently), express strength
through wording — repeat / rephrase the concept, use a strong adjective,
or lead the sentence with the emphasized element. Do NOT wrap anything
in parentheses with a numeric weight.

Negative prompt: Flux models do not use negative prompts effectively.
Always return an EMPTY <negative></negative> tag.

Output format (unchanged):
<prompts><positive>your natural-language prompt</positive><negative></negative></prompts>
Reply ONLY with the XML structure — no introduction, no explanation.
```

The existing SD system prompt (with `(phrase:weight)` emphasis handling) is used unchanged when `arch === 'sd15' | 'sdxl'` or the body field is absent.

### Metadata persistence — solving ADR-16

`GenerationMetadata` gains `modelArchitecture?: Architecture`. Populated at generation time by the client sending `modelTypeFilter` in the `/api/generate` body. Stored on both Firebase (`users/{uid}/generations/{id}`) and local `metadata.json`.

**`loadIntoForm` precedence** (`client/src/components/loadIntoFormState.ts`):

1. If the record has `modelArchitecture`, trust it (ground truth from the user's toggle at generation time).
2. Else, use `inferSdArchitectureFromTitle(record.model, sdModels)` — the current path, which reads server's `type` from `sdModels`.
3. Else, fall back to the existing name heuristic in `inferSdArchitectureFromTitle`.

Legacy records without `modelArchitecture` retain today's behavior exactly. New records solve the ADR-16 misclassification bug because the user's toggle-time selection is authoritative.

### Batch generation

`BatchGenerationModal.tsx` adds a Flux branch:

- `buildFluxBatchJobs()`: iterates `FLUX_PRESETS × orientations × sizes` following the same pattern as `buildSdxlBatchJobs()`.
- Batch dispatch line becomes: `modelTypeFilter === 'flux' ? buildFluxBatchJobs() : modelTypeFilter === 'sdxl' ? buildSdxlBatchJobs() : buildSd15BatchJobs()`.
- Batch "model cycling" mode uses `sdModels.filter(m => m.type === modelTypeFilter)` — already generalized, no code change needed.
- `enhanceOnce()` inside `handleBatchGenerate()` passes `arch: modelTypeFilter` so all jobs share the Flux LLM output (empty negative for Flux batches).

## i18n keys (new)

Added to `client/src/i18n/ja.ts` and mirrored in `en.ts`:

- `controlPanel.archFluxLabel`: JP "Flux" / EN "Flux" (segment tab label)
- `controlPanel.noFluxModelsFound`: JP "Flux モデルが見つかりません" / EN "No Flux models found"
- `controlPanel.fluxNegativeDisabledNote`: JP "Flux モデルでは negative prompt は使用しません" / EN "Negative prompt is not used with Flux models"
- `controlPanel.fluxVariantSchnellBadge`: "schnell" (both locales)
- `controlPanel.fluxVariantDevBadge`: "dev" (both locales)
- `batchModal.noModelsOfType(arch)`: no signature change. The existing function accepts a display-label string (currently `'SDXL'|'SD'`); Flux mode passes `'Flux'`. The `'SD'` label for SD1.5 mode stays as-is to preserve current UX text.
- `controlPanel.loraTypeMismatch(arch)`: extend to accept `'Flux'` for the badge (existing function already parameterized)

## Testing

**New Vitest coverage** (`client/src/**/*.test.ts`, following the existing pure-function extraction pattern from ADR-15):

- `components/presets.test.ts` — add Flux section: `resolveFluxDimensions` round-trip on all ratios × orientations × sizes; `findFluxSelection` reverse lookup for all preset entries; `findFluxSelection` returns null for non-preset (width, height) pairs.
- `components/loadIntoFormState.test.ts` — add cases:
  - Record with `modelArchitecture: 'flux'` → `archToSet: 'flux'`, `fluxPicker` populated from width/height (or null → falls back to Flux default).
  - Legacy record (no `modelArchitecture`) with SDXL-titled model → uses `inferSdArchitectureFromTitle` (unchanged path).
  - Legacy record with non-XL-named SDXL model (the ADR-16 case) still misdetects as `sd15` — this is intentional: fixing legacy records is out of scope, only new records get the ground-truth path.
- **New test file** `client/src/components/fluxDefaults.test.ts` — pure function `computeFluxDefaults(fluxVariant, overrides)` extracted from App.tsx into `client/src/components/fluxDefaults.ts` for testability:
  - schnell variant + all overrides `false` → `{ steps: 4, cfg: 1.0, sampler: 'Euler', scheduler: 'Simple' }`
  - dev variant + all overrides `false` → `{ steps: 25, cfg: 3.5, sampler: 'Euler', scheduler: 'Simple' }`
  - schnell variant + `stepsUserOverride: true`, current steps 12 → `{ steps: 12, cfg: 1.0, … }` (per-field override, not all-or-nothing)
  - Unknown variant (Flux model with no variant info) → treated as schnell

**Server**: no unit tests (consistent with server having no tests). Manual verification instead, listed as explicit steps in the implementation plan:

- Header path: `2758FluxAsianUtopian_v60SchnellFp8Noclip.safetensors` → `{ type: 'flux', fluxVariant: 'schnell' }` via `curl /api/sd-models`.
- Header path: `sd_xl_base_1.0.safetensors` → `{ type: 'sdxl' }`.
- Header path: `v1-5-pruned-emaonly.safetensors` → `{ type: 'sd15' }`.
- Fallback path (invalid filename): title containing "flux" → `flux`; title containing "xl" → `sdxl`; else `sd15`.

**E2E via chrome-devtools MCP** (final verification pass, executed as the last SDD task):

- Toggle 3-way switches (SD1.5 → SDXL → Flux → back) render correct model dropdown scoping, correct preset picker (1:1 / 4:3 / etc.), and correct default values on each switch.
- Selecting a schnell model in Flux mode auto-applies steps=4, CFG=1.0, Euler + Simple. Selecting a dev model applies steps=25, CFG=3.5.
- Negative prompt textarea is `disabled` in Flux mode; the note is visible.
- `POST /api/enhance` request body contains `arch: 'flux'` when in Flux mode (fetch monkey-patch verification).
- `POST /api/generate` request body contains `modelArchitecture: 'flux'` (and 'sd15' / 'sdxl' for the other modes).
- Load-into-form on a Flux-generated record correctly restores the toggle to Flux and re-applies preset picker + defaults.
- Batch "size combinations" mode in Flux emits FLUX_PRESETS cross product; "model cycling" mode filters to Flux models only.

## ADR updates

- **New**: `docs/arch/adr-0042-flux-support-3way-architecture.md`
  - Context: ADR-9 / ADR-29 foresaw Flux as future work; concrete Flux checkpoint now in daily use; ADR-16's misclassification fix piggybacks naturally.
  - Decision: 3-way `Architecture` union; `classifyCheckpointArch` with variant detection; FLUX_PRESETS; Flux-specific UX (steps/CFG/sampler defaults, negative disabled, LLM prompt variant); `modelArchitecture` persistence.
  - Status: 承認済み
  - Consequences: single-source-of-truth toggle preserved with N-way generalization; ADR-16 SDXL misclassification fixed by the persistence side of this change; schnell/dev variant only affects defaults (no separate picker); Hires.fix / VAE / Refiner deferred for Flux; forward-compat pattern established for SD3 / Sana / other future architectures.
- **Update**: `docs/arch/adr-0016-defer-sdxl-misclassification-fix.md` — change Status from "承認済み" to "置き換え済み（[[adr-0042-flux-support-3way-architecture]] により置き換え）". Body unchanged.
- **Update**: `docs/arch/adr-0009-safetensors-header-sdxl-detection.md` — append to the last Consequences bullet a reference to ADR-0042 ("この将来課題は [[adr-0042-flux-support-3way-architecture]] で扱われます"). Body otherwise unchanged.
- **Update**: `docs/arch/adr-0029-sd-sdxl-architecture-ui-handling.md` — append to the last Consequences bullet the same forward reference. Body otherwise unchanged.

## Rollout & compatibility

- **No breaking changes to storage rules or Firestore indexes**. `modelArchitecture` is an additional optional field on an existing collection.
- **No breaking changes to `/api/sd-models` for existing SD1.5/SDXL clients**. `type` union widens (backwards-compatible for consumers that only distinguish sdxl/other) and `fluxVariant` is optional.
- **No breaking changes to `/api/enhance` and `/api/generate`**. Both accept new optional fields; omitting them yields today's behavior.
- **Client rollout**: single deploy from main. No stepped migration required.
- **Legacy Flux images (generated before this ships)**: they were saved with either `type: 'sd15'` (which is wrong) or nothing. After this ships, the "load into form" path still works via `inferSdArchitectureFromTitle` fallback for records that lack `modelArchitecture`, but the toggle may resolve to `sd15` rather than `flux`. User can manually flip to Flux post-load, matching ADR-29's manual override contract. Only new generations get the ground-truth persistence.

## Files changed

- `server/index.ts`
- `client/src/components/presets.ts`
- `client/src/App.tsx`
- `client/src/components/ControlPanel.tsx`
- `client/src/components/BatchGenerationModal.tsx`
- `client/src/components/loadIntoFormState.ts` (+ test)
- `client/src/components/presets.test.ts`
- `client/src/components/fluxDefaults.ts` (new, extracted for testability)
- `client/src/components/fluxDefaults.test.ts` (new)
- `client/src/i18n/ja.ts`
- `client/src/i18n/en.ts`
- `docs/arch/adr-0042-flux-support-3way-architecture.md` (new)
- `docs/arch/adr-0016-defer-sdxl-misclassification-fix.md` (Status only)
- `docs/arch/adr-0009-safetensors-header-sdxl-detection.md` (Consequences bullet)
- `docs/arch/adr-0029-sd-sdxl-architecture-ui-handling.md` (Consequences bullet)
