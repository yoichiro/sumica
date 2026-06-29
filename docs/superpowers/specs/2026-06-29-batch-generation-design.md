# Batch Generation — Design Spec

- **Date:** 2026-06-29
- **Status:** Approved (design)
- **Topic:** Generate multiple images in one action by calling Stable Diffusion sequentially, one image at a time.

## Goal

Add a new "batch generate" button next to the existing single-generate button.
Pressing it opens a modal to pick a count (2–10). On confirm, the client
enhances the prompt **once**, then requests Stable Diffusion **one image at a
time, sequentially** (N separate `/api/generate` calls — never SD's own Batch
Count parameter). Each finished image is persisted and shown in the preview as
it completes; a final toast summarizes how many succeeded.

## Decisions (resolved forks)

1. **Enhance once, reuse for all N.** A single `/api/enhance` call up front; the
   returned positive/negative prompts feed every image. Keeps the LLM cost at
   one call and gives a coherent set.
2. **Seed follows the existing seed-lock setting — no special-casing.** Each
   image uses `seed = seedLocked ? seedValue : -1`, identical to single
   generation. The batch loop does NOT force random seeds or auto-increment.
   Rationale: a future "parameter sweep" feature (vary size / model / etc.)
   will be the source of variation, so seed stays a pure user-controlled
   parameter. With seed locked and no parameter variation, N identical images
   is an accepted user choice.
3. **Continue on per-image failure; summarize at the end.** A failed image is
   counted and the loop continues. Final toast (`addToast` supports only
   `'success' | 'error'`): all succeeded = `success`; any failures (partial or
   all) = `error` toast whose message states the counts
   ("N枚中M枚を生成しました（X枚失敗）").
4. **Sequential preview + history accumulation.** The progress tracker shows
   "画像 i/N"; each completed image is set as `currentGeneration` so the preview
   updates live. Each image persists as it finishes (Firebase when signed in,
   server-local when signed out). The last completed image remains in the
   preview.
5. **New button sits side-by-side with the single-generate button** (a flex
   row), not stacked below it.

### Rejected alternatives

- **Use SD Batch Count.** Explicitly forbidden by the requirement — the whole
  point is per-image sequential requests so the UI can report progress and
  persist incrementally.
- **Auto-increment / force-random seed in batch.** Breaks the design's
  consistency with single generation and pre-empts the future parameter-sweep
  feature. Rejected.
- **Re-enhance per image.** N LLM calls, slower, concept drifts between images.
  Rejected.
- **Batch-specific server endpoint.** Unnecessary — `/api/generate` already
  generates exactly one image per call. The server stays untouched.

## Architecture

Batch is implemented **entirely client-side** in `client/src/App.tsx`. The
server (`server/index.ts`) is **not modified** — `/api/generate` already
produces one image per request with `seed`, `skipEnhance`, `clientPersist`,
`model`, `sampler`, `loras`, etc.

Following the approved "extract single-generation core" approach (Approach A),
`handleGenerate` is refactored so the enhance step and the per-image
generate+persist step become two reusable helpers, shared by single and batch:

```
enhanceOnce(promptText): Promise<{ positive: string; negative: string }>
  → POST /api/enhance ; throws Error on failure.

generateAndPersist(positive, negative, originalPrompt, seed): Promise<GenerationData>
  → POST /api/generate { prompt: positive, negativePrompt: negative,
       originalPrompt, width, height, steps, cfgScale,
       model: selectedModel || undefined, skipEnhance: true, seed,
       sampler: selectedSampler || undefined, loras: selectedLoras,
       clientPersist: !!user }
  → signed in  → saveGeneration(uid, result.image, result.params) → record
     signed out → result.data
  → throws Error on HTTP failure or save failure (caller decides recovery).
```

- **Single** (`handleGenerate`): `enhanceOnce` once → `generateAndPersist`
  once. Behaviorally equivalent to a batch of N=1, preserving the current flow
  (step indicator 1→2→3, confetti, restore-on-error, cloud-save-failure
  fallback that keeps the image displayed).
- **Batch** (`handleBatchGenerate(count)`): `enhanceOnce` once, then loop
  `generateAndPersist` `count` times.

The cloud-save-failure fallback currently inlined in `handleGenerate`
(lines 609–624: keep the in-hand image as a `data:` URI and toast) is preserved.
For single generation it behaves as today. In batch, a cloud-save failure is
counted as a failed image and the loop continues (the in-hand image is not
specially surfaced mid-loop; the summary toast reports the failure count).

## Data flow (batch)

