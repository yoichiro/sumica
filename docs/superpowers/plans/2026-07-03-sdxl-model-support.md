# SDXL Model Support in UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop excluding SDXL checkpoints from Sumica and let the user generate with them, via a new "SD / SDXL" architecture toggle that scopes the model picker, resolution options, and "モデル切替" batch mode to one architecture at a time, plus an informational LoRA-compatibility badge.

**Architecture:** Two server tasks first (tag checkpoints and LoRAs with an architecture `type` instead of filtering/discarding it), then four client tasks in sequence (foundation types/state + model picker toggle, resolution reset effect, batch modal updates, LoRA badge), then a final end-to-end manual verification pass. Each task lands a fully-compiling, independently verifiable slice.

**Tech Stack:** Express 5 + TypeScript ESM (server, tsx, no build step); React 19 + TypeScript + Vite 8 (client); oxlint; no new npm dependencies.

## Global Constraints

- Modify `server/index.ts` and `client/src/App.tsx` only.
- This repo has **no automated test framework** (`npm test` is a placeholder that exits 1 at every level — see `CLAUDE.md`). Every task substitutes unit tests with: (a) `tsc` type-checking, (b) `oxlint` for the client, and (c) a live verification against the real running Stable Diffusion instance (already confirmed reachable at `http://127.0.0.1:7860` in this environment) via `curl` for server tasks, or `npm run dev` + browser for client tasks. Do not add a test runner (jest/vitest/etc.) as part of this work.
- `npm run typecheck --prefix server` must exit 0 after every server task.
- `cd client && npx tsc -b` and `npm run lint --prefix client` must exit 0 after every client task.
- Comments in English only.
- No new npm dependencies.
- Do not add a three-way toggle, Refiner-specific pipeline support, VAE selection, or Hires.fix parameter tuning — all explicitly out of scope per the spec.
- Do not push to the remote unless explicitly asked; commit locally at the end of each task.
- Spec: `docs/superpowers/specs/2026-07-03-sdxl-model-support-design.md`.
- ADR: `docs/arch/adr-0009-safetensors-header-sdxl-detection.md` (the `isSdxlCheckpoint()` helper this plan reuses).

---

### Task 1: Server — `/api/sd-models` returns architecture-tagged checkpoints

**Files:**
- Modify: `server/index.ts:525-552` (the `/api/sd-models` route)

**Interfaces:**
- Consumes: `isSdxlCheckpoint(filename: string | undefined, title: string): Promise<boolean>` (defined at `server/index.ts:278`, unchanged).
- Produces: `GET /api/sd-models` now returns `{ models: { title: string; type: 'sd15' | 'sdxl' }[]; current: string | null }` instead of `{ models: string[]; current: string | null }`. No checkpoints are excluded anymore.

- [ ] **Step 1: Replace the route body**

Current content at `server/index.ts:525-552`:

```ts
// 6. List Stable Diffusion checkpoints and the currently active one (for the model picker).
// Always responds 200; on failure returns an empty list so the client can disable the selector.
app.get('/api/sd-models', async (_req: Request, res: Response) => {
  try {
    const [listRes, optionsRes] = await Promise.all([
      axios.get(`${stableDiffusionUrl}/sdapi/v1/sd-models`, { timeout: 5000 }),
      axios.get(`${stableDiffusionUrl}/sdapi/v1/options`, { timeout: 5000 }),
    ]);
    // Exclude Stable Diffusion XL checkpoints, detected by reading each .safetensors header.
    const rawModels: Array<{ title?: string; filename?: string }> = Array.isArray(listRes.data) ? listRes.data : [];
    const checkedModels = await Promise.all(
      rawModels
        .filter((m): m is { title: string; filename?: string } => Boolean(m.title))
        .map(async (m) => ({ title: m.title, isXl: await isSdxlCheckpoint(m.filename, m.title) }))
    );
    const models = checkedModels.filter((m) => !m.isXl).map((m) => m.title);
    const activeCheckpoint = optionsRes.data?.sd_model_checkpoint ?? null;
    // If the active checkpoint was filtered out (e.g. an XL model), fall back to the
    // first valid model so the picker never points at a hidden entry.
    const current = activeCheckpoint && models.includes(activeCheckpoint)
      ? activeCheckpoint
      : models[0] ?? null;
    res.json({ models, current });
  } catch (error) {
    console.error('Failed to fetch SD models:', (error as Error).message);
    res.json({ models: [], current: null });
  }
});
```

Replace it with:

