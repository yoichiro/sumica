# History Gallery Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add model / architecture / sampler filters to the history gallery via a popover toolbar button, applied client-side on top of the existing date + favorites filters.

**Architecture:** Pure filter helpers in a new module, backed by unit tests. A self-contained popover component owns the UI. App.tsx exposes an intermediate `baseScopedHistory` so the empty-state message can distinguish "no data for this date" from "no data matches your filters". Firestore query pattern is unchanged.

**Tech Stack:** React 19 + TypeScript, Vite 8, Vitest (jsdom + @testing-library), lucide-react icons, existing i18n module. Everything client-side; no server changes.

## Global Constraints

- **Design spec of record:** `docs/superpowers/specs/2026-07-15-history-gallery-filters-design.md`. Every task's requirements are grounded in that spec — read the relevant section before starting a task.
- **Filter scope is within the current date's history only.** Do NOT change the Firestore subscription or `/api/history` fetch pattern.
- **Filters combine as AND**, both across gallery-filter fields and with the existing date + favorites filters.
- **Single-select per field.** `null` on any GalleryFilters field means "no constraint" for that field.
- **No persistence.** Filters reset on reload. Do NOT write to localStorage.
- **Both `ja.ts` and `en.ts` i18n bundles must stay in sync** — every key added to one must be added to the other with the same shape.
- **Commit messages are one line, English, imperative mood** (project convention — see `git log --oneline` for examples).
- **Do NOT skip pre-commit hooks** (`--no-verify` is forbidden per the harness's git safety protocol).

---

### Task 1: Pure filter helpers (`galleryFilters.ts`) with unit tests

**Files:**
- Create: `client/src/components/galleryFilters.ts`
- Create: `client/src/components/galleryFilters.test.ts`

**Interfaces:**
- Consumes: `GenerationData` from `../App`, `SdModel` from `./presets`, `inferSdArchitectureFromTitle` from `./loadIntoFormState`
- Produces:
  - `GalleryFilters` type: `{ arch: 'sdxl' | 'sd15' | null; model: string | null; sampler: string | null }`
  - `applyGalleryFilters(history: GenerationData[], filters: GalleryFilters, sdModels: SdModel[]): GenerationData[]`
  - `deriveFilterOptions(history: GenerationData[]): { models: string[]; samplers: string[] }`
  - `countActiveFilters(filters: GalleryFilters): number`

- [ ] **Step 1: Write the failing test file**

Create `client/src/components/galleryFilters.test.ts` with the following complete content:

```typescript
import { describe, it, expect } from 'vitest';
import {
  applyGalleryFilters,
  deriveFilterOptions,
  countActiveFilters,
  type GalleryFilters,
} from './galleryFilters';
import type { GenerationData } from '../App';
import type { SdModel } from './presets';

const ALL_NULL: GalleryFilters = { arch: null, model: null, sampler: null };

function mkRecord(overrides: Partial<GenerationData>): GenerationData {
  return {
    originalPrompt: '',
    enhancedPrompt: '',
    negativePrompt: '',
    width: 512,
    height: 512,
    steps: 20,
    cfgScale: 7,
    model: null,
    imageUrl: 'x',
    timestamp: 0,
    createdAt: '',
    backendMode: 'local',
    ...overrides,
  };
}

const KNOWN_MODELS: SdModel[] = [
  { title: 'juggernautXL.safetensors [abc]', type: 'sdxl' },
  { title: 'mengxMixReal.safetensors [xyz]', type: 'sd15' },
];

describe('applyGalleryFilters', () => {
  it('returns all when every filter is null', () => {
    const history = [mkRecord({ model: 'a' }), mkRecord({ model: 'b' })];
    expect(applyGalleryFilters(history, ALL_NULL, [])).toEqual(history);
  });

  it('filters by exact model title', () => {
    const history = [
      mkRecord({ model: 'a' }),
      mkRecord({ model: 'b' }),
      mkRecord({ model: 'a' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, model: 'a' }, []);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.model === 'a')).toBe(true);
  });

  it('filters by exact sampler', () => {
    const history = [
      mkRecord({ sampler: 'Euler a' }),
      mkRecord({ sampler: 'DPM++ 2M' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, sampler: 'Euler a' }, []);
    expect(out).toHaveLength(1);
    expect(out[0].sampler).toBe('Euler a');
  });

  it('filters by arch=sdxl using sdModels', () => {
    const history = [
      mkRecord({ model: 'juggernautXL.safetensors [abc]' }),
      mkRecord({ model: 'mengxMixReal.safetensors [xyz]' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, arch: 'sdxl' }, KNOWN_MODELS);
    expect(out).toHaveLength(1);
    expect(out[0].model).toContain('juggernautXL');
  });

  it('filters by arch=sd15 using sdModels', () => {
    const history = [
      mkRecord({ model: 'juggernautXL.safetensors [abc]' }),
      mkRecord({ model: 'mengxMixReal.safetensors [xyz]' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, arch: 'sd15' }, KNOWN_MODELS);
    expect(out).toHaveLength(1);
    expect(out[0].model).toContain('mengxMixReal');
  });

  it('falls back to xl-in-name heuristic when sdModels is empty', () => {
    const history = [
      mkRecord({ model: 'someXLModel.safetensors' }),
      mkRecord({ model: 'plainModel.safetensors' }),
    ];
    const out = applyGalleryFilters(history, { ...ALL_NULL, arch: 'sdxl' }, []);
    expect(out).toHaveLength(1);
    expect(out[0].model).toContain('XL');
  });

  it('applies arch + model + sampler as AND', () => {
    const history = [
      mkRecord({ model: 'juggernautXL.safetensors [abc]', sampler: 'Euler a' }),
      mkRecord({ model: 'juggernautXL.safetensors [abc]', sampler: 'DPM++ 2M' }),
      mkRecord({ model: 'mengxMixReal.safetensors [xyz]', sampler: 'Euler a' }),
    ];
    const filters: GalleryFilters = {
      arch: 'sdxl',
      model: 'juggernautXL.safetensors [abc]',
      sampler: 'Euler a',
    };
    const out = applyGalleryFilters(history, filters, KNOWN_MODELS);
    expect(out).toHaveLength(1);
    expect(out[0].sampler).toBe('Euler a');
    expect(out[0].model).toContain('juggernautXL');
  });

  it('returns empty array when input is empty', () => {
    expect(applyGalleryFilters([], ALL_NULL, [])).toEqual([]);
    expect(applyGalleryFilters([], { ...ALL_NULL, model: 'x' }, [])).toEqual([]);
  });
});

describe('deriveFilterOptions', () => {
  it('returns sorted distinct models and samplers', () => {
    const history = [
      mkRecord({ model: 'z-model', sampler: 'DPM++ 2M' }),
      mkRecord({ model: 'a-model', sampler: 'Euler a' }),
      mkRecord({ model: 'z-model', sampler: 'Euler a' }),
    ];
    const opts = deriveFilterOptions(history);
    expect(opts.models).toEqual(['a-model', 'z-model']);
    expect(opts.samplers).toEqual(['DPM++ 2M', 'Euler a']);
  });

  it('excludes null and empty-string values', () => {
    const history = [
      mkRecord({ model: null, sampler: undefined }),
      mkRecord({ model: '', sampler: '' }),
      mkRecord({ model: 'ok-model', sampler: 'ok-sampler' }),
    ];
    const opts = deriveFilterOptions(history);
    expect(opts.models).toEqual(['ok-model']);
    expect(opts.samplers).toEqual(['ok-sampler']);
  });
});

describe('countActiveFilters', () => {
  it('returns 0 when all filters are null', () => {
    expect(countActiveFilters(ALL_NULL)).toBe(0);
  });

  it('returns 1 when a single filter is set', () => {
    expect(countActiveFilters({ ...ALL_NULL, arch: 'sdxl' })).toBe(1);
    expect(countActiveFilters({ ...ALL_NULL, model: 'x' })).toBe(1);
    expect(countActiveFilters({ ...ALL_NULL, sampler: 'y' })).toBe(1);
  });

  it('returns 3 when all filters are set', () => {
    expect(countActiveFilters({ arch: 'sd15', model: 'x', sampler: 'y' })).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run --prefix client -- galleryFilters.test.ts`
Expected: FAIL — the test file cannot resolve `./galleryFilters` because the module does not exist yet.

- [ ] **Step 3: Implement the helpers**

Create `client/src/components/galleryFilters.ts` with the following complete content:

```typescript
import type { GenerationData } from '../App';
import type { SdModel } from './presets';
import { inferSdArchitectureFromTitle } from './loadIntoFormState';

// Pure helpers backing the gallery filter popover. Kept as pure functions
// (no React, no state) so the filter logic can be unit-tested independently
// of the DOM. See docs/superpowers/specs/2026-07-15-history-gallery-filters-design.md.

export interface GalleryFilters {
  arch: 'sdxl' | 'sd15' | null;
  model: string | null;
  sampler: string | null;
}

export function applyGalleryFilters(
  history: GenerationData[],
  filters: GalleryFilters,
  sdModels: SdModel[],
): GenerationData[] {
  return history.filter((it) => {
    if (filters.model && it.model !== filters.model) return false;
    if (filters.sampler && it.sampler !== filters.sampler) return false;
    if (filters.arch) {
      const arch = inferSdArchitectureFromTitle(it.model ?? '', sdModels);
      if (arch !== filters.arch) return false;
    }
    return true;
  });
}

export function deriveFilterOptions(history: GenerationData[]): {
  models: string[];
  samplers: string[];
} {
  const models = new Set<string>();
  const samplers = new Set<string>();
  for (const it of history) {
    if (it.model) models.add(it.model);
    if (it.sampler) samplers.add(it.sampler);
  }
  return {
    models: [...models].sort(),
    samplers: [...samplers].sort(),
  };
}

export function countActiveFilters(filters: GalleryFilters): number {
  let count = 0;
  if (filters.arch) count++;
  if (filters.model) count++;
  if (filters.sampler) count++;
  return count;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run --prefix client -- galleryFilters.test.ts`
Expected: PASS — all 14 tests green (8 for `applyGalleryFilters`, 2 for `deriveFilterOptions`, 3 for `countActiveFilters`, plus the describe blocks themselves).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/galleryFilters.ts client/src/components/galleryFilters.test.ts
git commit -m "feat: add pure gallery filter helpers with unit tests"
```

---

### Task 2: i18n keys for the filter UI

**Files:**
- Modify: `client/src/i18n/ja.ts` (add `gallery.filters` block and `gallery.emptyStateFiltered`)
- Modify: `client/src/i18n/en.ts` (add the same keys, English strings)

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `t.gallery.filters.buttonLabel: string`
  - `t.gallery.filters.activeCountSuffix: (n: number) => string`
  - `t.gallery.filters.archLabel: string`
  - `t.gallery.filters.archAll: string`
  - `t.gallery.filters.modelLabel: string`
  - `t.gallery.filters.modelAll: string`
  - `t.gallery.filters.samplerLabel: string`
  - `t.gallery.filters.samplerAll: string`
  - `t.gallery.filters.clearButton: string`
  - `t.gallery.filters.closeButton: string`
  - `t.gallery.emptyStateFiltered: string`

- [ ] **Step 1: Add the Japanese strings to `ja.ts`**

In `client/src/i18n/ja.ts`, locate the existing `gallery: { ... }` block. Right after the existing `emptyStateNoResults` line, add a new sibling entry `emptyStateFiltered`, and right after that, add a new `filters` object. The finished block should include (among the existing keys) exactly these additions:

```typescript
    emptyStateNoResults: '指定した日付の画像はありません 📅',
    emptyStateFiltered: 'フィルタ条件に合う画像がありません 🔍',
    filters: {
      buttonLabel: 'フィルター',
      activeCountSuffix: (n: number) => ` (${n})`,
      archLabel: 'アーキテクチャ',
      archAll: 'すべて',
      modelLabel: 'モデル',
      modelAll: 'すべて',
      samplerLabel: 'サンプラー',
      samplerAll: 'すべて',
      clearButton: '🗑️ クリア',
      closeButton: '閉じる',
    },
```

Keep the trailing comma before the next sibling key. Do NOT touch any other keys.

- [ ] **Step 2: Add the English strings to `en.ts`**

In `client/src/i18n/en.ts`, do the mirror edit — same structure, English values:

```typescript
    emptyStateNoResults: 'No images for the selected date 📅',
    emptyStateFiltered: 'No images match the filters 🔍',
    filters: {
      buttonLabel: 'Filter',
      activeCountSuffix: (n: number) => ` (${n})`,
      archLabel: 'Architecture',
      archAll: 'All',
      modelLabel: 'Model',
      modelAll: 'All',
      samplerLabel: 'Sampler',
      samplerAll: 'All',
      clearButton: '🗑️ Clear',
      closeButton: 'Close',
    },
```

Note the existing `emptyStateNoResults` string in `en.ts` may differ from `'No images for the selected date 📅'`. If it does, leave the existing value intact and only insert your new lines around it — do not overwrite it.

- [ ] **Step 3: Type-check to confirm both bundles are in sync**

Run: `npm run build --prefix client 2>&1 | head -30`
Expected: no TypeScript errors. The i18n type inference derives its shape from one bundle and enforces it on the other, so any typo or missing key will surface as an error here.

- [ ] **Step 4: Commit**

```bash
git add client/src/i18n/ja.ts client/src/i18n/en.ts
git commit -m "feat: add gallery filter i18n keys for ja and en"
```

---

### Task 3: `GalleryFiltersPopover` UI component

**Files:**
- Create: `client/src/components/GalleryFiltersPopover.tsx`

**Interfaces:**
- Consumes:
  - `GalleryFilters` type + `countActiveFilters` from `./galleryFilters` (Task 1)
  - `t.gallery.filters.*` from `../i18n` (Task 2)
  - `Filter` icon from `lucide-react`
- Produces:
  - `GalleryFiltersPopoverProps` interface: `{ filters, onSetFilters, availableModels, availableSamplers }`
  - `GalleryFiltersPopover` component (named export)

- [ ] **Step 1: Create the component file**

Create `client/src/components/GalleryFiltersPopover.tsx` with the following complete content:

```typescript
import { useEffect, useRef, useState } from 'react';
import { Filter } from 'lucide-react';
import { t } from '../i18n';
import type { GalleryFilters } from './galleryFilters';
import { countActiveFilters } from './galleryFilters';

// Toggle button + popover for the gallery-side filter surface added in the
// 2026-07-15 filter-expansion pass. Renders a Filter icon button next to the
// existing date + favorites controls; opening it exposes an arch radio group
// and two native selects (model, sampler). Auto-hides fields whose distinct
// value set has <= 1 entries, since filtering by an axis with a single option
// is not useful.
export interface GalleryFiltersPopoverProps {
  filters: GalleryFilters;
  onSetFilters: (filters: GalleryFilters) => void;
  availableModels: string[];
  availableSamplers: string[];
}

export function GalleryFiltersPopover({
  filters,
  onSetFilters,
  availableModels,
  availableSamplers,
}: GalleryFiltersPopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const active = countActiveFilters(filters);

  const showModel = availableModels.length > 1;
  const showSampler = availableSamplers.length > 1;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const clear = () => onSetFilters({ arch: null, model: null, sampler: null });

  const archOptions: { value: GalleryFilters['arch']; label: string }[] = [
    { value: null, label: t.gallery.filters.archAll },
    { value: 'sdxl', label: 'SDXL' },
    { value: 'sd15', label: 'SD1.5' },
  ];

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="scale-hover"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 10px',
          borderRadius: '8px',
          border: active > 0 ? 'none' : '1.5px solid var(--panel-border)',
          background: active > 0 ? 'var(--pop-blue)' : 'transparent',
          color: active > 0 ? '#fff' : 'var(--text-secondary)',
          fontSize: '12px',
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        <Filter size={14} />
        {t.gallery.filters.buttonLabel}
        {active > 0 && t.gallery.filters.activeCountSuffix(active)}
      </button>
      {open && (
        <div
          role="dialog"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 100,
            minWidth: '280px',
            padding: '16px',
            borderRadius: '10px',
            border: '1px solid var(--panel-border)',
            background: 'var(--panel-bg)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
              {t.gallery.filters.archLabel}
            </label>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {archOptions.map((opt) => (
                <label
                  key={String(opt.value)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', cursor: 'pointer' }}
                >
                  <input
                    type="radio"
                    checked={filters.arch === opt.value}
                    onChange={() => onSetFilters({ ...filters, arch: opt.value })}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          {showModel && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                {t.gallery.filters.modelLabel}
              </label>
              <select
                className="input-field"
                value={filters.model ?? ''}
                onChange={(e) => onSetFilters({ ...filters, model: e.target.value || null })}
                style={{ borderRadius: '8px' }}
              >
                <option value="">{t.gallery.filters.modelAll}</option>
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          )}
          {showSampler && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                {t.gallery.filters.samplerLabel}
              </label>
              <select
                className="input-field"
                value={filters.sampler ?? ''}
                onChange={(e) => onSetFilters({ ...filters, sampler: e.target.value || null })}
                style={{ borderRadius: '8px' }}
              >
                <option value="">{t.gallery.filters.samplerAll}</option>
                {availableSamplers.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button
              type="button"
              onClick={clear}
              className="scale-hover"
              style={{
                padding: '5px 10px',
                borderRadius: '8px',
                border: '1.5px solid var(--panel-border)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {t.gallery.filters.clearButton}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: '5px 10px',
                borderRadius: '8px',
                border: 'none',
                background: 'var(--pop-blue)',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {t.gallery.filters.closeButton}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check the new component**

Run: `npm run build --prefix client 2>&1 | head -30`
Expected: no TypeScript errors. The component isn't imported anywhere yet, but `tsc -b` will still type-check it because it's in the project's `include` glob.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/GalleryFiltersPopover.tsx
git commit -m "feat: add GalleryFiltersPopover component"
```

---

### Task 4: Wire filters into App.tsx and HistoryGallery.tsx

This task combines App.tsx state additions and HistoryGallery.tsx toolbar changes because they form one testable deliverable: after this task, the filter button appears, the popover works, and applying a filter narrows the gallery.

**Files:**
- Modify: `client/src/App.tsx` (state, memos, effect, prop wiring)
- Modify: `client/src/components/HistoryGallery.tsx` (props, toolbar rendering, empty-state 3-branch)

**Interfaces:**
- Consumes:
  - `GalleryFilters` + `applyGalleryFilters` + `deriveFilterOptions` from `./components/galleryFilters` (Task 1)
  - `GalleryFiltersPopover` from `./components/GalleryFiltersPopover` (Task 3)
  - `t.gallery.emptyStateFiltered` from `../i18n` (Task 2)
- Produces: no new exports; user-visible behavior — the filter button appears in the toolbar and clicking it opens the popover, and choosing filter values narrows the visible gallery.

- [ ] **Step 1: Add imports and state to App.tsx**

In `client/src/App.tsx`, near the top of the file where other component imports live, add:

```typescript
import { applyGalleryFilters, deriveFilterOptions, type GalleryFilters } from './components/galleryFilters';
```

Inside the `App()` function, locate the line:

```typescript
  const [favoritesOnly, setFavoritesOnly] = useState(false);
```

Right after it, add:

```typescript
  const [galleryFilters, setGalleryFilters] = useState<GalleryFilters>({ arch: null, model: null, sampler: null });
```

- [ ] **Step 2: Split `displayedHistory` into `baseScopedHistory` + `displayedHistory`**

In App.tsx, locate the existing `displayedHistory` `useMemo`. It currently looks like:

```typescript
  const displayedHistory = useMemo(() => {
    if (favoritesOnly) {
      return user ? history : history.filter((h) => !!h.isFavorite);
    }
    return filterDate ? history.filter((it) => localYMD(it.timestamp) === filterDate) : history;
  }, [history, favoritesOnly, filterDate, user]);
```

Replace that block with:

```typescript
  // Base scope: existing date + favoritesOnly filters. Exposed so HistoryGallery
  // can distinguish "no data for this date" from "no data matches your gallery filters"
  // in the empty-state message.
  const baseScopedHistory = useMemo(() => {
    if (favoritesOnly) return user ? history : history.filter((h) => !!h.isFavorite);
    return filterDate ? history.filter((it) => localYMD(it.timestamp) === filterDate) : history;
  }, [history, favoritesOnly, filterDate, user]);

  const displayedHistory = useMemo(
    () => applyGalleryFilters(baseScopedHistory, galleryFilters, sdModels),
    [baseScopedHistory, galleryFilters, sdModels],
  );
```

- [ ] **Step 3: Derive filter options and drop hidden selections**

In App.tsx, right after the `displayedHistory` useMemo you just added, insert:

```typescript
  // Distinct values from the current base scope, feeding the popover's model/sampler
  // selects. Deriving from baseScopedHistory (not raw history) means the dropdowns
  // only show values that could actually match after the date/favorites filter.
  const filterOptions = useMemo(() => deriveFilterOptions(baseScopedHistory), [baseScopedHistory]);

  // When filters change and hide previously-selected items, prune the hidden
  // ids from selectedIds so a subsequent "delete selected" can't operate on
  // invisible rows. Sized-guarded so identical selection sets don't re-render.
  useEffect(() => {
    const visibleKeys = new Set(displayedHistory.map(itemKey));
    setSelectedIds((prev) => {
      const next = new Set<string>();
      for (const k of prev) if (visibleKeys.has(k)) next.add(k);
      return next.size === prev.size ? prev : next;
    });
  }, [displayedHistory]);
```

- [ ] **Step 4: Pass new props to `<HistoryGallery />`**

In App.tsx, locate the `<HistoryGallery ... />` JSX call. Add these four new props alongside the existing ones (keep the existing props unchanged):

```tsx
              baseScopedHistoryLength={baseScopedHistory.length}
              galleryFilters={galleryFilters}
              onSetGalleryFilters={setGalleryFilters}
              availableModels={filterOptions.models}
              availableSamplers={filterOptions.samplers}
```

- [ ] **Step 5: Update `HistoryGalleryProps` and destructuring**

In `client/src/components/HistoryGallery.tsx`, add the import at the top of the file:

```typescript
import { GalleryFiltersPopover } from './GalleryFiltersPopover';
import type { GalleryFilters } from './galleryFilters';
```

Extend the `HistoryGalleryProps` interface with the 5 new props:

```typescript
  baseScopedHistoryLength: number;
  galleryFilters: GalleryFilters;
  onSetGalleryFilters: (filters: GalleryFilters) => void;
  availableModels: string[];
  availableSamplers: string[];
```

Add them to the destructuring at the top of the `HistoryGallery` function:

```typescript
  baseScopedHistoryLength,
  galleryFilters,
  onSetGalleryFilters,
  availableModels,
  availableSamplers,
```

- [ ] **Step 6: Render the popover in the toolbar**

In `HistoryGallery.tsx`, locate the toolbar's favorites-only button (the `<button>` with `onClick={() => onSetFavoritesOnly((v) => !v)}`). Directly after that button's closing `</button>`, insert:

```tsx
          <GalleryFiltersPopover
            filters={galleryFilters}
            onSetFilters={onSetGalleryFilters}
            availableModels={availableModels}
            availableSamplers={availableSamplers}
          />
```

- [ ] **Step 7: Update the empty-state to a 3-branch fallback**

In `HistoryGallery.tsx`, locate the current empty-state block:

```tsx
      ) : (
        <div className="glass-panel" style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', borderRadius: '16px', background: 'var(--panel-bg)' }}>
          {historyLength === 0
            ? t.gallery.emptyStateNoHistory
            : t.gallery.emptyStateNoResults}
        </div>
      )}
```

Replace it with:

```tsx
      ) : (
        <div className="glass-panel" style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', borderRadius: '16px', background: 'var(--panel-bg)' }}>
          {historyLength === 0
            ? t.gallery.emptyStateNoHistory
            : baseScopedHistoryLength === 0
              ? t.gallery.emptyStateNoResults
              : t.gallery.emptyStateFiltered}
        </div>
      )}
```

- [ ] **Step 8: Type-check the whole client build**

Run: `npm run build --prefix client 2>&1 | tail -20`
Expected: no TypeScript errors. The vite bundle should also succeed (`built in NNNms`).

- [ ] **Step 9: Run existing unit tests to confirm no regressions**

Run: `npm run test:run --prefix client 2>&1 | tail -10`
Expected: All tests pass. Before this task the suite had 119 tests; after Task 1 it has ~133 (Task 1 added ~14 assertions across 3 describe blocks). No test count should decrease.

- [ ] **Step 10: Commit**

```bash
git add client/src/App.tsx client/src/components/HistoryGallery.tsx
git commit -m "feat: wire gallery filters into App and HistoryGallery"
```

---

### Task 5: Full verification and manual browser check

**Files:**
- Modify: none (verification only). If a manual check surfaces a bug, fix in a follow-up commit.

**Interfaces:**
- Consumes: everything from Tasks 1-4
- Produces: verified working feature

- [ ] **Step 1: Run the client test suite**

Run: `npm run test:run --prefix client 2>&1 | tail -5`
Expected: All tests pass, including the 14 new `galleryFilters.test.ts` assertions.

- [ ] **Step 2: Run oxlint**

Run: `npm run lint --prefix client 2>&1 | tail -20`
Expected: Only pre-existing warnings (the same set that was present before this feature). No new errors or warnings from the newly-added files.

- [ ] **Step 3: Run the production client build**

Run: `npm run build --prefix client 2>&1 | tail -10`
Expected: `built in NNNms`, no TypeScript errors, no vite errors.

- [ ] **Step 4: Boot dev servers if not already running**

Check with `ss -tlnp | grep -E ':5173|:5000'`. If both ports are listening you can skip this step. Otherwise run in the project root: `npm run dev` (starts both server + client concurrently on 5000 + 5173).

- [ ] **Step 5: Manual browser flow (one pass, one browser reload)**

Open http://localhost:5173/?hl=ja. Then:

1. Switch to the **履歴ギャラリー** tab in the right column.
2. Set the date filter to a day that has multiple images with different models (e.g. `2026-06-29` in the demo local data has 66 images).
3. Confirm a **[🔍 フィルター]** button appears next to the ⭐ button. The counter suffix should be absent (no filters active yet).
4. Click the button — a popover opens showing an **アーキテクチャ** radio group and, if there are >= 2 distinct models / samplers that day, model + sampler dropdowns.
5. Select **SDXL** in the radio group. Confirm the grid updates to show only SDXL images. The button label should now show `フィルター (1)`.
6. Change the model dropdown to a specific model title. Confirm the grid narrows further. Button badge should read `(2)`.
7. Select **Euler a** in the sampler dropdown. Confirm intersection is shown. Button badge should read `(3)`.
8. Deliberately choose a sampler+model combination that has 0 images. Confirm the empty state shows `"フィルタ条件に合う画像がありません 🔍"` — NOT `"指定した日付の画像はありません"`.
9. Click **🗑️ クリア**. Confirm all filters reset (radio returns to すべて, dropdowns to すべて, badge disappears, full day's images return).
10. Set a filter to hide some images. Ctrl-click / Shift-click 3 visible images to select them. Change the filter to hide some of the selected. Confirm the selection count drops accordingly (hidden items are pruned).
11. Reload the browser (Ctrl-R). Confirm the popover resets to all-null on next open — filters do NOT persist.

- [ ] **Step 6: Report results**

If all steps in Step 5 pass, this task is complete. If any step fails, do not commit — investigate and fix in a follow-up commit that references the failing step number.

- [ ] **Step 7: Final status summary**

Run: `git log --oneline -6` and confirm 4 new commits from this plan (one per Task 1-4). Working tree should be clean.

---

## Self-Review Notes

Reviewed after writing:

1. **Spec coverage:** Every spec section maps to a task:
   - "アーキテクチャとデータフロー" → Task 4 (Steps 2-3 refactor `displayedHistory` into base + gallery-filter chain)
   - "フィルタ状態と純粋ヘルパー" → Task 1 (helpers + tests) + Task 4 (state + memo wiring)
   - "UI: GalleryFiltersPopover" → Task 3
   - "選択インタラクションと空状態" → Task 4 Steps 3 + 7
   - "テスト戦略" → Task 1 Step 1 (test content) + Task 5 (manual verify)
   - "影響を受けるファイル一覧" → all listed files touched exactly as spec'd

2. **Placeholder scan:** No TBD / TODO / "similar to earlier" / "add error handling" strings. Every code block is complete. Every command shows expected output.

3. **Type consistency:** `GalleryFilters` is defined in Task 1 and consumed by Tasks 3 + 4 verbatim. `applyGalleryFilters`, `deriveFilterOptions`, `countActiveFilters` names match across tasks. `HistoryGalleryProps` extensions in Task 4 Step 5 match the props passed in Step 4. `galleryFilters` state name is consistent App.tsx→popover.

4. **Scope check:** Single implementation plan. Filter axis surface is 3 fields (model / arch / sampler). Additional filter axes (Scheduler / LoRA / Hires / Refiner / size) are explicitly deferred per spec.

5. **Ambiguity check:**
   - `emptyStateFiltered` message shown only when base scope has data but gallery filter kills it — Task 4 Step 7 code is explicit.
   - Auto-hide fields with 1 or fewer distinct values — Task 3 uses `.length > 1` guard.
   - `sdModels` is used only for arch judgment on the App side, not passed to the popover — Task 4 Step 4 does not pass it to `GalleryFiltersPopover`.
   - Selection cleanup effect uses ref-equality guard to avoid render loops — Task 4 Step 3 spells this out.
