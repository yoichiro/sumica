# LoRA and Checkpoint Keyword Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to specify keywords (trigger words / quality tags) associated with Checkpoints and LoRAs, persist them per model/LoRA in `localStorage`, and deterministically inject them into the positive prompt before Stable Diffusion image generation.

**Architecture:** A pure helper function `composePositivePrompt` deterministically joins model keywords, LoRA trigger words, and the LM Studio enhanced prompt into a clean, comma-separated string on the client before calling `/api/generate`. `ControlPanel` adds inline input fields for model keywords and per-LoRA trigger words, synchronized in real time with `localStorage`. Past generation records and recipes persist and restore LoRA keywords with legacy fallback.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Express 5, LocalStorage, Firestore/Firebase.

**Spec:** [`docs/superpowers/specs/2026-10-01-lora-checkpoint-keyword-injection-design.md`](file:///home/yoichiro/projects/sumica/docs/superpowers/specs/2026-10-01-lora-checkpoint-keyword-injection-design.md)

## Global Constraints

- Comments must be written in English. No other languages, such as Japanese, will be used.
- Git commit messages must be written in English and using one line.
- Do not break existing API contracts: `/api/generate` and `/api/enhance` maintain their current interfaces; combined prompt is passed in the existing `prompt` field with `skipEnhance: true`.
- Zero runtime regression: if no keywords are set, the prompt composition must produce the exact enhanced prompt as before without extra or dangling commas.
- Test-driven development: every logical component must be verified with automated unit tests using Vitest.

---

### Task 1: Prompt Composition Pure Helper and Unit Tests

**Files:**
- Create: `client/src/utils/promptComposition.ts`
- Test: `client/src/utils/promptComposition.test.ts`

**Interfaces:**
- Consumes: None
- Produces: `composePositivePrompt(options: ComposePositivePromptOptions): string`
  ```typescript
  export interface ComposePositivePromptOptions {
    modelKeywords?: string;
    loraKeywords?: string[];
    enhancedPrompt: string;
  }
  ```

- [ ] **Step 1: Write the failing tests for `composePositivePrompt`**

Create `client/src/utils/promptComposition.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { composePositivePrompt } from './promptComposition';

describe('composePositivePrompt', () => {
  it('combines model keywords, lora keywords, and enhanced prompt in order', () => {
    const result = composePositivePrompt({
      modelKeywords: 'score_9, score_8_up, masterpiece',
      loraKeywords: ['costume_a, ribbon', 'hatsune miku'],
      enhancedPrompt: 'a girl smiling in the beach, sunny day',
    });
    expect(result).toBe(
      'score_9, score_8_up, masterpiece, costume_a, ribbon, hatsune miku, a girl smiling in the beach, sunny day'
    );
  });

  it('returns only enhanced prompt when model and lora keywords are empty', () => {
    const result = composePositivePrompt({
      modelKeywords: '',
      loraKeywords: ['', '   '],
      enhancedPrompt: 'a beautiful mountain',
    });
    expect(result).toBe('a beautiful mountain');
  });

  it('handles only model keywords and enhanced prompt', () => {
    const result = composePositivePrompt({
      modelKeywords: 'score_9, score_8_up',
      enhancedPrompt: 'cyberpunk street',
    });
    expect(result).toBe('score_9, score_8_up, cyberpunk street');
  });

  it('handles only lora keywords and enhanced prompt', () => {
    const result = composePositivePrompt({
      loraKeywords: ['flat color', 'retro style'],
      enhancedPrompt: 'cat on a roof',
    });
    expect(result).toBe('flat color, retro style, cat on a roof');
  });

  it('cleans up leading, trailing, and duplicate commas inside parts', () => {
    const result = composePositivePrompt({
      modelKeywords: ' , score_9, score_8_up , , ',
      loraKeywords: [', ribbon ,'],
      enhancedPrompt: 'sunset sky,',
    });
    expect(result).toBe('score_9, score_8_up, ribbon, sunset sky');
  });

  it('returns keywords when enhanced prompt is empty', () => {
    const result = composePositivePrompt({
      modelKeywords: 'score_9',
      loraKeywords: ['solo'],
      enhancedPrompt: '',
    });
    expect(result).toBe('score_9, solo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix client -- client/src/utils/promptComposition.test.ts`
Expected: FAIL with "Cannot find module './promptComposition'" or "composePositivePrompt is not defined".

- [ ] **Step 3: Implement `composePositivePrompt`**

Create `client/src/utils/promptComposition.ts`:
```typescript
export interface ComposePositivePromptOptions {
  modelKeywords?: string;
  loraKeywords?: string[];
  enhancedPrompt: string;
}

/**
 * Deterministically composes model keywords, LoRA trigger words, and the enhanced prompt
 * into a single comma-separated string, cleaning up redundant whitespace and commas.
 */
export function composePositivePrompt(options: ComposePositivePromptOptions): string {
  const parts: string[] = [];

  const cleanPart = (text?: string): string => {
    if (!text) return '';
    return text
      .trim()
      .replace(/^[\s,]+|[\s,]+$/g, '')
      .trim();
  };

  const modelPart = cleanPart(options.modelKeywords);
  if (modelPart) {
    parts.push(modelPart);
  }

  if (options.loraKeywords && Array.isArray(options.loraKeywords)) {
    for (const kw of options.loraKeywords) {
      const cleanKw = cleanPart(kw);
      if (cleanKw) {
        parts.push(cleanKw);
      }
    }
  }

  const enhancedPart = cleanPart(options.enhancedPrompt);
  if (enhancedPart) {
    parts.push(enhancedPart);
  }

  return parts.join(', ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix client -- client/src/utils/promptComposition.test.ts`
Expected: PASS with 6 passing tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/promptComposition.ts client/src/utils/promptComposition.test.ts
git commit -m "feat: add composePositivePrompt utility and unit tests"
```

---

### Task 2: Type Definitions and i18n Dictionary Entries

**Files:**
- Modify: `client/src/firebase.ts:87`
- Modify: `server/index.ts:84`
- Modify: `client/src/i18n/ja.ts`
- Modify: `client/src/i18n/en.ts`

**Interfaces:**
- Consumes: None
- Produces:
  - `loras?: { name: string; weight: number; keywords?: string }[]` on `GenerationParams` and `GenerationMetadata`
  - i18n keys under `controlPanel`:
    - `modelKeywordsLabel: string`
    - `modelKeywordsPlaceholder: string`
    - `loraKeywordsPlaceholder: string`

- [ ] **Step 1: Update LoRA types in `client/src/firebase.ts` and `server/index.ts`**

In `client/src/firebase.ts:87`, update:
```typescript
  loras?: { name: string; weight: number; keywords?: string }[];
```

In `server/index.ts:84`, update:
```typescript
  loras?: { name: string; weight: number; keywords?: string }[];
```

In `server/index.ts:575-579`, ensure `loraList` preserves `keywords`:
```typescript
  const loraList: { name: string; weight: number; keywords?: string }[] = (Array.isArray(loras) ? loras : [])
    .filter((l: { name?: string }) => l && l.name)
    .map((l: { name: string; weight?: number; keywords?: string }) => ({
      name: l.name,
      weight: typeof l.weight === 'number' ? l.weight : 0.8,
      ...(l.keywords ? { keywords: l.keywords } : {}),
    }));
```

- [ ] **Step 2: Add i18n dictionary entries to `ja.ts` and `en.ts`**

In `client/src/i18n/ja.ts`, inside `controlPanel`:
```typescript
    modelKeywordsLabel: 'モデルキーワード (トリガーワード)',
    modelKeywordsPlaceholder: '例: score_9, score_8_up, masterpiece',
    loraKeywordsPlaceholder: 'トリガーワード (例: costume_a, ribbon)',
```

In `client/src/i18n/en.ts`, inside `controlPanel`:
```typescript
    modelKeywordsLabel: 'Model keywords (Trigger words)',
    modelKeywordsPlaceholder: 'e.g. score_9, score_8_up, masterpiece',
    loraKeywordsPlaceholder: 'Trigger words (e.g. costume_a, ribbon)',
```

- [ ] **Step 3: Run existing tests to verify i18n test still passes**

Run: `npm run test:run --prefix client -- client/src/i18n/index.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/firebase.ts server/index.ts client/src/i18n/ja.ts client/src/i18n/en.ts
git commit -m "feat: add keyword types and i18n dictionary entries"
```

---

### Task 3: LoadIntoForm LoRA Keywords Restoration & Unit Tests

**Files:**
- Modify: `client/src/components/loadIntoFormState.ts`
- Modify: `client/src/components/loadIntoFormState.test.ts`

**Interfaces:**
- Consumes: `LoadableGenerationItem`
- Produces: `LoadIntoFormState.loras` or pure helper to resolve loaded LoRAs with `keywords`

- [ ] **Step 1: Write the failing tests in `client/src/components/loadIntoFormState.test.ts`**

Add tests for LoRA keyword restoration in `client/src/components/loadIntoFormState.test.ts`:
```typescript
import { resolveLoadedLoras } from './loadIntoFormState';

describe('resolveLoadedLoras', () => {
  it('preserves keywords when present on the loaded item', () => {
    const input = [
      { name: 'lora1', weight: 0.8, keywords: 'costume_a, ribbon' },
      { name: 'lora2', weight: 1.0, keywords: 'hatsune miku' },
    ];
    const resolved = resolveLoadedLoras(input, () => 'fallback');
    expect(resolved).toEqual([
      { name: 'lora1', weight: 0.8, keywords: 'costume_a, ribbon' },
      { name: 'lora2', weight: 1.0, keywords: 'hatsune miku' },
    ]);
  });

  it('falls back to getter when keywords are missing or undefined on legacy records', () => {
    const input = [
      { name: 'lora1', weight: 0.8 },
      { name: 'lora2', weight: 1.0, keywords: '' },
    ];
    const resolved = resolveLoadedLoras(input, (name) => (name === 'lora1' ? 'saved_lora1_tag' : ''));
    expect(resolved).toEqual([
      { name: 'lora1', weight: 0.8, keywords: 'saved_lora1_tag' },
      { name: 'lora2', weight: 1.0, keywords: '' },
    ]);
  });

  it('handles empty or undefined loras array', () => {
    expect(resolveLoadedLoras(undefined, () => 'test')).toEqual([]);
    expect(resolveLoadedLoras([], () => 'test')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run --prefix client -- client/src/components/loadIntoFormState.test.ts`
Expected: FAIL with "resolveLoadedLoras is not defined".

- [ ] **Step 3: Implement `resolveLoadedLoras` in `client/src/components/loadIntoFormState.ts`**

Add to `client/src/components/loadIntoFormState.ts`:
```typescript
export interface LoadedLora {
  name: string;
  weight: number;
  keywords?: string;
}

export interface FormLora {
  name: string;
  weight: number;
  keywords: string;
}

/**
 * Resolves LoRA items loaded from past history or recipes, preserving explicit keywords
 * when present and falling back to a storage lookup (e.g. localStorage) for legacy records.
 */
export function resolveLoadedLoras(
  loras: LoadedLora[] | undefined,
  getFallbackKeywords: (name: string) => string
): FormLora[] {
  if (!loras || !Array.isArray(loras)) return [];
  return loras.map((l) => ({
    name: l.name,
    weight: typeof l.weight === 'number' ? l.weight : 0.8,
    keywords: l.keywords !== undefined ? l.keywords : (getFallbackKeywords(l.name) || ''),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run --prefix client -- client/src/components/loadIntoFormState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/loadIntoFormState.ts client/src/components/loadIntoFormState.test.ts
git commit -m "feat: add resolveLoadedLoras helper with fallback support and tests"
```

---

### Task 4: ControlPanel UI for Model Keywords and LoRA Trigger Words

**Files:**
- Modify: `client/src/components/ControlPanel.tsx`

**Interfaces:**
- Consumes:
  - `modelKeywords: string`
  - `setModelKeywords: (val: string) => void`
  - `selectedLoras: { name: string; weight: number; keywords: string }[]`
  - `setLoraKeywords: (name: string, keywords: string) => void`
- Produces: Rendered input fields under model select and inside each LoRA card

- [ ] **Step 1: Extend `ControlPanelProps` in `client/src/components/ControlPanel.tsx`**

Update `ControlPanelProps` in `client/src/components/ControlPanel.tsx`:
```typescript
  modelKeywords: string;
  setModelKeywords: (v: string) => void;
  selectedLoras: { name: string; weight: number; keywords: string }[];
  setLoraKeywords: (name: string, keywords: string) => void;
```

- [ ] **Step 2: Add Model Keywords input below model select in `ControlPanel.tsx`**

Directly under the model `<select>` element (around line 430 in `ControlPanel.tsx`), insert:
```tsx
              {/* Checkpoint Keywords Input */}
              {p.selectedModel && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                    {t.controlPanel.modelKeywordsLabel}
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    value={p.modelKeywords}
                    onChange={(e) => p.setModelKeywords(e.target.value)}
                    placeholder={t.controlPanel.modelKeywordsPlaceholder}
                    disabled={p.loading}
                    style={{ borderRadius: '8px', fontSize: '12px', padding: '6px 10px' }}
                  />
                </div>
              )}
```

- [ ] **Step 3: Add LoRA Trigger Words input inside each LoRA card in `ControlPanel.tsx`**

Inside `p.selectedLoras.map((l) => ...)` (around line 880 in `ControlPanel.tsx`), add the keywords input as a second/third row:
```tsx
              {p.selectedLoras.map((l) => (
                <div key={l.name} style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--panel-bg)', border: '2px solid var(--panel-border)', borderRadius: '8px', padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ flex: 1, fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.name}>{l.name}</span>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.05"
                      value={l.weight}
                      onChange={(e) => p.setLoraWeight(l.name, parseFloat(e.target.value))}
                      disabled={p.loading}
                      style={{ width: '80px', accentColor: 'var(--pop-blue)' }}
                    />
                    <span style={{ fontSize: '11px', fontWeight: '800', color: 'var(--text-secondary)', width: '32px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.weight.toFixed(2)}</span>
                    <button
                      type="button"
                      onClick={() => p.removeLora(l.name)}
                      disabled={p.loading}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '2px 4px' }}
                      title="Remove LoRA"
                    >
                      ×
                    </button>
                  </div>
                  <input
                    type="text"
                    className="input-field"
                    value={l.keywords || ''}
                    onChange={(e) => p.setLoraKeywords(l.name, e.target.value)}
                    placeholder={t.controlPanel.loraKeywordsPlaceholder}
                    disabled={p.loading}
                    style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px' }}
                  />
                </div>
              ))}
```

- [ ] **Step 4: Verify typecheck passes or errors only on App.tsx missing props**

Run: `npm run lint --prefix client`
Expected: Check for syntax issues in `ControlPanel.tsx`.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ControlPanel.tsx
git commit -m "feat: add model keywords and lora trigger words input fields to ControlPanel"
```

---

### Task 5: App.tsx State, LocalStorage Sync, and Generation Pipeline Integration

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes:
  - `composePositivePrompt` from `client/src/utils/promptComposition`
  - `resolveLoadedLoras`, `FormLora` from `client/src/components/loadIntoFormState`
- Produces:
  - `modelKeywords` state + `handleModelKeywordsChange`
  - `selectedLoras: FormLora[]` state + `setLoraKeywords` + updated `addLora`
  - Integrated `handleGenerate` and `handleBatchGenerate` prompt assembly
  - Updated `loadIntoForm`

- [ ] **Step 1: Add state and handlers in `client/src/App.tsx`**

1. Import `composePositivePrompt` and `resolveLoadedLoras`:
```typescript
import { composePositivePrompt } from './utils/promptComposition';
import { resolveLoadedLoras, type FormLora } from './components/loadIntoFormState';
```

2. Update `selectedLoras` type and add `modelKeywords` state:
```typescript
  const [modelKeywords, setModelKeywords] = useState<string>('');
  const [selectedLoras, setSelectedLoras] = useState<FormLora[]>([]);
```

3. Update `handleModelKeywordsChange`:
```typescript
  const handleModelKeywordsChange = (val: string) => {
    setModelKeywords(val);
    if (selectedModel) {
      localStorage.setItem(`sumica.modelKeywords.${selectedModel}`, val);
    }
  };
```

4. Update `handleSelectModel` or model change logic:
Whenever `selectedModel` changes, load corresponding keywords:
```typescript
  const handleSelectModel = (model: string) => {
    setSelectedModel(model);
    if (model) {
      const saved = localStorage.getItem(`sumica.modelKeywords.${model}`) || '';
      setModelKeywords(saved);
    } else {
      setModelKeywords('');
    }
  };
```

5. Update `addLora` and add `setLoraKeywords`:
```typescript
  const addLora = (name: string) => {
    if (!name) return;
    const saved = localStorage.getItem(`sumica.loraKeywords.${name}`) || '';
    setSelectedLoras((prev) =>
      prev.some((l) => l.name === name) ? prev : [...prev, { name, weight: 0.8, keywords: saved }]
    );
  };

  const setLoraKeywords = (name: string, keywords: string) => {
    setSelectedLoras((prev) => prev.map((l) => (l.name === name ? { ...l, keywords } : l)));
    localStorage.setItem(`sumica.loraKeywords.${name}`, keywords);
  };
```

6. Pass new props to `ControlPanel`:
```tsx
  modelKeywords={modelKeywords}
  setModelKeywords={handleModelKeywordsChange}
  selectedLoras={selectedLoras}
  setLoraKeywords={setLoraKeywords}
  setSelectedModel={handleSelectModel}
```

- [ ] **Step 2: Update `loadIntoForm` in `client/src/App.tsx`**

In `loadIntoForm`:
```typescript
    const resolvedModel = resolveSelectedModel(item.model || '', s.archToSet, sdModels);
    setSelectedModel(resolvedModel);
    if (resolvedModel) {
      setModelKeywords(localStorage.getItem(`sumica.modelKeywords.${resolvedModel}`) || '');
    } else {
      setModelKeywords('');
    }
    setSelectedLoras(
      resolveLoadedLoras(item.loras, (name) => localStorage.getItem(`sumica.loraKeywords.${name}`) || '')
    );
```

- [ ] **Step 3: Update `handleGenerate` prompt composition**

In `handleGenerate`:
After `positive` is retrieved (either from `loadedPositive` or `enhanceOnce(prompt)`), compose the effective positive prompt:
```typescript
    const rawPositive = loadedPositive ? loadedPositive : (await enhanceOnce(prompt)).positive;
    const rawNegative = loadedPositive ? loadedNegative : (await enhanceOnce(prompt)).negative;
```
Note: Ensure `enhanceOnce(prompt)` is called once as before, and then:
```typescript
    const effectivePositive = composePositivePrompt({
      modelKeywords,
      loraKeywords: selectedLoras.map((l) => l.keywords),
      enhancedPrompt: positive,
    });
```
Pass `effectivePositive` into `generateImage(effectivePositive, negative, prompt, ...)`.

- [ ] **Step 4: Update `handleBatchGenerate` prompt composition**

In `handleBatchGenerate`:
For count and size combination jobs, compose `effectivePositive` once:
```typescript
    const effectivePositive = composePositivePrompt({
      modelKeywords,
      loraKeywords: selectedLoras.map((l) => l.keywords),
      enhancedPrompt: positive,
    });
```
For model cycling jobs where `job.model` is present:
```typescript
    const jobModel = job.model ?? selectedModel;
    const jobModelKeywords = job.model
      ? (localStorage.getItem(`sumica.modelKeywords.${job.model}`) || '')
      : modelKeywords;
    const jobPositive = composePositivePrompt({
      modelKeywords: jobModelKeywords,
      loraKeywords: selectedLoras.map((l) => l.keywords),
      enhancedPrompt: positive,
    });
```
Pass `jobPositive` into `generateImage(jobPositive, negative, prompt, ...)`.

- [ ] **Step 5: Run tests and lint to verify build and clean state**

Run: `npm run lint --prefix client`
Run: `npm run test:run --prefix client`
Expected: All tests pass, lint passes.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: integrate keyword injection into App state and generation pipeline"
```

---

### Task 6: Full Verification and Build Checks

**Files:**
- None (verification across entire workspace)

- [ ] **Step 1: Run server typecheck**

Run: `npm run typecheck --prefix server`
Expected: Exit code 0, no errors.

- [ ] **Step 2: Run client test suite**

Run: `npm run test:run --prefix client`
Expected: All Vitest suites pass.

- [ ] **Step 3: Run client lint**

Run: `npm run lint --prefix client`
Expected: 0 oxlint errors.

- [ ] **Step 4: Run client production build**

Run: `npm run build --prefix client`
Expected: `tsc -b && vite build` succeeds cleanly.
