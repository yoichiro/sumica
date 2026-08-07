# Image Download Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-image download button to the Lightbox that saves the currently viewed image locally with a human-readable JST timestamp filename.

**Architecture:** Introduce a small `client/src/utils/download.ts` module with a pure filename formatter (unit tested) and a DOM side-effect `downloadImage` function that uses fetch → Blob → objectURL → `<a download>` → revokeObjectURL to bypass cross-origin `download` attribute limitations. Wire it into the Lightbox toolbar and App.tsx handler; report success/failure via the existing `ToastContainer`.

**Tech Stack:** React 19 + Vite 8 + TypeScript, Vitest (jsdom), lucide-react (icons), oxlint. Client-only feature — server is untouched.

## Global Constraints

- Filename format: `sumica_YYYYMMDD_HHMMSS.png` with JST (UTC+9) time, computed deterministically from `item.timestamp` (unix ms).
- Fallback for missing/invalid timestamp: `Date.now()`.
- Download method: fetch → Blob → `URL.createObjectURL` → temporary `<a download>` → click → `URL.revokeObjectURL` (called from `finally` for leak safety).
- Feedback: existing `addToast(message, 'success' | 'error')` helper in `App.tsx:143`.
- Comments in code: English only.
- Commit messages: English, one line.
- Per-task verification runs from repo root; keep the working tree clean between tasks.

---

## File Structure

| Path | Task | Responsibility |
|---|---|---|
| `client/src/utils/download.ts` | 1, 2 | `formatDownloadFilename` (pure) + `downloadImage` (DOM side-effect) |
| `client/src/utils/download.test.ts` | 1 | Unit tests for `formatDownloadFilename` only |
| `client/src/i18n/ja.ts` | 3 | Add `lightbox.downloadTooltip`, `toast.imageDownloaded`, `toast.imageDownloadFailed` (Japanese) |
| `client/src/i18n/en.ts` | 3 | Same keys in English |
| `client/src/components/Lightbox.tsx` | 4 | Add `Download` icon import, `onDownload` prop, toolbar button |
| `client/src/App.tsx` | 5 | Add `handleDownload` async handler, pass `onDownload` prop to `<Lightbox>` |

---

## Task 1: `formatDownloadFilename` pure function + unit tests

**Files:**
- Create: `client/src/utils/download.ts`
- Create: `client/src/utils/download.test.ts`

**Interfaces:**
- Consumes: (nothing from earlier tasks)
- Produces: `export function formatDownloadFilename(timestamp: number | undefined): string`

- [ ] **Step 1: Write the failing tests**

Create `client/src/utils/download.test.ts` with the following exact content:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatDownloadFilename } from './download';

