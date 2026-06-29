# Batch Size Combinations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "size combinations" mode to the「まとめて生成」batch dialog that generates one image per width×height cross-product, alongside the existing count mode.

**Architecture:** All changes are client-side in `client/src/App.tsx`; the server is untouched (`/api/generate` already accepts per-request `width`/`height`). The batch engine is generalized from "N copies at one size" to a normalized **job list** of `{ width, height }` entries — both the count mode and the new size mode build that list and feed the same sequential loop, persistence, live preview, and error/toast path.

**Tech Stack:** React 19 + TypeScript + Vite (client). No test framework exists (`npm test` exits 1), so per-task verification is `tsc -b` build + oxlint + manual app checks — there are no unit tests to write.

## Global Constraints

- **Client-only.** No changes to `server/index.ts`; `/api/generate` is called exactly as today (one image per call, sequential — never SD's Batch Count).
- **Candidate sizes:** `SIZE_OPTIONS = [512, 768, 1024]`, same set for width and height.
- **Cross-product cap:** `MAX_SIZE_COMBINATIONS = 16`. Confirm disabled when `widths.length * heights.length > 16`.
- **Seed/prompt carry-over:** enhance the prompt **once**; each image uses `seed = seedLocked ? seedValue : -1`. Identical to current batch.
- **Continue-on-failure:** a failed image increments `failed` and the loop continues; enhance failure aborts before the loop. `setLoading(false)` + `setBatchProgress(null)` in `finally`.
- **Toast copy (verbatim):** all-success → `` `${succeeded}枚の画像を生成しました！🎨⚡️` `` (`'success'`); any failure → `` `${jobs.length}枚中${succeeded}枚を生成しました（${failed}枚失敗）。\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。` `` (`'error'`).
- **No per-image size in the progress label** — keep the existing `画像 (i/N)` / `(${batchProgress.current}/${batchProgress.total})` indicator.
- **Lint/build gates:** `npm run build --prefix client` and `npm run lint --prefix client` must stay clean (no new errors). `noUnusedLocals` is on — no dangling `void x;` hacks.

---

### Task 1: Generalize generation helpers to take explicit width/height

**Files:**
- Modify: `client/src/App.tsx` — `generateImage` (~566-596), `generateAndPersist` (~610-619), `handleGenerate` call site (~645), `handleBatchGenerate` call site (~732).

**Interfaces:**
- Consumes: existing component state `width`, `height` (numbers, `App.tsx:121-122`), `seedLocked`/`seedValue`, `selectedModel`/`selectedSampler`/`selectedLoras`, `steps`, `cfgScale`.
- Produces:
  - `generateImage(positive: string, negative: string, originalPrompt: string, seed: number, width: number, height: number): Promise<GenResult>`
  - `generateAndPersist(positive: string, negative: string, originalPrompt: string, seed: number, width: number, height: number): Promise<GenerationData>`

This is a **behavior-preserving refactor**: the helpers stop closing over the component's `width`/`height` state and receive them as parameters instead. Every current caller passes the same form-state values, so runtime behavior is identical. `handleBatchGenerate` still takes `count` in this task — only its inner call gains the two args.

- [ ] **Step 1: Add `width`/`height` params to `generateImage`**

Replace the signature and body's use of the closed-over `width`/`height`. The `body` already references bare `width`/`height` — once they are parameters, no body change is needed beyond the signature.

```tsx
  // Step 2: request ONE image from Stable Diffusion at the given size. Throws on HTTP failure.
  const generateImage = async (
    positive: string,
    negative: string,
    originalPrompt: string,
    seed: number,
    width: number,
    height: number
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
```

- [ ] **Step 2: Add `width`/`height` params to `generateAndPersist`**

```tsx
  // Convenience for batch: generate one image at the given size and persist it. Throws on any failure.
  const generateAndPersist = async (
    positive: string,
    negative: string,
    originalPrompt: string,
    seed: number,
    width: number,
    height: number
  ): Promise<GenerationData> => {
    const result = await generateImage(positive, negative, originalPrompt, seed, width, height);
    if (!result.success) throw new Error('Image generation returned an unsuccessful result');
    return await persistResult(result);
  };
```

- [ ] **Step 3: Update `handleGenerate` to pass the form size**

In `handleGenerate` (~645), change the `generateImage` call to pass the component's `width`/`height` state explicitly:

```tsx
      const result = await generateImage(positive, negative, prompt, seedLocked ? seedValue : -1, width, height);
```

- [ ] **Step 4: Update `handleBatchGenerate`'s inner call to pass the form size**

In `handleBatchGenerate`'s loop (~732), pass `width`/`height` (still the form state — this task does not yet vary size):

```tsx
          const saved = await generateAndPersist(positive, negative, prompt, seed, width, height);
```

- [ ] **Step 5: Verify build + lint pass (no tests exist)**

Run: `npm run build --prefix client && npm run lint --prefix client`
Expected: build succeeds (`tsc -b && vite build`), oxlint reports no new errors. In particular `noUnusedLocals` is satisfied because `generateAndPersist` is still used by the batch loop.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "refactor: pass width/height into generation helpers"
```

---

### Task 2: Generalize the batch engine to a job list (count mode preserved)

**Files:**
- Modify: `client/src/App.tsx` — `handleBatchGenerate` (~704-769) and its single call site in the batch modal (~2125).

**Interfaces:**
- Consumes: `generateAndPersist(..., width, height)` from Task 1; existing state `batchCount` (`App.tsx:327`), `width`/`height`, `seedLocked`/`seedValue`, `setBatchProgress`, `setCurrentGeneration`, `fetchHistory`, `addToast`.
- Produces:
  - `type SizeJob = { width: number; height: number }`
  - `handleBatchGenerate(jobs: SizeJob[]): Promise<void>` — runs one image per job, sequentially.

After this task the dialog's confirm builds a count job list (`Array(batchCount).fill(...)`); **count mode behaves exactly as before**. The size mode UI arrives in Task 3.

- [ ] **Step 1: Add the `SizeJob` type**

Place it next to the `GenResult` type (after `App.tsx:548`), so both are co-located:

```tsx
  // One image's size in a batch run. Both batch modes (count, size cross-product)
  // build a SizeJob[] and feed it to the single sequential loop in handleBatchGenerate.
  type SizeJob = { width: number; height: number };
```

- [ ] **Step 2: Change `handleBatchGenerate` to take `jobs: SizeJob[]`**

Replace the whole function. Loop over `jobs` (each entry = one image at its own size); `total` becomes `jobs.length`; the failure toast uses `jobs.length`. Everything else (enhance-once, seed rule, counters, live preview, confetti, `errorStep`, signed-out `fetchHistory`, `finally` cleanup) is preserved.

```tsx
  // Batch: enhance once, then generate one image per job, sequentially (one SD
  // call each — NOT SD's Batch Count). Each job carries its own width/height, so
  // both count mode (N copies at the form size) and size mode (width×height cross
  // product) share this loop. A failed image is counted and skipped; the loop
  // continues. The last completed image stays in the preview.
  const handleBatchGenerate = async (jobs: SizeJob[]) => {
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
          const saved = await generateAndPersist(positive, negative, prompt, seed, job.width, job.height);
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

- [ ] **Step 3: Update the modal confirm to build a count job list**

In the batch modal confirm button (~2125), change the `onClick` to construct the count job list at the form size:

```tsx
                onClick={() => { setShowBatchModal(false); handleBatchGenerate(Array(batchCount).fill({ width, height })); }}
```

- [ ] **Step 4: Verify build + lint pass**

Run: `npm run build --prefix client && npm run lint --prefix client`
Expected: clean. `handleBatchGenerate` now takes `SizeJob[]` and the only caller passes one.

- [ ] **Step 5: Manual check — count mode unchanged**

Run the app (`npm run dev`), open「まとめて生成」, pick e.g. 3 with the slider, confirm. Expected: 3 images generated sequentially at the form size, `(1/3)…(3/3)` progress, last shown in preview, success toast `3枚の画像を生成しました！🎨⚡️`.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "refactor: drive batch generation from a normalized SizeJob list"
```

---

### Task 3: Add the size-combination mode to the batch dialog

**Files:**
- Modify: `client/src/App.tsx` — new state near the batch state (~325-327), new constants (top of the `App` component or module scope), batch modal body (~2091-2131).

**Interfaces:**
- Consumes: `SizeJob` + `handleBatchGenerate(jobs: SizeJob[])` from Task 2; existing `batchCount`, `width`/`height`, `showBatchModal`/`setShowBatchModal`.
- Produces: a mode-switched dialog. No new exported symbols.

This task adds the segmented tab, the width/height chip selectors, the live combination count, and the mode-aware confirm. Count mode keeps its existing slider UI.

- [ ] **Step 1: Add mode + selection state**

After `App.tsx:327` (`const [batchCount, setBatchCount] = useState(4);`), add:

```tsx
  const [batchMode, setBatchMode] = useState<'count' | 'size'>('count');
  const [selectedWidths, setSelectedWidths] = useState<number[]>([512]);
  const [selectedHeights, setSelectedHeights] = useState<number[]>([512]);
```

- [ ] **Step 2: Add the size constants**

At module scope, next to the other top-of-file constants (e.g. just above the `App` component / near `API_BASE`), add:

```tsx
// Candidate sizes offered as toggle chips in the batch dialog's size mode
// (covers common SD1.5 / SDXL resolutions). Same set for width and height.
const SIZE_OPTIONS = [512, 768, 1024];
// Defensive cap on the width×height cross product (3×3 = 9 today, room to grow).
const MAX_SIZE_COMBINATIONS = 16;
```

- [ ] **Step 3: Add a `toggleSize` helper inside the component**

Place it near the other modal handlers (anywhere in the `App` component body before the return). It toggles a value's membership in a number-array setter:

```tsx
  const toggleSize = (
    setter: React.Dispatch<React.SetStateAction<number[]>>,
    value: number
  ) => {
    setter(prev => (prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]));
  };
```

- [ ] **Step 4: Replace the modal body (intro text → confirm row) with the mode-switched UI**

Replace the block from the intro `<p>` (~2091) through the closing `</div>` of the button row (~2131) with the following. The header (`まとめて生成 🖼️` + ✕) above and the modal wrappers below are unchanged.

```tsx
            {/* Segmented mode tabs */}
            <div style={{ display: 'flex', gap: '8px', background: '#f1f3f5', borderRadius: '12px', padding: '4px' }}>
              {([['count', '枚数'], ['size', 'サイズの組合せ']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setBatchMode(mode)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: '9px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 800,
                    fontSize: '13px',
                    background: batchMode === mode ? 'var(--pop-blue)' : 'transparent',
                    color: batchMode === mode ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {batchMode === 'count' ? (
              <>
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
              </>
            ) : (
              <>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
                  選んだ横幅と縦幅の組み合わせ（掛け合わせ）ごとに1枚ずつ生成します。
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {([['横幅', selectedWidths, setSelectedWidths], ['縦幅', selectedHeights, setSelectedHeights]] as const).map(([label, selected, setter]) => (
                    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>{label}:</span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {SIZE_OPTIONS.map(size => {
                          const active = selected.includes(size);
                          return (
                            <button
                              key={size}
                              type="button"
                              onClick={() => toggleSize(setter, size)}
                              className="scale-hover"
                              style={{
                                flex: 1,
                                padding: '10px',
                                borderRadius: '10px',
                                border: active ? '2px solid var(--pop-blue)' : '2px solid #e9ecef',
                                background: active ? 'var(--pop-blue)' : '#fff',
                                color: active ? '#fff' : 'var(--text-secondary)',
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {size}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize: '13px', fontWeight: 700, textAlign: 'center', color: 'var(--pop-blue)' }}>
                    横{selectedWidths.length} × 縦{selectedHeights.length} = {selectedWidths.length * selectedHeights.length}通りを生成
                  </div>
                </div>
              </>
            )}

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
                disabled={batchMode === 'size' && (selectedWidths.length === 0 || selectedHeights.length === 0 || selectedWidths.length * selectedHeights.length > MAX_SIZE_COMBINATIONS)}
                onClick={() => {
                  setShowBatchModal(false);
                  const jobs: SizeJob[] = batchMode === 'count'
                    ? Array(batchCount).fill({ width, height })
                    : selectedWidths.flatMap(w => selectedHeights.map(h => ({ width: w, height: h })));
                  handleBatchGenerate(jobs);
                }}
                className="btn-neon"
                style={{ flex: 1, padding: '12px', borderRadius: '12px', fontWeight: '800', cursor: 'pointer' }}
              >
                {batchMode === 'count'
                  ? `${batchCount}枚生成する`
                  : `${selectedWidths.length * selectedHeights.length}通り生成する`}
              </button>
            </div>
```

- [ ] **Step 5: Verify build + lint pass**

Run: `npm run build --prefix client && npm run lint --prefix client`
Expected: clean. No unused locals; `SizeJob`, `SIZE_OPTIONS`, `MAX_SIZE_COMBINATIONS`, `toggleSize`, and the three new state hooks are all referenced in the modal.

- [ ] **Step 6: Manual verification (all spec scenarios)**

Run the app and confirm:
- (a) **count mode** — tab `枚数`, slider → N images at form size (unchanged from Task 2).
- (b) **size mode** — tab `サイズの組合せ`; toggle 横幅 {512,768} × 縦幅 {512,1024} → live `横2 × 縦2 = 4通りを生成`; confirm → 4 images generated sequentially each at its own size, all saved to history, last shown in preview.
- (c) **disabled confirm** — empty 横幅 set, or empty 縦幅 set → confirm disabled (and would also disable if combinations exceeded 16).
- (d) **mid-batch failure** — stop SD mid-run; loop continues and the final toast reports the partial count.

- [ ] **Step 7: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add size-combination mode to the batch dialog"
```

---

### Task 4: Document the two batch modes in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` — the "Batch generation (client-side sequential loop)" section.

**Interfaces:**
- Consumes: nothing in code. Documentation only.
- Produces: nothing in code.

- [ ] **Step 1: Update the batch-generation section**

In the "### Batch generation (client-side sequential loop)" section of `CLAUDE.md`, add a sentence describing the two modes and the job list. Insert after the existing description of the count modal (adapt wording to fit the surrounding prose):

```markdown
The dialog has two mutually-exclusive modes selected by a segmented tab: **count** (2–10 copies at the main-form size) and **size combinations** (one image per width×height cross product, candidates `[512, 768, 1024]` per axis, capped at 16 combinations). Both modes build a normalized job list of `{ width, height }` entries that `handleBatchGenerate(jobs)` runs through a single sequential loop — the same per-image persistence, live preview, continue-on-failure, and summary toast back both modes. The shared helpers `generateImage` / `generateAndPersist` take `width`/`height` as explicit parameters so each job's size flows through to SD and into the persisted metadata.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document batch size-combination mode"
```

---

## Self-Review notes

- **Spec coverage:** Decisions 1–6 map to Task 3 (tab, chips, candidates, cap, confirm), Task 2 (job-list engine, seed/prompt carry-over), Task 1 (helper size params). Architecture's helper-signature change → Task 1. Modal UI → Task 3. Data-flow loop → Task 2. Docs-to-update → Task 4. No gaps.
- **No tests:** the repo has no test framework; per the spec's Testing section the gates are `tsc -b && vite build`, oxlint, and the manual scenarios in Task 3 Step 6 — reflected verbatim above rather than fabricating unit tests.
- **Type consistency:** `SizeJob = { width: number; height: number }` is defined in Task 2 Step 1 and used identically in Task 3's confirm; `generateImage`/`generateAndPersist` gain `(…, width, height)` in Task 1 and are called with that arity everywhere thereafter; `handleBatchGenerate(jobs: SizeJob[])` matches all call sites.
