# Batch Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "まとめて生成" button that opens a count picker (2–10) and generates that many images by calling Stable Diffusion sequentially, one image at a time.

**Architecture:** Pure client-side change in `client/src/App.tsx`. `handleGenerate` is refactored to extract reusable helpers (`enhanceOnce`, `generateImage`, `persistResult`, plus a `generateAndPersist` convenience). A new `handleBatchGenerate(count)` enhances once and loops the generate+persist helpers N times, updating a live progress indicator and the preview after each image. The server (`server/index.ts`) is NOT modified — `/api/generate` already produces exactly one image per request.

**Tech Stack:** React 19 + TypeScript + Vite 8, `lucide-react` icons, `canvas-confetti`, Firebase Web SDK (client). Lint = oxlint. No test framework exists.

## Global Constraints

- **No Stable Diffusion Batch Count.** Batch is N sequential `/api/generate` calls (one image each). Never set SD's `batch_size`/`n_iter` for this feature.
- **Enhance once per batch.** A single `/api/enhance` call; reuse its positive/negative for all N images.
- **Seed follows the existing seed-lock setting**, identical to single generation: `seed = seedLocked ? seedValue : -1`. No auto-increment, no forced random.
- **Sequential only.** Generate images one at a time (`await` each before the next). No parallel/concurrent requests.
- **Continue on per-image failure.** Count failures, keep going; summarize at the end.
- **`addToast` supports only `'success' | 'error'`.** All-success → `'success'`; any failure → `'error'` toast stating the counts.
- **Side-by-side buttons.** The new button sits in a flex row next to the existing generate button (not stacked).
- **Server untouched.** No changes to `server/index.ts` or any API.
- **No test framework.** `npm test` is a placeholder that exits 1. The verification cycle for every task is: client build (`npm run build --prefix client`) + lint (`npm run lint --prefix client`), plus manual checks where noted.

---

## File Structure

- **Modify** `client/src/App.tsx` — all feature logic and UI (Tasks 1–3).
- **Modify** `client/CLAUDE.md`? No. **Modify** root `CLAUDE.md` — add a batch-generation note to the pipeline docs (Task 3).
- No new files. No server changes.

---

## Task 1: Extract generation helpers and rewire `handleGenerate`

Behavior-preserving refactor: pull the enhance / generate / persist steps out of `handleGenerate` into reusable helpers, then make `handleGenerate` call them. Single generation must behave exactly as before, including the cloud-save-failure fallback that keeps the image displayed.

**Files:**
- Modify: `client/src/App.tsx` (import at line 21; `handleGenerate` at lines 534–656)

**Interfaces:**
- Consumes: existing component state `prompt`, `width`, `height`, `steps`, `cfgScale`, `selectedModel`, `selectedSampler`, `selectedLoras`, `seedLocked`, `seedValue`, `user`, `currentGeneration`; existing fns `fetchHistory`, `addToast`, `saveGeneration`; existing constant `API_BASE`; existing type `GenerationData`.
- Produces (used by Tasks 2 & 3):
  - `type GenResult = { success: boolean; image?: string; params?: GenerationParams; data?: GenerationData }`
  - `enhanceOnce(promptText: string): Promise<{ positive: string; negative: string }>`
  - `generateImage(positive: string, negative: string, originalPrompt: string, seed: number): Promise<GenResult>`
  - `persistResult(result: GenResult): Promise<GenerationData>`
  - `generateAndPersist(positive: string, negative: string, originalPrompt: string, seed: number): Promise<GenerationData>`

- [ ] **Step 1: Import the `GenerationParams` type**

In `client/src/App.tsx`, extend the existing firebase import (line 21). Change:

```ts
import { isFirebaseConfigured, onAuth, signInWithGoogle, signOutUser, saveGeneration, subscribeGenerations, deleteGenerations, type AuthUser, type GenerationRecord } from './firebase';
```

to:

```ts
import { isFirebaseConfigured, onAuth, signInWithGoogle, signOutUser, saveGeneration, subscribeGenerations, deleteGenerations, type AuthUser, type GenerationRecord, type GenerationParams } from './firebase';
```

- [ ] **Step 2: Add the helper functions and `GenResult` type above `handleGenerate`**

