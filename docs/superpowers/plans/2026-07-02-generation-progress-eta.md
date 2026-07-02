# Generation Elapsed/Remaining Time Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During step 2 (image generation) of both single and batch generation, show elapsed time, SD's own estimated remaining time, and a progress bar, so the user isn't staring at an indeterminate spinner during long (e.g. Hires.fix) generations.

**Architecture:** Two tasks in sequence — server first (a new `GET /api/sd-progress` endpoint proxying SD's `/sdapi/v1/progress`), then client (elapsed-time state driven by a local `setInterval`, remaining-time/progress state driven by polling the new endpoint, both wrapped in a single reusable `runWithProgressTracking()` helper used by both `handleGenerate` and each job of `handleBatchGenerate`'s loop, plus a small JSX block rendered in the progress panel during step 2).

**Tech Stack:** Express 5 + TypeScript ESM (server, tsx); React 19 + TypeScript + Vite 8 (client); oxlint; no new dependencies.

## Global Constraints

- Modify `server/index.ts` and `client/src/App.tsx` only.
- `npm run typecheck --prefix server` must exit 0 after Task 1.
- `cd client && npx tsc -b` and `npm run lint --prefix client` must exit 0 after Task 2.
- Comments in English only.
- No new npm dependencies.
- Elapsed/remaining/progress bar is shown only during `genStatus === 'generating'` (step 2) — not during step 1 (prompt enhancement) or step 3 (saving).
- Batch generation resets elapsed/remaining/progress at the start of each job, not once for the whole batch.
- Spec: `docs/superpowers/specs/2026-07-02-generation-progress-eta-design.md`.

---

### Task 1: Server — `GET /api/sd-progress`

**Files:**
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: the `stableDiffusionUrl` const (near line 103), the `/api/sd-upscalers` endpoint (ends near line 547).
- Produces: `GET /api/sd-progress` returning `{ progress: number, etaRelative: number }`, degrading to `{ progress: 0, etaRelative: 0 }` on any failure.

- [ ] **Step 1: Add the `GET /api/sd-progress` endpoint**

The file currently has the `/api/sd-upscalers` endpoint ending like this, immediately followed by the delete-generations route:

```ts
    const upscalers = [...names(upscalersRes.data), ...names(latentRes.data)];
    res.json({ upscalers });
  } catch (error) {
    console.error('Failed to fetch SD upscalers:', (error as Error).message);
    res.json({ upscalers: [] });
  }
});

// 8. Delete selected generations (image files + metadata).
app.post('/api/generations/delete', async (req: Request, res: Response) => {
```

Insert the new endpoint between them:

```ts
    const upscalers = [...names(upscalersRes.data), ...names(latentRes.data)];
    res.json({ upscalers });
  } catch (error) {
    console.error('Failed to fetch SD upscalers:', (error as Error).message);
    res.json({ upscalers: [] });
  }
});

// 7d. Poll Stable Diffusion's own progress/ETA for the currently-running job
// (used by the client to show elapsed/remaining time during step 2). Degrades
// to zeros on any failure, same as the other optional SD proxy endpoints.
app.get('/api/sd-progress', async (_req: Request, res: Response) => {
  try {
    const response = await axios.get(`${stableDiffusionUrl}/sdapi/v1/progress`, {
      params: { skip_current_image: true },
      timeout: 5000,
    });
    res.json({
      progress: typeof response.data?.progress === 'number' ? response.data.progress : 0,
      etaRelative: typeof response.data?.eta_relative === 'number' ? response.data.eta_relative : 0,
    });
  } catch (error) {
    console.error('Failed to fetch SD progress:', (error as Error).message);
    res.json({ progress: 0, etaRelative: 0 });
  }
});

// 8. Delete selected generations (image files + metadata).
app.post('/api/generations/delete', async (req: Request, res: Response) => {
```

- [ ] **Step 2: Type-check the server**

Run: `npm run typecheck --prefix server`

Expected: exits 0, no output.

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: add /api/sd-progress endpoint for generation ETA polling"
```

---

### Task 2: Client — elapsed time, remaining time, progress bar

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/sd-progress` (from Task 1), the `errorStep` state declaration (near line 506), `generateAndPersist` (near line 896), `handleGenerate` (near line 909), `handleBatchGenerate` (near line 989), the progress panel's icon+steps row (roughly lines 1798-1927), `API_BASE`.
- Produces: state `[elapsedSeconds, setElapsedSeconds]`, `[sdProgress, setSdProgress]`; a `formatDuration()` helper; a `runWithProgressTracking()` helper; `handleGenerate`'s and `handleBatchGenerate`'s SD calls wrapped in it; a new JSX row in the progress panel shown during `genStatus === 'generating'`.

- [ ] **Step 1: Add the `elapsedSeconds`/`sdProgress` state**

The file currently has:

```ts
  const [genStatus, setGenStatus] = useState<GenStatus>('idle');
  const [errorStep, setErrorStep] = useState<number | null>(null);

  // Batch generation state
```