describe('formatDownloadFilename', () => {
  it('formats a known JST timestamp into sumica_YYYYMMDD_HHMMSS.png', () => {
    // 2026-08-07 17:05:01 JST == 2026-08-07 08:05:01 UTC.
    // Date.UTC(year, monthIndex, day, hour, minute, second) — monthIndex is 0-based (August = 7).
    const ms = Date.UTC(2026, 7, 7, 8, 5, 1);
    expect(formatDownloadFilename(ms)).toBe('sumica_20260807_170501.png');
  });

  it('zero-pads month, day, hour, minute, and second to two digits', () => {
    // 2026-01-07 09:05:01 JST == 2026-01-07 00:05:01 UTC.
    const ms = Date.UTC(2026, 0, 7, 0, 5, 1);
    expect(formatDownloadFilename(ms)).toBe('sumica_20260107_090501.png');
  });

  describe('fallback to Date.now() for invalid timestamps', () => {
    beforeEach(() => {
      // Freeze Date.now() to 2027-03-15 04:30:45 JST == 2027-03-14 19:30:45 UTC
      // so the fallback branch is deterministic across runs and machines.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2027, 2, 14, 19, 30, 45)));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('falls back to Date.now() when timestamp is undefined', () => {
      expect(formatDownloadFilename(undefined)).toBe('sumica_20270315_043045.png');
    });

    it('falls back to Date.now() when timestamp is 0', () => {
      expect(formatDownloadFilename(0)).toBe('sumica_20270315_043045.png');
    });

    it('falls back to Date.now() when timestamp is NaN', () => {
      expect(formatDownloadFilename(NaN)).toBe('sumica_20270315_043045.png');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run --prefix client -- utils/download.test.ts`

Expected: FAIL with an error like `Failed to load url ./download` or `Cannot find module './download'` (because `download.ts` does not exist yet).

- [ ] **Step 3: Create the minimal implementation**

Create `client/src/utils/download.ts` with the following exact content:

```typescript
// Filename generator + browser download trigger for saving generated images
// from the Lightbox. Split into a pure function (unit tested) and a DOM
// side-effect function (not unit tested — same pattern as `utils/thumbnail.ts`).

// Build a "sumica_YYYYMMDD_HHMMSS.png" filename from a unix millisecond
// timestamp, always rendered in JST (UTC+9) so the value is deterministic
// regardless of the user's OS timezone. Invalid input (undefined / 0 / NaN
// / negative) falls back to Date.now() so a filename is always producible.
export function formatDownloadFilename(timestamp: number | undefined): string {
  const validMs =
    typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
      ? timestamp
      : Date.now();
  // Shift UTC ms by +9 hours and then read via getUTC* to obtain JST wall
  // clock values without touching the machine's local timezone.
  const d = new Date(validMs + 9 * 60 * 60 * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `sumica_${yyyy}${mm}${dd}_${hh}${mi}${ss}.png`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run --prefix client -- utils/download.test.ts`

Expected: PASS — 5 tests pass in `download.test.ts`.

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npm run test:run --prefix client`

Expected: PASS — `Test Files 13 passed (13)` and `Tests 172 passed (172)` (the 5 new tests bring the total from 167 to 172).

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/download.ts client/src/utils/download.test.ts
git commit -m "feat: add formatDownloadFilename JST-based image download filename generator"
```

---

## Task 2: `downloadImage` DOM side-effect function

**Files:**
- Modify: `client/src/utils/download.ts` (append new function after `formatDownloadFilename`)

**Interfaces:**
- Consumes: (nothing from earlier tasks — same file as Task 1 but new function)
- Produces: `export async function downloadImage(url: string, filename: string): Promise<void>`

- [ ] **Step 1: Append the `downloadImage` function**

Add the following exact block to the **end** of `client/src/utils/download.ts` (after `formatDownloadFilename`):

```typescript
// Trigger a browser download of a remote image using the fetch → Blob →
// objectURL → <a download> → revoke pattern. This bypasses the browser's
// habit of ignoring the `download` attribute on cross-origin anchor URLs
// (both Firebase Storage tokenized URLs and the local /api/outputs/*
// hostname:port combination are effectively cross-origin from the Vite
// dev server), and lets us set an arbitrary filename regardless of the
// server-side name. Throws on network / decode failure; callers surface
// the error via the existing Toast system.
export async function downloadImage(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
```

- [ ] **Step 2: Run typecheck to verify the added code compiles**

Run: `npm run build --prefix client`

Expected: `✓ built in …` with no TypeScript errors. (The build command runs `tsc -b && vite build`.)

- [ ] **Step 3: Confirm the existing test suite still passes**

Run: `npm run test:run --prefix client`

Expected: PASS — same `Tests 172 passed (172)` from Task 1 (no new tests, no regression).

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/download.ts
git commit -m "feat: add downloadImage helper using fetch+Blob objectURL flow"
```

---

## Task 3: i18n keys for tooltip and toast messages

**Files:**
- Modify: `client/src/i18n/ja.ts` (add three keys)
- Modify: `client/src/i18n/en.ts` (add three keys)

**Interfaces:**
- Consumes: (nothing from earlier tasks)
- Produces: `t.lightbox.downloadTooltip`, `t.toast.imageDownloaded`, `t.toast.imageDownloadFailed`

TypeScript's i18n type is inferred from `ja.ts`, so both files must have the same shape or `en.ts` will fail typecheck. Add the keys to both.

- [ ] **Step 1: Add `downloadTooltip` to `lightbox` section in `ja.ts`**

In `client/src/i18n/ja.ts`, find the `lightbox: {` block (around line 140) and add the key **immediately before `imageAlt: '拡大表示',`** (or anywhere within the lightbox object — order doesn't matter, but this position keeps it near other tooltip keys). Use this diff:

```diff
   lightbox: {
     imageAlt: '拡大表示',
+    downloadTooltip: '画像をダウンロード',
     infoShowTooltip: '詳細情報を表示',
```

- [ ] **Step 2: Add `imageDownloaded` and `imageDownloadFailed` to `toast` section in `ja.ts`**

In the same file, find the `toast: {` block (around line 217). Add the two new keys **at the end of the toast object** (just before the closing `},`):

```diff
     batchStarted: 'バッチ生成を開始しました⚡️',
+    imageDownloaded: '画像をダウンロードしました 💾',
+    imageDownloadFailed: (details: string) => `画像のダウンロードに失敗しました。\n\n詳細: ${details}`,
   },
```

- [ ] **Step 3: Add the same three keys to `en.ts` with English strings**

In `client/src/i18n/en.ts`:

Inside `lightbox: {`:
```diff
   lightbox: {
     imageAlt: 'Enlarged view',
+    downloadTooltip: 'Download image',
     infoShowTooltip: 'Show details',
```

Inside `toast: {` (append at the end):
```diff
     batchStarted: 'Batch generation started⚡️',
+    imageDownloaded: 'Image downloaded 💾',
+    imageDownloadFailed: (details: string) => `Image download failed.\n\nDetails: ${details}`,
   },
```

- [ ] **Step 4: Verify types compile**

Run: `npm run build --prefix client`

Expected: `✓ built` with no errors. If `en.ts` and `ja.ts` diverged in shape, tsc will complain — go back and align them.

- [ ] **Step 5: Run test suite (confirm no regression)**

Run: `npm run test:run --prefix client`

Expected: `Tests 172 passed`.

- [ ] **Step 6: Commit**

```bash
git add client/src/i18n/ja.ts client/src/i18n/en.ts
git commit -m "feat: add i18n keys for image download tooltip and toast messages"
```

---

## Task 4: Lightbox Download button

**Files:**
- Modify: `client/src/components/Lightbox.tsx`

**Interfaces:**
- Consumes: `t.lightbox.downloadTooltip` from Task 3
- Produces: new prop `onDownload: () => void` on `LightboxProps`

- [ ] **Step 1: Add `Download` to the lucide-react imports**

In `client/src/components/Lightbox.tsx` line 2, change the import list to include `Download`:

```diff
-import { Info, CheckCircle2, Circle, Star, ChevronLeft, ChevronRight, Maximize, Minimize, Shuffle, Play, Pause, Eye, X } from 'lucide-react';
+import { Info, Download, CheckCircle2, Circle, Star, ChevronLeft, ChevronRight, Maximize, Minimize, Shuffle, Play, Pause, Eye, X } from 'lucide-react';
```

- [ ] **Step 2: Add `onDownload` to the `LightboxProps` interface**

Find the `LightboxProps` interface (starting around line 13). Add `onDownload: () => void;` immediately after `onClose: () => void;`:

```diff
   onClose: () => void;
+  onDownload: () => void;
   isFullscreen: boolean;
```

- [ ] **Step 3: Destructure `onDownload` in the component signature**

In the `export function Lightbox({ ... })` destructuring block (starting around line 48), add `onDownload,` immediately after `onClose,`:

```diff
   onClose,
+  onDownload,
   isFullscreen,
```

- [ ] **Step 4: Add the Download button JSX**

Inside the Lightbox rendered JSX, add a new `<button>` block. Place it **immediately before the closing `</div>` wrapper of the toolbar buttons** (i.e., before the OpenInPreview `<button>` which uses `right: '488px'`). Search for `right: '488px'` — the Download button goes right before that opening `<button` tag.

Use `right: '540px'` (52px to the visual left of OpenInPreview, matching the existing 52px spacing between toolbar buttons):

```tsx
      {/* Download button — save the currently displayed image to disk with a
          human-readable JST timestamp filename. Mirrors the Info button's
          shape/positioning; opts out of the toggled/pressed styling since
          it's a one-shot action. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDownload(); }}
        title={t.lightbox.downloadTooltip}
        className="scale-hover"
        style={{
          position: 'absolute',
          top: '20px',
          right: '540px',
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <Download size={22} />
      </button>
```

- [ ] **Step 5: Verify types compile and build succeeds**

Run: `npm run build --prefix client`

Expected: `✓ built` with no errors. The `LightboxProps` change adds a required prop; App.tsx will surface a "Property 'onDownload' is missing" error until Task 5 wires it up. **If the build reports exactly that error and nothing else, that's expected — proceed to Task 5 before committing this task's changes.** If any other error appears, fix it now.

- [ ] **Step 6: Commit** (still with the App.tsx wiring pending — this commit intentionally lands the Lightbox change first for reviewability; Task 5's commit lands together and clears the transient error)

```bash
git add client/src/components/Lightbox.tsx
git commit -m "feat: add download button and onDownload prop to Lightbox toolbar"
```

---

## Task 5: App.tsx wire-up + full verification

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `formatDownloadFilename` and `downloadImage` from Task 1/2; `t.toast.imageDownloaded` and `t.toast.imageDownloadFailed` from Task 3; `onDownload` prop on `<Lightbox>` from Task 4.
- Produces: full working feature (no downstream tasks).

- [ ] **Step 1: Import the two download utilities**

In `client/src/App.tsx`, near the other imports (e.g., after the `resolveLightboxKey` / `nextSlideshowIndex` imports around line 38-39), add:

```typescript
import { formatDownloadFilename, downloadImage } from './utils/download';
```

- [ ] **Step 2: Add the `handleDownload` handler**

Near the other lightbox handlers in App.tsx (e.g., after `randomizeLightbox` around line 543, or grouped with `openInPreview`), add:

```typescript
  // Trigger a browser download for the given gallery item. Reads the image
  // from item.imageUrl (Firebase Storage tokenized URL when signed in, local
  // /api/outputs/*.png when signed out) and saves it under a JST timestamp
  // filename. Surfaces success/failure via the existing Toast system.
  const handleDownload = async (item: GalleryItem) => {
    if (!item?.imageUrl) return;
    try {
      await downloadImage(item.imageUrl, formatDownloadFilename(item.timestamp));
      addToast(t.toast.imageDownloaded, 'success');
    } catch (e) {
      addToast(t.toast.imageDownloadFailed((e as Error).message), 'error');
    }
  };
```

Note: `GalleryItem` is the type used by `displayedHistory[]`. If the type name in App.tsx is different (e.g., `GenerationRecord`), use whatever type `displayedHistory[lightboxIndex]` resolves to — verify by hovering the variable in your editor or by reading the surrounding handlers like `openInPreview`.

- [ ] **Step 3: Pass `onDownload` prop to the `<Lightbox>` element**

Find the `<Lightbox … />` JSX block around line 1995. Add `onDownload={...}` next to the existing `onClose={closeLightbox}` line:

```diff
         onClose={closeLightbox}
+        onDownload={() => {
+          const item = displayedHistory[lightboxIndex];
+          if (item) handleDownload(item);
+        }}
         isFullscreen={isFullscreen}
```

- [ ] **Step 4: Run full verification suite**

Run each in sequence from the repo root:

```bash
npm run typecheck --prefix server
npm run build --prefix client
npm run lint --prefix client
npm run test:run --prefix client
```

Expected results:
- `server tsc`: no output (no errors)
- `client build`: `✓ built` with no errors
- `client lint`: only pre-existing warnings (the same 6-ish React `exhaustive-deps` warnings in App.tsx that appear on `main`); **zero new warnings**
- `client vitest`: `Test Files 13 passed (13)` and `Tests 172 passed (172)`

If any check fails, fix the code (not the tests unless the failure reveals a genuine spec issue) and re-run before committing.

- [ ] **Step 5: Manual sanity check via `npm run dev`**

Start the dev servers:

```bash
npm run dev
```

Then open `http://localhost:5173` in a browser and:
1. Generate one image (or pick any existing gallery thumbnail if history is present).
2. Click the thumbnail to open the Lightbox.
3. Confirm the new Download icon appears in the toolbar (leftmost position visually, next to the OpenInPreview eye icon).
4. Click the Download icon.
5. Confirm the browser saves a file named `sumica_YYYYMMDD_HHMMSS.png` matching the current JST time within a few seconds, and confirm a green success toast appears.
6. Optional negative test: stop the server (`Ctrl+C`), click Download again, confirm a red error toast appears.

Stop the dev servers before committing.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: wire lightbox download button to fetch+blob save with toast feedback"
```

---

## Self-Review

Verified before handoff:

**Spec coverage:**
- Spec §配置 (Lightbox toolbar button) → Task 4 ✓
- Spec §Filename `sumica_YYYYMMDD_HHMMSS.png` JST → Task 1 (function) + Task 5 (wired to `item.timestamp`) ✓
- Spec §fetch → Blob → objectURL → `<a download>` → revoke → Task 2 ✓
- Spec §Toast success/failure via existing `ToastContainer` → Task 3 (i18n keys) + Task 5 (`addToast` calls) ✓
- Spec §Firebase mode + local mode both work (cross-origin ok) → Task 2 (fetch/blob approach) + Task 5 (manual dev-server test on local mode) ✓
- Spec §`Date.now()` fallback for missing timestamp → Task 1 (function has fallback branch, 3 fallback tests) ✓
- Spec §Unit test only `formatDownloadFilename` (skip DOM function per `thumbnail.ts` pattern) → Task 1 tests pure function only, no test for `downloadImage` ✓
- Spec §Test count 167 → 172 (5 new tests) → Task 1 Step 5 asserts exactly `172 passed` ✓
- Spec §Global constraint: comments in English, commit messages English one-line → all commit messages in the plan are English one-liners; all code comments in the plan are English ✓

**Placeholder scan:** no "TBD", no "handle appropriately", no "similar to Task N" — each step contains verbatim code or exact command with expected output.

**Type consistency:**
- `formatDownloadFilename(timestamp: number | undefined): string` — same signature in Task 1 implementation and Task 5 caller.
- `downloadImage(url: string, filename: string): Promise<void>` — same signature in Task 2 implementation and Task 5 caller.
- `LightboxProps.onDownload: () => void` — same shape in Task 4 (interface) and Task 5 (`onDownload={() => { ... }}`).
- i18n key names (`downloadTooltip`, `imageDownloaded`, `imageDownloadFailed`) match verbatim between Task 3 (added), Task 4 (consumed in Lightbox), and Task 5 (consumed in App.tsx).
- Toast helper signature `addToast(message: string, type: 'error' | 'success')` matches the existing `App.tsx:143` signature.
