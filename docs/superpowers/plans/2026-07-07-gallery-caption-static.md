# Gallery Caption Static Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the just-shipped rotating caption (CaptionRotator + tick infrastructure) with a static 2-line layout that always shows model + size, adds presence-only emoji badges for Hires.fix (⚡) and LoRA (🎭), and shows a short-format date (`MM-DD`) at lower visibility.

**Architecture:** One atomic refactor commit that (1) rewrites `captionFields.ts` from a queue-returning pure function to an info-object-returning pure function, (2) removes the entire rotation infrastructure (App-level tick state + interval, `CaptionRotator` + `CaptionSlot` subcomponents, `prefers-reduced-motion` media query), and (3) adds a new small `CaptionInfo` static component with no hooks. A separate final verification task confirms lint/build/test pass with no regressions.

**Tech Stack:** React 19 + TypeScript + Vite + Vitest + oxlint. No new dependencies.

## Global Constraints

- Client is ESM (`"type": "module"`); use `import`, not `require`.
- All new pure logic must be covered by Vitest tests (`npm run test:run --prefix client`).
- Full build must pass: `npm run build --prefix client` (tsc + vite build).
- Do NOT change server code, Firebase schema, or `GenerationData` shape.
- Do NOT change the size or grid layout of gallery thumbnails; only the caption below each tile.
- Preserve the existing "click caption to recall image into preview" behavior — the wrapper `<div>`'s `onClick={() => onOpenInPreview(item)}` MUST stay intact.
- Emoji badges are literal Unicode: ⚡ for Hires, 🎭 for LoRA. No lucide icons.
- Date format is exactly `MM-DD` (two-digit month, dash, two-digit day) in the system local timezone.
- Commit messages must be one-line English; MUST NOT contain `Claude`, `Co-Authored-By`, or any AI-assistance trailer.

---

## File Structure

**Modified files:**
- `client/src/components/captionFields.ts` — full rewrite. New export shape: `type CaptionInfoData` + `function buildCaptionInfo`. Retains the existing `formatSize` helper (which uses `findSdxlSelection`/`findSd15Selection` from `./presets`). Removes: `type CaptionField`, `function buildCaptionFieldQueue`, `formatDate`, `formatSampler`, `formatHires`.
- `client/src/components/captionFields.test.ts` — full rewrite. New tests for `buildCaptionInfo`.
- `client/src/components/HistoryGallery.tsx` — remove `CaptionSlot` and `CaptionRotator` subcomponents (plus their `useState`/`useEffect` imports if no longer needed), remove `captionRotationTick` from `HistoryGalleryProps` and the destructuring, add a new inline `CaptionInfo` subcomponent, replace the `<CaptionRotator>` invocation with `<CaptionInfo info={buildCaptionInfo(item)} />`.
- `client/src/App.tsx` — remove `captionRotationTick` state, remove the `useEffect` that runs `setInterval(6000)`, remove the `captionRotationTick={captionRotationTick}` prop passed to `<HistoryGallery>`.
- `client/src/index.css` — remove the `@media (prefers-reduced-motion: reduce) { .caption-rotator-inner { transition: none !important; } }` block (the `.caption-rotator-inner` class no longer exists after this refactor).

**New files:** None.

**Deleted files:** None.

---

## Task 1: Rewrite caption from rotation to static layout

**Files:**
- Modify: `client/src/components/captionFields.ts` (full rewrite)
- Modify: `client/src/components/captionFields.test.ts` (full rewrite)
- Modify: `client/src/components/HistoryGallery.tsx` (remove CaptionRotator/CaptionSlot, add CaptionInfo, adjust props)
- Modify: `client/src/App.tsx` (remove tick state and interval)
- Modify: `client/src/index.css` (remove media query for `.caption-rotator-inner`)

**Interfaces:**
- Consumes (unchanged): `findSdxlSelection` and `findSd15Selection` from `./presets`; `GenerationData` from `../App`.
- Produces (new):
  - `export type CaptionInfoData = { model: string; size: string; date: string; hasHires: boolean; hasLora: boolean }`
  - `export function buildCaptionInfo(item: GenerationData): CaptionInfoData`
