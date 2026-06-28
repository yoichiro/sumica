# Sampler Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `sampler_name: 'Euler a'` with a user-selectable dropdown populated from Stable Diffusion's sampler list, persisted in metadata, shown in preview, and restored by "♻️ フォームにロード".

**Architecture:** Two tasks in sequence — server first (add `sampler` to `generateImage()`, route, metadata, and add `/api/sd-samplers` endpoint), then client (add state, fetch, dropdown UI, pass to API, show in preview, restore in `loadIntoForm`). Mirrors the existing model-selector pattern exactly.

**Tech Stack:** Express 5 + TypeScript ESM (server, tsx); React 19 + TypeScript + Vite 8 (client); oxlint; no new dependencies.

## Global Constraints

- Modify `server/index.ts` and `client/src/App.tsx` only.
- `npm run typecheck --prefix server` must exit 0 after Task 1.
- `cd client && npx tsc -b` and `npm run lint --prefix client` must exit 0 after Task 2.
- Comments in English only.
- No new npm dependencies.
- Spec: `docs/superpowers/specs/2026-06-28-sampler-selection-design.md`.

---

### Task 1: Server — sampler through the generation pipeline + `/api/sd-samplers`

**Files:**
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: `GenerationMetadata` (line 68), `generateImage()` (line 173), `/api/generate` route (line 258), `/api/sd-models` endpoint (line 453).
- Produces: `GenerationMetadata.sampler?: string`; `generateImage()` gains `sampler = 'Euler a'` as 9th parameter; `/api/generate` reads `sampler` from body; `GET /api/sd-samplers` returns `{ samplers: string[] }`.

- [ ] **Step 1: Add `sampler` to `GenerationMetadata` interface**

The interface currently ends at line 84 (`seed?: number`). Add one field after `seed`:

```ts
interface GenerationMetadata {
  id?: string;
  originalPrompt: string;
  enhancedPrompt: string;
  negativePrompt: string;
  width: number | string;
  height: number | string;
  steps: number | string;
  cfgScale: number | string;
  model: string | null;
  imageUrl: string;
  storagePath?: string;
  localPath?: string;
  timestamp: number;
  createdAt: string;
  backendMode: 'firebase' | 'local';
  seed?: number;
  sampler?: string;
}
```

- [ ] **Step 2: Add `sampler` parameter to `generateImage()` and replace the hardcoded value**

The function signature currently ends at `seed = -1` (line 181). Add `sampler = 'Euler a'` as the next parameter, and replace `sampler_name: 'Euler a'` (line 192) with `sampler_name: sampler`:

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
): Promise<{ image: string; seed: number }> {
```

And in the payload (line 192):

```ts
      sampler_name: sampler,
```

- [ ] **Step 3: Update the `/api/generate` route**

**3a.** Change the destructuring line (line 269) to add `sampler`:

```ts
  const { prompt, negativePrompt, originalPrompt, width, height, steps, cfgScale, skipEnhance, model, seed, sampler } = req.body;
```

**3b.** Change the `generateImage` call (lines 293–302) to pass `sampler` as the last argument:

```ts
    const { image: base64Image, seed: actualSeed } = await generateImage(
      finalPrompt,
      finalNegativePrompt,
      width ? parseInt(width) : 512,
      height ? parseInt(height) : 512,
      steps ? parseInt(steps) : 20,
      cfgScale ? parseFloat(cfgScale) : 7,
      model || '',
      seedVal,
      sampler || 'Euler a'
    );
```

**3c.** In the Firebase metadata object (line 322 block), add `sampler` after `seed: actualSeed`:

```ts
      const metadata: GenerationMetadata = {
        originalPrompt: finalOriginalPrompt,
        enhancedPrompt: finalPrompt,
        negativePrompt: finalNegativePrompt,
        width: width || 512,
        height: height || 512,
        steps: steps || 20,
        cfgScale: cfgScale || 7,
        model: model || null,
        seed: actualSeed,
        sampler: sampler || 'Euler a',
        imageUrl,
        storagePath,
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        backendMode: 'firebase'
      };
```

**3d.** In the local metadata object (line 353 block), add `sampler` after `seed: actualSeed`:

```ts
      const metadata: GenerationMetadata = {
        id: `local_${timestamp}`,
        originalPrompt: finalOriginalPrompt,
        enhancedPrompt: finalPrompt,
        negativePrompt: finalNegativePrompt,
        width: width || 512,
        height: height || 512,
        steps: steps || 20,
        cfgScale: cfgScale || 7,
        model: model || null,
        seed: actualSeed,
        sampler: sampler || 'Euler a',
        imageUrl,
        localPath: localFilePath,
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        backendMode: 'local'
      };
```

- [ ] **Step 4: Add the `GET /api/sd-samplers` endpoint**

Insert immediately after the closing `});` of the `/api/sd-models` endpoint (after line ~468, before the delete generations endpoint):

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

- [ ] **Step 5: Type-check the server**

Run: `npm run typecheck --prefix server`

Expected: exits 0, no output. Verify no errors about unknown `sampler` on `GenerationMetadata`, about `generateImage` argument count, or about the new route handler.

- [ ] **Step 6: Commit**

```bash
git add server/index.ts
git commit -m "feat: add sampler parameter to generation pipeline and /api/sd-samplers endpoint"
```

---

### Task 2: Client — sampler state, fetch, dropdown UI, preview, loadIntoForm

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/sd-samplers` → `{ samplers: string[] }` (from Task 1); existing `sdModels`/`selectedModel` state pattern (lines 127–128); `fetchSdModels` (line 257); the two SD-connected `useEffect` hooks (lines 189–205); settings-save handler (line ~424); advanced settings model selector (lines 603–623); generate fetch body (lines 344–358); preview params grid (lines 887–912); `loadIntoForm` (lines 274–287).
- Produces: `GenerationData.sampler?: string`; state pair `[sdSamplers, setSdSamplers]` + `[selectedSampler, setSelectedSampler]`; `sampler` field in `/api/generate` request body; sampler row in preview; `loadIntoForm` sets `selectedSampler`.

