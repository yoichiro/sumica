# Design: Seed Parameter — Reproducibility & Exploration

Date: 2026-06-28
Status: Approved

## Summary

Add a `seed` parameter to the image generation pipeline so users can:

1. **Reproduce** a previously generated image exactly (same prompt + same seed → same output).
2. **Explore** variations by locking a good seed and changing only the prompt.

The UI uses a "Seedを固定する" checkbox + number input in the advanced settings. After generation the actual seed used by SD is displayed in the preview. A "♻️ フォームにロード" button in the preview tab lets users load all generation parameters (including the seed) back into the left-panel form for tweaking and re-generation.

## How SD seed works

- Pass `seed: -1` → SD picks a random seed.
- Pass any integer ≥ 0 → SD uses that exact seed.
- SD's response includes an `info` JSON string with the key `seed` — the **actual** seed used (even when -1 was requested). This is the value to persist and display.

## Server changes (`server/index.ts`)

### `GenerationMetadata` interface

Add one optional field:

```ts
seed?: number;
```

### `generateImage()` function

**Signature change:** add `seed: number = -1` parameter; change return type from `Promise<string>` to `Promise<{ image: string; seed: number }>`.

**Payload:** include `seed` in the txt2img request body.

**Response parsing:** after a successful SD response, extract the actual seed from `response.data.info`:

```ts
let actualSeed = seed;
if (response.data.info) {
  try {
    const info = JSON.parse(response.data.info as string);
    if (typeof info.seed === 'number') actualSeed = info.seed;
  } catch {
    // keep the requested seed value as fallback
  }
}
return { image: response.data.images[0], seed: actualSeed };
```

### `/api/generate` route

- Destructure `seed` from `req.body` (alongside the existing `prompt`, `width`, etc.).
- Parse it as an integer: `const seedVal = seed !== undefined ? parseInt(seed) : -1`.
- Pass `seedVal` to `generateImage()`.
- Destructure the new return value: `const { image: base64Image, seed: actualSeed } = await generateImage(...)`.
- Include `seed: actualSeed` in both the Firebase metadata object and the local metadata object.

## Client changes (`client/src/App.tsx`)

### `GenerationData` interface

Add one optional field:

```ts
seed?: number;
```

### New state

```ts
const [seedLocked, setSeedLocked] = useState(false);
const [seedValue, setSeedValue] = useState(0);
```

### Advanced settings UI — seed section

Placed after the CFG Scale slider, before the Generate button. Rendered only when the advanced settings panel is open.

```
[ ] Seedを固定する
    ↓ when checked:
[✓] Seedを固定する
    [ 3829456789          ]
    (number input, disabled when unchecked)
```

- Checkbox label: "Seedを固定する"
- Number input: `type="number"`, `min=0`, `step=1`, disabled when `!seedLocked`
- When unchecked: `seedValue` state is kept but the field is grayed out

### `handleGenerate` — passing seed

In the `/api/generate` fetch body, add:

```ts
seed: seedLocked ? seedValue : -1,
```

### Preview — seed display

In the params grid (currently shows 解像度, ステップ, CFG, モデル), add a seed row when seed is known:

```tsx
{currentGeneration.seed !== undefined && (
  <div style={{ gridColumn: '1 / -1' }}>
    <span>Seed: </span>
    <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
      {currentGeneration.seed}
    </strong>
  </div>
)}
```

### New `loadIntoForm(item: GenerationData)` helper

Loads all generation parameters from a `GenerationData` object into the left-panel form state. Intended for the "♻️ フォームにロード" button in the preview tab.

```ts
const loadIntoForm = (item: GenerationData) => {
  setPrompt(item.originalPrompt);
  setWidth(item.width);
  setHeight(item.height);
  setSteps(item.steps);
  setCfgScale(item.cfgScale);
  setSelectedModel(item.model || '');
  if (item.seed !== undefined) {
    setSeedLocked(true);
    setSeedValue(item.seed);
  } else {
    setSeedLocked(false);
  }
};
```

### "♻️ フォームにロード" button in preview

Rendered in the preview tab's info section when `currentGeneration` exists (below the params grid). Calls `loadIntoForm(currentGeneration)`.

## Data flow

```
User checks "Seedを固定する" + enters value
  → handleGenerate sends seed: seedValue
  → SD uses that seed → returns actual seed in info.seed
  → server parses info.seed → stores in metadata
  → client receives GenerationData with seed
  → preview shows seed value
  → user clicks "♻️ フォームにロード"
  → loadIntoForm sets all form state including seedLocked=true + seedValue
  → user tweaks prompt → generates again with same seed
```

## Edge cases

| Case | Handling |
|---|---|
| SD omits `info` or JSON parse fails | Catch the error silently; fall back to the requested seed value (may be -1 for random generations) |
| Existing history items have no `seed` field | `seed?: number` is optional; preview omits seed row; `loadIntoForm` sets `setSeedLocked(false)` |
| Advanced settings panel collapsed when `loadIntoForm` runs | Panel open/close state is unchanged; user can expand to confirm the loaded seed |
| User types a non-integer into the seed input | `parseInt` coerces on server side; `type="number"` + `step=1` constrains the client input |

## Testing / verification

No automated tests exist. Verify manually with Playwright after lint + tsc pass:

1. Generate image with seed unchecked → preview shows a seed value (large integer).
2. Note the seed, check "Seedを固定する", enter that value, generate with the same prompt → same image produced (requires SD to be running).
3. Double-click a history image → preview shows → click "♻️ フォームにロード" → left panel has prompt, params, and seed filled in with checkbox checked.
4. Load from history item that has no `seed` field → seed checkbox is unchecked.

Also run:
- `npm run typecheck --prefix server` → zero errors
- `cd client && npx tsc -b` → zero errors
- `npm run lint --prefix client` → no new errors

## Out of scope

- Sampler selector (seed reproducibility also depends on sampler; hardcoded to "Euler a" for now).
- Seed range slider (seeds are large integers, not a bounded range).
- Display of seed in the history gallery thumbnail.
- Server-side persistence for seed in `CLAUDE.md` updates (will be handled after implementation).
