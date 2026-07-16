# Lightbox Slideshow & Random-Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing lightbox Shuffle button into a "random mode" toggle (affecting manual navigation) and add a new Slideshow toggle that auto-advances every 5s, both keyed off the same shared random state.

**Architecture:** Two new pieces of state (`randomMode`, `slideshowPlaying`) live in App.tsx alongside the existing lightbox state. Manual navigation branches on `randomMode` inside `navigateLightbox`. A single `useEffect` sets a 5000ms interval when `slideshowPlaying` is true, computes the next index via a new pure helper `nextSlideshowIndex`, and clears itself on any dep change. The pure lightbox key resolver is updated (rename `randomize` action → `toggleRandom`, add `toggleSlideshow`). Lightbox gains a new Slideshow button next to the existing Shuffle (now visually a toggle).

**Tech Stack:** React 19 + TypeScript, Vite 8, Vitest, lucide-react icons, existing i18n bundles.

## Global Constraints

- **Design spec of record:** `docs/superpowers/specs/2026-07-16-lightbox-slideshow-design.md`. Every task's requirements are grounded there.
- **Slideshow interval constant:** exactly `5000` ms, exposed as `SLIDESHOW_INTERVAL_MS` in App.tsx so a future UI can vary it.
- **State ownership:** `randomMode` and `slideshowPlaying` live in App.tsx, NOT inside Lightbox. Rationale: state must survive lightbox close/reopen and fullscreen toggle.
- **Existing 1-shot Shuffle behavior is fully replaced** — the button becomes a mode toggle. The `R` key's action name becomes `toggleRandom`.
- **Both ja and en i18n bundles must stay in sync.** TypeScript enforces this at compile time.
- **Commit messages:** one line, English, imperative mood (project convention).
- **Do NOT skip pre-commit hooks** (`--no-verify` is forbidden).
- **No new npm dependencies.** All required lucide icons (`Shuffle`, `Play`, `Pause`) are available in the existing `lucide-react` install.

---

### Task 1: Pure helper `slideshowStep.ts` with unit tests

**Files:**
- Create: `client/src/components/slideshowStep.ts`
- Create: `client/src/components/slideshowStep.test.ts`

**Interfaces:**
- Consumes: nothing (pure integer math)
- Produces:
  - `nextSlideshowIndex(currentIndex: number, totalCount: number, randomMode: boolean, rand?: () => number): number`

- [ ] **Step 1: Write the failing test file**

Create `client/src/components/slideshowStep.test.ts` with the following complete content:

```typescript
import { describe, it, expect } from 'vitest';
import { nextSlideshowIndex } from './slideshowStep';

describe('nextSlideshowIndex', () => {
  it('advances by 1 in sequential mode', () => {
    expect(nextSlideshowIndex(0, 5, false)).toBe(1);
    expect(nextSlideshowIndex(3, 5, false)).toBe(4);
  });

  it('wraps to the first index at the end in sequential mode', () => {
    expect(nextSlideshowIndex(4, 5, false)).toBe(0);
  });

  it('returns the current index unchanged when totalCount <= 1', () => {
    // A slideshow with 0 or 1 items has nowhere to advance; the timer callback
    // treats an unchanged return as a no-op.
    expect(nextSlideshowIndex(0, 0, false)).toBe(0);
    expect(nextSlideshowIndex(0, 1, false)).toBe(0);
    expect(nextSlideshowIndex(0, 1, true)).toBe(0);
  });

  it('never returns the current index in random mode (boundary rand=0)', () => {
    // rand=0 → pick=0. If current=2, pick(0) < current(2) so returned as-is.
    expect(nextSlideshowIndex(2, 5, true, () => 0)).toBe(0);
  });

  it('bumps past the current index in random mode when rand collides', () => {
    // rand=0.5 → pick=Math.floor(0.5*4)=2. current=2 collides → returns 2+1=3.
    expect(nextSlideshowIndex(2, 5, true, () => 0.5)).toBe(3);
  });

  it('returns the last index in random mode at the top of the range', () => {
    // rand=0.99 → pick=Math.floor(0.99*4)=3. current=2, pick(3) >= current(2) → returns 4.
    expect(nextSlideshowIndex(2, 5, true, () => 0.99)).toBe(4);
  });

  it('excludes the current index across many random draws', () => {
    // Sample 100 pseudo-random ticks and verify current is never re-picked.
    let seed = 1;
    const prng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 100; i++) {
      const next = nextSlideshowIndex(3, 10, true, prng);
      expect(next).not.toBe(3);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(10);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run --prefix client -- slideshowStep.test.ts`