- [ ] **Step 1: Add `sampler` to `GenerationData` interface**

The interface (lines 17–32) currently ends with `seed?: number`. Add one field after it:

```ts
interface GenerationData {
  id?: string;
  originalPrompt: string;
  enhancedPrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  model?: string | null;
  imageUrl: string;
  timestamp: number;
  createdAt: string;
  backendMode: 'firebase' | 'local';
  seed?: number;
  sampler?: string;
}
```

- [ ] **Step 2: Add sampler state declarations**

After the existing `const [sdModels, setSdModels] = useState<string[]>([]);` and `const [selectedModel, setSelectedModel] = useState('');` (lines 127–128), add:

```ts
  const [sdSamplers, setSdSamplers] = useState<string[]>([]);
  const [selectedSampler, setSelectedSampler] = useState('');
```

- [ ] **Step 3: Add `fetchSdSamplers()` function**

Insert immediately after the closing `};` of `fetchSdModels` (currently line ~269), before `const loadIntoForm`:

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

- [ ] **Step 4: Call `fetchSdSamplers()` in the two useEffect hooks and the settings handler**

**4a.** In the initial `useEffect` (lines 189–197), add `fetchSdSamplers()` next to `fetchSdModels()`:

```ts
  useEffect(() => {
    fetchHistory();
    fetchStatus();
    fetchHealth();
    fetchSdModels();
    fetchSdSamplers();
    const healthInterval = setInterval(fetchHealth, 20000);
    return () => clearInterval(healthInterval);
  }, []);
```

**4b.** In the SD-connected `useEffect` (lines 201–205), add `fetchSdSamplers()` next to `fetchSdModels()`:

```ts
  useEffect(() => {
    if (health?.stableDiffusion.connected) {
      fetchSdModels();
      fetchSdSamplers();
    }
  }, [health?.stableDiffusion.connected]);
```

**4c.** Find the settings save handler that calls `fetchSdModels()` on SD URL change (around line 424). Add `fetchSdSamplers()` on the next line:

```ts
        fetchSdModels(); // Refresh model list against the newly saved SD URL
        fetchSdSamplers();
```

- [ ] **Step 5: Add the sampler dropdown to the advanced settings UI**

Insert the sampler block immediately after the closing `</div>` of the model selector section (after line 623, before `{/* Size Select with Swap Button */}` at line 625):

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

- [ ] **Step 6: Pass `sampler` in the generate fetch body**

