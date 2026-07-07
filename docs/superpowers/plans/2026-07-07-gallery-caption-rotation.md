# Gallery Caption Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current gallery thumbnail caption (truncated prompt + date) with a vertically-scrolling 2-line rotator that cycles through per-image metadata (model, size, date, sampler/scheduler, Hires.fix, individual LoRAs) at 3-second intervals, synchronized across the gallery.

**Architecture:** A single App-level tick counter (`useState<number>` + `setInterval(3000)`) is passed as a prop through `HistoryGallery` to a new `CaptionRotator` subcomponent. Each `CaptionRotator` builds its own dynamic field queue from the item's data via a pure function `buildCaptionFieldQueue`, and shows two adjacent slots at a time using CSS `transform: translateY` for a scroll-up animation. Hover pauses the tile individually; `prefers-reduced-motion` disables the transition via CSS media query.

**Tech Stack:** React 19 + TypeScript + Vite + Vitest + oxlint. No new dependencies.

## Global Constraints

- All code must pass `npm run build --prefix client` (tsc + vite build).
- All new pure logic must be covered by Vitest tests (`npm run test:run --prefix client`).
- Client is ESM (`"type": "module"`); use `import`, not `require`.
- Follow existing file layout: components in `client/src/components/` (flat).
- CSS lives in `App.css` / `index.css` — no CSS framework.
- Do NOT change server code, Firebase schema, or `GenerationData` shape.
- Rotation interval is exactly 3000 ms; animation duration is exactly 400 ms.
- Field queue order is fixed per the spec table (model → size → date → sampler → hires → loras).
- Any commits must NOT include `Claude` or `Co-Authored-By` trailers (project convention: single-line English commit message).

---

## File Structure

**New files:**
- `client/src/components/captionFields.ts` — pure function `buildCaptionFieldQueue(item: GenerationData): CaptionField[]` + `CaptionField` type.
- `client/src/components/captionFields.test.ts` — Vitest tests for the pure function.

**Modified files:**
- `client/src/App.tsx` — add `captionRotationTick` state + `useEffect` interval, pass tick as prop to `HistoryGallery`.
- `client/src/components/HistoryGallery.tsx` — accept `captionRotationTick` prop, add `CaptionRotator` subcomponent, replace current caption `<div>` with `<CaptionRotator />`.
- `client/src/index.css` — one media query rule for `prefers-reduced-motion` on the rotator inner wrapper.

---

## Task 1: `buildCaptionFieldQueue` pure function

**Files:**
- Create: `client/src/components/captionFields.ts`
- Test: `client/src/components/captionFields.test.ts`

**Interfaces:**
- Consumes: `GenerationData` (imported from `../App`), `findSdxlSelection` and `findSd15Selection` (imported from `./presets`).
- Produces:
  - `export type CaptionField = { key: string; label: string; value: string }`
  - `export function buildCaptionFieldQueue(item: GenerationData): CaptionField[]`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/captionFields.test.ts` with the following content:

```ts
import { describe, it, expect } from 'vitest';
import { buildCaptionFieldQueue } from './captionFields';
import type { GenerationData } from '../App';

const baseItem: GenerationData = {
  originalPrompt: 'a girl',
  enhancedPrompt: 'a girl',
  negativePrompt: 'bad',
  width: 512,
  height: 512,
  steps: 20,
  cfgScale: 7,
  model: 'yayoi_mix_v25-fp16.safetensors [ca28aa4a44]',
  imageUrl: 'x',
  timestamp: new Date('2026-07-05T14:23:00+09:00').getTime(),
  createdAt: '2026-07-05T05:23:00.000Z',
  backendMode: 'local',
  sampler: 'DPM++ SDE',
  scheduler: 'Karras',
};