Expected: FAIL — the test file cannot resolve `./slideshowStep` because the module does not exist yet.

- [ ] **Step 3: Implement the helper**

Create `client/src/components/slideshowStep.ts` with the following complete content:

```typescript
// Pure per-tick index selector for the lightbox slideshow. Extracted from the
// setInterval callback in App.tsx so the branching (sequential wrap vs. random
// pick with current-index exclusion) is unit-testable without mounting React.
//
// - Sequential mode: (currentIndex + 1) % totalCount — wraps at the end.
// - Random mode: pick uniformly from [0..totalCount) excluding currentIndex,
//   using a rejection-free bump: draw from totalCount-1 candidates, then
//   shift the pick past currentIndex if it collides.
// - Degenerate cases (totalCount <= 1): return currentIndex unchanged so the
//   caller can no-op on the "nothing to advance to" signal.
//
// `rand` is injected to let tests supply deterministic sequences.
export function nextSlideshowIndex(
  currentIndex: number,
  totalCount: number,
  randomMode: boolean,
  rand: () => number = Math.random,
): number {
  if (totalCount <= 1) return currentIndex;
  if (!randomMode) return (currentIndex + 1) % totalCount;
  const pick = Math.floor(rand() * (totalCount - 1));
  return pick >= currentIndex ? pick + 1 : pick;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run --prefix client -- slideshowStep.test.ts`
Expected: PASS — all 7 assertions green.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/slideshowStep.ts client/src/components/slideshowStep.test.ts
git commit -m "feat: add nextSlideshowIndex pure helper with unit tests"
```

---

### Task 2: Update `lightboxKeyboard.ts` (rename `randomize` → `toggleRandom`, add `toggleSlideshow`)

**Files:**
- Modify: `client/src/components/lightboxKeyboard.ts`
- Modify: `client/src/components/lightboxKeyboard.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `LightboxKeyAction` union gains `{ type: 'toggleRandom' }` (replacing `{ type: 'randomize' }`) and `{ type: 'toggleSlideshow' }`
  - `resolveLightboxKey(key, code, hasFullscreen, lightboxIndex)` returns those new types for `R` and `P` keys

- [ ] **Step 1: Update the test file first (TDD)**

Open `client/src/components/lightboxKeyboard.test.ts` and locate any existing tests that assert `type: 'randomize'` on `R` / `r`. Change them to `type: 'toggleRandom'`. Then add new tests for the `P` key. The complete diff for the test file is:

