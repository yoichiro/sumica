# Seed Parameter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `seed` parameter to the image generation pipeline so users can reproduce exact results and explore variations with a locked seed.

**Architecture:** Three tasks in sequence — server first (seed plumbing through SD API + metadata), then client UI (seed checkbox + form input + pass to API), then client preview (seed display + `loadIntoForm` helper + "♻️ フォームにロード" button). Server and client changes are independent until integration, so typecheck gates each task.

**Tech Stack:** Express 5 + TypeScript (server, run via tsx), React 19 + TypeScript (client, Vite 8), oxlint, `tsc -b` (client), `tsc --noEmit` (server). No automated test runner — verification is typecheck + lint + Playwright manual check.

## Global Constraints

- Both packages are ESM (`"type": "module"`); use `import`.
- Server: `npm run typecheck --prefix server` must pass after every server task.
- Client: `cd client && npx tsc -b` + `npm run lint --prefix client` must pass after every client task.
- Comments in English only.
- No new dependencies.
- Spec: `docs/superpowers/specs/2026-06-28-seed-parameter-design.md`.

---

### Task 1: Server — seed parameter through the generation pipeline

**Files:**
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: existing `generateImage()` at line 172, `/api/generate` route at line 256, `GenerationMetadata` at line 68.
- Produces: `generateImage()` returns `Promise<{ image: string; seed: number }>`. `GenerationMetadata` gains `seed?: number`. API response `data` includes `seed: number`.

- [ ] **Step 1: Add `seed` to `GenerationMetadata` interface**

In `server/index.ts` at line 68, the interface currently ends with `backendMode`. Add one field:

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
}
```

- [ ] **Step 2: Update `generateImage()` — signature, payload, response parsing, return type**

Replace the entire `generateImage` function (lines 171–206). The new version adds a `seed` parameter, includes it in the payload, parses `info.seed` from the SD response, and returns `{ image, seed }` instead of just the base64 string.

```ts
// Helper: Generate Image via Stable Diffusion sdapi/v1/txt2img
async function generateImage(
  prompt: string,
  negativePrompt: string,
  width = 512,
  height = 512,
  steps = 20,
  cfgScale = 7,
  model = '',
  seed = -1
): Promise<{ image: string; seed: number }> {
  try {
    console.log(`Sending generation request to Stable Diffusion (${stableDiffusionUrl}/sdapi/v1/txt2img)...`);
    const payload: Record<string, unknown> = {
      prompt,
      negative_prompt: negativePrompt || 'nsfw, low quality, worst quality, deformed, bad anatomy, blurry',
      steps,
      cfg_scale: cfgScale,
      width,
      height,
      sampler_name: 'Euler a',
      seed,
    };
    // Switch checkpoint for this request; SD keeps it loaded for subsequent generations.
    if (model) {
      payload.override_settings = { sd_model_checkpoint: model };
    }
    const response = await axios.post(`${stableDiffusionUrl}/sdapi/v1/txt2img`, payload, { timeout: 180000 }); // 3 minutes timeout

    if (response.data && response.data.images && response.data.images[0]) {
      let actualSeed = seed;
      if (response.data.info) {
        try {
          const info = JSON.parse(response.data.info as string);
          if (typeof info.seed === 'number') actualSeed = info.seed;
        } catch {
          // keep requested seed as fallback
        }
      }
      return { image: response.data.images[0], seed: actualSeed };
    }
    throw new Error('No image returned from Stable Diffusion API');
  } catch (error) {
    console.error('Stable Diffusion generation failed:', (error as Error).message);
    throw error;
  }
}
```

- [ ] **Step 3: Update the `/api/generate` route — extract seed, call generateImage, save to metadata**

In `server/index.ts` at the `/api/generate` route (around line 256):

**3a.** Change the destructuring line from:

```ts
const { prompt, negativePrompt, originalPrompt, width, height, steps, cfgScale, skipEnhance, model } = req.body;
```

to:

```ts
const { prompt, negativePrompt, originalPrompt, width, height, steps, cfgScale, skipEnhance, model, seed } = req.body;
```

**3b.** Add a seed parse line immediately after the destructuring (before the `if (!prompt)` check):

```ts
const seedVal = seed !== undefined ? parseInt(seed) : -1;
```

**3c.** Change the `generateImage` call from:

```ts
const base64Image = await generateImage(
  finalPrompt,
  finalNegativePrompt,
  width ? parseInt(width) : 512,
  height ? parseInt(height) : 512,
  steps ? parseInt(steps) : 20,
  cfgScale ? parseFloat(cfgScale) : 7,
  model || ''
);
```

to:

```ts
const { image: base64Image, seed: actualSeed } = await generateImage(
  finalPrompt,
  finalNegativePrompt,
  width ? parseInt(width) : 512,
  height ? parseInt(height) : 512,
  steps ? parseInt(steps) : 20,
  cfgScale ? parseFloat(cfgScale) : 7,
  model || '',
  seedVal
);
```

**3d.** In the Firebase metadata object, add `seed: actualSeed` after `model: model || null`:

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
  imageUrl,
  storagePath,
  timestamp,
  createdAt: new Date(timestamp).toISOString(),
  backendMode: 'firebase'
};
```

