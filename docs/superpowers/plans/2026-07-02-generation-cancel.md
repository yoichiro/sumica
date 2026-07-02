# Cancel a Running Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user cancel an in-flight image generation (single or batch) by telling Stable Diffusion (SD) to interrupt its current job, instead of waiting out the full timeout.

**Architecture:** Two tasks in sequence — server first (a module-level `cancelRequested` flag, a new `POST /api/generate/interrupt` endpoint that calls SD's `/sdapi/v1/interrupt`, and a check inside `/api/generate` that turns an interrupted generation into a `{ success: false, cancelled: true }` response instead of persisting a half-finished image), then client (a `cancelling` state, a `requestCancel()` helper, a Cancel button shown during step 2 of the progress panel, and cancellation-aware catch blocks in both `handleGenerate` and `handleBatchGenerate`). No client-side `AbortController` is used — the original `/api/generate` fetch simply resolves faster once SD is interrupted.

**Tech Stack:** Express 5 + TypeScript ESM (server, tsx); React 19 + TypeScript + Vite 8 (client); oxlint; no new dependencies.

## Global Constraints

- Modify `server/index.ts` and `client/src/App.tsx` only.
- `npm run typecheck --prefix server` must exit 0 after Task 1.
- `cd client && npx tsc -b` and `npm run lint --prefix client` must exit 0 after Task 2.
- Comments in English only.
- No new npm dependencies.
- Scope is single generation + batch generation only — no per-job-ID cancellation, no cancelling during step 1 (prompt enhancement) or step 3 (saving).
- No new toast type — cancellation reuses the existing `'success'`-styled toast.
- Spec: `docs/superpowers/specs/2026-07-02-generation-cancel-design.md`.

---

### Task 1: Server — cancel flag, `/api/generate/interrupt`, `/api/generate` cancellation check

**Files:**
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: the `stableDiffusionUrl` const (near line 103), `generateImage()` (defined near line 159), the `/api/generate` route (starts near line 275, ends near line 421).
- Produces: module-level `let cancelRequested = false;`; new `POST /api/generate/interrupt` route returning `{ success: true }`; `/api/generate` resets the flag at the top of its handler and, once `generateImage()` resolves, returns `{ success: false, cancelled: true }` (skipping persistence) when the flag was set during the request.

- [ ] **Step 1: Add the `cancelRequested` module-level flag**

The file currently has this block:

```ts
// LM Studio / Stable Diffusion endpoints — .env-only, no runtime override.
// The UI panel that changed these at runtime was removed; users edit
// server/.env and restart if they need different targets.
const lmStudioUrl = process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234';
const stableDiffusionUrl = process.env.STABLE_DIFFUSION_URL || 'http://127.0.0.1:7860';
const lmStudioModel = process.env.LM_STUDIO_MODEL || ''; // Empty ⇒ use LM Studio's currently loaded model
```

Add the flag immediately after it:

```ts
// LM Studio / Stable Diffusion endpoints — .env-only, no runtime override.
// The UI panel that changed these at runtime was removed; users edit
// server/.env and restart if they need different targets.
const lmStudioUrl = process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234';
const stableDiffusionUrl = process.env.STABLE_DIFFUSION_URL || 'http://127.0.0.1:7860';
const lmStudioModel = process.env.LM_STUDIO_MODEL || ''; // Empty ⇒ use LM Studio's currently loaded model

// Set by POST /api/generate/interrupt, consumed by the in-flight POST /api/generate
// handler once its call to generateImage() resolves. A single flag is sufficient
// because SD only ever processes one generation job at a time for this
// single-local-user tool — no per-job tracking is needed.
let cancelRequested = false;
```

- [ ] **Step 2: Reset the flag at the top of the `/api/generate` handler**

The handler currently starts:

```ts
app.post('/api/generate', async (req: Request, res: Response) => {
  const { prompt, negativePrompt, originalPrompt, width, height, steps, cfgScale, skipEnhance, model, seed, sampler, scheduler, loras, enableHr, hrUpscaler, hrScale, hrSecondPassSteps, denoisingStrength, clientPersist } = req.body;
  const seedVal = seed !== undefined ? parseInt(seed) : -1;
```

Add a defensive reset right after the destructuring line, so a leftover flag from a previous, already-finished request can never wrongly cancel a fresh one:

```ts
app.post('/api/generate', async (req: Request, res: Response) => {
  const { prompt, negativePrompt, originalPrompt, width, height, steps, cfgScale, skipEnhance, model, seed, sampler, scheduler, loras, enableHr, hrUpscaler, hrScale, hrSecondPassSteps, denoisingStrength, clientPersist } = req.body;
  cancelRequested = false; // defensive reset — clears any stale flag from an unrelated, already-finished request
  const seedVal = seed !== undefined ? parseInt(seed) : -1;
```

- [ ] **Step 3: Check the flag after `generateImage()` resolves**

The route currently reads (inside the `try` block):

```ts
    // Step 2: Generate image with Stable Diffusion
    const { image: base64Image, seed: actualSeed } = await generateImage(
      finalPrompt,
      finalNegativePrompt,
      width ? parseInt(width) : 512,
      height ? parseInt(height) : 512,
      steps ? parseInt(steps) : 20,
      cfgScale ? parseFloat(cfgScale) : 7,
      model || '',
      seedVal,
      sampler || 'Euler a',
      scheduler || '',
      !!enableHr,
      hrUpscaler || '',
      hrScale ? parseFloat(hrScale) : 2,
      hrSecondPassSteps ? parseInt(hrSecondPassSteps) : 0,
      denoisingStrength !== undefined ? parseFloat(denoisingStrength) : 0.7
    );

    // Step 3: Persist. When the client owns persistence (signed in), return the
    // raw image + params and save nothing. Otherwise fall back to local save.
    if (clientPersist) {
```

Insert the cancellation check between the `generateImage()` call and the `// Step 3: Persist.` comment:

```ts
    // Step 2: Generate image with Stable Diffusion
    const { image: base64Image, seed: actualSeed } = await generateImage(
      finalPrompt,
      finalNegativePrompt,
      width ? parseInt(width) : 512,
      height ? parseInt(height) : 512,
      steps ? parseInt(steps) : 20,
      cfgScale ? parseFloat(cfgScale) : 7,
      model || '',
      seedVal,
      sampler || 'Euler a',
      scheduler || '',
      !!enableHr,
      hrUpscaler || '',
      hrScale ? parseFloat(hrScale) : 2,
      hrSecondPassSteps ? parseInt(hrSecondPassSteps) : 0,
      denoisingStrength !== undefined ? parseFloat(denoisingStrength) : 0.7
    );

    // If the user cancelled while SD was still rendering, generateImage() resolves
    // with whatever partial image SD had at the moment of interruption — discard it
    // instead of persisting it.
    if (cancelRequested) {
      cancelRequested = false;
      return res.json({ success: false, cancelled: true });
    }

    // Step 3: Persist. When the client owns persistence (signed in), return the
    // raw image + params and save nothing. Otherwise fall back to local save.
    if (clientPersist) {
```

- [ ] **Step 4: Add the `POST /api/generate/interrupt` endpoint**

Insert immediately after the closing `});` of the `/api/generate` route, before the `// 2. Retrieve History` comment:

```ts
// 1b. Interrupt the currently-running Stable Diffusion generation, if any.
// Best-effort: always reports success, since there's nothing the client can do
// differently if SD itself is unreachable (the pending generation will fail on
// its own regardless).
app.post('/api/generate/interrupt', async (_req: Request, res: Response) => {
  cancelRequested = true;
  try {
    await axios.post(`${stableDiffusionUrl}/sdapi/v1/interrupt`, {}, { timeout: 5000 });
  } catch (error) {
    console.error('Failed to interrupt Stable Diffusion generation:', (error as Error).message);
  }
  res.json({ success: true });
});
```

- [ ] **Step 5: Type-check the server**

Run: `npm run typecheck --prefix server`

Expected: exits 0, no output. Verify no errors about the new route handler or the `cancelRequested` flag's usage.

- [ ] **Step 6: Commit**

```bash
git add server/index.ts
git commit -m "feat: add generation cancellation via SD interrupt endpoint"
```

---

### Task 2: Client — cancel button, request wiring, cancellation-aware single/batch handling

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `GenResult` type (near line 812), the client `generateImage()` helper (near line 841), `generateAndPersist` (near line 896), `handleGenerate` (near line 909), `handleBatchGenerate` (near line 989), the `errorStep` state declaration (near line 506), the progress panel JSX (the `{genStatus !== 'idle' && (...)}` block, roughly lines 1798-1927), `API_BASE`, `addToast`.
- Produces: `GenResult.cancelled?: boolean`; a `GenerationCancelledError` class; state `[cancelling, setCancelling]`; a `requestCancel()` function; a Cancel button rendered during `genStatus === 'generating'`; `handleGenerate`/`handleBatchGenerate` catch blocks that special-case `GenerationCancelledError`.

- [ ] **Step 1: Add `cancelled` to `GenResult` and define `GenerationCancelledError`**

The file currently has:

```ts
  // Raw result of POST /api/generate, before client-side persistence.
  // Signed in → server returns { success, image(base64), params }.
  // Signed out → server already saved locally and returns { success, data }.
  type GenResult = {
    success: boolean;
    image?: string;
    params?: GenerationParams;
    data?: GenerationData;
  };
```

Change it to:

```ts
  // Raw result of POST /api/generate, before client-side persistence.
  // Signed in → server returns { success, image(base64), params }.
  // Signed out → server already saved locally and returns { success, data }.
  // cancelled → the user interrupted the generation; no image/data is present.
  type GenResult = {
    success: boolean;
    cancelled?: boolean;
    image?: string;
    params?: GenerationParams;
    data?: GenerationData;
  };

  // Thrown by the client generateImage() helper when the server reports the
  // generation was cancelled, so callers can distinguish it from a real failure.
  class GenerationCancelledError extends Error {}
```

- [ ] **Step 2: Add the `cancelling` state**

The file currently has:

```ts
  const [genStatus, setGenStatus] = useState<GenStatus>('idle');
  const [errorStep, setErrorStep] = useState<number | null>(null);

  // Batch generation state
```

Add the new state between `errorStep` and the batch-generation comment:

```ts
  const [genStatus, setGenStatus] = useState<GenStatus>('idle');
  const [errorStep, setErrorStep] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Batch generation state
```

- [ ] **Step 3: Make the client `generateImage()` helper throw on cancellation**

The helper currently ends:

```ts
    if (!genRes.ok) {
      const errData = await genRes.json();
      throw new Error(errData.error || 'Failed to generate image');
    }
    return await genRes.json();
  };
```

Change the last two lines to parse the JSON once and check `cancelled`:

```ts
    if (!genRes.ok) {
      const errData = await genRes.json();
      throw new Error(errData.error || 'Failed to generate image');
    }
    const result: GenResult = await genRes.json();
    if (result.cancelled) throw new GenerationCancelledError('Generation was cancelled');
    return result;
  };
```

- [ ] **Step 4: Add the `requestCancel()` helper**

Insert it right after `generateAndPersist` and before `handleGenerate`. The file currently has:

```ts
  const generateAndPersist = async (
    positive: string,
    negative: string,
    originalPrompt: string,
    seed: number,
    width: number,
    height: number,
    modelOverride?: string
  ): Promise<GenerationData> => {
    const result = await generateImage(positive, negative, originalPrompt, seed, width, height, modelOverride);
    if (!result.success) throw new Error('Image generation returned an unsuccessful result');
    return await persistResult(result);
  };
  const handleGenerate = async (e: React.FormEvent) => {
```

Insert `requestCancel` between them:

```ts
  const generateAndPersist = async (
    positive: string,
    negative: string,
    originalPrompt: string,
    seed: number,
    width: number,
    height: number,
    modelOverride?: string
  ): Promise<GenerationData> => {
    const result = await generateImage(positive, negative, originalPrompt, seed, width, height, modelOverride);
    if (!result.success) throw new Error('Image generation returned an unsuccessful result');
    return await persistResult(result);
  };

  // Tell the server to interrupt the current SD job, if any. The original
  // /api/generate request (still pending) resolves on its own once SD stops —
  // no AbortController is used here.
  const requestCancel = async () => {
    setCancelling(true);
    try {
      await fetch(`${API_BASE}/generate/interrupt`, { method: 'POST' });
    } catch (error) {
      console.error('Failed to send cancel request:', error);
      addToast('キャンセル要求の送信に失敗しました。', 'error');
      setCancelling(false);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
```

- [ ] **Step 5: Handle cancellation in `handleGenerate`'s catch block, and reset `cancelling` in `finally`**

The catch/finally currently reads:

```ts
    } catch (error: any) {
      console.error(error);

      // Restore previous generation to keep it visible on error
      setCurrentGeneration(prevGen);

      // Use currentStep to freeze on the correct failed step
      setErrorStep(currentStep);
      setGenStatus('error');

      addToast(`画像生成に失敗しました。\n\n詳細: ${error.message}\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
    } finally {
      setLoading(false);
    }
  };
