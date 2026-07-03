# Design: SDXL Model Support in UI

Date: 2026-07-03
Status: Approved

## Summary

Stop excluding SDXL checkpoints from the app and let the user generate with them. The core idea is a new **"SD / SDXL" architecture toggle** that scopes the whole form to one architecture at a time: it filters which checkpoints appear in the model picker, drives which resolution options are offered, and scopes which models "モデル切替" batch mode cycles through. Because the toggle guarantees the form never mixes architectures, no per-model or per-batch-job resolution overrides are needed — the single width/height already selected is always appropriate for whatever is currently visible.

LoRA compatibility is surfaced but not enforced: the LoRA picker shows a "⚠" badge on entries whose architecture is confidently known and different from the active toggle, and leaves everything else (including LoRAs with no architecture metadata at all — about 40% of this environment's LoRAs, per investigation) untouched and selectable, exactly as today.

This builds directly on [[adr-0009-safetensors-header-sdxl-detection]]'s per-checkpoint SDXL detection.

## Current behavior (as-is)

- `/api/sd-models` excludes any checkpoint whose `.safetensors` header shows the SDXL `conditioner.embedders.*` signature (ADR-9), returning a flat `models: string[]`. SDXL checkpoints never appear anywhere in the client.
- The model picker (`client/src/App.tsx`) is a single flat `<select>` over `sdModels`.
- Width/height are two independent `<select>`s sharing one hardcoded option list, `[512, 768, 1024]`, used both by the main form and by "まとめて生成"'s "サイズの組み合わせ" batch mode (`SIZE_OPTIONS` module constant).
- "まとめて生成" has three modes: 枚数 (count), サイズの組み合わせ (size combinations, cross product of `SIZE_OPTIONS` on each axis), モデル切替 (model cycling — one job per selected checkpoint, all jobs using the main form's current width/height).
- `/api/sd-loras` returns a flat `loras: string[]` of names only; SD's own `/sdapi/v1/loras` response actually includes a `metadata` object per LoRA with training-time info, but the server discards everything except `name`. There is no compatibility information anywhere in the LoRA picker.

## Desired behavior (to-be)

- All checkpoints are returned by the server, tagged with an architecture `type`.
- A new segmented toggle ("SD" / "SDXL") sits near the model picker, visually consistent with the existing batch-mode tabs. Its initial value matches SD's actual currently-loaded checkpoint's architecture.
- The model `<select>` only lists checkpoints matching the active toggle value.
- The width/height `<select>`s offer different option sets depending on the toggle: `[512, 768, 1024]` for "SD", `[1024, 1152, 1280]` for "SDXL". Flipping the toggle keeps the current width/height if it's still a valid option in the new set, otherwise resets it to that architecture's default (512 for SD, 1024 for SDXL).
- "サイズの組み合わせ" batch mode's candidate sizes follow the same toggle-driven option set.
- "モデル切替" batch mode only cycles through checkpoints matching the active toggle, so every job in that batch shares one architecture and the form's single width/height is always valid for all of them — no per-job resolution logic is needed.
- The "+ LoRAを追加" dropdown appends a "⚠" marker to any LoRA whose detected architecture is confidently known and does not match the active toggle. LoRAs with no detectable architecture are shown exactly as today, unmarked.

## Server changes (`server/index.ts`)

### `/api/sd-models`

Remove the exclusion filter entirely. Reuse the existing `isSdxlCheckpoint()` helper (ADR-9) to tag each checkpoint instead of dropping it. Non-SDXL results (including truly unknown architectures such as Flux, which `isSdxlCheckpoint()` already returns `false` for) are tagged `'sd15'` — this matches the earlier decision that unknown-architecture checkpoints are treated the same as SD1.5 for exclusion purposes, so no third bucket is needed at this layer.

```ts
app.get('/api/sd-models', async (_req: Request, res: Response) => {
  try {
    const [listRes, optionsRes] = await Promise.all([
      axios.get(`${stableDiffusionUrl}/sdapi/v1/sd-models`, { timeout: 5000 }),
      axios.get(`${stableDiffusionUrl}/sdapi/v1/options`, { timeout: 5000 }),
    ]);
    const rawModels: Array<{ title?: string; filename?: string }> = Array.isArray(listRes.data) ? listRes.data : [];
    const models = await Promise.all(
      rawModels
        .filter((m): m is { title: string; filename?: string } => Boolean(m.title))
        .map(async (m) => ({
          title: m.title,
          type: (await isSdxlCheckpoint(m.filename, m.title)) ? 'sdxl' as const : 'sd15' as const,
        }))
    );
    const activeCheckpoint = optionsRes.data?.sd_model_checkpoint ?? null;
    const current = activeCheckpoint && models.some((m) => m.title === activeCheckpoint)
      ? activeCheckpoint
      : models[0]?.title ?? null;
    res.json({ models, current });
  } catch (error) {
    console.error('Failed to fetch SD models:', (error as Error).message);
    res.json({ models: [], current: null });
  }
});
```

Response shape changes from `{ models: string[], current }` to `{ models: { title: string; type: 'sd15' | 'sdxl' }[], current }`.

### `/api/sd-loras`

New helper, placed near `isSdxlCheckpoint()`:

```ts
// Classify a LoRA's base architecture from the training metadata AUTOMATIC1111/Forge
// already parses and returns via /sdapi/v1/loras. Prefers the modelspec.sai_model_spec
// convention's `modelspec.architecture` field; falls back to the looser `ss_base_model_version`
// field some older trainers write instead. Returns 'unknown' when neither is present —
// true for roughly 40% of LoRAs in practice (older or non-modelspec-aware trainers),
// so callers must not treat 'unknown' as "incompatible".
function classifyLoraArchitecture(metadata: Record<string, unknown> | undefined): 'sd15' | 'sdxl' | 'unknown' {
  const arch = String(metadata?.['modelspec.architecture'] ?? metadata?.['ss_base_model_version'] ?? '').toLowerCase();
  if (arch.includes('xl')) return 'sdxl';
  if (arch.includes('stable-diffusion-v1') || arch.startsWith('sd_v1') || arch.startsWith('sd_1')) return 'sd15';
  return 'unknown';
}
```

Update the route:

```ts
app.get('/api/sd-loras', async (_req: Request, res: Response) => {
  try {
    const listRes = await axios.get(`${stableDiffusionUrl}/sdapi/v1/loras`, { timeout: 5000 });
    const loras = Array.isArray(listRes.data)
      ? listRes.data
          .filter((l: { name?: string }): l is { name: string; metadata?: Record<string, unknown> } => Boolean(l.name))
          .map((l) => ({ name: l.name, type: classifyLoraArchitecture(l.metadata) }))
      : [];
    res.json({ loras });
  } catch (error) {
    console.error('Failed to fetch SD LoRAs:', (error as Error).message);
    res.json({ loras: [] });
  }
});
```

Response shape changes from `{ loras: string[] }` to `{ loras: { name: string; type: 'sd15' | 'sdxl' | 'unknown' }[] }`.

## Client changes (`client/src/App.tsx`)

### Types

```ts
type SdModel = { title: string; type: 'sd15' | 'sdxl' };
type SdLora = { name: string; type: 'sd15' | 'sdxl' | 'unknown' };
```

### Constants

Replace the single `SIZE_OPTIONS` constant with a lookup covering both architectures:

```ts
const SIZE_OPTIONS_BY_TYPE: Record<'sd15' | 'sdxl', number[]> = {
  sd15: [512, 768, 1024],
  sdxl: [1024, 1152, 1280],
};
```

`SIZE_OPTIONS` (the old flat constant) is removed; every former usage switches to `SIZE_OPTIONS_BY_TYPE[modelTypeFilter]`.

### State changes

```ts
const [sdModels, setSdModels] = useState<SdModel[]>([]);       // was string[]
const [sdLoras, setSdLoras] = useState<SdLora[]>([]);          // was string[]
const [modelTypeFilter, setModelTypeFilter] = useState<'sd15' | 'sdxl'>('sd15');
const modelTypeInitialized = useRef(false); // set true after the first real /api/sd-models response
```

`selectedLoras` (`{ name, weight }[]`) is unchanged — it stores LoRA choices, not architecture info, which is looked up from `sdLoras` at render time. `addLora`/`removeLora`/`setLoraWeight` key on `name: string` only and are untouched. `fetchSdLoras()` itself needs no code change either — it already does `setSdLoras(Array.isArray(data.loras) ? data.loras : [])`, which passes the new `{ name, type }[]` shape through verbatim; only the `sdLoras` state's type annotation changes.

### `fetchSdModels()`

```ts
const fetchSdModels = async () => {
  try {
    const res = await fetch(`${API_BASE}/sd-models`);
    if (res.ok) {
      const data = await res.json();
      const models: SdModel[] = Array.isArray(data.models) ? data.models : [];
      setSdModels(models);
      setSelectedModel((prev) => prev || data.current || '');
      if (!modelTypeInitialized.current && data.current) {
        const currentType = models.find((m) => m.title === data.current)?.type;
        if (currentType) {
          setModelTypeFilter(currentType);
          modelTypeInitialized.current = true;
        }
      }
    }
  } catch (error) {
    console.error('Failed to fetch SD models:', error);
  }
};
```

The `modelTypeInitialized` ref makes the toggle default itself once from SD's real active checkpoint, without stomping on a manual toggle choice the user might have made before a later re-fetch (e.g. the reconnect-triggered re-fetch in the `health.stableDiffusion.connected` effect).

### Model picker + toggle

```tsx
<div style={{ display: 'flex', gap: '8px', ... }}>
  {(['sd15', 'sdxl'] as const).map((t) => (
    <button
      key={t}
      type="button"
      onClick={() => setModelTypeFilter(t)}
      disabled={loading}
      style={{ /* same segmented-tab look as batchMode tabs */
        background: modelTypeFilter === t ? 'var(--pop-blue)' : 'transparent',
        color: modelTypeFilter === t ? '#fff' : 'var(--text-secondary)',
      }}
    >
      {t === 'sd15' ? 'SD' : 'SDXL'}
    </button>
  ))}
</div>
```

```tsx
const modelsInScope = sdModels.filter((m) => m.type === modelTypeFilter);
...
{modelsInScope.length > 0 ? (
  <select className="input-field" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} disabled={loading}>
    {modelsInScope.map((m) => (
      <option key={m.title} value={m.title}>{m.title}</option>
    ))}
  </select>
) : (
  <select className="input-field" disabled>
    <option>{modelTypeFilter === 'sdxl' ? 'SDXLモデルが見つかりません' : 'SD1.5モデルが見つかりません'}</option>
  </select>
)}
```

### Resolution + toggle reset effect

One effect reacts to `modelTypeFilter` changes and re-validates every value that depends on it — `selectedModel`, the main-form `width`/`height`, and the batch modal's `selectedWidths`/`selectedHeights`:

```ts
// Re-validate everything that depends on the active architecture whenever the
// toggle flips. sdModels is intentionally not a dependency here — this should
// only run on an explicit toggle flip, not every time the model list happens
// to refresh with the same toggle value still selected.
useEffect(() => {
  const options = SIZE_OPTIONS_BY_TYPE[modelTypeFilter];
  const fallback = modelTypeFilter === 'sdxl' ? 1024 : 512;

  setSelectedModel((prev) => (sdModels.some((m) => m.type === modelTypeFilter && m.title === prev) ? prev : (sdModels.find((m) => m.type === modelTypeFilter)?.title ?? '')));
  setWidth((prev) => (options.includes(prev) ? prev : fallback));
  setHeight((prev) => (options.includes(prev) ? prev : fallback));
  setSelectedWidths((prev) => { const kept = prev.filter((w) => options.includes(w)); return kept.length ? kept : [...options]; });
  setSelectedHeights((prev) => { const kept = prev.filter((h) => options.includes(h)); return kept.length ? kept : [...options]; });
}, [modelTypeFilter]);
```

### Batch modal

- `openBatchModal()`: seed `selectedBatchModels` from the filtered list instead of all of `sdModels`:
  ```ts
  const openBatchModal = () => {
    setSelectedBatchModels(new Set(sdModels.filter((m) => m.type === modelTypeFilter).map((m) => m.title)));
    setShowBatchModal(true);
  };
  ```
- "サイズの組み合わせ" mode's size-toggle buttons iterate `SIZE_OPTIONS_BY_TYPE[modelTypeFilter]` instead of the old `SIZE_OPTIONS` constant.
- "モデル切替" mode's candidate list (the checkbox list, the "全選択"/"全解除" buttons, and the job-building `.filter(...).map(...)` at submit) all operate over `sdModels.filter((m) => m.type === modelTypeFilter)` instead of the full `sdModels`.
- The submit-time job builder is otherwise unchanged — it still emits `{ width, height, model: m.title }` per selected checkpoint, and both `width`/`height` are already guaranteed valid for `modelTypeFilter` by the effect above.

### LoRA picker badge

```tsx
{sdLoras.filter((l) => !selectedLoras.some((sl) => sl.name === l.name)).map((l) => {
  const mismatched = l.type !== 'unknown' && l.type !== modelTypeFilter;
  return (
    <option key={l.name} value={l.name}>
      {l.name}{mismatched ? ` ⚠${l.type === 'sdxl' ? 'SDXL' : 'SD1.5'}用` : ''}
    </option>
  );
})}
```

No other LoRA behavior changes — selection, weight, and the `<lora:name:weight>` prompt suffix at generation time are untouched.

## Data flow

```
Page load → fetchSdModels() → /api/sd-models returns tagged models + current
  → modelTypeFilter initializes to current's type (once)
  → model <select> and width/height <option>s scope to modelTypeFilter

User flips "SD / SDXL" toggle
  → effect re-validates selectedModel / width / height / selectedWidths / selectedHeights
  → model <select> options swap to the other architecture's checkpoints

User opens "まとめて生成" → モデル切替
  → candidate list = sdModels already scoped to modelTypeFilter
  → every job shares one architecture, so the form's width/height applies validly to all of them
  → handleBatchGenerate runs unchanged

User opens LoRA dropdown
  → fetchSdLoras() classification (server-side) drives the "⚠" badge against modelTypeFilter
```

## Edge cases

| Case | Handling |
|---|---|
| SD has zero SDXL checkpoints installed | Toggling to "SDXL" shows the disabled "SDXLモデルが見つかりません" placeholder; user can still toggle back to "SD" |
| SD has zero checkpoints of the initial toggle's type (unlikely, but e.g. active checkpoint deleted) | `modelTypeInitialized` still gets set from `data.current`'s type even if that specific model later disappears from a re-fetch; the picker shows the empty-state placeholder rather than crashing |
| User flips the toggle while "まとめて生成" modal is open | `selectedBatchModels`/`selectedWidths`/`selectedHeights` were seeded from the toggle value *at modal-open time*; flipping the toggle while the modal is open is not specially handled — the modal's own state stays as last seeded. This matches the existing pattern where the modal's local choices aren't reactive to background state changes. |
| LoRA has no architecture metadata (`unknown`) | Always shown unmarked, exactly as today — never hidden, never badged, regardless of `modelTypeFilter` |
| LoRA's `type` matches `modelTypeFilter` | Shown unmarked |
| History item generated before this feature, reloaded via "♻️ フォームにロード" | `loadIntoForm()` sets `width`/`height`/`model` from the saved record directly (unchanged code path); if the saved model's architecture differs from the current `modelTypeFilter`, the toggle is not auto-flipped — out of scope, see below |
| `/api/sd-models` or `/api/sd-loras` unreachable | Same as today: empty arrays, disabled placeholders; `modelTypeFilter` stays at its last value (default `'sd15'` if never initialized) |

## Testing / verification

No automated tests in this project. Verify manually after typecheck + lint:

1. Page load with SD connected → toggle defaults to match the actually-loaded checkpoint's architecture.
2. Toggle to "SDXL" → model list shows only SDXL checkpoints; width/height options become `1024/1152/1280`; if the previous width/height (e.g. 512) isn't valid, it resets to 1024.
3. Toggle back to "SD" → same checks in reverse, default 512.
4. Generate a single image with an SDXL checkpoint selected → succeeds, image looks correct at 1024×1024 (previously excluded entirely).
5. "まとめて生成" → モデル切替 with toggle on "SDXL" → checkbox list only shows SDXL checkpoints; batch completes with one image per checked model, all at the same (valid) resolution.
6. "まとめて生成" → サイズの組み合わせ with toggle on "SDXL" → size buttons show `1024/1152/1280`.
7. Add a LoRA known to be SDXL-only while toggle is on "SD" → dropdown entry shows the "⚠SDXL用" marker. Toggle to "SDXL" → marker disappears for that entry, appears instead on known-SD1.5 LoRAs.
8. Add a LoRA with no architecture metadata → never shows a marker, in either toggle state.
9. SD unreachable → both pickers show existing disabled-placeholder behavior; no crash from the new toggle logic.

Also run:
- `npm run typecheck --prefix server` → zero errors
- `cd client && npx tsc -b` → zero errors
- `npm run lint --prefix client` → no new errors

## Out of scope

- Auto-flipping `modelTypeFilter` when loading a past generation (via "♻️ フォームにロード") whose saved model belongs to the other architecture. The form would show the loaded model's width/height/model correctly, but the toggle and the *other* dropdown's option set could look inconsistent until the user interacts with the toggle. Left for a follow-up if it proves confusing in practice.
- A three-way toggle separating true SD1.5 from other unknown architectures (Flux, HunyuanVideo, etc.) that happen to be installed. They stay bucketed under "SD".
- Automatic LoRA weight adjustment or any enforcement (blocking, filtering) based on architecture mismatch — badges are purely informational.
- Hires.fix parameter tuning specific to SDXL (e.g. different default denoising strength). The existing sliders are reused unchanged.
- Persisting the toggle choice across page reloads (no localStorage, consistent with sampler/scheduler/LoRA selections today).
