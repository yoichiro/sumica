# Design: Sampler Selection

Date: 2026-06-28
Status: Approved

## Summary

Replace the hardcoded `sampler_name: 'Euler a'` in the generation pipeline with a user-selectable sampler. The sampler list is fetched dynamically from Stable Diffusion's `/sdapi/v1/samplers` endpoint (same pattern as the existing model selector). The selected sampler is persisted in generation metadata, displayed in the preview, and restored by the "♻️ フォームにロード" button.

## Current behavior (as-is)

`generateImage()` in `server/index.ts` hardcodes `sampler_name: 'Euler a'` in the SD txt2img payload (line 192). The user has no way to change it.

## Desired behavior (to-be)

- A sampler dropdown appears in the advanced settings panel, after the model selector.
- On page load, the client fetches the sampler list from a new `/api/sd-samplers` endpoint and defaults to `'Euler a'`.
- When SD is unreachable, the dropdown shows a disabled placeholder (identical pattern to the model selector).
- The chosen sampler flows through to SD, is saved in metadata, shown in the preview, and loaded back into the form via "♻️ フォームにロード".

## Server changes (`server/index.ts`)

### `GenerationMetadata` interface

Add one optional field:

```ts
sampler?: string;
```

### `generateImage()` function

Add `sampler: string = 'Euler a'` as the last parameter. Replace the hardcoded string in the payload:

```ts
// before
sampler_name: 'Euler a',

// after
sampler_name: sampler,
```

### `/api/generate` route

- Destructure `sampler` from `req.body` alongside the existing fields.
- Pass it to `generateImage()` as the last argument: `model || '', seedVal, sampler || 'Euler a'`.
- Add `sampler: sampler || 'Euler a'` to both the Firebase metadata object and the local metadata object.

### New `GET /api/sd-samplers` endpoint

Proxy SD's sampler list. Returns a flat array of sampler name strings. Falls back to empty array on error so the client degrades gracefully.

```ts
app.get('/api/sd-samplers', async (_req: Request, res: Response) => {
  try {
    const listRes = await axios.get(`${stableDiffusionUrl}/sdapi/v1/samplers`, { timeout: 5000 });
    const samplers = Array.isArray(listRes.data)
      ? listRes.data.map((s: { name?: string }) => s.name).filter((n): n is string => Boolean(n))
      : [];
    res.json({ samplers });
  } catch (error) {
    console.error('Failed to fetch SD samplers:', (error as Error).message);
    res.json({ samplers: [] });
  }
});
```

Note: SD has no concept of a "currently active sampler" (unlike checkpoints). There is no `current` field in the response.

## Client changes (`client/src/App.tsx`)

### `GenerationData` interface

Add one optional field:

```ts
sampler?: string;
```

### New state

```ts
const [sdSamplers, setSdSamplers] = useState<string[]>([]);
const [selectedSampler, setSelectedSampler] = useState('');
```

### New `fetchSdSamplers()` function

Called on page load alongside `fetchSdModels()`.

```ts
const fetchSdSamplers = async () => {
  try {
    const res = await fetch(`${API_BASE}/sd-samplers`);
    if (res.ok) {
      const data = await res.json();
      const samplers: string[] = Array.isArray(data.samplers) ? data.samplers : [];
      setSdSamplers(samplers);
      setSelectedSampler((prev) => prev || 'Euler a');
    }
  } catch (error) {
    console.error('Failed to fetch SD samplers:', error);
  }
};
```

The `(prev) => prev || 'Euler a'` guard preserves an explicit user choice on subsequent calls (same pattern as `fetchSdModels`).

### Advanced settings UI — sampler dropdown

Placed immediately after the model selector block, before the resolution (width/height) block. Mirrors the model selector's connected/disconnected states exactly:

```tsx
{/* Sampler */}
<div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>サンプラー (Sampler)</label>
  {sdSamplers.length > 0 ? (
    <select
      className="input-field"
      value={selectedSampler}
      onChange={(e) => setSelectedSampler(e.target.value)}
      disabled={loading}
      style={{ borderRadius: '8px' }}
    >
      {sdSamplers.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  ) : (
    <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
      <option>サンプラー一覧を取得できません（SD未接続）</option>
    </select>
  )}
</div>
```

### `handleGenerate` — passing sampler

Add to the `/api/generate` fetch body:

```ts
sampler: selectedSampler || undefined,
```

### Preview — sampler display

In the params grid, add a sampler row when present (same pattern as the model row):

```tsx
{currentGeneration.sampler && (
  <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
    <span>サンプラー: </span>
    <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.sampler}</strong>
  </div>
)}
```

### `loadIntoForm()` update

Add sampler restoration:

```ts
setSelectedSampler(item.sampler || '');
```

## Data flow

```
User selects sampler from dropdown
  → handleGenerate sends sampler in request body
  → server passes to generateImage() → SD payload includes sampler_name
  → server saves sampler to metadata
  → client receives GenerationData with sampler
  → preview shows サンプラー row
  → user clicks "♻️ フォームにロード"
  → loadIntoForm sets selectedSampler
```

## Edge cases

| Case | Handling |
|---|---|
| SD unreachable at page load | `fetchSdSamplers` catches the error silently; `sdSamplers` stays empty; dropdown shows disabled placeholder |
| `selectedSampler` is empty string when generating | Server falls back to `'Euler a'` (same as current hardcoded behavior) |
| History item has no `sampler` field (generated before this feature) | Preview omits sampler row; `loadIntoForm` sets `selectedSampler('')` → SD defaults to `'Euler a'` |
| `fetchSdSamplers` called multiple times (e.g. health poll) | `setSelectedSampler((prev) => prev || 'Euler a')` preserves user's choice |

## `generateImage()` parameter order after this change

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
  sampler = 'Euler a'
): Promise<{ image: string; seed: number }>
```

## Testing / verification

No automated tests. Verify manually with Playwright after typecheck + lint:

1. Page load with SD connected → sampler dropdown populated; default is `'Euler a'`.
2. Select a different sampler, generate → image produced (SD uses the chosen sampler).
3. Preview shows `サンプラー: <name>` row.
4. Double-click a history image (from this feature) → "♻️ フォームにロード" → sampler dropdown shows the stored sampler.
5. Load a history image from before this feature → sampler dropdown resets to empty / Euler a fallback.
6. SD unreachable → sampler dropdown shows disabled placeholder.

Also run:
- `npm run typecheck --prefix server` → zero errors
- `cd client && npx tsc -b` → zero errors
- `npm run lint --prefix client` → no new errors

## Out of scope

- Scheduler / second-pass sampler fields (some SD extensions expose these).
- Displaying the sampler in the history gallery thumbnail.
- Persisting the last-used sampler across page reloads (no localStorage).