Insert this block immediately before `const handleGenerate = async (e: React.FormEvent) => {` (currently line 534):

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

  // Step 1: enhance a prompt via LM Studio. Throws on HTTP failure.
  const enhanceOnce = async (promptText: string): Promise<{ positive: string; negative: string }> => {
    const enhanceRes = await fetch(`${API_BASE}/enhance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptText })
    });
    if (!enhanceRes.ok) {
      const errData = await enhanceRes.json();
      throw new Error(errData.error || 'Failed to enhance prompt');
    }
    const enhanceResult = await enhanceRes.json();
    return { positive: enhanceResult.positive, negative: enhanceResult.negative };
  };

  // Step 2: request ONE image from Stable Diffusion. Throws on HTTP failure.
  const generateImage = async (
    positive: string,
    negative: string,
    originalPrompt: string,
    seed: number
  ): Promise<GenResult> => {
    const genRes = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: positive,
        negativePrompt: negative,
        originalPrompt,
        width,
        height,
        steps,
        cfgScale,
        model: selectedModel || undefined, // Override SD checkpoint when one is selected
        skipEnhance: true, // Skip enhancement since we already did it!
        seed,
        sampler: selectedSampler || undefined,
        loras: selectedLoras,
        clientPersist: !!user
      })
    });
    if (!genRes.ok) {
      const errData = await genRes.json();
      throw new Error(errData.error || 'Failed to generate image');
    }
    return await genRes.json();
  };

  // Step 3: persist a generated image. Signed in → upload to Firebase; signed
  // out → the server already saved it, so just return its metadata.
  // Throws on cloud-save failure (caller decides recovery).
  const persistResult = async (result: GenResult): Promise<GenerationData> => {
    if (user && result.image && result.params) {
      return await saveGeneration(user.uid, result.image, result.params) as unknown as GenerationData;
    }
    return result.data as GenerationData;
  };

  // Convenience for batch: generate one image and persist it. Throws on any failure.
  const generateAndPersist = async (
    positive: string,
    negative: string,
    originalPrompt: string,
    seed: number
  ): Promise<GenerationData> => {
    const result = await generateImage(positive, negative, originalPrompt, seed);
    if (!result.success) throw new Error('Image generation returned an unsuccessful result');
    return await persistResult(result);
  };
```

- [ ] **Step 3: Rewire the body of `handleGenerate` to use the helpers**

Replace the entire current body of `handleGenerate` (the `try { ... } catch ... finally ...` block, currently lines 550–655) so the function reads exactly:

```ts
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    // Backup current generation to restore on error
    const prevGen = currentGeneration;

    setLoading(true);
    setErrorStep(null);
    setRightTab('preview'); // Surface progress/result even if the gallery tab was open
    setGenStatus('enhancing');
    setCurrentGeneration(null); // Clear preview on start
    setLoadingStep(1); // Start Step 1: Prompt Enhancement

    let currentStep = 1;

    try {
      // --- Step 1: Enhance prompt via LM Studio ---
      const { positive, negative } = await enhanceOnce(prompt);

      // --- Transition to Step 2: Image Generation ---
      currentStep = 2;
      setLoadingStep(2);
      setGenStatus('generating');

      const result = await generateImage(positive, negative, prompt, seedLocked ? seedValue : -1);

      if (result.success) {
        // --- Transition to Step 3: Saving ---
        currentStep = 3;
        setLoadingStep(3);
        setGenStatus('saving');

        let saved: GenerationData;
        try {
          saved = await persistResult(result);
        } catch (saveErr: any) {
          // Cloud save failed, but the image is already generated and in hand —
          // keep it displayed (per the design spec's error handling) rather than discarding it.
          const ts = Date.now();
          setCurrentGeneration({
            ...result.params,
            id: `unsaved_${ts}`,
            imageUrl: `data:image/png;base64,${result.image}`,
            backendMode: 'local',
            timestamp: ts,
            createdAt: new Date(ts).toISOString(),
          } as GenerationData);
          setGenStatus('success');
          addToast(`クラウド保存に失敗しました（画像は表示中）。\n\n詳細: ${saveErr.message}`, 'error');
          return;
        }

        confetti({
          particleCount: 150,
          spread: 85,
          origin: { y: 0.6 },
          colors: ['#339af0', '#fcc419', '#ff922b', '#51cf66'],
        });

        setCurrentGeneration(saved);
        setGenStatus('success');
        if (!user) fetchHistory(); // signed-in history updates via onSnapshot (Task 5)
        addToast('画像を生成しました！🎨⚡️', 'success');
      }
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

- [ ] **Step 4: Type-check and build the client**

Run: `npm run build --prefix client`
Expected: PASS (`tsc -b` reports no errors, `vite build` completes). If `tsc` complains that spreading `result.params` (type `GenerationParams | undefined`) is disallowed, it should not — object spread of `undefined` is legal — but the final `as GenerationData` cast already covers the object's shape.

- [ ] **Step 5: Lint the client**

Run: `npm run lint --prefix client`
Expected: PASS (no new oxlint errors).

- [ ] **Step 6: Manual smoke check (single generation unchanged)**

With the dev server running (`npm run dev`), generate a single image both signed-out (local save) and, if Firebase is configured, signed-in (Firebase save). Confirm the step indicator goes 1→2→3, confetti fires, the image appears, and history updates — exactly as before this refactor.

- [ ] **Step 7: Commit**

```bash
git add client/src/App.tsx
git commit -m "refactor: extract generation helpers from handleGenerate"
```

---

## Task 2: Add batch state, `handleBatchGenerate`, and progress label

Add the batch loop and the per-image progress indicator. There is no UI trigger yet (Task 3 adds the button + modal); this task delivers the engine and the progress display, reviewable for logic.

**Files:**
- Modify: `client/src/App.tsx` (state block after line 321; new function near `handleGenerate`; progress tracker label at line 1415)

**Interfaces:**
- Consumes: `enhanceOnce`, `generateAndPersist` (Task 1); state `prompt`, `loading`, `seedLocked`, `seedValue`, `user`; fns `setLoading`, `setErrorStep`, `setRightTab`, `setGenStatus`, `setLoadingStep`, `setCurrentGeneration`, `fetchHistory`, `addToast`, `confetti`.
- Produces (used by Task 3):
  - state `batchProgress: { current: number; total: number } | null` with setter `setBatchProgress`
  - state `showBatchModal: boolean` with setter `setShowBatchModal`
  - state `batchCount: number` with setter `setBatchCount`
  - `handleBatchGenerate(count: number): Promise<void>`

- [ ] **Step 1: Add batch state**

Immediately after the `errorStep` state declaration (currently line 321: `const [errorStep, setErrorStep] = useState<number | null>(null);`), insert:

```ts

  // Batch generation state
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchCount, setBatchCount] = useState(4);
```

- [ ] **Step 2: Add `handleBatchGenerate` after `handleGenerate`**

Insert this function immediately after the closing `};` of `handleGenerate`:

```ts

  // Batch: enhance once, then generate `count` images one at a time (sequential
  // SD calls — NOT SD's Batch Count). A failed image is counted and skipped;
  // the loop continues. The last completed image stays in the preview.
  const handleBatchGenerate = async (count: number) => {
    if (!prompt.trim() || loading) return;

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

      for (let i = 1; i <= count; i++) {
        setBatchProgress({ current: i, total: count });
        const seed = seedLocked ? seedValue : -1;
        try {
          const saved = await generateAndPersist(positive, negative, prompt, seed);
          succeeded++;
          setCurrentGeneration(saved); // live preview update
        } catch (genErr) {
          failed++;
          console.error(genErr);
        }
      }

      if (succeeded > 0) {
        confetti({
          particleCount: 150,
          spread: 85,
          origin: { y: 0.6 },
          colors: ['#339af0', '#fcc419', '#ff922b', '#51cf66'],
        });
      }

      if (succeeded === 0) setErrorStep(2);
      setGenStatus(succeeded > 0 ? 'success' : 'error');
      if (!user) fetchHistory(); // signed-in history updates via onSnapshot

      if (failed === 0) {
        addToast(`${count}枚の画像を生成しました！🎨⚡️`, 'success');
      } else {
        addToast(`${count}枚中${succeeded}枚を生成しました（${failed}枚失敗）。\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
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

- [ ] **Step 3: Show per-image progress in the tracker label**

In the progress tracker, change the "画像生成" label (currently line 1415):

```tsx
                    <span className={genStatus === 'generating' ? 'processing-shimmer' : undefined}>画像生成</span>
```

to:

```tsx
                    <span className={genStatus === 'generating' ? 'processing-shimmer' : undefined}>画像生成{batchProgress ? ` (${batchProgress.current}/${batchProgress.total})` : ''}</span>
```

- [ ] **Step 4: Type-check and build the client**

Run: `npm run build --prefix client`
Expected: PASS. Note `handleBatchGenerate`, `showBatchModal`, `batchCount`, and the setters are not yet referenced by any JSX — TypeScript with `noUnusedLocals` flags **unused locals**, but `useState` results are used (the setters/values are exported via this task's interface and consumed in Task 3) and a `const` function declaration assigned but not called is not a `noUnusedLocals` error for a module-level-style local in a component body. If the build flags `handleBatchGenerate`/`batchCount`/`showBatchModal` as unused, that is expected to be resolved by Task 3; proceed to commit only if the build is GREEN. If it is red solely due to these unused symbols, complete Task 3's wiring in the same change set before committing, and note this in the report.

- [ ] **Step 5: Lint the client**

Run: `npm run lint --prefix client`
Expected: PASS (no new oxlint errors).

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add batch generation engine and progress indicator"
```

---

## Task 3: Side-by-side batch button, count modal, and docs

Add the trigger UI: a "まとめて生成" button next to the generate button, and a modal to pick the count, wired to `handleBatchGenerate`. Update the project docs.

**Files:**
- Modify: `client/src/App.tsx` (import line 2–20; generate button at lines 1074–1102; add modal near the other modal blocks ~line 1801)
- Modify: `CLAUDE.md` (pipeline section)

**Interfaces:**
- Consumes: `showBatchModal`/`setShowBatchModal`, `batchCount`/`setBatchCount`, `handleBatchGenerate` (Task 2); existing `loading`, `prompt`, classes `.btn-neon`/`.scale-hover`/`.glass-panel`, the pop-styled `input[type="range"]` from `index.css`.

- [ ] **Step 1: Import the `Layers` icon**

In the `lucide-react` import block (lines 2–20), add `Layers` to the list. Change the line `  LogIn` (line 19) to:

```ts
  LogIn,
  Layers
```

- [ ] **Step 2: Replace the single generate button with a side-by-side button row**

Replace the entire generate-button block (currently lines 1074–1102, the comment `{/* GENERATE BUTTON ... */}` through the closing `</button>`) with:

```tsx
            {/* GENERATE BUTTONS - Always visible and pinned at bottom */}
            <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
              <button
                type="submit"
                className="btn-neon"
                disabled={loading || !prompt.trim()}
                style={{
                  flex: 1,
                  padding: '16px',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  fontSize: '17px'
                }}
              >
                {loading ? (
                  <>
                    <RotateCw size={20} className="animate-spin-custom" />
                    <span>生成リクエストを実行中... ⚡️</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={20} />
                    <span>画像を生成する 🎨⚡️</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowBatchModal(true)}
                disabled={loading || !prompt.trim()}
                className="scale-hover"
                title="複数枚をまとめて生成"
                style={{
                  padding: '16px 20px',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontSize: '15px',
                  fontWeight: 700,
                  background: '#fff',
                  color: 'var(--pop-blue)',
                  border: '2px solid var(--pop-blue)',
                  cursor: (loading || !prompt.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (loading || !prompt.trim()) ? 0.5 : 1,
                  whiteSpace: 'nowrap'
                }}
              >
                <Layers size={18} />
                <span>まとめて生成</span>
              </button>
            </div>
```

- [ ] **Step 3: Add the batch count modal**

Immediately after the settings modal's closing `)}` (the block that starts `{/* MODAL: CONFIGURATION SETTINGS */}` and ends with `</div> )}`), add a new modal block. Place it among the other modal blocks:

```tsx
      {/* MODAL: BATCH GENERATION COUNT */}
      {showBatchModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 110,
          padding: '20px'
        }}>
          <div
            className="glass-panel"
            style={{
              width: '100%',
              maxWidth: '420px',
              borderRadius: '20px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              textAlign: 'left',
              border: '2px solid var(--pop-blue)',
              background: '#ffffff'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <Layers color="var(--pop-blue)" size={20} />
                <span>まとめて生成 🖼️</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
              同じプロンプトで複数枚を1枚ずつ順番に生成します。生成する枚数を選んでください。
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '40px', fontWeight: 800, color: 'var(--pop-blue)', lineHeight: 1 }}>
                {batchCount}<span style={{ fontSize: '16px', color: 'var(--text-secondary)', marginLeft: '4px' }}>枚</span>
              </span>
              <input
                type="range"
                min={2}
                max={10}
                step={1}
                value={batchCount}
                onChange={(e) => setBatchCount(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span>2枚</span>
                <span>10枚</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                className="scale-hover"
                style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '2px solid #e9ecef', background: '#fff', color: 'var(--text-secondary)', fontWeight: '800', cursor: 'pointer' }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => { setShowBatchModal(false); handleBatchGenerate(batchCount); }}
                className="btn-neon"
                style={{ flex: 1, padding: '12px', borderRadius: '12px', fontWeight: '800', cursor: 'pointer' }}
              >
                {batchCount}枚生成する
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Type-check and build the client**

Run: `npm run build --prefix client`
Expected: PASS (`tsc -b` clean — `handleBatchGenerate`, `showBatchModal`, `batchCount`, `Layers` are now all referenced — and `vite build` completes).

- [ ] **Step 5: Lint the client**

Run: `npm run lint --prefix client`
Expected: PASS (no new oxlint errors).

- [ ] **Step 6: Manual end-to-end check**

With `npm run dev` running:
1. Type a prompt. Confirm "まとめて生成" is disabled when the prompt is empty and during generation.
2. Click it → modal opens. Move the slider (2–10), confirm the big number tracks it.
3. Click "N枚生成する" → modal closes, tracker shows "画像生成 (1/N)…(N/N)", the preview updates as each image completes, and a success toast reports N.
4. Signed-out: history (gallery tab) shows all N. Signed-in (if Firebase configured): all N appear via onSnapshot.
5. Mid-batch failure: stop Stable Diffusion partway, run a batch, confirm the loop continues and the final toast reports the partial count (e.g. "5枚中2枚を生成しました（3枚失敗）").

- [ ] **Step 7: Update `CLAUDE.md`**

In the root `CLAUDE.md`, add a batch-generation note to the generation-pipeline docs. Find the heading line:

```markdown
### Storage: client Firebase ↔ server local fallback
```

and insert this block immediately **before** it:

```markdown
### Batch generation (client-side sequential loop)

"まとめて生成" opens a modal to pick a count (2–10), then `handleBatchGenerate(count)` (in `client/src/App.tsx`) enhances the prompt **once** and calls `/api/generate` **N times sequentially — one image at a time**. SD's own Batch Count parameter is deliberately **not** used, so the UI can show per-image progress ("画像 i/N"), persist each finished image incrementally (Firebase when signed in, server-local when signed out), and continue past a failed image (summarized in a final toast). Seed follows the existing seed-lock setting, identical to single generation. The server is unchanged — batch is purely a client-side loop over the existing single-image endpoint. The shared helpers `enhanceOnce` / `generateImage` / `persistResult` / `generateAndPersist` back both the single and batch flows.

```

- [ ] **Step 8: Commit**

```bash
git add client/src/App.tsx CLAUDE.md
git commit -m "feat: add batch generation button, count modal, and docs"
```

---

## Self-Review notes (author)

- **Spec coverage:** enhance-once (T1 `enhanceOnce`, T2 calls once) ✓; seed follows lock (T1/T2 `seedLocked ? seedValue : -1`) ✓; sequential one-at-a-time (T2 `for` loop with `await`) ✓; continue-on-failure + summary toast (T2) ✓; sequential preview + history accumulation (T2 `setCurrentGeneration(saved)` + `fetchHistory`/onSnapshot) ✓; side-by-side buttons (T3 flex row) ✓; modal 2–10 slider (T3) ✓; progress "i/N" (T2 label) ✓; server untouched ✓; cloud-save fallback preserved for single (T1 `handleGenerate` inner try/catch) ✓; docs (T3 step 7) ✓.
- **Placeholder scan:** every code step contains full code; verification steps name exact commands. No TBD/TODO.
- **Type consistency:** helper names and signatures in T1's "Produces" match their usage in T2 (`enhanceOnce`, `generateAndPersist`) and the `GenResult`/`GenerationParams` types are defined in T1. State names (`batchProgress`, `showBatchModal`, `batchCount`) defined in T2 match their use in T2 (label) and T3 (buttons/modal).
