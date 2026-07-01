# Design: Hires.fix Support

Date: 2026-07-02
Status: Approved

## Summary

Add support for Stable Diffusion's Hires.fix (high-resolution second pass) to the generation pipeline. A toggle in the advanced settings panel enables it; when on, the user picks an upscaler, an upscale-by factor, a second-pass step count, and a denoising strength. These flow through to SD's `/sdapi/v1/txt2img` as `enable_hr`/`hr_upscaler`/`hr_scale`/`hr_second_pass_steps`/`denoising_strength`, are persisted in generation metadata (both Firebase and local-file backends), shown in the preview, restored via "♻️ フォームにロード", and apply uniformly to every batch-generation mode (count / size combinations / model cycling) since batch reads the same form state as single generation.

Only the basic five parameters are exposed. SD's finer-grained Hires.fix knobs (`hr_sampler_name`, `hr_scheduler`, `hr_prompt`, `hr_negative_prompt`, `hr_resize_x/y`) are out of scope — see "Out of scope".

## Current behavior (as-is)

`generateImage()` in `server/index.ts` builds a txt2img payload with no Hires.fix fields at all; SD runs a single pass at the requested `width`×`height`. There is no way to upscale within the pipeline.

## Desired behavior (to-be)

- An "Hires.fixを有効にする" checkbox sits in the advanced settings panel, after CFG Scale and before the LoRA section (mirrors the Seed-lock checkbox's collapse/expand style).
- When checked, four controls appear: upscaler dropdown, upscale-by slider, hires用ステップ数 slider, denoising strength slider.
- The upscaler list is fetched once on page load from a new `/api/sd-upscalers` endpoint (SD's GAN upscalers merged with its latent upscale modes).
- Enabling Hires.fix and generating (single or batch) produces an upscaled image via SD's built-in two-pass pipeline.
- The setting is saved with the generation, shown in the preview panel, and restored when loading a past generation back into the form.

## Server changes (`server/index.ts`)

### `GenerationMetadata` interface

Add five optional fields, next to the existing `sampler?`/`scheduler?`:

```ts
enableHr?: boolean;
hrUpscaler?: string;
hrScale?: number;
hrSecondPassSteps?: number;
denoisingStrength?: number;
```

### `generateImage()` function

Add four new parameters after `scheduler`:

```ts
async function generateImage(
  prompt: string,
  negativePrompt: string,
  width = 512,
  height = 512,
  steps = 20,
  cfgScale = 7,
  model = '',
  seed = -1,
  sampler = 'Euler a',
  scheduler = '',
  enableHr = false,
  hrUpscaler = '',
  hrScale = 2,
  hrSecondPassSteps = 0,
  denoisingStrength = 0.7
): Promise<{ image: string; seed: number }>
```

In the payload, mirror the existing `scheduler` conditional-include pattern — only add the Hires.fix fields when enabled, so older SD builds without Hires.fix support (or requests that don't want it) get a payload identical to today's:

```ts
if (enableHr) {
  payload.enable_hr = true;
  payload.hr_scale = hrScale;
  payload.denoising_strength = denoisingStrength;
  if (hrUpscaler) payload.hr_upscaler = hrUpscaler;
  if (hrSecondPassSteps) payload.hr_second_pass_steps = hrSecondPassSteps;
}
```

`hr_second_pass_steps: 0` (the SD default) means "same step count as the first pass" — so it's only sent when the user picked a non-zero override, same reasoning as the `scheduler` omission.

### `/api/generate` route

- Destructure `enableHr, hrUpscaler, hrScale, hrSecondPassSteps, denoisingStrength` from `req.body` alongside the existing fields.
- Pass them through to `generateImage()` in the new parameter positions, with the same defaults as above when absent/undefined.
- Add the five fields to both the `clientPersist` response's `params` object and the local-save `metadata` object — only include a field when `enableHr` is true, so generations made without Hires.fix don't carry stray `hrScale`/`hrUpscaler` values:

```ts
enableHr: !!enableHr,
...(enableHr ? { hrUpscaler: hrUpscaler || undefined, hrScale: hrScale || 2, hrSecondPassSteps: hrSecondPassSteps || 0, denoisingStrength: denoisingStrength || 0.7 } : {}),
```

### New `GET /api/sd-upscalers` endpoint

Follows the `sd-schedulers` degrade-to-empty-list pattern. Merges SD's GAN-based upscalers (`/sdapi/v1/upscalers`) with its latent-space upscale modes (`/sdapi/v1/latent-upscale-modes`) into one flat name list, since `hr_upscaler` accepts either kind interchangeably:

```ts
app.get('/api/sd-upscalers', async (_req: Request, res: Response) => {
  try {
    const [upscalersRes, latentRes] = await Promise.all([
      axios.get(`${stableDiffusionUrl}/sdapi/v1/upscalers`, { timeout: 5000 }),
      axios.get(`${stableDiffusionUrl}/sdapi/v1/latent-upscale-modes`, { timeout: 5000 }),
    ]);
    const names = (data: unknown) =>
      Array.isArray(data)
        ? data.map((u: { name?: string }) => u.name).filter((n): n is string => Boolean(n))
        : [];
    const upscalers = [...names(upscalersRes.data), ...names(latentRes.data)];
    res.json({ upscalers });
  } catch (error) {
    console.error('Failed to fetch SD upscalers:', (error as Error).message);
    res.json({ upscalers: [] });
  }
});
```

## Client changes (`client/src/App.tsx`)

### `GenerationData` interface

Add the same five optional fields as `GenerationMetadata`.

### New state

```ts
const [sdUpscalers, setSdUpscalers] = useState<string[]>([]);
const [hiresFixEnabled, setHiresFixEnabled] = useState(false);
const [selectedUpscaler, setSelectedUpscaler] = useState('');
const [hiresScale, setHiresScale] = useState(2);
const [hiresSteps, setHiresSteps] = useState(0);
const [hiresDenoising, setHiresDenoising] = useState(0.7);
```

### New `fetchSdUpscalers()` function

Called on page load alongside `fetchSdModels()`/`fetchSdSamplers()`/`fetchSdSchedulers()`. No "current" concept to default to (same as samplers) — leaves `selectedUpscaler` empty until the user picks one; an empty value is sent as `undefined` and SD falls back to its own default upscaler.

```ts
const fetchSdUpscalers = async () => {
  try {
    const res = await fetch(`${API_BASE}/sd-upscalers`);
    if (res.ok) {
      const data = await res.json();
      const upscalers: string[] = Array.isArray(data.upscalers) ? data.upscalers : [];
      setSdUpscalers(upscalers);
    }
  } catch (error) {
    console.error('Failed to fetch SD upscalers:', error);
  }
};
```

### Advanced settings UI — Hires.fix block

Placed after the CFG Scale slider and before the LoRA section:

```tsx
{/* Hires.fix */}
<div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: loading ? 'default' : 'pointer', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
    <input
      type="checkbox"
      checked={hiresFixEnabled}
      onChange={(e) => setHiresFixEnabled(e.target.checked)}
      disabled={loading}
    />
    Hires.fixを有効にする
  </label>
  {hiresFixEnabled && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingLeft: '4px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>アップスケーラー (Upscaler)</label>
        {sdUpscalers.length > 0 ? (
          <select
            className="input-field"
            value={selectedUpscaler}
            onChange={(e) => setSelectedUpscaler(e.target.value)}
            disabled={loading}
            style={{ borderRadius: '8px' }}
          >
            <option value="">SDのデフォルトを使用</option>
            {sdUpscalers.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        ) : (
          <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
            <option>アップスケーラー一覧を取得できません（SD未接続）</option>
          </select>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
          <span>アップスケール倍率</span>
          <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{hiresScale.toFixed(1)}x</span>
        </div>
        <input type="range" min="1" max="4" step="0.1" value={hiresScale} onChange={(e) => setHiresScale(parseFloat(e.target.value))} disabled={loading} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
          <span>Hires用ステップ数 (0 = Stepsと同じ)</span>
          <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{hiresSteps === 0 ? 'Stepsと同じ' : hiresSteps}</span>
        </div>
        <input type="range" min="0" max="50" value={hiresSteps} onChange={(e) => setHiresSteps(parseInt(e.target.value))} disabled={loading} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
          <span>Denoising strength</span>
          <span style={{ color: 'var(--pop-blue)', fontWeight: '800' }}>{hiresDenoising.toFixed(2)}</span>
        </div>
        <input type="range" min="0" max="1" step="0.05" value={hiresDenoising} onChange={(e) => setHiresDenoising(parseFloat(e.target.value))} disabled={loading} />
      </div>
    </div>
  )}
</div>
```

### `generateImage()` (client helper) — passing Hires.fix fields

Add to the `/api/generate` fetch body, always including `enableHr` and gating the rest on it (mirrors the server's own conditional-include reasoning, keeps the wire payload minimal when Hires.fix is off):

```ts
enableHr: hiresFixEnabled,
...(hiresFixEnabled ? {
  hrUpscaler: selectedUpscaler || undefined,
  hrScale: hiresScale,
  hrSecondPassSteps: hiresSteps || undefined,
  denoisingStrength: hiresDenoising,
} : {}),
```

No `BatchJob` changes are needed: `sampler`/`scheduler`/`selectedLoras` are already read directly from component state inside `generateImage()` rather than threaded through `BatchJob`, and Hires.fix follows the same pattern — every batch job (count, size-combination, model-cycling) picks up whatever the form's Hires.fix controls are set to.

**Size-combination interaction**: `width`/`height` (including each batch job's per-size candidate) continue to mean the first-pass resolution; `hrScale` multiplies that. E.g. a 512×512 size candidate with `hiresScale=2` produces a 1024×1024 final image. This is expected SD behavior and needs no special-casing in the batch size logic.

### Preview — Hires.fix display

In the params grid, next to the sampler/scheduler rows, shown only when `enableHr` is true:

```tsx
{currentGeneration.enableHr && (
  <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
    <span>Hires.fix: </span>
    <strong style={{ color: 'var(--text-primary)' }}>
      ON ({(currentGeneration.hrScale ?? 2).toFixed(1)}x{currentGeneration.hrUpscaler ? `, ${currentGeneration.hrUpscaler}` : ''})
    </strong>
  </div>
)}
```

### `loadIntoForm()` update

```ts
setHiresFixEnabled(!!item.enableHr);
setSelectedUpscaler(item.hrUpscaler || '');
setHiresScale(item.hrScale ?? 2);
setHiresSteps(item.hrSecondPassSteps ?? 0);
setHiresDenoising(item.denoisingStrength ?? 0.7);
```

## Data flow

```
User checks "Hires.fixを有効にする", adjusts upscaler/scale/steps/denoising
  → handleGenerate / handleBatchGenerate send enableHr (+ the other 4 fields) in the request body
  → server passes to generateImage() → SD payload includes enable_hr/hr_scale/hr_upscaler/hr_second_pass_steps/denoising_strength
  → SD returns the upscaled image
  → server saves the 5 fields to metadata (clientPersist params or local metadata.json)
  → client receives GenerationData with enableHr/hrScale/hrUpscaler/hrSecondPassSteps/denoisingStrength
  → preview shows "Hires.fix: ON (2.0x, ...)" row
  → user clicks "♻️ フォームにロード"
  → loadIntoForm restores all 5 fields
```

## Edge cases

| Case | Handling |
|---|---|
| SD unreachable at page load | `fetchSdUpscalers` catches the error silently; `sdUpscalers` stays empty; dropdown shows disabled placeholder |
| Hires.fix enabled but `selectedUpscaler` empty | Field omitted from payload; SD uses its own default upscaler |
| Hires.fix enabled, `hiresSteps` left at 0 | `hr_second_pass_steps` omitted; SD reuses the first-pass step count (its own default semantics) |
| Hires.fix disabled | No new fields sent at all; SD payload identical to pre-feature behavior |
| History item has no `enableHr` field (generated before this feature) | Preview omits the Hires.fix row; `loadIntoForm` sets `hiresFixEnabled(false)` and resets the other 4 fields to defaults |
| Batch generation (any mode) with Hires.fix on | Every job in the batch uses the same Hires.fix settings, since they're read from form state, not per-job |
| SD build without Hires.fix support (very old) | `enable_hr: true` with unrecognized fields — SD ignores unknown fields; worst case the request 400s the same way an invalid `scheduler` would on an old build. Not otherwise guarded, consistent with how `scheduler` is handled today. |

## `generateImage()` (server) parameter order after this change

```ts
async function generateImage(
  prompt: string,
  negativePrompt: string,
  width = 512,
  height = 512,
  steps = 20,
  cfgScale = 7,
  model = '',
  seed = -1,
  sampler = 'Euler a',
  scheduler = '',
  enableHr = false,
  hrUpscaler = '',
  hrScale = 2,
  hrSecondPassSteps = 0,
  denoisingStrength = 0.7
): Promise<{ image: string; seed: number }>
```

## Testing / verification

No automated tests. Verify manually after typecheck + lint:

1. Page load with SD connected → upscaler dropdown populated.
2. Leave Hires.fix unchecked, generate → payload/behavior unchanged from before this feature.
3. Check Hires.fix, pick an upscaler, generate (single) → SD produces an upscaled image; preview shows the Hires.fix row.
4. Check Hires.fix, run "まとめて生成" in each of the three batch modes → every image in the batch is upscaled consistently.
5. Double-click a history image generated with Hires.fix on → "♻️ フォームにロード" → checkbox and all four sub-fields restore correctly.
6. Load a history image from before this feature → Hires.fix checkbox stays unchecked, sub-fields reset to defaults.
7. SD unreachable → upscaler dropdown shows disabled placeholder; Hires.fix checkbox itself still works (just sends `hrUpscaler: undefined`).

Also run:
- `npm run typecheck --prefix server` → zero errors
- `cd client && npx tsc -b` → zero errors
- `npm run lint --prefix client` → no new errors

## Out of scope

- `hr_sampler_name` / `hr_scheduler` (separate sampler/scheduler for the second pass).
- `hr_prompt` / `hr_negative_prompt` (separate prompt for the second pass).
- `hr_resize_x` / `hr_resize_y` (exact-pixel second-pass target instead of a scale factor).
- Per-batch-job Hires.fix overrides (e.g. a "Hires.fix cycling" batch mode) — batch just inherits whatever the form is set to.
- Persisting the last-used Hires.fix settings across page reloads (no localStorage, consistent with sampler/scheduler/LoRA today).