```ts
// 6. List Stable Diffusion checkpoints, tagged with their architecture, and the
// currently active one (for the model picker). Always responds 200; on failure
// returns an empty list so the client can disable the selector. No checkpoints
// are excluded — the client scopes the picker to one architecture via its own
// "SD / SDXL" toggle instead.
app.get('/api/sd-models', async (_req: Request, res: Response) => {
  try {
    const [listRes, optionsRes] = await Promise.all([
      axios.get(`${stableDiffusionUrl}/sdapi/v1/sd-models`, { timeout: 5000 }),
      axios.get(`${stableDiffusionUrl}/sdapi/v1/options`, { timeout: 5000 }),
    ]);
    const rawModels: Array<{ title?: string; filename?: string }> = Array.isArray(listRes.data) ? listRes.data : [];
    const models = await Promise.all(
      rawModels
        .filter((m): m is { title: string; filename?: string } => Boolean(m.title))
        .map(async (m) => ({
          title: m.title,
          type: (await isSdxlCheckpoint(m.filename, m.title)) ? 'sdxl' as const : 'sd15' as const,
        }))
    );
    const activeCheckpoint = optionsRes.data?.sd_model_checkpoint ?? null;
    const current = activeCheckpoint && models.some((m) => m.title === activeCheckpoint)
      ? activeCheckpoint
      : models[0]?.title ?? null;
    res.json({ models, current });
  } catch (error) {
    console.error('Failed to fetch SD models:', (error as Error).message);
    res.json({ models: [], current: null });
  }
});
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck --prefix /home/yoichiro/projects/sumica/server`
Expected: exits 0, no output.

- [ ] **Step 3: Live verification against the running SD instance**

Start the server in the background and query it:

```bash
cd /home/yoichiro/projects/sumica/server && npx tsx index.ts > /tmp/sdxl-plan-server.log 2>&1 &
sleep 2
curl -s http://localhost:5000/api/sd-models | node -e "
let data='';process.stdin.on('data',d=>data+=d);process.stdin.on('end',()=>{
  const j = JSON.parse(data);
  console.log('total:', j.models.length);
  console.log('sample:', j.models.slice(0,3));
  console.log('current:', j.current);
  console.log('has sdxl entries:', j.models.some(m => m.type === 'sdxl'));
  console.log('has sd15 entries:', j.models.some(m => m.type === 'sd15'));
});
"
kill %1 2>/dev/null
```

Expected: `total` matches (or exceeds) the count from the previous session's ADR-9 verification; every entry in `sample` has both a `title` (string) and a `type` (`'sd15'` or `'sdxl'`); `has sdxl entries` is `true` if any SDXL checkpoints are installed (this environment has several — `sd_xl_base_1.0.safetensors` etc.); `current` is a non-null string matching whatever checkpoint SD currently has loaded. If port 5000 is already in use by the user's own `npm run dev`, skip starting a new instance and just run the `curl` line — the file change is picked up automatically by `tsx watch`.

- [ ] **Step 4: Commit**

```bash
cd /home/yoichiro/projects/sumica
git add server/index.ts
git commit -m "feat: tag SD checkpoints with architecture instead of excluding SDXL"
```

---

### Task 2: Server — `/api/sd-loras` returns architecture-tagged LoRAs

**Files:**
- Modify: `server/index.ts:587-599` (the `/api/sd-loras` route)
- Add: new `classifyLoraArchitecture()` helper, placed directly above the route