```
1. Click "まとめて生成" → setShowBatchModal(true)
2. Modal: slider picks N (2–10) → "N枚生成する" → handleBatchGenerate(N)
3. Close modal; setLoading(true); setRightTab('preview'); setErrorStep(null);
   setCurrentGeneration(null); setGenStatus('enhancing'); setLoadingStep(1)
4. positive/negative = await enhanceOnce(prompt)        [step 1: enhancing]
5. setLoadingStep(2); setGenStatus('generating')
   let succeeded = 0, failed = 0
   for (let i = 1; i <= N; i++) {
     setBatchProgress({ current: i, total: N })          [tracker shows "画像 i/N"]
     const seed = seedLocked ? seedValue : -1
     try {
       const saved = await generateAndPersist(positive, negative, prompt, seed)
       succeeded++
       setCurrentGeneration(saved)                       [live preview update]
     } catch (e) { failed++; console.error(e) }
   }
6. if (succeeded > 0) confetti(...)  // one burst at the end, not per image
7. setGenStatus(succeeded > 0 ? 'success' : 'error')
   if (!user) fetchHistory()  // signed-in history updates via onSnapshot
   toast: all ok (failed===0) → `${N}枚の画像を生成しました！🎨⚡️` ('success')
          otherwise           → `${N}枚中${succeeded}枚を生成しました（${failed}枚失敗）` ('error')
8. finally: setLoading(false); setBatchProgress(null)
```

If `enhanceOnce` throws (step 1), abort before the loop exactly like single
generation: `setErrorStep(1)`, `setGenStatus('error')`, error toast, no images.

## Components (`client/src/App.tsx` only)

### New state
- `showBatchModal: boolean` — batch count modal visibility.
- `batchCount: number` — selected count, default 4, clamped 2–10.
- `batchProgress: { current: number; total: number } | null` — drives the
  "画像 i/N" label in the progress tracker; `null` when not batching.

### Refactored functions
- Extract `enhanceOnce` and `generateAndPersist` from the existing
  `handleGenerate` body (lines 534–656). `handleGenerate` keeps its signature
  `(e: React.FormEvent)`, its guards, status transitions, confetti,
  restore-on-error, and success toast — it just delegates the two network steps
  to the helpers.
- Add `handleBatchGenerate(count: number): Promise<void>` per the data flow.

### Buttons (side-by-side)
Replace the single full-width submit button (lines 1075–1102) with a flex row
(`display:flex; gap:10px; flexShrink:0`) containing:
- **Primary** — the existing `type="submit"` `.btn-neon` button, now
  `flex: 1` instead of `width:100%`. Same label/spinner behavior.
  `disabled={loading || !prompt.trim()}`.
- **Secondary** — new `type="button"` "まとめて生成" button with a `Layers`
  icon (lucide-react), auxiliary styling (outline/ghost: white background,
  blue border + text — reuse existing CSS tokens, not `.btn-neon`'s filled
  fill). `disabled={loading || !prompt.trim()}`. `onClick` →
  `setShowBatchModal(true)`.

### Batch count modal
Follows the existing modal pattern (delete-confirm ~line 1776, settings
~line 1817): fixed overlay + centered `.glass-panel` card. Contents:
- Title "まとめて生成" + short helper text.
- A range slider `min=2 max=10 step=1` bound to `batchCount`, with a large live
  number display. Reuse the existing pop-styled `input[type="range"]` from
  `index.css`.
- Actions: "キャンセル" (closes modal) and a `.btn-neon` "○枚生成する"
  (`{batchCount}枚生成する`) that calls `setShowBatchModal(false)` then
  `handleBatchGenerate(batchCount)`.

### Progress tracker
Reuse the existing tracker (renders when `genStatus !== 'idle'`). When
`batchProgress` is non-null, append ` (${current}/${total})` to the
"画像生成" step label so the user sees per-image progress. Single generation
leaves `batchProgress` null and the label is unchanged.

## Error handling

- **enhanceOnce failure:** abort before the loop; `errorStep=1`,
  `genStatus='error'`, error toast (same as single).
- **Per-image generate/persist failure:** increment `failed`, log, continue.
  Never abort the whole batch on one image.
- **Cloud-save failure inside `generateAndPersist`:** treated as a thrown
  error → counted as a failed image in batch. In single generation, the
  existing keep-displayed `data:`-URI fallback is preserved (handled in
  `handleGenerate`, not in the shared helper, to keep the helper's contract
  "throws on any failure").
- **Concurrency guard:** while `loading`, the prompt textarea and BOTH buttons
  are disabled; the modal's confirm path also no-ops if already loading.

## Out of scope (YAGNI)

- Parameter sweeps (vary size / model / sampler / steps across the batch). The
  loop structure is left easy to extend for this later, but it is **not**
  implemented now.
- Parallel/concurrent generation. Sequential only, by requirement.
- Per-image cancel / pause. (A future enhancement; not needed for v1.)
- Server changes of any kind.

## Testing

No automated tests exist (`npm test` is a placeholder that exits 1). Gates:
- `npm run typecheck --prefix server` (must stay green; server untouched).
- `npm run build --prefix client` (`tsc -b && vite build`).
- `npm run lint --prefix client` (oxlint).

Manual verification via Playwright/chrome-devtools MCP across:
(a) signed-out → batch of 3 → 3 local saves, history shows all, last in preview;
(b) signed-in → batch of 3 → 3 Firestore/Storage writes, onSnapshot history,
last in preview; (c) mid-batch failure (e.g. stop SD partway) → loop continues,
summary toast reports the partial count.

## Docs to update

`CLAUDE.md` — note the client-side batch loop (N sequential `/api/generate`
calls; SD Batch Count deliberately unused; server unchanged) in the generation
pipeline section.