Add the new state between `errorStep` and the batch-generation comment:

```ts
  const [genStatus, setGenStatus] = useState<GenStatus>('idle');
  const [errorStep, setErrorStep] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sdProgress, setSdProgress] = useState<{ progress: number; etaRelative: number } | null>(null);

  // Batch generation state
```

- [ ] **Step 2: Add `formatDuration()` and `runWithProgressTracking()`**

Insert them between `generateAndPersist` and `handleGenerate`. The file currently has:

```ts
  const generateAndPersist = async (
    positive: string,
    negative: string,
    originalPrompt: string,
    seed: number,
    width: number,
    height: number,
    modelOverride?: string
  ): Promise<GenerationData> => {
    const result = await generateImage(positive, negative, originalPrompt, seed, width, height, modelOverride);
    if (!result.success) throw new Error('Image generation returned an unsuccessful result');
    return await persistResult(result);
  };
  const handleGenerate = async (e: React.FormEvent) => {
```

Insert the two new helpers between them:

```ts
  const generateAndPersist = async (
    positive: string,
    negative: string,
    originalPrompt: string,
    seed: number,
    width: number,
    height: number,
    modelOverride?: string
  ): Promise<GenerationData> => {
    const result = await generateImage(positive, negative, originalPrompt, seed, width, height, modelOverride);
    if (!result.success) throw new Error('Image generation returned an unsuccessful result');
    return await persistResult(result);
  };

  // Formats a duration in seconds as "12秒" or, past a minute, "1分5秒" —
  // Hires.fix generations can run several minutes.
  const formatDuration = (totalSeconds: number): string => {
    const s = Math.max(0, Math.round(totalSeconds));
    if (s < 60) return `${s}秒`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}分${rem}秒`;
  };

  // Wraps a single SD call with a live elapsed-time timer (client-side, no
  // network) and remaining-time/progress polling (GET /api/sd-progress,
  // which proxies SD's own progress estimate). Used by both single and batch
  // generation so each batch job gets its own reset elapsed/progress display.
  const runWithProgressTracking = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const startTime = Date.now();
    setElapsedSeconds(0);
    setSdProgress(null);

    const elapsedTimer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    const pollProgress = async () => {
      try {
        const res = await fetch(`${API_BASE}/sd-progress`);
        if (res.ok) {
          const data = await res.json();
          setSdProgress({
            progress: typeof data.progress === 'number' ? data.progress : 0,
            etaRelative: typeof data.etaRelative === 'number' ? data.etaRelative : 0,
          });
        }
      } catch {
        // best-effort — keep showing the last known progress rather than clearing it
      }
    };
    pollProgress(); // fire immediately so the first update doesn't wait a full interval
    const progressTimer = setInterval(pollProgress, 1500);

    try {
      return await fn();
    } finally {
      clearInterval(elapsedTimer);
      clearInterval(progressTimer);
      setElapsedSeconds(0);
      setSdProgress(null);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
```

- [ ] **Step 3: Wrap the SD call in `handleGenerate`**

The file currently has, inside `handleGenerate`'s `try` block:

```ts
      // --- Transition to Step 2: Image Generation ---
      currentStep = 2;
      setLoadingStep(2);
      setGenStatus('generating');

      const result = await generateImage(positive, negative, prompt, seedLocked ? seedValue : -1, width, height);
```

Change the last line to wrap the call:

```ts
      // --- Transition to Step 2: Image Generation ---
      currentStep = 2;
      setLoadingStep(2);
      setGenStatus('generating');

      const result = await runWithProgressTracking(() =>
        generateImage(positive, negative, prompt, seedLocked ? seedValue : -1, width, height)
      );
```

- [ ] **Step 4: Wrap the SD call in `handleBatchGenerate`'s loop**

The loop currently has:

```ts
        try {
          const saved = await generateAndPersist(positive, negative, prompt, seed, job.width, job.height, job.model);
          succeeded++;
          setCurrentGeneration(saved); // live preview update
        } catch (genErr) {
          failed++;
          console.error(genErr);
        }
```

Change it to:

```ts
        try {
          const saved = await runWithProgressTracking(() =>
            generateAndPersist(positive, negative, prompt, seed, job.width, job.height, job.model)
          );
          succeeded++;
          setCurrentGeneration(saved); // live preview update
        } catch (genErr) {
          failed++;
          console.error(genErr);
        }
```

- [ ] **Step 5: Add the elapsed/remaining/progress-bar row to the progress panel**

Inside the `{genStatus !== 'idle' && (...)}` progress panel, the icon+steps row closes, then the panel itself closes:

```tsx
                    <span>保存完了</span>
                  </div>
                </div>
              </div>
          )}