**Interfaces:**
- Consumes: nothing new (uses the `metadata` field already present in SD's `/sdapi/v1/loras` response, which the current code discards).
- Produces: `classifyLoraArchitecture(metadata: Record<string, unknown> | undefined): 'sd15' | 'sdxl' | 'unknown'`. `GET /api/sd-loras` now returns `{ loras: { name: string; type: 'sd15' | 'sdxl' | 'unknown' }[] }` instead of `{ loras: string[] }`.

- [ ] **Step 1: Add the classifier helper and update the route**

Current content at `server/index.ts:587-599`:

```ts
// 7b. List Stable Diffusion LoRAs (for the LoRA picker). Applied via <lora:name:weight> in the prompt.
app.get('/api/sd-loras', async (_req: Request, res: Response) => {
  try {
    const listRes = await axios.get(`${stableDiffusionUrl}/sdapi/v1/loras`, { timeout: 5000 });
    const loras = Array.isArray(listRes.data)
      ? listRes.data.map((l: { name?: string }) => l.name).filter((n): n is string => Boolean(n))
      : [];
    res.json({ loras });
  } catch (error) {
    console.error('Failed to fetch SD LoRAs:', (error as Error).message);
    res.json({ loras: [] });
  }
});
```

Replace it with:

```ts
// Classify a LoRA's base architecture from the training metadata AUTOMATIC1111/Forge
// already parses and returns via /sdapi/v1/loras. Prefers the modelspec.sai_model_spec
// convention's `modelspec.architecture` field; falls back to the looser `ss_base_model_version`
// field some older trainers write instead. Returns 'unknown' when neither is present —
// true for roughly 40% of LoRAs in practice (older or non-modelspec-aware trainers),
// so callers must not treat 'unknown' as "incompatible".
function classifyLoraArchitecture(metadata: Record<string, unknown> | undefined): 'sd15' | 'sdxl' | 'unknown' {
  const arch = String(metadata?.['modelspec.architecture'] ?? metadata?.['ss_base_model_version'] ?? '').toLowerCase();
  if (arch.includes('xl')) return 'sdxl';
  if (arch.includes('stable-diffusion-v1') || arch.startsWith('sd_v1') || arch.startsWith('sd_1')) return 'sd15';
  return 'unknown';
}

// 7b. List Stable Diffusion LoRAs, tagged with their architecture (for the LoRA picker).
// Applied via <lora:name:weight> in the prompt.
app.get('/api/sd-loras', async (_req: Request, res: Response) => {
  try {
    const listRes = await axios.get(`${stableDiffusionUrl}/sdapi/v1/loras`, { timeout: 5000 });
    const loras = Array.isArray(listRes.data)
      ? listRes.data
          .filter((l: { name?: string }): l is { name: string; metadata?: Record<string, unknown> } => Boolean(l.name))
          .map((l) => ({ name: l.name, type: classifyLoraArchitecture(l.metadata) }))
      : [];
    res.json({ loras });
  } catch (error) {
    console.error('Failed to fetch SD LoRAs:', (error as Error).message);
    res.json({ loras: [] });
  }
});
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck --prefix /home/yoichiro/projects/sumica/server`
Expected: exits 0, no output.

- [ ] **Step 3: Live verification against the running SD instance**

```bash
cd /home/yoichiro/projects/sumica/server && npx tsx index.ts > /tmp/sdxl-plan-server2.log 2>&1 &
sleep 2
curl -s http://localhost:5000/api/sd-loras | node -e "
let data='';process.stdin.on('data',d=>data+=d);process.stdin.on('end',()=>{
  const j = JSON.parse(data);
  console.log('total:', j.loras.length);
  const counts = j.loras.reduce((acc, l) => { acc[l.type] = (acc[l.type]||0)+1; return acc; }, {});
  console.log('counts by type:', counts);
  console.log('sample:', j.loras.slice(0,5));
});
"
kill %1 2>/dev/null
```

Expected: `total` matches the LoRA count from SD (21 in this environment as of the design investigation, may differ if the user added/removed files). `counts by type` should show a mix of `sd15`, `sdxl`, and `unknown` — per the design investigation, expect roughly a third to be `unknown` (no architecture metadata at all). No entry should ever be `undefined` or crash the classifier.

- [ ] **Step 4: Commit**

```bash
cd /home/yoichiro/projects/sumica
git add server/index.ts
git commit -m "feat: classify LoRA architecture from SD metadata"
```

---

### Task 3: Client — foundation types/state + model picker toggle

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `/api/sd-models` response shape from Task 1 (`{ models: { title, type }[]; current }`).
- Produces: `SdModel`/`SdLora` types; `SIZE_OPTIONS_BY_TYPE` constant; `modelTypeFilter` state (`'sd15' | 'sdxl'`, default `'sd15'`); `sdModels: SdModel[]` state (was `string[]`). These are consumed by Tasks 4–6.

- [ ] **Step 1: Add types and replace the `SIZE_OPTIONS` constant**

Current content at `client/src/App.tsx:190-192`:

```ts
const SIZE_OPTIONS = [512, 768, 1024];
// Defensive cap on the width×height cross product (3×3 = 9 today, room to grow).
const MAX_SIZE_COMBINATIONS = 16;
```

Replace with:

```ts
type SdModel = { title: string; type: 'sd15' | 'sdxl' };
type SdLora = { name: string; type: 'sd15' | 'sdxl' | 'unknown' };

// Resolution options differ by architecture: SDXL was trained around 1024×1024
// and looks poor well below it, while SD1.5's native range is lower.
const SIZE_OPTIONS_BY_TYPE: Record<'sd15' | 'sdxl', number[]> = {
  sd15: [512, 768, 1024],
  sdxl: [1024, 1152, 1280],
};
// Defensive cap on the width×height cross product (3×3 = 9 today, room to grow).
const MAX_SIZE_COMBINATIONS = 16;
```

- [ ] **Step 2: Change `sdModels`/`sdLoras` state types and add `modelTypeFilter`**

Current content at `client/src/App.tsx:243-249`:

```ts
  const [sdModels, setSdModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [sdSamplers, setSdSamplers] = useState<string[]>([]);
  const [selectedSampler, setSelectedSampler] = useState('');
  const [sdSchedulers, setSdSchedulers] = useState<string[]>([]);
  const [selectedScheduler, setSelectedScheduler] = useState('');
  const [sdLoras, setSdLoras] = useState<string[]>([]);
```

Replace with:

```ts
  const [sdModels, setSdModels] = useState<SdModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [sdSamplers, setSdSamplers] = useState<string[]>([]);
  const [selectedSampler, setSelectedSampler] = useState('');
  const [sdSchedulers, setSdSchedulers] = useState<string[]>([]);
  const [selectedScheduler, setSelectedScheduler] = useState('');
  const [sdLoras, setSdLoras] = useState<SdLora[]>([]);
  // Which architecture the form is currently scoped to. Drives the model picker
  // filter, the width/height option sets, and which models "モデル切替" batch
  // mode cycles through. Initializes from SD's actual active checkpoint the
  // first time fetchSdModels() succeeds (see modelTypeInitialized below).
  const [modelTypeFilter, setModelTypeFilter] = useState<'sd15' | 'sdxl'>('sd15');
  const modelTypeInitialized = useRef(false);
```

- [ ] **Step 3: Update `fetchSdModels()`**

Current content at `client/src/App.tsx:682-694`:

```ts
  const fetchSdModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/sd-models`);
      if (res.ok) {
        const data = await res.json();
        const models: string[] = Array.isArray(data.models) ? data.models : [];
        setSdModels(models);
        setSelectedModel((prev) => prev || data.current || '');
      }
    } catch (error) {
      console.error('Failed to fetch SD models:', error);
    }
  };