- Removes (old):
  - `export type CaptionField`
  - `export function buildCaptionFieldQueue`
  - The old private helpers `formatDate`, `formatSampler`, `formatHires`

This is one atomic task committed as a single change because the file dependencies are tightly coupled: `HistoryGallery.tsx` currently imports `buildCaptionFieldQueue` and `CaptionField`, so replacing captionFields.ts without simultaneously updating HistoryGallery would leave the build broken.

- [ ] **Step 1: Write the new test file (full replacement)**

Overwrite `client/src/components/captionFields.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { buildCaptionInfo } from './captionFields';
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
};

describe('buildCaptionInfo', () => {
  it('returns core fields with hasHires and hasLora both false when neither is applied', () => {
    const info = buildCaptionInfo(baseItem);
    expect(info.model).toBe('yayoi_mix_v25-fp16.safetensors [ca28aa4a44]');
    expect(info.size).toBe('512×512 (1:1)');
    expect(info.hasHires).toBe(false);
    expect(info.hasLora).toBe(false);
  });

  it('falls back to "不明" when model is null', () => {
    const info = buildCaptionInfo({ ...baseItem, model: null });
    expect(info.model).toBe('不明');
  });

  it('falls back to "不明" when model is empty string', () => {
    const info = buildCaptionInfo({ ...baseItem, model: '' });
    expect(info.model).toBe('不明');
  });

  it('omits the aspect ratio suffix when dimensions do not match any preset', () => {
    const info = buildCaptionInfo({ ...baseItem, width: 999, height: 555 });
    expect(info.size).toBe('999×555');
  });

  it('recognizes SDXL 832x1216 as 3:2 portrait', () => {
    const info = buildCaptionInfo({ ...baseItem, width: 832, height: 1216 });
    expect(info.size).toBe('832×1216 (3:2)');
  });

  it('sets hasHires true when enableHr is true', () => {
    const info = buildCaptionInfo({ ...baseItem, enableHr: true });
    expect(info.hasHires).toBe(true);
  });

  it('sets hasLora true when at least one LoRA is applied', () => {
    const info = buildCaptionInfo({
      ...baseItem,
      loras: [{ name: 'x', weight: 0.5 }],
    });
    expect(info.hasLora).toBe(true);
  });

  it('sets hasLora true when multiple LoRAs are applied', () => {
    const info = buildCaptionInfo({
      ...baseItem,
      loras: [
        { name: 'x', weight: 0.5 },
        { name: 'y', weight: 0.7 },
        { name: 'z', weight: 0.3 },
      ],
    });
    expect(info.hasLora).toBe(true);
  });

  it('sets hasLora false when loras is an empty array', () => {
    const info = buildCaptionInfo({ ...baseItem, loras: [] });
    expect(info.hasLora).toBe(false);
  });

  it('formats the date as MM-DD (shape-only, timezone-agnostic)', () => {
    const info = buildCaptionInfo(baseItem);
    expect(info.date).toMatch(/^\d{2}-\d{2}$/);
  });

  it('flags both hasHires and hasLora when both are applied', () => {
    const info = buildCaptionInfo({
      ...baseItem,
      enableHr: true,
      loras: [{ name: 'a', weight: 0.5 }],
    });
    expect(info.hasHires).toBe(true);
    expect(info.hasLora).toBe(true);
  });
});
```

- [ ] **Step 2: Run the captionFields test file to verify it fails**

Run: `npm run test:run --prefix client -- captionFields`

Expected: FAIL. Errors will look like "buildCaptionInfo is not exported" or "Cannot find module" since `buildCaptionInfo` doesn't exist yet. The old `buildCaptionFieldQueue` may still be exported but no tests import it anymore.

- [ ] **Step 3: Rewrite captionFields.ts to add the new function (full replacement)**

Overwrite `client/src/components/captionFields.ts` with:

```ts
import type { GenerationData } from '../App';
import { findSdxlSelection, findSd15Selection } from './presets';

export type CaptionInfoData = {
  model: string;
  size: string;
  date: string;
  hasHires: boolean;
  hasLora: boolean;
};

function formatDateShort(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatSize(width: number, height: number): string {
  const sdxl = findSdxlSelection(width, height);
  if (sdxl) return `${width}×${height} (${sdxl.ratio})`;
  const sd15 = findSd15Selection(width, height);
  if (sd15) return `${width}×${height} (${sd15.ratio})`;
  return `${width}×${height}`;
}

export function buildCaptionInfo(item: GenerationData): CaptionInfoData {
  return {
    model: item.model && item.model.length > 0 ? item.model : '不明',
    size: formatSize(item.width, item.height),
    date: formatDateShort(item.timestamp),
    hasHires: !!item.enableHr,
    hasLora: !!(item.loras && item.loras.length > 0),
  };
}
```

Note: The old `buildCaptionFieldQueue`, `CaptionField`, `formatDate`, `formatSampler`, and `formatHires` are removed. The file's public API is now just `CaptionInfoData` and `buildCaptionInfo`.

- [ ] **Step 4: Run the captionFields test file to verify it passes**

Run: `npm run test:run --prefix client -- captionFields`

Expected: PASS. All 11 test cases pass.

Note: The full test suite (`npm run test:run --prefix client` without a filter) will still work at this point because Vitest doesn't do full TypeScript checking. However, `npm run build` will fail because `HistoryGallery.tsx` still imports the removed `buildCaptionFieldQueue` — that gets fixed in the next steps. Do NOT run the full build here; wait until Step 8.

- [ ] **Step 5: Rewrite HistoryGallery.tsx caption region**

Open `client/src/components/HistoryGallery.tsx` and apply the following changes.

**5a: Update the imports at the top of the file.**

Locate the current imports (near the top, just below the initial `lucide-react` import):
```tsx
import { useState, useEffect } from 'react';
import { buildCaptionFieldQueue, type CaptionField } from './captionFields';
```

Replace with:
```tsx
import { buildCaptionInfo, type CaptionInfoData } from './captionFields';
```

Note: `useState` and `useEffect` are no longer needed because the new `CaptionInfo` component has no hooks. Verify no other code in this file still uses them; grep for `useState\|useEffect` should return no matches after this change.

**5b: Delete `CaptionSlot` and `CaptionRotator` subcomponents.**

Find the two function declarations `function CaptionSlot(...)` and `function CaptionRotator(...)` (they appear consecutively, roughly between the `FavoriteButton` and the `HistoryGalleryProps` interface). Delete both function definitions entirely.

**5c: Add the new `CaptionInfo` subcomponent** in the same location (between `FavoriteButton` and `HistoryGalleryProps`):

```tsx
function CaptionInfo({ info }: { info: CaptionInfoData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{
        fontSize: '13px',
        fontWeight: 700,
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {info.model}
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '6px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          minWidth: 0,
          flex: 1,
        }}>
          <span style={{
            fontSize: '11px',
            fontWeight: 500,
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {info.size}
          </span>
          {info.hasHires && (
            <span title="Hires.fix 適用" style={{ fontSize: '12px', flexShrink: 0 }}>⚡</span>
          )}
          {info.hasLora && (
            <span title="LoRA 適用" style={{ fontSize: '12px', flexShrink: 0 }}>🎭</span>
          )}
        </div>
        <span style={{
          fontSize: '10px',
          color: 'var(--text-muted)',
          flexShrink: 0,
        }}>
          {info.date}
        </span>
      </div>
    </div>
  );
}
```

**5d: Update `HistoryGalleryProps` to remove `captionRotationTick`.**

Find the interface `interface HistoryGalleryProps { ... }`. Delete the line `captionRotationTick: number;`.

**5e: Update the destructured parameter list of `export function HistoryGallery({ ... })`.**

Delete `captionRotationTick,` from the destructuring.

**5f: Replace the `<CaptionRotator>` JSX with `<CaptionInfo>`.**

Find the JSX line that reads:
```tsx
<CaptionRotator item={item} tick={captionRotationTick} />
```

Replace with:
```tsx
<CaptionInfo info={buildCaptionInfo(item)} />
```