describe('buildCaptionFieldQueue', () => {
  it('returns the 4 basic fields for a plain SD1.5 512x512 generation', () => {
    const q = buildCaptionFieldQueue(baseItem);
    expect(q.map(f => f.key)).toEqual(['model', 'size', 'date', 'sampler']);
    expect(q[0].label).toBe('モデル');
    expect(q[0].value).toBe('yayoi_mix_v25-fp16.safetensors [ca28aa4a44]');
    expect(q[1].label).toBe('サイズ');
    expect(q[1].value).toBe('512×512 (1:1)');
    expect(q[3].label).toBe('Sampler');
    expect(q[3].value).toBe('DPM++ SDE · Karras');
  });

  it('falls back to "不明" when model is null or empty', () => {
    const q1 = buildCaptionFieldQueue({ ...baseItem, model: null });
    const q2 = buildCaptionFieldQueue({ ...baseItem, model: '' });
    expect(q1[0].value).toBe('不明');
    expect(q2[0].value).toBe('不明');
  });

  it('drops scheduler suffix when scheduler is missing', () => {
    const q = buildCaptionFieldQueue({ ...baseItem, scheduler: undefined });
    expect(q[3].value).toBe('DPM++ SDE');
  });

  it('skips the sampler field when sampler is missing', () => {
    const q = buildCaptionFieldQueue({ ...baseItem, sampler: undefined, scheduler: undefined });
    expect(q.map(f => f.key)).toEqual(['model', 'size', 'date']);
  });

  it('omits the aspect ratio suffix when no preset matches', () => {
    const q = buildCaptionFieldQueue({ ...baseItem, width: 999, height: 555 });
    expect(q[1].value).toBe('999×555');
  });

  it('recognizes SDXL 1024x1536 as 3:2 portrait', () => {
    const q = buildCaptionFieldQueue({ ...baseItem, width: 832, height: 1216 });
    expect(q[1].value).toBe('832×1216 (3:2)');
  });

  it('adds a Hires.fix slot when enableHr is true', () => {
    const q = buildCaptionFieldQueue({ ...baseItem, enableHr: true, hrScale: 2, denoisingStrength: 0.5 });
    expect(q.map(f => f.key)).toContain('hires');
    const hires = q.find(f => f.key === 'hires')!;
    expect(hires.label).toBe('Hires.fix');
    expect(hires.value).toBe('×2 (denoise 0.5)');
  });

  it('adds one slot per applied LoRA', () => {
    const q = buildCaptionFieldQueue({
      ...baseItem,
      loras: [
        { name: 'siitake-eye', weight: 0.8 },
        { name: 'ClearHand-V2', weight: 0.7 },
      ],
    });
    const loraSlots = q.filter(f => f.key.startsWith('lora-'));
    expect(loraSlots).toHaveLength(2);
    expect(loraSlots[0].label).toBe('LoRA');
    expect(loraSlots[0].value).toBe('siitake-eye × 0.8');
    expect(loraSlots[1].value).toBe('ClearHand-V2 × 0.7');
  });

  it('combines Hires.fix and multiple LoRAs in order', () => {
    const q = buildCaptionFieldQueue({
      ...baseItem,
      enableHr: true,
      hrScale: 2,
      denoisingStrength: 0.5,
      loras: [
        { name: 'a', weight: 0.5 },
        { name: 'b', weight: 0.6 },
        { name: 'c', weight: 0.7 },
      ],
    });
    expect(q.map(f => f.key)).toEqual(['model', 'size', 'date', 'sampler', 'hires', 'lora-0', 'lora-1', 'lora-2']);
  });

  it('formats the date as YYYY-MM-DD HH:mm using the ja-JP locale', () => {
    const q = buildCaptionFieldQueue(baseItem);
    expect(q[2].label).toBe('日時');
    expect(q[2].value).toMatch(/^2026-07-05 \d{2}:\d{2}$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run --prefix client -- captionFields`

Expected: Multiple failures — `buildCaptionFieldQueue is not defined` or the file doesn't exist.

- [ ] **Step 3: Implement the pure function**

Create `client/src/components/captionFields.ts` with the following content:

```ts
import type { GenerationData } from '../App';
import { findSdxlSelection, findSd15Selection } from './presets';

export type CaptionField = {
  key: string;
  label: string;
  value: string;
};

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSize(width: number, height: number): string {
  const sdxl = findSdxlSelection(width, height);
  if (sdxl) return `${width}×${height} (${sdxl.ratio})`;
  const sd15 = findSd15Selection(width, height);
  if (sd15) return `${width}×${height} (${sd15.ratio})`;
  return `${width}×${height}`;
}

function formatSampler(item: GenerationData): string | null {
  if (!item.sampler) return null;
  if (item.scheduler) return `${item.sampler} · ${item.scheduler}`;
  return item.sampler;
}

function formatHires(item: GenerationData): string {
  const scale = item.hrScale ?? 2;
  const denoise = item.denoisingStrength ?? 0.7;
  return `×${scale} (denoise ${denoise})`;
}

export function buildCaptionFieldQueue(item: GenerationData): CaptionField[] {
  const fields: CaptionField[] = [];

  fields.push({
    key: 'model',
    label: 'モデル',
    value: item.model && item.model.length > 0 ? item.model : '不明',
  });

  fields.push({
    key: 'size',
    label: 'サイズ',
    value: formatSize(item.width, item.height),
  });

  fields.push({
    key: 'date',
    label: '日時',
    value: formatDate(item.timestamp),
  });

  const sampler = formatSampler(item);
  if (sampler) {
    fields.push({ key: 'sampler', label: 'Sampler', value: sampler });
  }

  if (item.enableHr) {
    fields.push({ key: 'hires', label: 'Hires.fix', value: formatHires(item) });
  }

  if (item.loras && item.loras.length > 0) {
    item.loras.forEach((l, i) => {
      fields.push({
        key: `lora-${i}`,
        label: 'LoRA',
        value: `${l.name} × ${l.weight}`,
      });
    });
  }

  return fields;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run --prefix client -- captionFields`

Expected: All 10 test cases pass.

- [ ] **Step 5: Run full test suite + typecheck**

Run: `npm run test:run --prefix client && npm run build --prefix client`

Expected: All existing tests still pass; typecheck+build succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/captionFields.ts client/src/components/captionFields.test.ts
git commit -m "feat: add buildCaptionFieldQueue for gallery caption rotation"
```

---

## Task 2: `CaptionRotator` component + App-level tick + integration

**Files:**
- Modify: `client/src/components/HistoryGallery.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `buildCaptionFieldQueue` and `CaptionField` from `./captionFields` (defined in Task 1).
- Produces:
  - Inline `CaptionRotator` subcomponent inside `HistoryGallery.tsx` (not exported).
  - `HistoryGalleryProps` gains a new required field: `captionRotationTick: number`.

- [ ] **Step 1: Add App-level tick state and interval**

In `client/src/App.tsx`, add the state near the other `useRef`/`useState` declarations (search for `prevLightboxIndexRef` around line 379 for a nearby anchor):

```tsx
// Shared tick counter that drives the gallery caption rotation. Advances every
// 3 seconds. Passed down to HistoryGallery so all tiles switch in sync.
const [captionRotationTick, setCaptionRotationTick] = useState(0);
useEffect(() => {
  const id = setInterval(() => {
    setCaptionRotationTick(t => t + 1);
  }, 3000);
  return () => clearInterval(id);
}, []);
```

- [ ] **Step 2: Pass the tick to `HistoryGallery`**

Locate the `<HistoryGallery` JSX invocation in `App.tsx` (search for `<HistoryGallery`) and add the prop:

```tsx
<HistoryGallery
  // ... existing props ...
  captionRotationTick={captionRotationTick}
/>
```

- [ ] **Step 3: Extend `HistoryGalleryProps` and destructure**

In `client/src/components/HistoryGallery.tsx`, add the field to the interface (around line 87):

```tsx
interface HistoryGalleryProps {
  // ... existing fields ...
  captionRotationTick: number;
}
```

Then add `captionRotationTick` to the destructured parameter list of `export function HistoryGallery({ ... })` (around line 105).

- [ ] **Step 4: Add the `CaptionRotator` subcomponent**

In the same file, add these imports at the top (below the existing `lucide-react` import):

```tsx
import { useState, useEffect } from 'react';
import { buildCaptionFieldQueue, type CaptionField } from './captionFields';
```

Then, above the `HistoryGalleryProps` interface (around line 85), insert:

```tsx
function CaptionSlot({ field }: { field: CaptionField }) {
  return (
    <div style={{ height: '20px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: '9px', color: 'var(--text-muted)', lineHeight: '10px' }}>
        {field.label}
      </span>
      <span style={{
        fontSize: '11px',
        fontWeight: 700,
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        lineHeight: '10px',
      }}>
        {field.value}
      </span>
    </div>
  );
}

function CaptionRotator({ item, tick }: { item: GenerationData; tick: number }) {
  const queue = buildCaptionFieldQueue(item);
  const N = queue.length;

  // For a very short queue (theoretically not possible given the 3 always-on
  // basic fields, but guard anyway), skip the rotation animation.
  const canRotate = N >= 2;

  const [displayTick, setDisplayTick] = useState(tick);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    if (!canRotate) return;
    if (tick === displayTick) return;
    setScrolling(true);
    const timer = setTimeout(() => {
      setDisplayTick(tick);
      setScrolling(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [tick, displayTick, canRotate]);

  const topIdx = ((displayTick % N) + N) % N;
  const bottomIdx = (topIdx + 1) % N;
  const nextIdx = (topIdx + 2) % N;

  const SLOT_H = 40; // 2 lines × 20px
  const LINE_H = 20;

  return (
    <div style={{ height: `${SLOT_H}px`, overflow: 'hidden' }}>
      <div
        className="caption-rotator-inner"
        style={{
          transform: scrolling ? `translateY(-${LINE_H}px)` : 'translateY(0)',
          transition: scrolling ? 'transform 400ms ease-out' : 'none',
        }}
      >
        <CaptionSlot field={queue[topIdx]} />
        <CaptionSlot field={queue[bottomIdx]} />
        <CaptionSlot field={queue[nextIdx]} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace the current caption `<div>` with `<CaptionRotator>`**

Locate the caption JSX (around line 316–335 in the current file, the `<div>` containing `onClick={() => onOpenInPreview(item)}` with the prompt `<p>` and date `<span>` inside). Replace the CONTENTS of that outer div (keep the wrapper `<div>` with its `onClick`, `title`, and `style` intact so the "click to load into preview" affordance is preserved). New contents:

```tsx
<div
  onClick={() => onOpenInPreview(item)}
  title="プレビューに表示"
  style={{ padding: '10px', textAlign: 'left', background: 'var(--panel-bg)', cursor: 'pointer' }}
>
  <CaptionRotator item={item} tick={captionRotationTick} />
</div>
```

- [ ] **Step 6: Run typecheck + build**

Run: `npm run build --prefix client`

Expected: Passes, no type errors, bundles successfully.

- [ ] **Step 7: Run full test suite**

Run: `npm run test:run --prefix client`

Expected: All existing tests pass (42 + 10 new from Task 1 = 52 total).

- [ ] **Step 8: Manual visual check**

Run `npm run dev` and open the app in a browser. Sign in (or use local mode). Confirm:
- Each gallery tile's caption now shows a 2-line label+value pair (e.g., "モデル / juggernautXL" and "サイズ / 1024×1536 (3:2)").
- Every 3 seconds all tiles smoothly scroll up to the next pair, in sync.
- Tiles with LoRAs cycle through them one at a time.
- Clicking the caption still recalls the image into the preview tab (existing affordance preserved).

- [ ] **Step 9: Commit**

```bash
git add client/src/App.tsx client/src/components/HistoryGallery.tsx
git commit -m "feat: add rotating multi-field caption to gallery thumbnails"
```

---

## Task 3: Hover-pause on `CaptionRotator`

**Files:**
- Modify: `client/src/components/HistoryGallery.tsx`

**Interfaces:**
- No new exports. Hover behavior is local to `CaptionRotator`.

- [ ] **Step 1: Add hover state and gate the useEffect**

In `client/src/components/HistoryGallery.tsx`, inside `CaptionRotator`, add hover state and modify the useEffect:

```tsx
const [isHovered, setIsHovered] = useState(false);

useEffect(() => {
  if (!canRotate) return;
  if (isHovered) return; // frozen — do not advance while user is inspecting
  if (tick === displayTick) return;
  setScrolling(true);
  const timer = setTimeout(() => {
    setDisplayTick(tick);
    setScrolling(false);
  }, 400);
  return () => clearTimeout(timer);
}, [tick, displayTick, canRotate, isHovered]);
```

- [ ] **Step 2: Attach hover handlers to the outer wrapper**

In the return statement of `CaptionRotator`, add `onMouseEnter` / `onMouseLeave` to the outer container:

```tsx
return (
  <div
    style={{ height: `${SLOT_H}px`, overflow: 'hidden' }}
    onMouseEnter={() => setIsHovered(true)}
    onMouseLeave={() => setIsHovered(false)}
  >
    {/* ... unchanged ... */}
  </div>
);
```

- [ ] **Step 3: Run typecheck + tests**

Run: `npm run build --prefix client && npm run test:run --prefix client`

Expected: All pass.

- [ ] **Step 4: Manual verification**

Run `npm run dev`. In the gallery:
- Hover over a single tile — its caption stops rotating; other tiles continue.
- Move the mouse off — the tile catches up (may scroll rapidly through 1+ steps) and rejoins the sync.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/HistoryGallery.tsx
git commit -m "feat: pause caption rotation on gallery tile hover"
```

---

## Task 4: `prefers-reduced-motion` support

**Files:**
- Modify: `client/src/index.css`

**Interfaces:**
- No code interface change. Pure CSS.

- [ ] **Step 1: Add the media query rule to `index.css`**

Append to the end of `client/src/index.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .caption-rotator-inner {
    transition: none !important;
  }
}
```

The `!important` is needed because `CaptionRotator` sets `transition` inline; the media query must override that inline style for the reduced-motion case.

- [ ] **Step 2: Verify build**

Run: `npm run build --prefix client`

Expected: Passes.

- [ ] **Step 3: Manual verification**

Enable "Reduce motion" at the OS level (macOS: System Settings → Accessibility → Display → Reduce motion; Windows: Settings → Accessibility → Visual effects → Animation effects off). Reload the app.

Expected: Fields still swap every 3s but with no scroll animation (instant snap). Turning motion back on restores the smooth scroll.

- [ ] **Step 4: Commit**

```bash
git add client/src/index.css
git commit -m "feat: disable caption rotation animation for reduced-motion users"
```

---

## Task 5: Final verification

**Files:** None modified.

- [ ] **Step 1: Run full test suite, lint, and build**

Run in order:

```bash
npm run test:run --prefix client
npm run lint --prefix client
npm run build --prefix client
```

Expected: All pass. Lint may show pre-existing warnings but no new ones.

- [ ] **Step 2: Manual smoke test in browser**

Run `npm run dev` and verify:
- Gallery renders as before, but with the new rotating caption
- Rotation is smooth, syncs across tiles
- Hover pause works
- Prompt is no longer in the caption
- Clicking caption still recalls the image (existing behavior preserved)
- Lightbox still opens on image click
- Deletion, favoriting, selection all work unchanged

- [ ] **Step 3: Update task list**

Update `docs/superpowers/plans/` and mark the plan as executed if using a tracking convention. Otherwise, this task is a no-op documentation step.

- [ ] **Step 4: No further commit needed for Task 5 unless issues surfaced during manual testing.**

---

## Post-Implementation

Once all tasks are complete and verified, the user may request a push to origin. Do not push without explicit user confirmation (project convention).