```

Replace with:

```ts
  const fetchSdModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/sd-models`);
      if (res.ok) {
        const data = await res.json();
        const models: SdModel[] = Array.isArray(data.models) ? data.models : [];
        setSdModels(models);
        setSelectedModel((prev) => prev || data.current || '');
        if (!modelTypeInitialized.current && data.current) {
          const currentType = models.find((m) => m.title === data.current)?.type;
          if (currentType) {
            setModelTypeFilter(currentType);
            modelTypeInitialized.current = true;
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch SD models:', error);
    }
  };
```

- [ ] **Step 4: Add the toggle and filter the model picker**

Current content at `client/src/App.tsx:1313-1333`:

```tsx
                {/* Stable Diffusion Model Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>モデル (Stable Diffusion)</label>
                  {sdModels.length > 0 ? (
                    <select
                      className="input-field"
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      disabled={loading}
                      style={{ borderRadius: '8px' }}
                    >
                      {sdModels.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
                      <option>モデル一覧を取得できません（SD未接続）</option>
                    </select>
                  )}
                </div>
```

Replace with:

```tsx
                {/* Stable Diffusion Model Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>モデル (Stable Diffusion)</label>
                  <div style={{ display: 'flex', gap: '6px', background: 'var(--panel-bg-sunk)', borderRadius: '10px', padding: '3px' }}>
                    {(['sd15', 'sdxl'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setModelTypeFilter(t)}
                        disabled={loading}
                        style={{
                          flex: 1,
                          padding: '6px',
                          borderRadius: '7px',
                          border: 'none',
                          cursor: loading ? 'default' : 'pointer',
                          fontWeight: 800,
                          fontSize: '12px',
                          background: modelTypeFilter === t ? 'var(--pop-blue)' : 'transparent',
                          color: modelTypeFilter === t ? '#fff' : 'var(--text-secondary)',
                        }}
                      >
                        {t === 'sd15' ? 'SD' : 'SDXL'}
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const modelsInScope = sdModels.filter((m) => m.type === modelTypeFilter);
                    return modelsInScope.length > 0 ? (
                      <select
                        className="input-field"
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        disabled={loading}
                        style={{ borderRadius: '8px' }}
                      >
                        {modelsInScope.map((m) => (
                          <option key={m.title} value={m.title}>{m.title}</option>
                        ))}
                      </select>
                    ) : (
                      <select className="input-field" disabled style={{ borderRadius: '8px', color: 'var(--text-muted)' }}>
                        <option>{sdModels.length === 0 ? 'モデル一覧を取得できません（SD未接続）' : modelTypeFilter === 'sdxl' ? 'SDXLモデルが見つかりません' : 'SD1.5モデルが見つかりません'}</option>
                      </select>
                    );
                  })()}
                </div>
```

- [ ] **Step 5: Adapt remaining `sdModels`/`sdLoras` consumers to the new shape**

Changing `sdModels`/`sdLoras` from `string[]` to `SdModel[]`/`SdLora[]` (Step 2) breaks every other spot in the file that still treats their entries as plain strings — the LoRA dropdown at `App.tsx:1553-1568` and the batch modal's model list at `App.tsx:2678-2740` both do this and will fail `tsc -b` otherwise. Fix them here so the build stays green; the *functional* filtering/badging behavior for these two areas is still deferred to Tasks 5–6 — this step is a pure shape adaptation, not a behavior change.

In the LoRA dropdown (`App.tsx:1553-1568`), change:
```tsx
                      {sdLoras.filter((n) => !selectedLoras.some((l) => l.name === n)).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
```
to:
```tsx
                      {sdLoras.filter((l) => !selectedLoras.some((sl) => sl.name === l.name)).map((l) => (
                        <option key={l.name} value={l.name}>{l.name}</option>
                      ))}
```