The wrapping `<div>` around this (with `onClick={() => onOpenInPreview(item)}` and `title="プレビューに表示"`) MUST remain unchanged.

- [ ] **Step 6: Update App.tsx to remove the rotation tick**

Open `client/src/App.tsx`. Locate this block (currently around line 384-392):

```tsx
  // Shared tick counter that drives the gallery caption rotation. Advances every
  // 6 seconds. Passed down to HistoryGallery so all tiles switch in sync.
  const [captionRotationTick, setCaptionRotationTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setCaptionRotationTick(t => t + 1);
    }, 6000);
    return () => clearInterval(id);
  }, []);
```

Delete the entire block (all 9 lines including the two-line comment above the state declaration).

Then locate the `<HistoryGallery>` JSX invocation (currently around line 1404). Delete the line:

```tsx
              captionRotationTick={captionRotationTick}
```

- [ ] **Step 7: Remove the reduced-motion media query for `.caption-rotator-inner`**

Open `client/src/index.css`. Locate this block at the end of the file:

```css
@media (prefers-reduced-motion: reduce) {
  .caption-rotator-inner {
    transition: none !important;
  }
}
```

Delete the entire 5-line block (plus the blank line before it if there is one, to keep the file tidy). Do NOT delete the earlier `@media (prefers-reduced-motion: reduce)` block that targets `.processing-shimmer` — that one is for a different feature and must stay.

- [ ] **Step 8: Run the full test suite and build**

Run in sequence:
```bash
npm run test:run --prefix client
npm run build --prefix client
```

Expected: Both pass. Test count: 53 total (11 new in captionFields.test.ts + 42 pre-existing in other test files). Build succeeds with no type errors.

If either fails, review Steps 5-7 for typos or missed edits. Common mistakes:
- Forgot to remove `useState`/`useEffect` import when they're no longer used (produces oxlint warning, not a build error).
- Left a stray reference to `captionRotationTick` somewhere.
- Left a stray reference to `CaptionRotator` or `CaptionSlot`.

- [ ] **Step 9: Commit**

```bash
git add client/src/components/captionFields.ts client/src/components/captionFields.test.ts client/src/components/HistoryGallery.tsx client/src/App.tsx client/src/index.css
git commit -m "feat: replace rotating caption with static 2-line layout and presence badges"
```

---

## Task 2: Final verification

**Files:** None modified.

- [ ] **Step 1: Run tests, lint, and build in sequence**

```bash
npm run test:run --prefix client
npm run lint --prefix client
npm run build --prefix client
```

Expected: All pass. Lint may show pre-existing warnings in App.tsx (`react-hooks(exhaustive-deps)` warnings that predate this feature) but no new warnings introduced by this refactor.

- [ ] **Step 2: Manual smoke test in the browser**

Run `npm run dev` and open the app. Verify:

- Every gallery tile shows the new static caption:
  - Row 1: model name (bold, larger, truncates with `…` if long).
  - Row 2 left: size like `1024×1536 (3:2)`, optionally followed by ⚡ if Hires was applied, optionally followed by 🎭 if LoRA was applied.
  - Row 2 right: date in `MM-DD` format, smaller and muted.
- Tiles without Hires or LoRA show just size on the left and date on the right (no badges).
- Tiles with only Hires show ⚡ but not 🎭. Vice versa for LoRA-only.
- Hovering the ⚡ badge shows the tooltip `Hires.fix 適用`. Hovering 🎭 shows `LoRA 適用`.
- Clicking anywhere in the caption area still recalls the image into the preview tab (existing behavior preserved).
- Nothing scrolls or animates in the caption (no rotation).
- Other gallery interactions unchanged: image click opens lightbox, badges, selection, favoriting, deletion all work as before.

- [ ] **Step 3: No further commits required for Task 2 unless the manual smoke test surfaces issues.**

---

## Post-Implementation

After Task 2 verification, the ledger for this run is complete. The rotation-era commits (c199e30..583e4ea) remain in git history as a documented iteration; the current HEAD represents the final static-layout design. Push to origin only on explicit user confirmation (project convention).