```typescript
// Find any existing block that looks like:
//   it('returns randomize for R', ...) {
//     expect(resolveLightboxKey('r', ..., 0)).toEqual({ type: 'randomize' });
//   }
// and replace 'randomize' with 'toggleRandom' in the expected object.
//
// Then add these new test cases inside the same `describe('resolveLightboxKey', ...)`:

  it('returns toggleRandom for R when gallery-backed (index >= 0)', () => {
    expect(resolveLightboxKey('r', '', false, 0)).toEqual({ type: 'toggleRandom' });
    expect(resolveLightboxKey('R', '', false, 5)).toEqual({ type: 'toggleRandom' });
  });

  it('returns null for R when index is -1 (preview tab has nothing to shuffle to)', () => {
    expect(resolveLightboxKey('r', '', false, -1)).toBeNull();
  });

  it('returns toggleSlideshow for P when gallery-backed (index >= 0)', () => {
    expect(resolveLightboxKey('p', '', false, 0)).toEqual({ type: 'toggleSlideshow' });
    expect(resolveLightboxKey('P', '', false, 3)).toEqual({ type: 'toggleSlideshow' });
  });

  it('returns null for P when index is -1 (no slideshow over a single preview image)', () => {
    expect(resolveLightboxKey('p', '', false, -1)).toBeNull();
  });

  it('routes P through even while OS fullscreen is active', () => {
    // R and P are mode toggles, not close/exit actions; unlike Escape (which
    // is gated so the browser can exit fullscreen first), these should still
    // fire while fullscreen is active.
    expect(resolveLightboxKey('p', '', true, 0)).toEqual({ type: 'toggleSlideshow' });
    expect(resolveLightboxKey('r', '', true, 0)).toEqual({ type: 'toggleRandom' });
  });
```

If the existing test file has no test for `R` currently, add all the above tests. If it has one, rename `randomize` → `toggleRandom` in that test's `expect(...).toEqual(...)` call before appending the new cases.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run --prefix client -- lightboxKeyboard.test.ts`
Expected: FAIL — the resolver still emits `type: 'randomize'` for R and has no branch for P.

- [ ] **Step 3: Update the resolver**

Open `client/src/components/lightboxKeyboard.ts` and replace its entire content with:

```typescript
// Pure resolver for lightbox keyboard shortcuts. Given the raw key/code from
// a KeyboardEvent plus the surrounding context (are we in OS fullscreen?
// which item is displayed?), it returns which action the App should dispatch.
// Extracted from App.tsx's useEffect so the mapping can be unit-tested
// without mounting the full React tree or synthesizing DOM events.

export type LightboxKeyAction =
  | { type: 'close' }
  | { type: 'navigate'; delta: number }
  | { type: 'toggleSelection' }
  | { type: 'toggleFavorite' }
  | { type: 'toggleRandom' }
  | { type: 'toggleSlideshow' }
  | null;

export function resolveLightboxKey(
  key: string,
  code: string,
  hasFullscreenElement: boolean,
  lightboxIndex: number,
): LightboxKeyAction {
  if (key === 'Escape') {
    // In OS fullscreen, let the browser handle Escape (it exits fullscreen);
    // only after that will a second Escape actually close the lightbox.
    return hasFullscreenElement ? null : { type: 'close' };
  }
  if (key === 'ArrowLeft') return { type: 'navigate', delta: -1 };
  if (key === 'ArrowRight') return { type: 'navigate', delta: 1 };
  if (key === ' ' || code === 'Space') {
    // Selection and favorite are only meaningful for persisted gallery items
    // (index >= 0). The preview tab's transient generation has no id and
    // cannot be toggled — return null so callers know to no-op.
    return lightboxIndex >= 0 ? { type: 'toggleSelection' } : null;
  }
  if (key === 'f' || key === 'F') {
    return lightboxIndex >= 0 ? { type: 'toggleFavorite' } : null;
  }
  if (key === 'r' || key === 'R') {
    // Random-mode toggle: flips whether ← / → and the slideshow pick a random
    // next image or step through the gallery order. Meaningful only for a
    // gallery-backed lightbox (index >= 0).
    return lightboxIndex >= 0 ? { type: 'toggleRandom' } : null;
  }
  if (key === 'p' || key === 'P') {
    // Slideshow play/pause toggle. Same gate as random-mode: no-op over the
    // preview tab's transient image.
    return lightboxIndex >= 0 ? { type: 'toggleSlideshow' } : null;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run --prefix client -- lightboxKeyboard.test.ts`
