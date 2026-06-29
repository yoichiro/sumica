# Batch Size Combinations — Design Spec

- **Date:** 2026-06-29
- **Status:** Approved (design)
- **Topic:** Add a "size combinations" mode to the batch-generation dialog — generate one image per width×height combination (cross product), as an alternative to the existing count mode.

## Goal

Extend the "まとめて生成" (batch) dialog so the user can generate across a
**cross product of width and height candidates** instead of N copies at a single
size. The two modes are **mutually exclusive**: the dialog shows either the
count UI or the size-combination UI, never both. In size mode the client
generates exactly one image per (width, height) combination, sequentially (one
`/api/generate` call each — never SD's Batch Count), reusing the existing batch
engine's persistence, live preview, and error handling.

## Decisions (resolved forks)

1. **Count and size modes are mutually exclusive**, selected by a segmented tab
   at the top of the dialog. Only the active mode's controls are shown.
2. **Size specification = cross product of a width-candidate set and a
   height-candidate set.** The user multi-selects widths and heights from chips;
   the batch is every `width × height` pair. One image per pair.
3. **Candidate values = `[512, 768, 1024]`** for both axes (covers SD1.5 and
   SDXL common resolutions). Same set for width and height.
4. **Cross-product cap = 16 combinations.** If `widths.length ×
   heights.length > 16`, the confirm button is disabled. (With 3 candidates per
   axis the max is 3×3 = 9, so the cap is a defensive guard / future-proofing
   if the candidate set grows.)
5. **Seed and prompt behavior carry over from the existing batch:** enhance the
   prompt once; each image uses `seed = seedLocked ? seedValue : -1`. Same
   prompt + same seed + different size yields a genuinely different image, which
   is the point of varying size.
6. **The batch engine is generalized to a job list.** `handleBatchGenerate`
   takes a `{ width, height }[]` where each entry is one image; both modes build
   that list. This keeps a single sequential loop and is the same structure a
   future model/parameter sweep would extend.

### Rejected alternatives

- **Showing both count and size controls at once.** The user wants the
  exclusivity obvious; a segmented tab makes it unambiguous.
- **Explicit (W×H) preset chips or free-form W×H rows** for size selection.
  Cross product matches the literal request ("縦と横のサイズの組み合わせ") and
  needs fewer interactions.
- **Mode-flag or two-handler batch implementations.** A normalized job list is
  DRY-er (one loop, one progress/toast path) and extends cleanly to future
  sweep axes. Rejected B (internal branching) and C (duplicate handlers).
- **Per-image size in the progress label** (e.g. "(1/9 · 768×1024)"). Out of
  scope (YAGNI); the existing "画像 i/N" indicator is kept.

## Architecture

All changes are client-side in `client/src/App.tsx`. The server
(`server/index.ts`) is **not modified** — `/api/generate` already accepts
per-request `width`/`height` and produces one image.

The batch engine is generalized from "count copies at one size" to a **job
list**, where each job is one image with its own size:

```
type SizeJob = { width: number; height: number }

handleBatchGenerate(jobs: SizeJob[]): Promise<void>
  enhance once → for each job (sequential): generateAndPersist(pos, neg, prompt,
  seed, job.width, job.height) → live preview + per-image continue-on-failure →
  final summary toast. batchProgress.total = jobs.length.

Count mode  → jobs = Array(batchCount).fill({ width, height })   // main-form size
Size mode   → jobs = selectedWidths.flatMap(w =>
                       selectedHeights.map(h => ({ width: w, height: h })))
```

The Task-1 helpers gain explicit size parameters so a job's size flows through
to Stable Diffusion (and thus into the persisted metadata):

```
generateImage(positive, negative, originalPrompt, seed, width, height): Promise<GenResult>
generateAndPersist(positive, negative, originalPrompt, seed, width, height): Promise<GenerationData>
```

Single generation (`handleGenerate`) passes the main form's `width`/`height`, so
its behavior is unchanged.

## Components (`client/src/App.tsx` only)

### New state and constants
- `batchMode: 'count' | 'size'` — default `'count'`.
- `selectedWidths: number[]` — default `[512]`.
- `selectedHeights: number[]` — default `[512]`.
- Module/component constants: `SIZE_OPTIONS = [512, 768, 1024]` (chips for both
  axes) and `MAX_SIZE_COMBINATIONS = 16` (cross-product cap).
- Existing `batchCount`, `batchProgress`, `showBatchModal` are reused unchanged.

### Helper signature change (generalizes Task-1 work)
- `generateImage` and `generateAndPersist` take `width` and `height` as their
  last two parameters (instead of closing over the component's `width`/`height`
  state). `handleGenerate` calls them with the form state values.

### `handleBatchGenerate` change
- Signature becomes `(jobs: SizeJob[])`. The loop iterates `jobs` (one image per
  job), calling `generateAndPersist(positive, negative, prompt, seed, job.width,
  job.height)`. Everything else (enhance-once, `seedLocked ? seedValue : -1`,
  `succeeded`/`failed` counters, `setCurrentGeneration` per success,
  `setBatchProgress({ current, total: jobs.length })`, confetti, final toast,
  `finally` cleanup, signed-out `fetchHistory`) is preserved from the current
  implementation.
- Guard: `if (!prompt.trim() || loading || jobs.length === 0) return;`

### Modal UI (the dialog at `App.tsx` ~line 2050)
- **Segmented tab** at the top toggling `batchMode` between `枚数` and
  `サイズの組合せ`. The active tab is visually highlighted; switching tabs swaps
  which control block is rendered.
- **Count tab** (`batchMode === 'count'`): the existing 2–10 slider + big number
  display, unchanged.
- **Size tab** (`batchMode === 'size'`): two rows of toggle chips —
  `横幅:` and `縦幅:`, each rendering `SIZE_OPTIONS` as toggleable chips bound to
  `selectedWidths` / `selectedHeights` (click toggles membership). A live line
  shows `横{W} × 縦{H} = {W*H}通りを生成` where `W = selectedWidths.length`,
  `H = selectedHeights.length`.
- **Confirm button** (depends on mode):
  - count → label `{batchCount}枚生成する`; builds the count job list.
  - size → label `{combos}通り生成する` where `combos = selectedWidths.length *
    selectedHeights.length`; **disabled** when `selectedWidths.length === 0 ||
    selectedHeights.length === 0 || combos > MAX_SIZE_COMBINATIONS`.
  - On click: close the modal, build the job list for the active mode, call
    `handleBatchGenerate(jobs)`.

## Data flow

```
Open dialog → choose mode tab.
COUNT mode:  slider → confirm → jobs = Array(batchCount).fill({width, height})
SIZE mode:   toggle width chips + height chips → live "W×H = N通り"
             confirm (enabled iff W≥1 and H≥1 and N≤16)
             → jobs = cross product of selectedWidths × selectedHeights
handleBatchGenerate(jobs):
  enhanceOnce(prompt)                              [step 1]
  for i, job in jobs (sequential):                 [step 2, "画像 i/N"]
    seed = seedLocked ? seedValue : -1
    saved = await generateAndPersist(pos, neg, prompt, seed, job.width, job.height)
    succeeded++ ; setCurrentGeneration(saved)      [live preview]
    (on throw: failed++ ; continue)
  confetti if succeeded>0 ; genStatus success/error ; signed-out → fetchHistory
  toast: failed===0 → `${succeeded}枚の画像を生成しました！🎨⚡️` ('success')
         else        → `${jobs.length}枚中${succeeded}枚を生成しました（${failed}枚失敗）…` ('error')
```

## Error handling

- Reuses the existing batch engine: enhance failure aborts before the loop (like
  single generation); per-image generate/persist failure increments `failed` and
  continues; `setLoading(false)` and `setBatchProgress(null)` run in `finally`.
- Confirm is unreachable in an invalid size state because the button is disabled
  (zero on an axis, or over the cap). `handleBatchGenerate` additionally returns
  early on `jobs.length === 0` as a guard.
- `addToast` supports only `'success' | 'error'`; the summary toast uses
  `'success'` when nothing failed and `'error'` otherwise (counts in the text).

## Out of scope (YAGNI)

- Per-image size in the progress label.
- Any sweep axis other than size (model, sampler, steps, cfg). The job-list
  structure is left easy to extend, but no other axis is implemented now.
- Custom/free-form width-height entry; only the `SIZE_OPTIONS` chips.
- Parallel generation; sequential only.
- Server changes.

## Testing

No test framework exists (`npm test` is a placeholder that exits 1). Gates:
- `npm run build --prefix client` (`tsc -b && vite build`).
- `npm run lint --prefix client` (oxlint, no new errors).

Manual verification via the running app:
(a) count mode still works exactly as before (slider → N images at form size);
(b) size mode: toggle e.g. width {512,768} × height {512,1024} → live "2×2 =
4通り" → confirm → 4 images generated sequentially, each at its own size, all
saved to history, last shown in preview;
(c) disabled-confirm states: empty width set, empty height set, and (if the
candidate set is expanded) over-16 combinations;
(d) mid-batch failure continues and reports the partial count.

## Docs to update

`CLAUDE.md` — note the batch dialog's two modes (count vs size cross-product)
and that the batch engine runs a normalized job list of `{width,height}` entries
via sequential `/api/generate` calls.