In `handleGenerate`, the fetch body currently ends with `seed: seedLocked ? seedValue : -1` (line 356). Add one field after it:

```ts
          seed: seedLocked ? seedValue : -1,
          sampler: selectedSampler || undefined,
```

- [ ] **Step 7: Add sampler row to the preview params grid**

The params grid (lines 887–912) currently ends with the seed row (`{currentGeneration.seed !== undefined && ...}`). Add the sampler row immediately after the seed row and before the closing `</div>` of the grid:

```tsx
                    {currentGeneration.sampler && (
                      <div style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>
                        <span>サンプラー: </span>
                        <strong style={{ color: 'var(--text-primary)' }}>{currentGeneration.sampler}</strong>
                      </div>
                    )}
```

- [ ] **Step 8: Update `loadIntoForm` to restore sampler**

In `loadIntoForm` (lines 274–287), after `setSelectedModel(item.model || '')`, add:

```ts
    setSelectedSampler(item.sampler || '');
```

The full updated function:

```ts
  const loadIntoForm = (item: GenerationData) => {
    setPrompt(item.originalPrompt);
    setWidth(item.width);
    setHeight(item.height);
    setSteps(item.steps);
    setCfgScale(item.cfgScale);
    setSelectedModel(item.model || '');
    setSelectedSampler(item.sampler || '');
    if (item.seed !== undefined) {
      setSeedLocked(true);
      setSeedValue(item.seed);
    } else {
      setSeedLocked(false);
    }
  };
```

- [ ] **Step 9: Type-check and lint**

Run both:

```bash
cd /home/yoichiro/projects/sumica/client && npx tsc -b
npm run lint --prefix /home/yoichiro/projects/sumica/client
```

Expected: `tsc -b` exits 0. Lint exits 0 (pre-existing `react-hooks/exhaustive-deps` warnings for `fetchSdSamplers` are acceptable — same as existing warnings for `fetchSdModels`).

- [ ] **Step 10: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add sampler dropdown to advanced settings"
```

---

## Self-Review

**Spec coverage:**
- `GenerationMetadata.sampler?: string` → Task 1 Step 1 ✓
- `generateImage()` gains `sampler = 'Euler a'` parameter → Task 1 Step 2 ✓
- Hardcoded `'Euler a'` replaced → Task 1 Step 2 ✓
- Route extracts and passes `sampler`, stores in metadata (both Firebase + local) → Task 1 Steps 3a-3d ✓
- `GET /api/sd-samplers` endpoint → Task 1 Step 4 ✓
- `GenerationData.sampler?: string` → Task 2 Step 1 ✓
- State `[sdSamplers, setSdSamplers]` + `[selectedSampler, setSelectedSampler]` → Task 2 Step 2 ✓
- `fetchSdSamplers()` function → Task 2 Step 3 ✓
- Called on load, on SD connect, and on SD URL save → Task 2 Step 4 ✓
- Sampler dropdown in advanced settings (after model selector) → Task 2 Step 5 ✓
- `sampler: selectedSampler || undefined` in generate fetch body → Task 2 Step 6 ✓
- Sampler row in preview params grid → Task 2 Step 7 ✓
- `loadIntoForm` sets `setSelectedSampler` → Task 2 Step 8 ✓
- SD unreachable → disabled placeholder → Task 2 Step 5 (sdSamplers.length === 0 branch) ✓
- Empty `selectedSampler` → server fallback to `'Euler a'` → Task 1 Step 3b (`sampler || 'Euler a'`) ✓

**Placeholder scan:** No TBD/TODO. All code shown verbatim. ✓

**Type consistency:**
- `generateImage()` 9th parameter `sampler = 'Euler a'` in Task 1 Step 2; called with `sampler || 'Euler a'` in Task 1 Step 3b. ✓
- `sdSamplers` typed `string[]` in Task 2 Step 2; `data.samplers` guarded with `Array.isArray` in Task 2 Step 3. ✓
- `selectedSampler` is `string` state; `item.sampler` is `string | undefined` (from `GenerationData.sampler?`); `item.sampler || ''` always produces `string`. ✓
- Preview condition `currentGeneration.sampler &&` is truthy check on `string | undefined` — correctly skips falsy (undefined or empty string). ✓