Expected: PASS — including the new `toggleRandom` / `toggleSlideshow` cases.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/lightboxKeyboard.ts client/src/components/lightboxKeyboard.test.ts
git commit -m "feat: rename lightbox R action to toggleRandom and add P for toggleSlideshow"
```

---

### Task 3: i18n keys

**Files:**
- Modify: `client/src/i18n/ja.ts`
- Modify: `client/src/i18n/en.ts`

**Interfaces:**
- Produces (both bundles):
  - `t.lightbox.randomModeToggleOnTooltip: string`
  - `t.lightbox.randomModeToggleOffTooltip: string`
  - `t.lightbox.slideshowStartTooltip: string`
  - `t.lightbox.slideshowStopTooltip: string`
  - Existing `t.lightbox.randomTooltip` is REPLACED by the two randomMode variants (rename, not addition).

- [ ] **Step 1: Update `ja.ts`**

In `client/src/i18n/ja.ts`, find the `lightbox: { ... }` block and locate the `randomTooltip` key. Replace it with the four new keys shown below. Keep every other key in the block unchanged:

```typescript
// Before (single key):
//   randomTooltip: 'ランダムな画像に切り替え (R)',
// After (four keys, replacing the one above):
    randomModeToggleOnTooltip: 'ランダム表示を解除 (R)',
    randomModeToggleOffTooltip: 'ランダム表示に切替: 前後ボタン・スライドショーがランダムに (R)',
    slideshowStartTooltip: 'スライドショー開始 (P) — 5秒毎に進む',
    slideshowStopTooltip: 'スライドショー停止 (P)',
```

- [ ] **Step 2: Update `en.ts`**

Mirror the change in `client/src/i18n/en.ts`. Replace `randomTooltip` with:

```typescript
    randomModeToggleOnTooltip: 'Turn off random mode (R)',
    randomModeToggleOffTooltip: 'Random mode: make ← / → and slideshow pick randomly (R)',
    slideshowStartTooltip: 'Start slideshow (P) — advances every 5s',
    slideshowStopTooltip: 'Stop slideshow (P)',
```

- [ ] **Step 3: Type-check both bundles are in sync**

Run: `npm run build --prefix client 2>&1 | tail -20`
Expected: no TypeScript errors. The i18n shape is inferred from `ja.ts` and enforced on `en.ts`; any typo or missing key surfaces here.

- [ ] **Step 4: Commit**

```bash
git add client/src/i18n/ja.ts client/src/i18n/en.ts
git commit -m "feat: add lightbox random-mode and slideshow tooltip keys in ja and en"
```

---

### Task 4: Update Lightbox toolbar (Random toggle + new Slideshow button)

**Files:**
- Modify: `client/src/components/Lightbox.tsx`

**Interfaces:**
- Consumes: `t.lightbox.randomModeToggleOn/OffTooltip`, `t.lightbox.slideshowStart/StopTooltip` (Task 3), lucide `Play`, `Pause`
- Produces:
  - `LightboxProps` gains: `randomMode: boolean`, `onToggleRandom: () => void`, `slideshowPlaying: boolean`, `onToggleSlideshow: () => void`
  - `LightboxProps` LOSES: `onRandomize: () => void` (the one-shot handler is gone — App now passes `onToggleRandom` instead)

- [ ] **Step 1: Extend the `LightboxProps` interface and destructure**

Open `client/src/components/Lightbox.tsx`. In the top `import` line, add `Play` and `Pause` to the `lucide-react` import (keep every other symbol). The final import line should read:

```typescript
import { Info, CheckCircle2, Circle, Star, ChevronLeft, ChevronRight, Maximize, Minimize, Shuffle, Play, Pause, Eye, X } from 'lucide-react';
```

Then locate the `LightboxProps` interface. Find the line `onRandomize: () => void;` and REPLACE it with the following four lines:

```typescript
  randomMode: boolean;
  onToggleRandom: () => void;
  slideshowPlaying: boolean;
  onToggleSlideshow: () => void;
```

Then update the destructuring in `export function Lightbox({...})` — remove `onRandomize,` and add the four new prop names in its place:

```typescript
  randomMode,
  onToggleRandom,
  slideshowPlaying,
  onToggleSlideshow,