```

Change it to:

```ts
    } catch (error: any) {
      if (error instanceof GenerationCancelledError) {
        // Restore previous generation and return to idle — this is a deliberate
        // user action, not an error, so no error panel is shown.
        setCurrentGeneration(prevGen);
        setGenStatus('idle');
        addToast('画像生成をキャンセルしました🛑', 'success');
        return;
      }

      console.error(error);

      // Restore previous generation to keep it visible on error
      setCurrentGeneration(prevGen);

      // Use currentStep to freeze on the correct failed step
      setErrorStep(currentStep);
      setGenStatus('error');

      addToast(`画像生成に失敗しました。\n\n詳細: ${error.message}\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
    } finally {
      setLoading(false);
      setCancelling(false);
    }
  };
```

- [ ] **Step 6: Handle cancellation in `handleBatchGenerate`'s loop**

The function currently reads:

```ts
  const handleBatchGenerate = async (jobs: BatchJob[]) => {
    if (!prompt.trim() || loading || jobs.length === 0) return;

    setLoading(true);
    setErrorStep(null);
    setRightTab('preview');
    setGenStatus('enhancing');
    setCurrentGeneration(null);
    setLoadingStep(1);

    let currentStep = 1;

    try {
      // --- Step 1: enhance ONCE, reuse for every image ---
      const { positive, negative } = await enhanceOnce(prompt);

      // --- Step 2: generate sequentially, one image at a time ---
      currentStep = 2;
      setLoadingStep(2);
      setGenStatus('generating');

      let succeeded = 0;
      let failed = 0;

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        setBatchProgress({ current: i + 1, total: jobs.length });
        const seed = seedLocked ? seedValue : -1;
        try {
          const saved = await generateAndPersist(positive, negative, prompt, seed, job.width, job.height, job.model);
          succeeded++;
          setCurrentGeneration(saved); // live preview update
        } catch (genErr) {
          failed++;
          console.error(genErr);
        }
      }

      if (succeeded === 0) setErrorStep(2);
      setGenStatus(succeeded > 0 ? 'success' : 'error');
      if (!user) fetchHistory(); // signed-in history updates via onSnapshot

      if (failed === 0) {
        addToast(`${succeeded}枚の画像を生成しました！🎨⚡️`, 'success');
      } else {
        addToast(`${jobs.length}枚中${succeeded}枚を生成しました（${failed}枚失敗）。\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
      }
    } catch (error: any) {
      // enhanceOnce failed before the loop → abort like single generation.
      console.error(error);
      setErrorStep(currentStep);
      setGenStatus('error');
      addToast(`画像生成に失敗しました。\n\n詳細: ${error.message}\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
    } finally {
      setLoading(false);
      setBatchProgress(null);
    }
  };
```

Replace the whole function body with this version — it adds `cancelledInLoop` tracking, breaks the loop on cancellation, branches the final status/toast on it, and resets `cancelling` in `finally`:

```ts
  const handleBatchGenerate = async (jobs: BatchJob[]) => {
    if (!prompt.trim() || loading || jobs.length === 0) return;

    setLoading(true);
    setErrorStep(null);
    setRightTab('preview');
    setGenStatus('enhancing');
    setCurrentGeneration(null);
    setLoadingStep(1);

    let currentStep = 1;

    try {
      // --- Step 1: enhance ONCE, reuse for every image ---
      const { positive, negative } = await enhanceOnce(prompt);

      // --- Step 2: generate sequentially, one image at a time ---
      currentStep = 2;
      setLoadingStep(2);
      setGenStatus('generating');

      let succeeded = 0;
      let failed = 0;
      let cancelledInLoop = false;

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        setBatchProgress({ current: i + 1, total: jobs.length });
        const seed = seedLocked ? seedValue : -1;
        try {
          const saved = await generateAndPersist(positive, negative, prompt, seed, job.width, job.height, job.model);
          succeeded++;
          setCurrentGeneration(saved); // live preview update
        } catch (genErr) {
          if (genErr instanceof GenerationCancelledError) {
            cancelledInLoop = true;
            break; // stop the batch entirely — don't run remaining jobs
          }
          failed++;
          console.error(genErr);
        }
      }

      if (!user) fetchHistory(); // signed-in history updates via onSnapshot

      if (cancelledInLoop) {
        setGenStatus(succeeded > 0 ? 'success' : 'idle');
        addToast(`${succeeded}枚生成した時点でキャンセルしました🛑`, 'success');
      } else if (succeeded === 0) {
        setErrorStep(2);
        setGenStatus('error');
        addToast(`${jobs.length}枚中${succeeded}枚を生成しました（${failed}枚失敗）。\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
      } else {
        setGenStatus('success');
        if (failed === 0) {
          addToast(`${succeeded}枚の画像を生成しました！🎨⚡️`, 'success');
        } else {
          addToast(`${jobs.length}枚中${succeeded}枚を生成しました（${failed}枚失敗）。\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
        }
      }
    } catch (error: any) {
      // enhanceOnce failed before the loop → abort like single generation.
      console.error(error);
      setErrorStep(currentStep);
      setGenStatus('error');
      addToast(`画像生成に失敗しました。\n\n詳細: ${error.message}\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
    } finally {
      setLoading(false);
      setBatchProgress(null);
      setCancelling(false);
    }
  };
```

- [ ] **Step 7: Add the Cancel button to the progress panel**

Inside the `{genStatus !== 'idle' && (...)}` progress panel, the "Steps Horizontally" row div closes, then the panel's own `<div className="glass-panel" ...>` closes:

```tsx
                    <span>保存完了</span>
                  </div>
                </div>
              </div>
          )}