In the batch modal's model-cycling list (`App.tsx:2704-2733`), change every bare `m` (a `string`) to `m.title`, and the `key`/`onClick`/`.has(m)` calls to use `m.title`:
```tsx
                      {sdModels.map((m, i) => {
                        const isSelected = selectedBatchModels.has(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => toggleBatchModel(m)}
```
to:
```tsx
                      {sdModels.map((m, i) => {
                        const isSelected = selectedBatchModels.has(m.title);
                        return (
                          <button
                            key={m.title}
                            type="button"
                            onClick={() => toggleBatchModel(m.title)}
```
and further down in the same block, change:
```tsx
                            <span style={{ wordBreak: 'break-all', flex: 1 }}>{m}</span>
```
to:
```tsx
                            <span style={{ wordBreak: 'break-all', flex: 1 }}>{m.title}</span>
```
and at the submit handler (`App.tsx:2773`), change:
```tsx
                      : sdModels.filter(m => selectedBatchModels.has(m)).map(m => ({ width, height, model: m }));
```
to:
```tsx
                      : sdModels.filter(m => selectedBatchModels.has(m.title)).map(m => ({ width, height, model: m.title }));
```
and the "全選択" button (`App.tsx:2688`), change:
```tsx
                        onClick={() => setSelectedBatchModels(new Set(sdModels))}
```
to:
```tsx
                        onClick={() => setSelectedBatchModels(new Set(sdModels.map((m) => m.title)))}
```
and `openBatchModal()` (`App.tsx:523-526`), change:
```ts
  const openBatchModal = () => {
    setSelectedBatchModels(new Set(sdModels));
    setShowBatchModal(true);
  };
```
to:
```ts
  const openBatchModal = () => {
    setSelectedBatchModels(new Set(sdModels.map((m) => m.title)));
    setShowBatchModal(true);
  };
```