**3e.** In the local mode metadata object, add `seed: actualSeed` after `model: model || null`:

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
  imageUrl,
  localPath: localFilePath,
  timestamp,
  createdAt: new Date(timestamp).toISOString(),
  backendMode: 'local'
};
```

- [ ] **Step 4: Type-check the server**

Run: `npm run typecheck --prefix server`

Expected: exits 0, no output. In particular no errors about `generateImage` return type, `base64Image` being used as a string, or unknown property `seed` on metadata.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat: add seed parameter to image generation pipeline"
```

---

### Task 2: Client — seed state, form UI, and pass to API

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: existing `cfgScale` state at line 85; CFG Scale JSX section ending at line 689; generate fetch body at lines 325–335.
- Produces: `GenerationData.seed?: number`; state pair `[seedLocked, setSeedLocked]` + `[seedValue, setSeedValue]`; `seed` field in `/api/generate` request body.

- [ ] **Step 1: Add `seed` to `GenerationData` interface**

In `client/src/App.tsx`, the `GenerationData` interface (lines 17–31) currently ends with `backendMode`. Add one optional field:

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
}
```

- [ ] **Step 2: Add seed state declarations**

After line 85 (`const [cfgScale, setCfgScale] = useState(7);`), add:

```ts
  const [seedLocked, setSeedLocked] = useState(false);
  const [seedValue, setSeedValue] = useState(0);
```

- [ ] **Step 3: Add seed UI section to advanced settings**

After the closing `</div>` of the CFG Scale section (line 689, which closes `{/* CFG Scale */}`), and before the `</div>` at line 690 (which closes the inner settings grid), insert:

```tsx
                {/* Seed */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: loading ? 'default' : 'pointer', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                    <input
                      type="checkbox"
                      checked={seedLocked}
                      onChange={(e) => setSeedLocked(e.target.checked)}
                      disabled={loading}
                    />
                    Seedを固定する
                  </label>
                  {seedLocked && (
                    <input
                      type="number"
                      className="input-field"
                      min={0}
                      step={1}
                      value={seedValue}
                      onChange={(e) => setSeedValue(parseInt(e.target.value) || 0)}
                      disabled={loading}
                      style={{ borderRadius: '8px' }}
                    />
                  )}
                </div>
```

- [ ] **Step 4: Pass seed in the generate fetch body**

In `handleGenerate`, the generate fetch body (lines 325–335) currently ends with `skipEnhance: true`. Add one field:

```ts
        body: JSON.stringify({
          prompt: enhanceResult.positive,
          negativePrompt: enhanceResult.negative,
          originalPrompt: prompt,
          width,
          height,
          steps,
          cfgScale,
          model: selectedModel || undefined,
          skipEnhance: true,
          seed: seedLocked ? seedValue : -1,
        })
```

- [ ] **Step 5: Type-check and lint**

Run both:
```bash
cd /home/yoichiro/projects/sumica/client && npx tsc -b
npm run lint --prefix /home/yoichiro/projects/sumica/client
```

Expected: `tsc -b` exits 0. Lint exits 0 (pre-existing `react-hooks/exhaustive-deps` warnings are acceptable; no new errors).

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add seed lock UI and pass seed to generate API"
```

---

### Task 3: Client — seed in preview, `loadIntoForm` helper, and "♻️ フォームにロード" button

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `GenerationData.seed?: number` (from Task 2); state setters `setPrompt`, `setWidth`, `setHeight`, `setSteps`, `setCfgScale`, `setSelectedModel`, `setSeedLocked`, `setSeedValue`; `currentGeneration: GenerationData | null`; preview params grid (lines 841–860).
- Produces: `loadIntoForm(item: GenerationData): void` — usable from any component that has a `GenerationData` object.

- [ ] **Step 1: Add `loadIntoForm` helper**

Insert immediately before `const openInPreview` (currently `client/src/App.tsx` around line 268):

```tsx
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

- [ ] **Step 2: Add seed row to the preview params grid**

The params grid in the preview section (lines 841–860) shows 解像度, ステップ, CFG, and optionally モデル. After the model block (after line 859, before the closing `</div>` at line 860), add:

```tsx
                    {currentGeneration.seed !== undefined && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <span>Seed: </span>
                        <strong style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{currentGeneration.seed}</strong>
                      </div>
                    )}