```

(The row div closes right after the step-3 `<span>保存完了</span>` block; the next `</div>` after that closes the `glass-panel` itself.) Insert a new sibling row between those two closing `</div>`s:

```tsx
                    <span>保存完了</span>
                  </div>
                </div>

                {genStatus === 'generating' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={requestCancel}
                      disabled={cancelling}
                      className="scale-hover"
                      style={{ padding: '8px 16px', borderRadius: '10px', border: '2px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'var(--text-secondary)', fontWeight: '800', fontSize: '12px', cursor: cancelling ? 'default' : 'pointer' }}
                    >
                      {cancelling ? 'キャンセル中...' : 'キャンセル'}
                    </button>
                  </div>
                )}
              </div>
          )}
```

This reuses the exact button styling already used for the "キャンセル" button in the delete-confirmation modal (`scale-hover` class + the same border/background/color/fontWeight), so it looks consistent with the rest of the app.

- [ ] **Step 8: Type-check and lint**

Run both:

```bash
cd /home/yoichiro/projects/sumica/client && npx tsc -b
npm run lint --prefix /home/yoichiro/projects/sumica/client
```

Expected: `tsc -b` exits 0. Lint exits 0 (no new errors).

- [ ] **Step 9: Manual verification**

If a local Stable Diffusion (AUTOMATIC1111/Forge, launched with `--api`) and LM Studio are reachable, run `npm run dev` from the repo root and check:

1. Start a single generation with Hires.fix enabled and a slow upscale setting. During step 2, a "キャンセル" button appears next to the progress panel. Click it.
2. SD's own WebUI/console shows the job being interrupted. The client's progress panel disappears (back to idle), and a "画像生成をキャンセルしました🛑" toast appears. No new item shows up in history/gallery.
3. Start a "まとめて生成" batch of 3 (count mode). During job 2's render, click キャンセル. Job 1 is saved (visible in gallery/history), job 2 is discarded, job 3 never starts. Toast reads "1枚生成した時点でキャンセルしました🛑".
4. Confirm the キャンセル button is not rendered during step 1 (プロンプト拡張) or step 3 (保存), only step 2 (画像生成).
5. Click キャンセル twice quickly — no crash, button shows "キャンセル中..." and re-enables once the request resolves.
6. Stop the Stable Diffusion process, start a generation (it will eventually fail on its own), and click キャンセル while it's failing to reach SD — a "キャンセル要求の送信に失敗しました。" toast appears and the button re-enables.

If SD/LM Studio aren't reachable in this environment, skip this step and note it explicitly rather than claiming it was verified.

- [ ] **Step 10: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add cancel button for in-flight generations"
```

