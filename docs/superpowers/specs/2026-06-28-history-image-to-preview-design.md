# Design: Recall a history image into the Preview tab (replace detail popup)

Date: 2026-06-28
Status: Approved (pending spec review)

## Summary

Double-clicking an image in the history gallery currently opens a detail
popup modal. This change **removes that popup** and instead treats the
double-clicked image as if it had **just been generated**: it is loaded into
the "プレビュー＆進捗" (Preview & Progress) tab, reusing the exact same
post-generation success state.

## Motivation

The detail popup is a dead end — "look and close." Recalling an image into
the preview makes it the active result, which is a natural starting point for
re-generation / fine-tuning workflows and keeps a single place where the
"current image" and its parameters live.

## Current behavior (as-is)

- `GenerationData` (`client/src/App.tsx:17`) is the shared shape for the
  freshly generated image (`currentGeneration`), the popup (`selectedItem`),
  and every history item. No conversion is needed between them.
- History item interactions (`client/src/App.tsx:1055-1056`):
  - single click → `toggleSelected(itemKey(item))` (selection for deletion)
  - double click → `setSelectedItem(item)` (opens the detail popup)
- The detail popup modal is a self-contained block at
  `client/src/App.tsx:1143-1299` (the next block, 1300, is the independent
  delete-confirmation modal).
- The Preview tab renders `currentGeneration` (`client/src/App.tsx:758-844`)
  with original/enhanced/negative prompt, width, height, steps, CFG, model,
  backend mode, and the download link — essentially the same parameters the
  popup showed, **except** the human-readable generation timestamp
  (`selectedItem.timestamp` at `App.tsx:1212`), which the Preview block does
  not display.
- On real generation success (`client/src/App.tsx:335-347`): fire confetti →
  `setCurrentGeneration(result.data)` → `setGenStatus('success')` →
  `fetchHistory()` → `addToast(...)`. The success/progress panel renders
  whenever `genStatus !== 'idle'` (`client/src/App.tsx:874+`).
- During the pipeline, `genStatus` is one of `'enhancing' | 'generating' |
  'saving'`.

## Desired behavior (to-be)

Double-clicking a history image emulates the just-generated success state
(chosen approach: "案A — full success-path reuse"), with **no toast**.

### New helper: `openInPreview(item: GenerationData)`

```text
1. Guard: if genStatus is 'enhancing' | 'generating' | 'saving' → return
   (ignore double-clicks while a generation is in progress; do not clobber
   the in-flight preview/progress).
2. Fire confetti (same parameters as the success path:
   particleCount 150, spread 85, origin { y: 0.6 },
   colors ['#339af0','#fcc419','#ff922b','#51cf66']).
3. setCurrentGeneration(item)
4. setGenStatus('success')
5. setLoadingStep(3)
6. setRightTab('preview')
   NOTE: do NOT call addToast.
```

## Changes

| Location | Change |
|---|---|
| `App.tsx:1056` | `onDoubleClick={() => setSelectedItem(item)}` → `onDoubleClick={() => openInPreview(item)}` |
| `App.tsx:1143-1299` | Delete the detail popup modal JSX |
| `App.tsx:177` | Delete the `selectedItem` / `setSelectedItem` state |
| new | Add `openInPreview` helper near `handleGenerate` |
| `App.tsx:1055` (`toggleSelected`) | No change (single-click selection kept) |

## Data flow

History item (`GenerationData`) → `openInPreview` → set as
`currentGeneration` → existing Preview render block (`758-844`) shows every
field unchanged. Identical types mean no mapping/normalization.

## Edge cases

- **Double-click during generation** → ignored by the guard.
- **Recall, then double-click another image** → `genStatus === 'success'`
  passes the guard → the preview is replaced. Fine.
- **Other references to `selectedItem`** → none outside the popup. The
  delete-confirmation modal (`showDeleteConfirm`) is independent, so removing
  `selectedItem` has no side effects (verified by grep).

## Testing / verification

This project has no automated tests. Verify manually with Playwright:

1. Double-click a history image → tab switches to プレビュー＆進捗, the image
   and its parameters render, confetti fires, the "生成完了！🎉" success panel
   shows, and **no toast** appears.
2. Start a generation, and while it is in progress double-click a history
   image → nothing happens (guard).
3. After a recall, double-click a different history image → preview swaps.

Also run `npm run lint --prefix client` and `tsc -b` in `client/` — both
must pass clean.

## Accepted differences

- The popup's human-readable generation timestamp is **not** carried over to
  the Preview tab (the Preview block has no timestamp field). This is
  intentional and consistent with the "treat as just generated" framing.

## Out of scope

- No change to single-click selection / delete flow.
- No new parameters (Seed work is tracked separately).
- No server-side changes.