```

- [ ] **Step 2: Convert the Shuffle button into a Random-mode toggle**

Find the existing block that starts with the comment `/* Shuffle: jump to a random image ...` (roughly around line 222). Replace it entirely with the following block, keeping the same `right: '384px'` position so the surrounding buttons stay put:

```tsx
      {/* Random-mode toggle: when ON, both manual ← / → and the slideshow
          timer pick a random next image (excluding the current one). Same
          disabled gate as before (needs at least 2 gallery-backed candidates). */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleRandom(); }}
        disabled={lightboxIndex < 0 || displayedHistory.length < 2}
        title={randomMode ? t.lightbox.randomModeToggleOnTooltip : t.lightbox.randomModeToggleOffTooltip}
        aria-pressed={randomMode}
        className={(lightboxIndex < 0 || displayedHistory.length < 2) ? '' : 'scale-hover'}
        style={{
          position: 'absolute',
          top: '20px',
          right: '384px',
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          border: 'none',
          background: randomMode ? 'var(--pop-blue)' : 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: (lightboxIndex < 0 || displayedHistory.length < 2) ? 'not-allowed' : 'pointer',
          opacity: (lightboxIndex < 0 || displayedHistory.length < 2) ? 0.35 : 1,
        }}
      >
        <Shuffle size={20} />
      </button>