---

## Self-Review

**Spec coverage:**
- Module-level `cancelRequested` flag → Task 1 Step 1 ✓
- `POST /api/generate/interrupt` calling SD's `/sdapi/v1/interrupt`, best-effort `{ success: true }` → Task 1 Step 4 ✓
- `/api/generate` resets the flag at the top and returns `{ success: false, cancelled: true }` after `generateImage()` when cancelled, skipping persistence → Task 1 Steps 2-3 ✓
- `GenResult.cancelled` + `GenerationCancelledError` → Task 2 Step 1 ✓
- `cancelling` state + `requestCancel()` → Task 2 Steps 2, 4 ✓
- Client `generateImage()` throws `GenerationCancelledError` on `result.cancelled` → Task 2 Step 3 ✓
- Cancel button visible only during `genStatus === 'generating'`, disabled while `cancelling` → Task 2 Step 7 ✓
- `handleGenerate` treats cancellation distinctly (idle + success-styled toast, no error panel) → Task 2 Step 5 ✓
- `handleBatchGenerate` breaks the loop on cancellation, keeps already-completed jobs, distinct toast → Task 2 Step 6 ✓
- No new toast type (reuses `'success'`) → Task 2 Steps 5-6 use `'success'` for the cancellation toasts ✓
- Old-SD-build / SD-unreachable degrade path → covered by Task 1 Step 4's best-effort try/catch; no special client-side detection, consistent with spec's "out of scope" ✓

**Placeholder scan:** No TBD/TODO. All code shown verbatim, including full before/after function bodies for the two rewritten handlers. ✓

**Type consistency:**
- `GenResult.cancelled?: boolean` (Task 2 Step 1) is checked in the client `generateImage()` helper (Task 2 Step 3) and set by the server's `res.json({ success: false, cancelled: true })` (Task 1 Step 3). ✓
- `GenerationCancelledError` (Task 2 Step 1) is thrown in `generateImage()` (Step 3) and caught with `instanceof` in both `handleGenerate` (Step 5) and `handleBatchGenerate`'s loop (Step 6) — same class, same import scope (all defined in the same component function). ✓
- `cancelling`/`setCancelling` (Step 2) is set `true` in `requestCancel()` (Step 4), read by the button's `disabled` prop (Step 7), and reset `false` in both `requestCancel()`'s catch (Step 4) and the `finally` blocks of `handleGenerate` (Step 5) and `handleBatchGenerate` (Step 6). ✓
- `requestCancel` (Step 4) is referenced by the button's `onClick` (Step 7) — same name, no signature mismatch (both take no arguments). ✓