```

(The first `</div>` after `<span>保存完了</span>` closes the "Steps Horizontally" container; the next `</div>` closes the row that holds both the spinner/status block and the steps; the third `</div>` closes the `glass-panel` itself.) Insert a new sibling row between the row's closing `</div>` and the panel's closing `</div>`:

```tsx
                    <span>保存完了</span>
                  </div>
                </div>

                {genStatus === 'generating' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <span>
                      経過{formatDuration(elapsedSeconds)}
                      {sdProgress && sdProgress.etaRelative > 0 ? ` / 残り約${formatDuration(sdProgress.etaRelative)}` : ''}
                    </span>
                    {sdProgress && (
                      <div style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'var(--panel-border)', overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.min(100, Math.max(0, sdProgress.progress * 100))}%`,
                          height: '100%',
                          background: 'var(--pop-blue)',
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
          )}
```

Note: `sdProgress` starts `null` at the beginning of each `runWithProgressTracking()` call, so the "残り約..." text and the bar are both hidden until the first successful poll response arrives — only the elapsed-time text shows in that brief window.

- [ ] **Step 6: Type-check and lint**

Run both:

```bash
cd /home/yoichiro/projects/sumica/client && npx tsc -b
npm run lint --prefix /home/yoichiro/projects/sumica/client
```

Expected: `tsc -b` exits 0. Lint exits 0 (no new errors).

- [ ] **Step 7: Manual verification**

If a local Stable Diffusion (AUTOMATIC1111/Forge, launched with `--api`) and LM Studio are reachable, run `npm run dev` from the repo root and check:

1. Start a generation without Hires.fix — during step 2, "経過X秒" appears immediately and counts up every second; once the first `/api/sd-progress` poll returns, "／残り約Y秒" and a progress bar appear and update roughly every 1.5s, with the bar filling as the count approaches completion.
2. Start a generation with Hires.fix enabled (slower) — confirm the display keeps updating smoothly across the transition from the first pass to the hires second pass, with no jump back to 0% or a stuck display.
3. Run "まとめて生成" (count mode, 3 images) — confirm elapsed/remaining/bar reset to their initial state (elapsed 0, bar hidden) at the start of each of the 3 jobs.
4. Confirm nothing from this feature renders during step 1 (プロンプト拡張) or step 3 (保存) — only during step 2.
5. Stop the Stable Diffusion process mid-generation (or point `STABLE_DIFFUSION_URL` at an unreachable host) and start a generation — confirm elapsed time keeps counting up while the remaining-time text and bar simply never appear (no toast spam, no crash); the generation itself will eventually fail via the existing SD-unreachable error path, which is unrelated to this feature.

If SD/LM Studio aren't reachable in this environment, skip this step and note it explicitly rather than claiming it was verified.

- [ ] **Step 8: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: show elapsed and estimated remaining time during generation"
```

---

## Self-Review

**Spec coverage:**
- `GET /api/sd-progress` proxying SD's `/sdapi/v1/progress?skip_current_image=true`, degrading to zeros on failure → Task 1 Step 1 ✓
- `elapsedSeconds`/`sdProgress` state → Task 2 Step 1 ✓
- `formatDuration()` (seconds → "N秒" / "M分S秒") → Task 2 Step 2 ✓
- `runWithProgressTracking()`: 1s local elapsed timer + 1.5s progress poll, reset at start, cleared in `finally` → Task 2 Step 2 ✓
- Both `handleGenerate` and `handleBatchGenerate`'s per-job call wrapped in `runWithProgressTracking` → Task 2 Steps 3-4 ✓
- Display limited to `genStatus === 'generating'` (step 2 only) → Task 2 Step 5 (the `{genStatus === 'generating' && (...)}` gate) ✓
- Remaining-time text and bar hidden until first successful poll (`sdProgress` starts `null`) → Task 2 Step 5, noted explicitly ✓
- Batch resets per job, not once for the whole batch → inherent to calling `runWithProgressTracking` fresh inside the loop (Task 2 Step 4) ✓
- Hires.fix needs no special-casing (SD's own progress covers both passes) → no code path needed, verified manually in Task 2 Step 7.2 ✓

**Placeholder scan:** No TBD/TODO. All code shown verbatim, including full before/after blocks for every edited function. ✓

**Type consistency:**
- `sdProgress: { progress: number; etaRelative: number } | null` (Task 2 Step 1) matches the shape parsed from `/api/sd-progress`'s JSON body in `pollProgress` (Task 2 Step 2) and the server's response shape from Task 1 Step 1 (`{ progress: number, etaRelative: number }`). ✓
- `runWithProgressTracking<T>(fn: () => Promise<T>): Promise<T>` (Task 2 Step 2) is called with `() => generateImage(...)` (returns `Promise<GenResult>`) in Step 3 and `() => generateAndPersist(...)` (returns `Promise<GenerationData>`) in Step 4 — both are zero-argument functions returning a `Promise<T>`, matching the generic signature. ✓
- `formatDuration(totalSeconds: number): string` (Step 2) is called with `elapsedSeconds` (`number` state) and `sdProgress.etaRelative` (`number`) in Step 5 — both are plain numbers. ✓