```

- [ ] **Step 3: Insert a new Slideshow toggle button next to the Random toggle**

Immediately AFTER the Random-toggle `</button>` you just wrote (still before the `{lightboxIndex >= 0 && ( ... Open-in-preview` block), insert the following new button. It occupies `right: '436px'` — the slot Open-in-preview currently uses. We will shift Open-in-preview to `right: '488px'` in the next step.

```tsx
      {/* Slideshow toggle: when ON, advances (via nextSlideshowIndex) every
          SLIDESHOW_INTERVAL_MS. Whether the advance is sequential or random
          depends on the shared randomMode flag above. Same disabled gate as
          the random toggle. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleSlideshow(); }}
        disabled={lightboxIndex < 0 || displayedHistory.length < 2}
        title={slideshowPlaying ? t.lightbox.slideshowStopTooltip : t.lightbox.slideshowStartTooltip}
        aria-pressed={slideshowPlaying}
        className={(lightboxIndex < 0 || displayedHistory.length < 2) ? '' : 'scale-hover'}
        style={{
          position: 'absolute',
          top: '20px',
          right: '436px',
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          border: 'none',
          background: slideshowPlaying ? 'var(--pop-blue)' : 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: (lightboxIndex < 0 || displayedHistory.length < 2) ? 'not-allowed' : 'pointer',
          opacity: (lightboxIndex < 0 || displayedHistory.length < 2) ? 0.35 : 1,
        }}
      >
        {slideshowPlaying ? <Pause size={20} /> : <Play size={20} />}
      </button>
```

- [ ] **Step 4: Shift the Open-in-preview button right to `488px`**

Find the existing Open-in-preview block (the one wrapped in `{lightboxIndex >= 0 && ( ...` right after where the Slideshow button now sits). Change its inline style from `right: '436px'` to `right: '488px'`:

```tsx
            right: '488px',
```

Leave every other line of that block unchanged.

- [ ] **Step 5: Type-check**

Run: `npm run build --prefix client 2>&1 | tail -20`
Expected: TypeScript errors about `onRandomize` still being passed by App.tsx (that's normal — we haven't rewired App.tsx yet). These will be fixed in Task 5. Do NOT commit yet if the ONLY errors are about `onRandomize` from App.tsx callers.

If there are OTHER errors (missing new i18n keys, wrong prop name, unresolved import), stop and fix them before proceeding.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Lightbox.tsx
git commit -m "feat: rework lightbox Shuffle button into random-mode + slideshow toggles"
```

---

### Task 5: Wire state and slideshow effect into App.tsx

This task combines App-side state, the manual-nav branch, the slideshow interval effect, the auto-stop on lightbox close, the key-handler dispatch cases, and the Lightbox prop update — because none of these ship a working feature on their own.

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes:
  - `nextSlideshowIndex` from `./components/slideshowStep` (Task 1)
  - `resolveLightboxKey` returning `toggleRandom` / `toggleSlideshow` (Task 2)
  - `t.lightbox.randomModeToggleOn/Off*` / `t.lightbox.slideshowStart/Stop*` (Task 3)
  - New Lightbox prop shape (Task 4)
- Produces: no new exports; user-visible behavior — Random-mode toggle affects manual nav, Slideshow button auto-advances every 5s.

- [ ] **Step 1: Add the interval constant and new imports**

Near the top of `client/src/App.tsx`, add the import for the new helper. Find the existing line:

```typescript
import { resolveLightboxKey } from './components/lightboxKeyboard';
```

Add a new import line below it:

```typescript
import { nextSlideshowIndex } from './components/slideshowStep';
```

Then, near the top of the `App()` function body (just below the existing `const [prompt, setPrompt] = useState('');` cluster, or anywhere before the lightbox-related code — grep for `const [lightboxUrl, setLightboxUrl] = useState` to find a good neighborhood), add:

```typescript
  // Slideshow tick interval. Kept as a constant so future UI can vary it in
  // one place. Also serves as the default for the useEffect that owns the timer.
  const SLIDESHOW_INTERVAL_MS = 5000;
  const [randomMode, setRandomMode] = useState(false);
  const [slideshowPlaying, setSlideshowPlaying] = useState(false);
```

- [ ] **Step 2: Branch `navigateLightbox` on `randomMode`**

Locate the existing `const navigateLightbox = (delta: number) => { ... };` function (grep for `navigateLightbox = ` to jump to it). Replace its body so that when `randomMode` is on, it defers to the existing `randomizeLightbox`. The `delta` parameter is ignored in random mode (which matches the design: any manual step is a fresh random pick):

```typescript
  const navigateLightbox = (delta: number) => {
    if (randomMode) {
      randomizeLightbox();
      return;
    }
    const idx = displayedHistory.findIndex((it) => itemKey(it) === morphSourceKey || it.imageUrl === lightboxUrl);
    if (idx === -1) return;
    const next = idx + delta;
    if (next < 0 || next >= displayedHistory.length) return;
    const target = displayedHistory[next];
    setMorphSourceKey(itemKey(target));
    setLightboxUrl(target.imageUrl);
  };
```

Leave `randomizeLightbox` itself unchanged — Task 5 keeps it as an internal implementation detail that `navigateLightbox` calls into.

- [ ] **Step 3: Add the slideshow timer useEffect**

Immediately AFTER `randomizeLightbox`'s closing brace, add the following useEffect. It owns the setInterval, computes the next index via `nextSlideshowIndex`, and updates `morphSourceKey` + `lightboxUrl` — the same two writes both `navigateLightbox` and `randomizeLightbox` do:

```typescript
  // Slideshow: while slideshowPlaying is true and the lightbox is on a gallery-
  // backed item (lightboxIndex >= 0), advance to the next index every
  // SLIDESHOW_INTERVAL_MS. The `lightboxIndex` dep means any manual ← / →
  // click resets the timer for free (effect cleans up + re-runs with the new
  // index). Sequential mode wraps at the end; random mode uses the same
  // rejection-free draw as randomizeLightbox.
  useEffect(() => {
    if (!slideshowPlaying) return;
    if (lightboxIndex < 0 || displayedHistory.length < 2) return;
    const id = setInterval(() => {
      const nextIdx = nextSlideshowIndex(lightboxIndex, displayedHistory.length, randomMode);
      if (nextIdx === lightboxIndex) return;
      const target = displayedHistory[nextIdx];
      setMorphSourceKey(itemKey(target));
      setLightboxUrl(target.imageUrl);
    }, SLIDESHOW_INTERVAL_MS);
    return () => clearInterval(id);
  }, [slideshowPlaying, lightboxIndex, randomMode, displayedHistory]);
```

- [ ] **Step 4: Auto-stop slideshow when the lightbox closes**

Immediately AFTER the useEffect from Step 3, add:

```typescript
  // Any exit from the lightbox (Esc, close button, background click) pauses
  // the slideshow so it never keeps ticking on a hidden surface. The user
  // must explicitly restart it after reopening.
  useEffect(() => {
    if (!lightboxUrl && slideshowPlaying) {
      setSlideshowPlaying(false);
    }
  }, [lightboxUrl, slideshowPlaying]);
```

- [ ] **Step 5: Handle the new keyboard actions**

Find the existing `switch (action.type)` block inside the lightbox keydown useEffect (grep for `case 'randomize':`). Replace the `case 'randomize':` case with two new cases:

```typescript
        case 'toggleRandom':
          e.preventDefault();
          setRandomMode((v) => !v);
          return;
        case 'toggleSlideshow':
          e.preventDefault();
          setSlideshowPlaying((v) => !v);
          return;
```

The whole switch, for reference, should now look like:

```typescript
      switch (action.type) {
        case 'close':
          closeLightbox();
          return;
        case 'navigate':
          e.preventDefault();
          navigateLightbox(action.delta);
          return;
        case 'toggleSelection':
          e.preventDefault();
          toggleSelected(itemKey(displayedHistory[lightboxIndex]));
          return;
        case 'toggleFavorite':
          e.preventDefault();
          toggleFavorite(displayedHistory[lightboxIndex]);
          return;
        case 'toggleRandom':
          e.preventDefault();
          setRandomMode((v) => !v);
          return;
        case 'toggleSlideshow':
          e.preventDefault();
          setSlideshowPlaying((v) => !v);
          return;
      }
```

- [ ] **Step 6: Update the `<Lightbox />` JSX call**

Find the `<Lightbox ... />` render (grep for `onRandomize={randomizeLightbox}`). Replace the `onRandomize={randomizeLightbox}` prop with the four new props:

```tsx
        onNavigate={navigateLightbox}
        randomMode={randomMode}
        onToggleRandom={() => setRandomMode((v) => !v)}
        slideshowPlaying={slideshowPlaying}
        onToggleSlideshow={() => setSlideshowPlaying((v) => !v)}
```

Leave the surrounding props (`onNavigate`, `onOpenInPreview`, `onClose`, `isFullscreen`, `onToggleFullscreen`, etc.) unchanged.

- [ ] **Step 7: Type-check the whole client build**

Run: `npm run build --prefix client 2>&1 | tail -20`
Expected: no TypeScript errors. The `built in NNNms` line should appear.

- [ ] **Step 8: Run all client tests to confirm no regressions**

Run: `npm run test:run --prefix client 2>&1 | tail -10`
Expected: All tests pass. Test count is baseline (from prior tasks in this session) + Task 1's 7 new tests + Task 2's 5 or so new tests (depending on how many existing R-key tests were amended in place). No test should decrease.

- [ ] **Step 9: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: wire lightbox slideshow timer and random-mode toggle into App"
```

---

### Task 6: Full verification and manual browser check

**Files:**
- Modify: none (verification only). If a check surfaces a bug, fix in a follow-up commit.

**Interfaces:**
- Consumes: everything from Tasks 1-5
- Produces: verified working feature

- [ ] **Step 1: Run the client test suite**

Run: `npm run test:run --prefix client 2>&1 | tail -5`
Expected: All tests pass. Task 1 added 7 assertions in `slideshowStep.test.ts`; Task 2 added several in `lightboxKeyboard.test.ts`.

- [ ] **Step 2: Run oxlint**

Run: `npm run lint --prefix client 2>&1 | tail -20`
Expected: Only pre-existing warnings; no new errors or warnings from the files this plan touched.

- [ ] **Step 3: Run the production build**

Run: `npm run build --prefix client 2>&1 | tail -10`
Expected: `built in NNNms`, no TypeScript errors, no vite errors.

- [ ] **Step 4: Confirm dev servers are up**

Run: `ss -tlnp 2>/dev/null | grep -E ':5173|:5000'`. If both ports listen, skip Step 5's boot step. Otherwise run `npm run dev` from the repo root.

- [ ] **Step 5: Manual browser flow**

Open http://localhost:5173/?hl=ja and:

1. Go to 履歴ギャラリー, pick a date with 2+ images, open one in the lightbox.
2. Confirm the Shuffle icon is unfilled (Random OFF, default) and a new Play-icon button sits to its right.
3. Click the Random toggle → button turns filled blue.
4. Click ← / → several times → each click jumps to a random image (never the current one).
5. Click the Random toggle again → button unfilled. Click ← / → → moves in gallery order, clamped at the ends.
6. Click the Play button → button becomes Pause icon (filled blue). Wait ~5s → the image advances. Wait another ~5s → advances again.
7. With slideshow running, click → manually → image changes immediately, and the next auto-advance is ~5s later (not immediate).
8. Continue slideshow (Random OFF) past the last image → wraps to the first.
9. Toggle Random ON with slideshow still running → next tick picks randomly.
10. Press `R` key → Random toggle flips. Press `P` → Slideshow toggles.
11. Close the lightbox (Esc or close button) → reopen → Slideshow is off (auto-paused on close), Random state persists at whatever it was.
12. Open a date with exactly 1 image → both toggle buttons are disabled (dimmed, no cursor pointer).

- [ ] **Step 6: Final status summary**

Run: `git log --oneline -6` and confirm 5 new commits from this plan (one per Task 1-5). Working tree should be clean.

---

## Self-Review Notes

Reviewed after writing:

1. **Spec coverage:** Every spec section maps to a task.
   - "挙動サマリ" → Task 5 Step 2 (navigateLightbox branch) + Step 3 (slideshow effect)
   - "状態管理" → Task 5 Step 1 (state declarations)
   - "スライドショーのタイマー" → Task 5 Step 3
   - "Pure ヘルパー nextSlideshowIndex" → Task 1
   - "UI" → Task 4 (Lightbox buttons) + Task 3 (i18n)
   - "キーボード" → Task 2 (resolver) + Task 5 Step 5 (dispatch)
   - "App.tsx への配線" → Task 5 (all steps)
   - "テスト戦略" → Task 1 Step 1 (test content) + Task 2 Step 1 + Task 6 (manual verify)
   - "影響を受けるファイル一覧" → all listed files touched exactly

2. **Placeholder scan:** No TBD / TODO / "similar to earlier" / "add error handling". Every code block is complete.

3. **Type consistency:**
   - `LightboxKeyAction` union in Task 2 uses `toggleRandom` / `toggleSlideshow` — same names dispatched in Task 5 Step 5.
   - `nextSlideshowIndex` signature in Task 1 matches the call site in Task 5 Step 3.
   - Prop names on `Lightbox` in Task 4 (`randomMode`, `onToggleRandom`, `slideshowPlaying`, `onToggleSlideshow`) match Task 5 Step 6's JSX.
   - The removed prop `onRandomize` is deleted on both ends (Task 4 removes from Lightbox, Task 5 removes from App's `<Lightbox />` call).
   - i18n keys in Task 3 match Task 4's `t.lightbox.*` accesses.

4. **Scope check:** Single implementation plan. Slideshow interval selector UI, hover-to-pause, progress bar are explicitly out-of-scope in the spec and not sneaked in here.

5. **Ambiguity check:**
   - Task 4 Step 5 explicitly notes the type errors that ARE expected between Task 4 and Task 5 (they get fixed in Task 5's Step 6).
   - Task 5 Step 2's "delta is ignored in random mode" is called out — matches spec's "ランダム ON: ランダムに 1 枚（現画像除外）" (delta direction irrelevant).
   - Task 5 Step 4's auto-stop on lightbox close is clearly a separate useEffect, not tangled with the timer effect.