This makes every existing consumer of `sdModels`/`sdLoras` compile against the new shape without yet adding the architecture-scoping filter to the batch modal (that's Task 5) or the LoRA badge (Task 6) — the batch modal still offers every model regardless of `modelTypeFilter` for now, exactly matching its pre-this-plan behavior.

- [ ] **Step 6: Type-check and lint**

```bash
cd /home/yoichiro/projects/sumica/client && npx tsc -b
npm run lint --prefix /home/yoichiro/projects/sumica/client
```

Expected: both exit 0.

- [ ] **Step 7: Manual verification**

Run `npm run dev` from the repo root (or confirm it's already running) and check in a browser:

1. Advanced settings shows a new "SD / SDXL" toggle above the model dropdown, defaulting to whichever matches SD's actually-loaded checkpoint.
2. Clicking "SDXL" narrows the model dropdown to only SDXL checkpoints (by name — e.g. `sd_xl_base_1.0.safetensors`, anything with "xl" in it). Clicking "SD" shows everything else.
3. If a category has zero models, the dropdown shows the "◯◯モデルが見つかりません" placeholder instead of a normal option list.
4. "まとめて生成" → モデル切替 still lists every model regardless of the toggle (unfiltered — expected for now, fixed in Task 5) and still completes a batch successfully.

If SD isn't reachable in this environment, skip this step and note it explicitly rather than claiming it was verified.

- [ ] **Step 8: Commit**

```bash
cd /home/yoichiro/projects/sumica
git add client/src/App.tsx
git commit -m "feat: add SD/SDXL model type toggle to the model picker"
```

---

### Task 4: Client — resolution reset effect

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `modelTypeFilter` state, `SIZE_OPTIONS_BY_TYPE` constant, `sdModels: SdModel[]` (all from Task 3); `width`/`height`/`selectedWidths`/`selectedHeights` state (pre-existing).
- Produces: a `useEffect` keyed on `modelTypeFilter` that keeps `selectedModel`, `width`, `height`, `selectedWidths`, `selectedHeights` valid for the active architecture. No new exports for later tasks.

- [ ] **Step 1: Add the effect**

Place this new effect directly after the existing reconnect effect at `client/src/App.tsx:560-568` (`useEffect(() => { if (health?.stableDiffusion.connected) { ... } }, [health?.stableDiffusion.connected]);`):

```ts
  // Re-validate everything that depends on the active architecture whenever the
  // toggle flips. sdModels is intentionally not a dependency here — this should
  // only run on an explicit toggle flip, not every time the model list happens
  // to refresh with the same toggle value still selected.
  useEffect(() => {
    const options = SIZE_OPTIONS_BY_TYPE[modelTypeFilter];
    const fallback = modelTypeFilter === 'sdxl' ? 1024 : 512;

    setSelectedModel((prev) => (sdModels.some((m) => m.type === modelTypeFilter && m.title === prev) ? prev : (sdModels.find((m) => m.type === modelTypeFilter)?.title ?? '')));
    setWidth((prev) => (options.includes(prev) ? prev : fallback));
    setHeight((prev) => (options.includes(prev) ? prev : fallback));
    setSelectedWidths((prev) => { const kept = prev.filter((w) => options.includes(w)); return kept.length ? kept : [...options]; });
    setSelectedHeights((prev) => { const kept = prev.filter((h) => options.includes(h)); return kept.length ? kept : [...options]; });
  }, [modelTypeFilter]);
```

Note: oxlint's `react` plugin does flag this as an `exhaustive-deps` **warning** (confirmed via a baseline `npm run lint --prefix client` run before this task started, which already shows 4 pre-existing warnings of the same kind for other effects with intentionally-partial dependency arrays, e.g. the reconnect effect at `App.tsx:560-568`). Warnings do not fail `npm run lint`'s exit code — only errors do. No `eslint-disable` comment is needed; none of the 4 pre-existing warnings use one either. A 5th warning appearing for this new effect is expected and acceptable.

- [ ] **Step 2: Update the width/height `<select>` option lists**

Current content at `client/src/App.tsx:1379-1432` (the "Size Select with Swap Button" block) hardcodes three `<option>`s in both the width and height `<select>`s:

```tsx
                    <select 
                      className="input-field" 
                      value={width} 
                      onChange={(e) => setWidth(parseInt(e.target.value))}
                      disabled={loading}
                      style={{ borderRadius: '8px' }}
                    >
                      <option value="512">512 px</option>
                      <option value="768">768 px</option>
                      <option value="1024">1024 px</option>
                    </select>
```

and similarly for height. Replace both `<option>` blocks (keep everything else — the surrounding `<select>` props, the swap button between them — unchanged) with a `.map()` over the toggle-driven option list:

```tsx
                      {SIZE_OPTIONS_BY_TYPE[modelTypeFilter].map((size) => (
                        <option key={size} value={size}>{size} px</option>
                      ))}
```

Apply this to both the width `<select>` (around line 1390-1392) and the height `<select>` (around line 1427-1429).

- [ ] **Step 3: Type-check and lint**

```bash
cd /home/yoichiro/projects/sumica/client && npx tsc -b
npm run lint --prefix /home/yoichiro/projects/sumica/client
```

Expected: `tsc -b` exits 0. Lint exits 0 — a 5th `react-hooks(exhaustive-deps)` warning for the new effect (Step 1) is expected and acceptable, joining the 4 pre-existing warnings already present at baseline (`App.tsx:545`, `562`, `580`, `657`); warnings do not fail the lint command's exit code, only errors do.

- [ ] **Step 4: Manual verification**

Run `npm run dev` and check in a browser:

1. With the toggle on "SD" and width/height at their defaults (512×512), flip to "SDXL" — width/height both jump to 1024, and the dropdown options become `1024 / 1152 / 1280`.
2. Manually set width to 1152 while on "SDXL", then flip to "SD" — width resets to 512 (1152 isn't a valid SD option), height behaves the same way independently.
3. Set width to 1024 while on "SD" (a value valid in both option sets), flip to "SDXL" — width stays at 1024 (no unnecessary reset).
4. Open "まとめて生成" → サイズの組み合わせ while toggle is "SDXL" — the size toggle buttons for both 横幅/縦幅 already show `1024/1152/1280` (this is Task 5's filtering of the batch modal itself, but the underlying `selectedWidths`/`selectedHeights` state from this task's effect should already contain valid values — verify no crash / empty state here even before Task 5 lands).

If SD isn't reachable, skip and note it explicitly.

- [ ] **Step 5: Commit**

```bash
cd /home/yoichiro/projects/sumica
git add client/src/App.tsx
git commit -m "feat: scope resolution options to the active model architecture"
```

---

### Task 5: Client — batch modal scoping

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `modelTypeFilter`, `SIZE_OPTIONS_BY_TYPE`, `sdModels: SdModel[]` (Task 3); the resolution-reset effect (Task 4) guarantees `selectedWidths`/`selectedHeights` are always valid for `modelTypeFilter`.
- Produces: no new state; "サイズの組み合わせ" and "モデル切替" batch modes are now scoped to the active architecture.

- [ ] **Step 1: Scope the "サイズの組み合わせ" size buttons**

Current content at `client/src/App.tsx:2641-2665` iterates the old flat `SIZE_OPTIONS` constant:

```tsx
                        {SIZE_OPTIONS.map(size => {
```

Change to:

```tsx
                        {SIZE_OPTIONS_BY_TYPE[modelTypeFilter].map(size => {
```

- [ ] **Step 2: Scope the "モデル切替" candidate list**

Current content at `client/src/App.tsx:2678-2740` (the モデル切替 panel body) reads `sdModels` directly in four places: the `{selectedBatchModels.size} / {sdModels.length}モデル` counter, the "全選択" button, the checkbox list `.map()`, and the empty-state check `sdModels.length > 0`.

Introduce a scoped list at the top of that block. Current:

```tsx
                {sdModels.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '40px', fontWeight: 800, color: 'var(--pop-blue)', lineHeight: 1 }}>
                        {selectedBatchModels.size}<span style={{ fontSize: '16px', color: 'var(--text-secondary)', marginLeft: '4px' }}>/ {sdModels.length}モデル</span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedBatchModels(new Set(sdModels.map((m) => m.title)))}
```

Replace with (introducing `modelsInBatchScope` and using it everywhere the block previously used `sdModels`):

```tsx
                {(() => { const modelsInBatchScope = sdModels.filter((m) => m.type === modelTypeFilter); return modelsInBatchScope.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '40px', fontWeight: 800, color: 'var(--pop-blue)', lineHeight: 1 }}>
                        {selectedBatchModels.size}<span style={{ fontSize: '16px', color: 'var(--text-secondary)', marginLeft: '4px' }}>/ {modelsInBatchScope.length}モデル</span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedBatchModels(new Set(modelsInBatchScope.map((m) => m.title)))}
```

Continue the same substitution — from Task 3's edit, the checkbox list was `{sdModels.map((m, i) => {`; change it to `{modelsInBatchScope.map((m, i) => {`.

Then close the new IIFE where the block previously ended. Current end of the block (from the earlier read, `App.tsx:2736-2740`):

```tsx
                ) : (
                  <div style={{ fontSize: '13px', fontWeight: 700, textAlign: 'center', color: 'var(--pop-orange)', background: 'var(--warning-bg)', borderRadius: '10px', padding: '14px' }}>
                    モデルが取得できていません。Stable Diffusion が起動しているか確認してください。
                  </div>
                )}
```

Replace the empty-state message and close the IIFE:

```tsx
                ) : (
                  <div style={{ fontSize: '13px', fontWeight: 700, textAlign: 'center', color: 'var(--pop-orange)', background: 'var(--warning-bg)', borderRadius: '10px', padding: '14px' }}>
                    {sdModels.length === 0 ? 'モデルが取得できていません。Stable Diffusion が起動しているか確認してください。' : `${modelTypeFilter === 'sdxl' ? 'SDXL' : 'SD'}モデルが見つかりません。`}
                  </div>
                ); })()}
```

Also update the disabled-condition for the submit button and the job-builder at the bottom of the modal (`App.tsx:2755-2773`), which still reference bare `sdModels`:

Current:
```tsx
                disabled={
                  (batchMode === 'size' && (selectedWidths.length === 0 || selectedHeights.length === 0 || selectedWidths.length * selectedHeights.length > MAX_SIZE_COMBINATIONS)) ||
                  (batchMode === 'model' && (sdModels.length === 0 || selectedBatchModels.size === 0))
                }
```

Change to:

```tsx
                disabled={
                  (batchMode === 'size' && (selectedWidths.length === 0 || selectedHeights.length === 0 || selectedWidths.length * selectedHeights.length > MAX_SIZE_COMBINATIONS)) ||
                  (batchMode === 'model' && (sdModels.filter((m) => m.type === modelTypeFilter).length === 0 || selectedBatchModels.size === 0))
                }
```

The job-builder line (from Task 3's edit) already reads `sdModels.filter(m => selectedBatchModels.has(m.title)).map(m => ({ width, height, model: m.title }))` — this is correct as-is, since `selectedBatchModels` itself is now always seeded from the architecture-scoped list (`openBatchModal` from Task 3, and the "全選択" button from this step), so it can never contain a title from the other architecture. No further change needed there.

- [ ] **Step 3: Type-check and lint**

```bash
cd /home/yoichiro/projects/sumica/client && npx tsc -b
npm run lint --prefix /home/yoichiro/projects/sumica/client
```

Expected: both exit 0.

- [ ] **Step 4: Manual verification**

Run `npm run dev` and check in a browser:

1. Toggle to "SDXL", open "まとめて生成" → サイズの組み合わせ — size buttons show `1024/1152/1280` only.
2. Toggle to "SDXL", open "まとめて生成" → モデル切替 — checkbox list shows only SDXL checkpoints; "全選択"/"全解除" only affect that list; the counter reads "N / (SDXL count)モデル".
3. Toggle to "SD", reopen the modal — モデル切替 now shows only SD checkpoints instead.
4. Run a small モデル切替 batch (2-3 models checked) on each toggle state — every image in the batch comes back at the resolution the form was set to, correctly sized for the checked models' architecture.
5. If an architecture has zero installed models, toggling to it and opening モデル切替 shows the "◯◯モデルが見つかりません。" message instead of an empty list with the button impossible to enable.

If SD isn't reachable, skip and note it explicitly.

- [ ] **Step 5: Commit**

```bash
cd /home/yoichiro/projects/sumica
git add client/src/App.tsx
git commit -m "feat: scope batch generation modes to the active model architecture"
```

---

### Task 6: Client — LoRA dropdown architecture badge

**Files:**
- Modify: `client/src/App.tsx:1553-1568` (or wherever the LoRA dropdown now lives after Tasks 3–5's edits — the block introduced by Task 3 Step 5's shape adaptation)

**Interfaces:**
- Consumes: `sdLoras: SdLora[]` (Task 3), `modelTypeFilter` (Task 3).
- Produces: no new state; LoRA dropdown options gain a "⚠SDXL用"/"⚠SD1.5用" suffix when confidently mismatched.

- [ ] **Step 1: Add the badge**

Current content (after Task 3's shape-adaptation edit):

```tsx
                      {sdLoras.filter((l) => !selectedLoras.some((sl) => sl.name === l.name)).map((l) => (
                        <option key={l.name} value={l.name}>{l.name}</option>
                      ))}
```

Replace with:

```tsx
                      {sdLoras.filter((l) => !selectedLoras.some((sl) => sl.name === l.name)).map((l) => {
                        const mismatched = l.type !== 'unknown' && l.type !== modelTypeFilter;
                        return (
                          <option key={l.name} value={l.name}>
                            {l.name}{mismatched ? ` ⚠${l.type === 'sdxl' ? 'SDXL' : 'SD1.5'}用` : ''}
                          </option>
                        );
                      })}
```

- [ ] **Step 2: Type-check and lint**

```bash
cd /home/yoichiro/projects/sumica/client && npx tsc -b
npm run lint --prefix /home/yoichiro/projects/sumica/client
```

Expected: both exit 0.

- [ ] **Step 3: Manual verification**

Run `npm run dev` and check in a browser:

1. Toggle to "SD", open the "＋LoRAを追加…" dropdown — any LoRA whose metadata confidently says SDXL shows a "⚠SDXL用" suffix; LoRAs with no architecture metadata at all show no suffix.
2. Toggle to "SDXL" — the same LoRA's suffix disappears, and any confidently-SD1.5 LoRA now shows "⚠SD1.5用" instead.
3. Adding a mismatched (badged) LoRA still works exactly as before — it's informational only, not blocked.

If SD isn't reachable, skip and note it explicitly.

- [ ] **Step 4: Commit**

```bash
cd /home/yoichiro/projects/sumica
git add client/src/App.tsx
git commit -m "feat: badge LoRA dropdown entries with a mismatched architecture"
```

---

### Task 7: Full end-to-end verification pass

**Files:** none (verification only)

**Interfaces:** none — this task exercises everything from Tasks 1–6 together.

- [ ] **Step 1: Full type-check and lint pass**

```bash
npm run typecheck --prefix /home/yoichiro/projects/sumica/server
cd /home/yoichiro/projects/sumica/client && npx tsc -b
npm run lint --prefix /home/yoichiro/projects/sumica/client
```

Expected: all three exit 0.

- [ ] **Step 2: Run the spec's full manual verification checklist**

With `npm run dev` running and SD/LM Studio reachable, work through every item from the spec's "テスト・検証" section (`docs/superpowers/specs/2026-07-03-sdxl-model-support-design.md`):

1. Page load with SD connected → toggle defaults to match the actually-loaded checkpoint's architecture.
2. Toggle to "SDXL" → model list shows only SDXL checkpoints; width/height options become `1024/1152/1280`; an out-of-range previous value resets to 1024.
3. Toggle back to "SD" → same checks in reverse, default 512.
4. Generate a single image with an SDXL checkpoint selected → succeeds, produces a 1024×1024 (or whatever size chosen) image.
5. "まとめて生成" → モデル切替 with toggle on "SDXL" → only SDXL checkpoints checkable; batch completes with correctly-sized images.
6. "まとめて生成" → サイズの組み合わせ with toggle on "SDXL" → size buttons show `1024/1152/1280`.
7. Add a known-SDXL LoRA while toggle is "SD" → "⚠SDXL用" marker shown; toggle to "SDXL" → marker disappears there, appears instead on known-SD1.5 LoRAs.
8. Add a LoRA with no architecture metadata → never shows a marker in either toggle state.
9. Disconnect SD (or point `STABLE_DIFFUSION_URL` at a bad port temporarily) → both pickers show the existing disabled-placeholder behavior; no crash from the new toggle logic.

Record which items were actually verified vs. skipped (and why) rather than claiming full verification if SD/LM Studio weren't reachable throughout.

- [ ] **Step 3: Final summary commit (only if any uncommitted fixups remain)**

If Step 2 surfaced any small fixes, commit them individually with a description of what was wrong. If everything passed as implemented in Tasks 1–6, no additional commit is needed here.

---

## Self-Review

**Spec coverage:**
- `/api/sd-models` stops excluding SDXL, returns `{ title, type }[]` → Task 1 ✓
- `/api/sd-loras` returns `{ name, type }[]` via `classifyLoraArchitecture()` → Task 2 ✓
- `SdModel`/`SdLora` types, `SIZE_OPTIONS_BY_TYPE`, `modelTypeFilter` state, toggle UI, filtered model `<select>` → Task 3 ✓
- Resolution reset effect (selectedModel/width/height/selectedWidths/selectedHeights) → Task 4 ✓
- サイズの組み合わせ candidate sizes scoped to toggle; モデル切替 candidate list scoped to toggle → Task 5 ✓
- LoRA dropdown "⚠" badge, unknown LoRAs unmarked → Task 6 ✓
- Full manual verification checklist from the spec → Task 7 ✓
- Out-of-scope items (Refiner pipeline, VAE selection, 3-way toggle, Hires.fix tuning, localStorage persistence, auto-flip on `loadIntoForm`) — deliberately not implemented anywhere in this plan, consistent with the spec.

**Placeholder scan:** No TBD/TODO; every step shows exact before/after code or an exact command with expected output.

**Type consistency:** `SdModel = { title: string; type: 'sd15' | 'sdxl' }` and `SdLora = { name: string; type: 'sd15' | 'sdxl' | 'unknown' }` are defined once in Task 3 and used with the same field names (`.title`, `.name`, `.type`) in every later task. `SIZE_OPTIONS_BY_TYPE` and `modelTypeFilter` are likewise defined once and referenced identically in Tasks 4–6. `classifyLoraArchitecture()`'s return type (`'sd15' | 'sdxl' | 'unknown'`) matches `SdLora['type']` exactly.