```

- [ ] **Step 3: Add "♻️ フォームにロード" button**

After the closing `</div>` of the params grid (line 860) and before the closing `</div>` of the scrollable info column (line 861), insert:

```tsx
                  <button
                    type="button"
                    onClick={() => loadIntoForm(currentGeneration)}
                    className="scale-hover"
                    style={{
                      marginTop: '12px',
                      background: 'rgba(51, 154, 240, 0.08)',
                      border: '2px solid rgba(51, 154, 240, 0.2)',
                      color: 'var(--pop-blue)',
                      borderRadius: '8px',
                      padding: '8px 16px',
                      fontSize: '13px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      width: '100%',
                      justifyContent: 'center'
                    }}
                  >
                    ♻️ フォームにロード
                  </button>
```

- [ ] **Step 4: Type-check and lint**

Run both:
```bash
cd /home/yoichiro/projects/sumica/client && npx tsc -b
npm run lint --prefix /home/yoichiro/projects/sumica/client
```

Expected: both exit 0 with no new errors.

- [ ] **Step 5: Manual verification with Playwright**

Ensure `npm run dev` is running. Drive a browser at `http://127.0.0.1:5173`:

1. Generate an image (any prompt) → preview tab shows a **Seed: [number]** row in the params grid.
2. Open advanced settings (詳細設定) → "Seedを固定する" checkbox appears unchecked. Check it → number input appears with value `0`.
3. Manually enter the seed from step 1 → regenerate with the same prompt → the same image is reproduced (requires a running SD).
4. Double-click a history image → shown in preview. Click "♻️ フォームにロード" → left panel: prompt matches the history item's original prompt, advanced settings shows the seed if present, checkbox is checked if seed was in the data.
5. Double-click a history image that was generated **before this feature** (no seed field) → "♻️ フォームにロード" → seed checkbox is unchecked.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: show seed in preview and add load-into-form button"
```

---

## Self-Review

**Spec coverage:**
- `GenerationMetadata.seed?: number` → Task 1 Step 1 ✓
- `generateImage()` accepts and passes `seed` → Task 1 Step 2 ✓
- SD response `info.seed` parsed → Task 1 Step 2 ✓
- Route extracts and forwards seed → Task 1 Step 3 ✓
- Firebase + local metadata include `seed` → Task 1 Steps 3d/3e ✓
- `GenerationData.seed?: number` → Task 2 Step 1 ✓
- Seed state `[seedLocked, setSeedLocked]` + `[seedValue, setSeedValue]` → Task 2 Step 2 ✓
- "Seedを固定する" checkbox + number input → Task 2 Step 3 ✓
- `seed: seedLocked ? seedValue : -1` in fetch body → Task 2 Step 4 ✓
- `loadIntoForm(item)` helper → Task 3 Step 1 ✓
- Seed row in preview params grid → Task 3 Step 2 ✓
- "♻️ フォームにロード" button → Task 3 Step 3 ✓
- Edge case: existing history items without seed → loadIntoForm `else setSeedLocked(false)` + conditional preview row ✓
- Edge case: SD `info` parse failure → try-catch fallback ✓

**Placeholder scan:** No TBD/TODO. All steps contain actual code. ✓

**Type consistency:**
- `generateImage()` return type `Promise<{ image: string; seed: number }>` defined in Task 1 Step 2, destructured as `{ image: base64Image, seed: actualSeed }` in Task 1 Step 3c. ✓
- `seedLocked`/`seedValue` defined in Task 2 Step 2, used in Task 2 Steps 3+4. ✓
- `setSeedLocked`/`setSeedValue` defined in Task 2 Step 2, used in Task 3 Step 1 (`loadIntoForm`). ✓
- `loadIntoForm` defined in Task 3 Step 1, called in Task 3 Step 3 button's `onClick`. ✓
- `currentGeneration` in Task 3 Step 3 button: the button is inside `{currentGeneration ? (...)  : (...)}` block so TypeScript knows it's non-null. ✓
