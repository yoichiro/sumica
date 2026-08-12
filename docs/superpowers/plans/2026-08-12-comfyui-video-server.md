# ComfyUI Video Generation — Plan 1: Server + Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring ComfyUI image-to-video generation online end-to-end at the server + data-model layer — verifiable purely with curl, no client UI required — so that Plan 2 (Client UI) can build on a working backend.

**Architecture:** Sumica server proxies ComfyUI (`127.0.0.1:8188`) through a new `/api/video/generate` (SSE-stream) + `/interrupt` pair, using a bundled workflow (`server/workflows/i2v.json`) whose dynamic parameters (Tier 1 + Tier 2 — image slots, prompts, seed, mxSlider ×6) are substituted at request time. A separate `server/comfyui.ts` module encapsulates ComfyUI HTTP + WebSocket calls plus pure workflow-mutation helpers (unit tested). Poster frame extraction uses `fluent-ffmpeg` + a WSL-side `ffmpeg` binary. Data model gains `mediaType` / `parentId` / `videoUrl` / `posterUrl` / `ltxParams` fields; Firebase Storage rules extend to `videos/` and `posters/`; local mode's `metadata.json` and `firebase.ts` cascade-delete children when their parent image is removed.

**Tech Stack:** Node.js + Express 5 + TypeScript (server), Vitest (client tests — no server tests exist yet), `axios`, `ws` (WebSocket client), `fluent-ffmpeg` npm + ffmpeg binary, Firebase SDK (client only — server stays Firebase-free).

## Global Constraints

- Bundled workflow file: `server/workflows/i2v.json` (verbatim copy of `/mnt/e/10Eros_10SNodes_I2V_FaceID_v2.json`).
- ComfyUI URL: `COMFYUI_URL=http://127.0.0.1:8188` (env var, override in `server/.env`).
- ComfyUI workflow path: `COMFYUI_WORKFLOW_PATH=./workflows/i2v.json` (env var).
- Workflow node IDs that are substituted at request time: image slots (837 = main input, 923 = optional reference), prompts (536 = positive, 537 = negative), seed (524, `Seed (rgthree)`, must be `int` and `< 2**50`), mxSliders (791 Width / 792 Height / 796 Length / 797 Fidelity / 915 Motion / 941 Identity — each written to BOTH `Xi` and `Xf` inputs at once), and save flag on VHS_VideoCombine node 597 (`save_output: false`, so video lands in `temp/` not `output/`).
- `mediaType` default when the field is absent on a persisted record: `'image'` (legacy safety).
- Storage paths: `users/{uid}/videos/{timestamp}.mp4`, `users/{uid}/posters/{timestamp}.webp` (Firebase mode); `server/outputs/generated_<timestamp>.mp4` + `_poster.webp` sidecar (local mode).
- Poster frames: 256px WebP quality 80 (matches `THUMBNAIL_MAX_DIMENSION` and `THUMBNAIL_QUALITY` already used for image thumbnails).
- Cascade delete semantics: deleting a parent image also deletes every record whose `parentId === parent.id`, plus their Storage objects (Firebase) / local files (local mode).
- Comments in code: English only.
- Commit messages: English, one line, imperative mood.
- Per-task verification runs from repo root; keep working tree clean between tasks.

---

## File Structure

| Path | Task | Responsibility |
|---|---|---|
| `client/src/firebase.ts` | 1, 6 | Type extension (`mediaType`, `parentId`, video fields, `ltxParams`); `saveVideoGeneration`; cascade-aware `deleteGenerations` |
| `client/src/App.tsx` | 1 | `GenerationData` interface — mirrors `GenerationRecord` additions |
| `storage.rules` | 2 | Read/write allow for `users/{uid}/videos/*` + `users/{uid}/posters/*` |
| `server/workflows/i2v.json` | 3 | Bundled ComfyUI workflow (byte-exact copy of user's file) |
| `server/.env` | 3 | New env vars for ComfyUI URL and workflow path |
| `server/package.json` | 3 | `fluent-ffmpeg` + `@types/fluent-ffmpeg` deps |
| `server/comfyui.ts` | 4 | Pure workflow-mutation helpers + ComfyUI HTTP/WS client (upload, submit, wait, fetch, poster extract) |
| `server/comfyui.test.ts` | 4 | Unit tests for pure workflow-mutation helpers only |
| `server/index.ts` | 5, 7 | `POST /api/video/generate` (SSE), `POST /api/video/generate/interrupt`, local mode metadata + cascade delete extensions |

---

## Task 1: Data model type extension

**Files:**
- Modify: `client/src/firebase.ts` (extend `GenerationRecord`)
- Modify: `client/src/App.tsx` (extend `GenerationData`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `GenerationRecord` (in `firebase.ts`) and `GenerationData` (in `App.tsx`) both carry the new fields exactly:
    - `mediaType: 'image' | 'video'`
    - `parentId?: string`
    - `videoUrl?: string`
    - `videoStoragePath?: string`
    - `posterUrl?: string`
    - `posterStoragePath?: string`
    - `ltxParams?: LtxParams`
  - Exported `LtxParams` type (from `firebase.ts` so both files import it):
    ```typescript
    export type LtxParams = {
      fidelity: number;
      motion: number;
      identity: number;
      length: number;
      referenceImageStoragePath?: string;
      positivePrompt: string;
      negativePrompt: string;
    };
    ```

- [ ] **Step 1: Add the shared `LtxParams` type + new fields to `GenerationRecord` in `client/src/firebase.ts`**

In `client/src/firebase.ts`, locate the `export type GenerationRecord = GenerationParams & { ... }` block (around line 100). Just before that block, add:

```typescript
// LTX-Video 2 image-to-video parameters, persisted only on mediaType === 'video'
// records. Length is in frames (workflow uses 24 fps, so 240 frames = 10 s). The
// three float knobs (fidelity/motion/identity) are the mxSlider values authored
// into the workflow (see server/workflows/i2v.json nodes 797/915/941). Prompts
// are stored so the record fully round-trips through "load into form".
export type LtxParams = {
  fidelity: number;
  motion: number;
  identity: number;
  length: number;
  referenceImageStoragePath?: string;
  positivePrompt: string;
  negativePrompt: string;
};
```

Then extend the `GenerationRecord` type block by adding the six media fields alongside `storagePath`. The existing block ends with something like `storagePath: string;` — after that line, add:

```typescript
  // Media type discriminator. Absent on legacy records; treat undefined as 'image'
  // when reading (never write undefined). Videos always carry parentId + videoUrl
  // + videoStoragePath (+ posterUrl/posterStoragePath when the ffmpeg poster
  // extraction succeeded) and ltxParams.
  mediaType: 'image' | 'video';
  parentId?: string;
  videoUrl?: string;
  videoStoragePath?: string;
  posterUrl?: string;
  posterStoragePath?: string;
  ltxParams?: LtxParams;
```

- [ ] **Step 2: Mirror the additions in `GenerationData` in `client/src/App.tsx`**

In `client/src/App.tsx`, find `export interface GenerationData {` (around line 75). Add the imports for `LtxParams` alongside the existing firebase imports at the top of the file:

```typescript
import { ..., type LtxParams } from './firebase';
```

Then, inside the `GenerationData` interface body, append the same six fields (same names, same optionality, same types) after the existing `storagePath?: string;` line:

```typescript
  mediaType?: 'image' | 'video';
  parentId?: string;
  videoUrl?: string;
  videoStoragePath?: string;
  posterUrl?: string;
  posterStoragePath?: string;
  ltxParams?: LtxParams;
```

Note: on `GenerationData`, `mediaType` is optional (the client-side type historically tolerates fields being absent on freshly-fetched data mid-load; the persisted `GenerationRecord` is stricter).

- [ ] **Step 3: Verify types compile**

Run: `npm run build --prefix client`
Expected: `✓ built` with no TypeScript errors. Only pre-existing warnings.

- [ ] **Step 4: Verify tests still pass**

Run: `npm run test:run --prefix client`
Expected: `Tests 172 passed (172)` (no new tests, no regression — the new fields are all optional / additive).

- [ ] **Step 5: Commit**

```bash
git add client/src/firebase.ts client/src/App.tsx
git commit -m "feat: extend GenerationRecord/Data with mediaType, parentId, video fields, ltxParams"
```

---

## Task 2: Firebase Storage rules — videos/ + posters/

**Files:**
- Modify: `storage.rules`

**Interfaces:**
- Consumes: nothing.
- Produces: Storage buckets `users/{uid}/videos/*` and `users/{uid}/posters/*` become writable by the owning authenticated user (mirrors the existing rules for `images/` + `thumbs/`).

- [ ] **Step 1: Add the two new match blocks**

In `storage.rules`, find the existing `match /users/{uid}/images/{filename}` block and the sibling `match /users/{uid}/thumbs/{filename}` block. Immediately after them (still inside the same enclosing `match /b/{bucket}/o` block), add:

```
    match /users/{uid}/videos/{filename} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /users/{uid}/posters/{filename} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
```

- [ ] **Step 2: Verify the rules file parses locally (syntax)**

Run: `grep -n "match /users" storage.rules`
Expected: four `match /users/{uid}/<segment>` lines (images, thumbs, videos, posters).

- [ ] **Step 3: Commit**

```bash
git add storage.rules
git commit -m "feat: allow authenticated users to read/write their videos and posters"
```

Note: rules deployment (`firebase deploy --only storage`) is a manual step for the owner and is outside this task's scope.

---

## Task 3: Bundled workflow file + config + ffmpeg dependency

**Files:**
- Create: `server/workflows/i2v.json`
- Modify: `server/.env` (or `server/.env.example` if `.env` is git-ignored — check `.gitignore` first)
- Modify: `server/package.json` (add `fluent-ffmpeg` + `@types/fluent-ffmpeg`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `server/workflows/i2v.json`: byte-exact copy of the user's ComfyUI workflow. Read by `server/comfyui.ts` at request time via `fs.promises.readFile`.
  - Env vars available to `server/index.ts`:
    - `COMFYUI_URL` (default `http://127.0.0.1:8188` when unset)
    - `COMFYUI_WORKFLOW_PATH` (default `./workflows/i2v.json` when unset, resolved relative to the server package root)
  - `fluent-ffmpeg` runtime dependency installed in `server/node_modules` for Task 4's poster-extract helper.
  - System-level `ffmpeg` binary must be on `PATH` inside WSL; installation is not automated by this task (see Step 4 note).

- [ ] **Step 1: Copy the workflow file into the repo**

```bash
mkdir -p server/workflows
cp /mnt/e/10Eros_10SNodes_I2V_FaceID_v2.json server/workflows/i2v.json
```

Verify:
```bash
python3 -c "import json; d=json.load(open('server/workflows/i2v.json')); print(len(d), 'nodes'); assert '837' in d and '923' in d and '524' in d and '536' in d and '537' in d and '791' in d and '792' in d and '796' in d and '797' in d and '915' in d and '941' in d and '597' in d"
```
Expected: prints `64 nodes` (and no assertion error — this is our sanity check that all the node IDs the code will substitute are actually present).

- [ ] **Step 2: Add env-var docs / defaults**

Check `.gitignore` for `server/.env`. If `.env` is git-ignored (typical), edit `server/.env.example` (also add if missing) with the two new keys documented; then also add them to `server/.env` so the running dev server picks them up locally. If `.env` is NOT ignored, edit `server/.env` only.

Add to whichever file(s) apply:

```
# ComfyUI (image-to-video generation) — see docs/superpowers/specs/2026-08-12-comfyui-video-generation-design.md
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_WORKFLOW_PATH=./workflows/i2v.json
```

- [ ] **Step 3: Install fluent-ffmpeg**

Run from repo root:
```bash
npm install --prefix server fluent-ffmpeg
npm install --prefix server -D @types/fluent-ffmpeg
```

Expected: both packages appear in `server/package.json` (`fluent-ffmpeg` under `dependencies`, `@types/fluent-ffmpeg` under `devDependencies`), no npm errors.

- [ ] **Step 4: Confirm ffmpeg binary is available**

Run: `which ffmpeg && ffmpeg -version | head -1`
Expected: prints a path (typical: `/usr/bin/ffmpeg`) and a version line (any version).

If missing: run `sudo apt-get install -y ffmpeg` and retry. This is a one-time WSL system-level install; document it in the commit message body if you had to run it.

- [ ] **Step 5: Verify server typecheck still passes**

Run: `npm run typecheck --prefix server`
Expected: no output (no TypeScript errors). `fluent-ffmpeg` types are now importable but no code imports them yet — that's fine.

- [ ] **Step 6: Commit**

```bash
git add server/workflows/i2v.json server/.env* server/package.json server/package-lock.json
git commit -m "feat: bundle ComfyUI workflow, add fluent-ffmpeg dep and COMFYUI_* env vars"
```

If `server/.env` is git-ignored, do NOT include it in the add — only `.env.example` (and `package.json`, `package-lock.json`, `workflows/i2v.json`) go to the commit.

---

## Task 4: `server/comfyui.ts` helper module + unit tests for pure workflow mutation

**Files:**
- Create: `server/comfyui.ts`
- Create: `server/comfyui.test.ts`
- Modify: `server/package.json` (add `test` + `test:run` scripts using Vitest — Vitest is already a devDep in the client workspace; add it to server too)

**Interfaces:**
- Consumes: env vars from Task 3 (`COMFYUI_URL`, `COMFYUI_WORKFLOW_PATH`); `LtxParams` from Task 1 (import from `../client/src/firebase`? — NO. Server MUST NOT import from client. Instead: redeclare the same shape locally in `comfyui.ts` as `type LtxParams` and keep the two in sync manually; document this in a header comment).
- Produces:
  - `export function mutateWorkflow(workflow: WorkflowJson, args: MutateArgs): WorkflowJson` — pure, deep-clones and returns a new workflow with the requested substitutions applied.
  - `export type MutateArgs = { sourceImageFilename: string; referenceImageFilename?: string; positivePrompt: string; negativePrompt: string; width: number; height: number; length: number; fidelity: number; motion: number; identity: number; seed: number }`
  - `export const SEED_MAX = 1125899906842624` (i.e. `2**50`).
  - `export function clampSeed(seed: number): number` — pure, brings `seed` into `[0, SEED_MAX]` by `Math.abs(Math.floor(seed)) % (SEED_MAX + 1)`.
  - `export async function loadBundledWorkflow(): Promise<WorkflowJson>` — reads `COMFYUI_WORKFLOW_PATH` (or default `./workflows/i2v.json` resolved from `server/`) and JSON-parses it.
  - `export async function uploadImageToComfy(bytes: Buffer, filename: string): Promise<string>` — POST multipart to `${COMFYUI_URL}/upload/image`, returns the returned `name`.
  - `export async function submitWorkflow(workflow: WorkflowJson, clientId: string): Promise<string>` — POST to `${COMFYUI_URL}/prompt`, returns `prompt_id`. Throws if the response body carries a non-empty `node_errors`.
  - `export async function fetchVideo(filename: string, subfolder: string, type: 'output' | 'temp'): Promise<Buffer>` — GET `${COMFYUI_URL}/view?filename=<>&subfolder=<>&type=<>`, returns bytes.
  - `export async function extractPoster(mp4: Buffer): Promise<Buffer>` — spawn `ffmpeg` via `fluent-ffmpeg`, decode frame at `00:00:00.000`, encode to 256px WebP quality 80, return bytes. Throws on ffmpeg error.
  - `export async function waitForCompletion(promptId: string, onProgress: (evt: WsEvent) => void, isCancelled: () => boolean): Promise<HistoryEntry>` — opens a WebSocket to `${COMFYUI_URL.replace(/^http/, 'ws')}/ws?clientId=<>`, streams `progress` / `progress_state` / `executing` / `execution_success` / `execution_error` events to `onProgress`, resolves on `execution_success` after fetching the corresponding history entry. If `isCancelled()` becomes true, sends `POST /interrupt` and rejects with a `CancelledError`.
- All types (`WorkflowJson`, `WsEvent`, `HistoryEntry`, `CancelledError`) are declared and exported from `comfyui.ts` (see Step 3 for the exact declarations).

- [ ] **Step 1: Add Vitest to server + wire up test scripts**

Run: `npm install --prefix server -D vitest`
Expected: `vitest` appears in `server/package.json` devDependencies.

Then edit `server/package.json` — inside the `"scripts"` block (which currently has at least `dev`, `typecheck`), add two more entries:

```json
    "test": "vitest",
    "test:run": "vitest run"
```

- [ ] **Step 2: Write the failing tests for pure helpers**

Create `server/comfyui.test.ts` with EXACTLY this content:

```typescript
import { describe, it, expect } from 'vitest';
import { clampSeed, mutateWorkflow, SEED_MAX, type MutateArgs, type WorkflowJson } from './comfyui';
import { promises as fs } from 'fs';
import path from 'path';

describe('clampSeed', () => {
  it('passes through positive seeds already under SEED_MAX', () => {
    expect(clampSeed(0)).toBe(0);
    expect(clampSeed(42)).toBe(42);
    expect(clampSeed(999_888_777)).toBe(999_888_777);
    expect(clampSeed(SEED_MAX)).toBe(SEED_MAX);
  });

  it('modulo-reduces seeds larger than SEED_MAX', () => {
    // The over-flow example from the earlier ComfyUI dry run (seed error at 1.138e18)
    const overflow = 1138015119000763924;
    const clamped = clampSeed(overflow);
    expect(clamped).toBeGreaterThanOrEqual(0);
    expect(clamped).toBeLessThanOrEqual(SEED_MAX);
  });

  it('floors non-integer seeds', () => {
    expect(clampSeed(42.9)).toBe(42);
    expect(clampSeed(42.1)).toBe(42);
  });

  it('turns negative seeds into positives via abs', () => {
    expect(clampSeed(-42)).toBe(42);
    expect(clampSeed(-999_888_777)).toBe(999_888_777);
  });
});

describe('mutateWorkflow', () => {
  // Load the bundled workflow once for all tests; each test then mutates a fresh
  // deep clone via mutateWorkflow's own clone (mutateWorkflow must not mutate its input).
  const loadWorkflow = async (): Promise<WorkflowJson> => {
    const p = path.join(__dirname, 'workflows', 'i2v.json');
    return JSON.parse(await fs.readFile(p, 'utf-8'));
  };

  const baseArgs: MutateArgs = {
    sourceImageFilename: 'test_source.png',
    referenceImageFilename: undefined,
    positivePrompt: 'She smiles softly.',
    negativePrompt: 'still image, watermark',
    width: 1024,
    height: 1088,
    length: 240,
    fidelity: 1.0,
    motion: 35,
    identity: 1.0,
    seed: 12345,
  };

  it('substitutes the main input image (node 837) and leaves reference (node 923) untouched when unset', async () => {
    const wf = await loadWorkflow();
    const referenceBefore = wf['923'].inputs.image;
    const out = mutateWorkflow(wf, baseArgs);
    expect(out['837'].inputs.image).toBe('test_source.png');
    expect(out['923'].inputs.image).toBe(referenceBefore);
  });

  it('substitutes the reference image (node 923) when provided', async () => {
    const wf = await loadWorkflow();
    const out = mutateWorkflow(wf, { ...baseArgs, referenceImageFilename: 'ref.png' });
    expect(out['923'].inputs.image).toBe('ref.png');
  });

  it('writes both Xi and Xf on each mxSlider so the value takes effect', async () => {
    const wf = await loadWorkflow();
    const out = mutateWorkflow(wf, baseArgs);
    // Width (791), Height (792), Length (796), Fidelity (797), Motion (915), Identity (941)
    expect(out['791'].inputs.Xi).toBe(1024);
    expect(out['791'].inputs.Xf).toBe(1024);
    expect(out['792'].inputs.Xi).toBe(1088);
    expect(out['792'].inputs.Xf).toBe(1088);
    expect(out['796'].inputs.Xi).toBe(240);
    expect(out['796'].inputs.Xf).toBe(240);
    expect(out['797'].inputs.Xi).toBe(1.0);
    expect(out['797'].inputs.Xf).toBe(1.0);
    expect(out['915'].inputs.Xi).toBe(35);
    expect(out['915'].inputs.Xf).toBe(35);
    expect(out['941'].inputs.Xi).toBe(1.0);
    expect(out['941'].inputs.Xf).toBe(1.0);
  });

  it('substitutes positive (536) and negative (537) prompts', async () => {
    const wf = await loadWorkflow();
    const out = mutateWorkflow(wf, baseArgs);
    expect(out['536'].inputs.text).toBe('She smiles softly.');
    expect(out['537'].inputs.text).toBe('still image, watermark');
  });

  it('clamps the seed and writes it to node 524', async () => {
    const wf = await loadWorkflow();
    const out = mutateWorkflow(wf, { ...baseArgs, seed: 999999999999999999 });
    const written = out['524'].inputs.seed;
    expect(typeof written).toBe('number');
    expect(written).toBeGreaterThanOrEqual(0);
    expect(written).toBeLessThanOrEqual(SEED_MAX);
  });

  it('sets save_output=false on the final VHS_VideoCombine node 597 so ComfyUI writes to temp/', async () => {
    const wf = await loadWorkflow();
    const out = mutateWorkflow(wf, baseArgs);
    expect(out['597'].inputs.save_output).toBe(false);
  });

  it('does not mutate the input workflow', async () => {
    const wf = await loadWorkflow();
    const originalImage = wf['837'].inputs.image;
    const originalSeed = wf['524'].inputs.seed;
    mutateWorkflow(wf, baseArgs);
    expect(wf['837'].inputs.image).toBe(originalImage);
    expect(wf['524'].inputs.seed).toBe(originalSeed);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:run --prefix server -- comfyui.test.ts`
Expected: FAIL — the module `./comfyui` does not exist yet.

- [ ] **Step 4: Create `server/comfyui.ts` with the minimal implementation**

Create `server/comfyui.ts` with EXACTLY this content:

```typescript
// ComfyUI HTTP + WebSocket client used by the video-generation endpoint. Kept
// separate from index.ts so the pure workflow-mutation logic can be unit tested
// without spinning up Express.
//
// Note: LtxParams-shaped fields are also declared in client/src/firebase.ts —
// keep them in sync when adding new knobs. The server is intentionally
// Firebase-free and cannot import from the client tree.

import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import WebSocket from 'ws';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough, Readable } from 'stream';

export type WorkflowJson = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: unknown }>;

export type MutateArgs = {
  sourceImageFilename: string;
  referenceImageFilename?: string;
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  length: number;
  fidelity: number;
  motion: number;
  identity: number;
  seed: number;
};

export type HistoryEntry = {
  outputs: Record<string, Record<string, unknown>>;
  status: { status_str: string; completed: boolean };
};

export type WsEvent =
  | { type: 'status'; data: unknown }
  | { type: 'executing'; data: { node: string | null; prompt_id?: string } }
  | { type: 'progress'; data: { value: number; max: number; node: string | null } }
  | { type: 'progress_state'; data: unknown }
  | { type: 'executed'; data: unknown }
  | { type: 'execution_success'; data: { prompt_id: string } }
  | { type: 'execution_error'; data: unknown };

export class CancelledError extends Error {
  constructor() { super('cancelled'); this.name = 'CancelledError'; }
}

// ComfyUI's Seed(rgthree) node caps at 2^50; go over and the prompt is rejected.
export const SEED_MAX = 1125899906842624;

export function clampSeed(seed: number): number {
  const abs = Math.abs(Math.floor(seed));
  return abs > SEED_MAX ? abs % (SEED_MAX + 1) : abs;
}

// Deep-clone-then-mutate: writes the dynamic Tier 1 + Tier 2 parameters into a
// fresh copy of the workflow and returns it. The input workflow is untouched.
export function mutateWorkflow(workflow: WorkflowJson, args: MutateArgs): WorkflowJson {
  const clone: WorkflowJson = JSON.parse(JSON.stringify(workflow));
  clone['837'].inputs.image = args.sourceImageFilename;
  if (args.referenceImageFilename) {
    clone['923'].inputs.image = args.referenceImageFilename;
  }
  clone['536'].inputs.text = args.positivePrompt;
  clone['537'].inputs.text = args.negativePrompt;
  clone['524'].inputs.seed = clampSeed(args.seed);
  const setSlider = (nodeId: string, v: number) => {
    clone[nodeId].inputs.Xi = v;
    clone[nodeId].inputs.Xf = v;
  };
  setSlider('791', args.width);
  setSlider('792', args.height);
  setSlider('796', args.length);
  setSlider('797', args.fidelity);
  setSlider('915', args.motion);
  setSlider('941', args.identity);
  // Force temp-only save so ComfyUI's persistent output/ folder is not written to
  // — Sumica saves videos on its own (Firebase Storage / server/outputs).
  clone['597'].inputs.save_output = false;
  return clone;
}

const comfyBase = () => process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const wsBase = () => comfyBase().replace(/^http/, 'ws');

export async function loadBundledWorkflow(): Promise<WorkflowJson> {
  const rel = process.env.COMFYUI_WORKFLOW_PATH || './workflows/i2v.json';
  const abs = path.isAbsolute(rel) ? rel : path.join(__dirname, rel);
  const text = await fs.readFile(abs, 'utf-8');
  return JSON.parse(text) as WorkflowJson;
}

export async function uploadImageToComfy(bytes: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append('image', bytes, { filename });
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const res = await axios.post(`${comfyBase()}/upload/image`, form, {
    headers: form.getHeaders(),
    timeout: 30_000,
  });
  const name = res.data?.name;
  if (typeof name !== 'string') throw new Error('ComfyUI upload/image returned no name');
  return name;
}

export async function submitWorkflow(workflow: WorkflowJson, clientId: string): Promise<string> {
  const res = await axios.post(`${comfyBase()}/prompt`, { prompt: workflow, client_id: clientId }, { timeout: 30_000 });
  const errors = res.data?.node_errors;
  if (errors && Object.keys(errors).length > 0) {
    throw new Error(`ComfyUI node_errors: ${JSON.stringify(errors)}`);
  }
  const promptId = res.data?.prompt_id;
  if (typeof promptId !== 'string') throw new Error('ComfyUI /prompt returned no prompt_id');
  return promptId;
}

export async function fetchVideo(filename: string, subfolder: string, type: 'output' | 'temp'): Promise<Buffer> {
  const url = `${comfyBase()}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`;
  const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 60_000 });
  return Buffer.from(res.data);
}

// Extract the first video frame and re-encode to a 256px-max-dimension WebP at
// quality 80. Uses a temp file for input because ffmpeg needs seekable input.
export async function extractPoster(mp4: Buffer): Promise<Buffer> {
  const tmp = path.join('/tmp', `sumica-poster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);
  await fs.writeFile(tmp, mp4);
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const out = new PassThrough();
      out.on('data', (c: Buffer) => chunks.push(c));
      out.on('end', () => resolve(Buffer.concat(chunks)));
      out.on('error', reject);
      ffmpeg(tmp)
        .inputOptions('-ss', '00:00:00.000')
        .outputOptions('-frames:v', '1')
        .outputOptions('-vf', 'scale=w=256:h=256:force_original_aspect_ratio=decrease')
        .outputOptions('-c:v', 'libwebp')
        .outputOptions('-quality', '80')
        .format('webp')
        .on('error', reject)
        .pipe(out, { end: true });
    });
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
}

export async function waitForCompletion(
  promptId: string,
  onProgress: (evt: WsEvent) => void,
  isCancelled: () => boolean,
): Promise<HistoryEntry> {
  return new Promise<HistoryEntry>((resolve, reject) => {
    const ws = new WebSocket(`${wsBase()}/ws?clientId=${encodeURIComponent(promptId)}`);
    const cancelPoll = setInterval(async () => {
      if (!isCancelled()) return;
      clearInterval(cancelPoll);
      try { await axios.post(`${comfyBase()}/interrupt`, {}); } catch { /* best-effort */ }
      try { ws.close(); } catch { /* ignore */ }
      reject(new CancelledError());
    }, 500);
    ws.on('message', async (raw: WebSocket.RawData) => {
      let msg: WsEvent;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      onProgress(msg);
      if (msg.type === 'execution_success' && msg.data?.prompt_id === promptId) {
        clearInterval(cancelPoll);
        try {
          const hist = await axios.get(`${comfyBase()}/history/${promptId}`, { timeout: 15_000 });
          const entry = hist.data?.[promptId];
          if (!entry) return reject(new Error('ComfyUI history entry missing after execution_success'));
          try { ws.close(); } catch { /* ignore */ }
          resolve(entry as HistoryEntry);
        } catch (err) { reject(err); }
      }
      if (msg.type === 'execution_error') {
        clearInterval(cancelPoll);
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error(`ComfyUI execution_error: ${JSON.stringify(msg.data)}`));
      }
    });
    ws.on('error', (err) => { clearInterval(cancelPoll); reject(err); });
  });
}
```

Also install the `form-data` and `ws` packages if they aren't already present:

```bash
npm install --prefix server form-data ws
npm install --prefix server -D @types/ws
```

(axios and fs/path are already used elsewhere in server/index.ts and don't need re-install.)

- [ ] **Step 5: Verify tests pass**

Run: `npm run test:run --prefix server -- comfyui.test.ts`
Expected: PASS — 11 tests total in `comfyui.test.ts` (4 for `clampSeed` + 7 for `mutateWorkflow`).

- [ ] **Step 6: Verify server typecheck still passes**

Run: `npm run typecheck --prefix server`
Expected: no output (no errors).

- [ ] **Step 7: Commit**

```bash
git add server/comfyui.ts server/comfyui.test.ts server/package.json server/package-lock.json
git commit -m "feat: add comfyui.ts helper module with pure workflow mutation and unit tests"
```

---

## Task 5: `POST /api/video/generate` + `/interrupt` endpoints (SSE)

**Files:**
- Modify: `server/index.ts` (add two new endpoints + a module-level cancellation flag)

**Interfaces:**
- Consumes:
  - `mutateWorkflow`, `clampSeed`, `loadBundledWorkflow`, `uploadImageToComfy`, `submitWorkflow`, `waitForCompletion`, `fetchVideo`, `extractPoster`, `CancelledError`, types `WorkflowJson`, `MutateArgs`, `WsEvent`, `HistoryEntry` — all from Task 4's `./comfyui`.
  - Env vars `COMFYUI_URL` + `COMFYUI_WORKFLOW_PATH` from Task 3.
- Produces:
  - Two HTTP endpoints available on the Sumica dev server:
    - `POST /api/video/generate` — accepts a JSON body (see Step 1 for exact shape), responds with `Content-Type: text/event-stream`. Emits `event: progress` / `event: complete` / `event: error` records.
    - `POST /api/video/generate/interrupt` — flips a module-level `videoCancelRequested` flag, responds `{ success: true }`.

- [ ] **Step 1: Read `server/index.ts:1-40` and note the imports and the location of the existing `cancelRequested` flag (used by image `/api/generate/interrupt`)**

Run: `grep -n "cancelRequested" server/index.ts | head -5`
Expected: 3-5 hits. The pattern to mirror is: (a) `let cancelRequested = false;` at module scope; (b) an `/api/generate/interrupt` endpoint that sets it to `true`; (c) the generation code path checks it and returns `{ success: false, cancelled: true }`.

- [ ] **Step 2: Add the new imports at the top of `server/index.ts`**

Just after the existing `import axios from 'axios';` line, add:

```typescript
import {
  loadBundledWorkflow,
  mutateWorkflow,
  uploadImageToComfy,
  submitWorkflow,
  waitForCompletion,
  fetchVideo,
  extractPoster,
  CancelledError,
  type MutateArgs,
  type WsEvent,
} from './comfyui';
```

- [ ] **Step 3: Add a module-level cancellation flag (mirrors the existing `cancelRequested`)**

Just below the existing `let cancelRequested = false;` line, add:

```typescript
// Independent cancellation flag for video generation — kept separate from the
// image `cancelRequested` so a video cancel doesn't accidentally interrupt an
// image generation running in the same session (Sumica is single-local-user
// but the endpoints are conceptually independent).
let videoCancelRequested = false;
```

- [ ] **Step 4: Add the `POST /api/video/generate` endpoint**

Find a natural insertion point in `server/index.ts`: just BEFORE the existing `POST /api/generate/interrupt` line (or immediately after the last `/api/generate*` endpoint, whichever is more readable). Insert:

```typescript
// Video generation via ComfyUI. Streams progress as SSE. See
// docs/superpowers/specs/2026-08-12-comfyui-video-generation-design.md
// for the request/response contract and node-mutation strategy.
app.post('/api/video/generate', async (req: Request, res: Response) => {
  // Preflight body validation (fail fast with a 400 before touching ComfyUI)
  const body = req.body as {
    sourceImageBytesBase64?: string;      // raw PNG bytes (base64) — client can send Firebase-fetched image directly
    sourceImageFilename?: string;         // suggested filename for upload/image (defaults to `sumica-source.png`)
    referenceImageBytesBase64?: string;   // optional
    referenceImageFilename?: string;
    positivePrompt?: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    length?: number;
    fidelity?: number;
    motion?: number;
    identity?: number;
    seed?: number;
    clientId?: string;
  };
  if (!body.sourceImageBytesBase64 || typeof body.sourceImageBytesBase64 !== 'string') {
    return res.status(400).json({ error: 'sourceImageBytesBase64 (base64 PNG) is required' });
  }
  if (typeof body.positivePrompt !== 'string' || typeof body.negativePrompt !== 'string') {
    return res.status(400).json({ error: 'positivePrompt and negativePrompt are required' });
  }
  const num = (v: unknown, name: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a finite number`);
    return v;
  };
  let args: MutateArgs;
  try {
    args = {
      sourceImageFilename: body.sourceImageFilename || 'sumica-source.png',
      referenceImageFilename: body.referenceImageFilename,
      positivePrompt: body.positivePrompt,
      negativePrompt: body.negativePrompt,
      width: num(body.width, 'width'),
      height: num(body.height, 'height'),
      length: num(body.length, 'length'),
      fidelity: num(body.fidelity, 'fidelity'),
      motion: num(body.motion, 'motion'),
      identity: num(body.identity, 'identity'),
      seed: num(body.seed, 'seed'),
    };
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }

  // Reset cancel flag defensively (guards against a stale flag from a prior request)
  videoCancelRequested = false;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const sse = (event: string, payload: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const clientId = body.clientId || `sumica-${Date.now()}`;

  try {
    sse('progress', { stage: 'preparing' });

    // 1. Load bundled workflow + upload source image (+ reference if present)
    const workflow = await loadBundledWorkflow();
    const sourceBytes = Buffer.from(body.sourceImageBytesBase64, 'base64');
    const sourceName = await uploadImageToComfy(sourceBytes, args.sourceImageFilename);
    args.sourceImageFilename = sourceName;
    sse('progress', { stage: 'uploaded_source', filename: sourceName });

    if (body.referenceImageBytesBase64) {
      const refBytes = Buffer.from(body.referenceImageBytesBase64, 'base64');
      const refName = await uploadImageToComfy(refBytes, body.referenceImageFilename || 'sumica-reference.png');
      args.referenceImageFilename = refName;
      sse('progress', { stage: 'uploaded_reference', filename: refName });
    }

    // 2. Mutate workflow with dynamic parameters and submit
    const mutated = mutateWorkflow(workflow, args);
    const promptId = await submitWorkflow(mutated, clientId);
    sse('progress', { stage: 'submitted', promptId });

    // 3. Stream ComfyUI progress events over SSE while waiting for completion
    const history = await waitForCompletion(
      promptId,
      (evt: WsEvent) => sse('progress', { stage: 'comfy', evt }),
      () => videoCancelRequested,
    );

    // 4. Locate the final video output filename (VHS_VideoCombine node 597, `gifs` array)
    const node597 = history.outputs?.['597'] as { gifs?: Array<{ filename: string; subfolder: string; type: 'output' | 'temp' }> } | undefined;
    const finalOutput = node597?.gifs?.[0];
    if (!finalOutput) throw new Error('ComfyUI history missing node 597 output');

    sse('progress', { stage: 'fetching_video', filename: finalOutput.filename });
    const mp4 = await fetchVideo(finalOutput.filename, finalOutput.subfolder, finalOutput.type);

    // 5. Extract poster frame (non-fatal on failure)
    sse('progress', { stage: 'extracting_poster' });
    let posterBase64: string | undefined;
    try {
      const posterBytes = await extractPoster(mp4);
      posterBase64 = posterBytes.toString('base64');
    } catch (e) {
      console.error('poster extract failed (non-fatal):', (e as Error).message);
    }

    // 6. Emit `complete` with the payload the client will persist
    sse('complete', {
      videoBase64: mp4.toString('base64'),
      posterBase64,
      ltxParams: {
        fidelity: args.fidelity,
        motion: args.motion,
        identity: args.identity,
        length: args.length,
        positivePrompt: args.positivePrompt,
        negativePrompt: args.negativePrompt,
        // referenceImageStoragePath is provided by the client on save; the server
        // only knows the reference by uploaded filename, not by storage path.
      },
    });
  } catch (err) {
    if (err instanceof CancelledError) {
      videoCancelRequested = false;
      sse('error', { cancelled: true });
    } else {
      console.error('/api/video/generate failed:', (err as Error).message);
      sse('error', { message: (err as Error).message });
    }
  } finally {
    res.end();
  }
});

// Best-effort cancellation of the currently-running video generation. Sets a
// flag that /api/video/generate's cancel-poll picks up on its next tick, which
// then calls ComfyUI's own /interrupt endpoint before rejecting with
// CancelledError.
app.post('/api/video/generate/interrupt', async (_req: Request, res: Response) => {
  videoCancelRequested = true;
  res.json({ success: true });
});
```

- [ ] **Step 5: Verify server typecheck passes**

Run: `npm run typecheck --prefix server`
Expected: no output (no TypeScript errors). If you see errors about `req.body`'s type or missing property annotations, double-check the Response/Request imports (already used by other endpoints in the same file).

- [ ] **Step 6: Verify existing tests still pass**

Run: `npm run test:run --prefix server`
Expected: `Test Files 1 passed (1)` and `Tests 11 passed (11)` (same as after Task 4 — no new tests, no regression).

- [ ] **Step 7: Restart dev server and smoke-test with curl**

Kill any running dev server (pkill or Ctrl+C), then:
```bash
npm run dev:server &
sleep 3
```

Prepare a small test PNG (any Sumica-generated PNG will do — the first one in `server/outputs/` is fine):
```bash
LATEST=$(ls -t server/outputs/*.png 2>/dev/null | head -1)
[ -z "$LATEST" ] && echo "no image found; skip curl smoke test" || echo "using $LATEST"
```

If `$LATEST` was found, run:
```bash
SRC_B64=$(base64 -w 0 "$LATEST")
cat > /tmp/vidreq.json <<EOF
{
  "sourceImageBytesBase64": "$SRC_B64",
  "sourceImageFilename": "sumica-smoketest.png",
  "positivePrompt": "She smiles softly, gentle breeze in her hair.",
  "negativePrompt": "still image, watermark, subtitles",
  "width": 1024,
  "height": 1088,
  "length": 240,
  "fidelity": 1.0,
  "motion": 35,
  "identity": 1.0,
  "seed": 12345,
  "clientId": "sumica-smoketest"
}
EOF

# Note: this will take ~2-5 minutes and stream SSE events to stdout
curl -N -X POST http://localhost:5000/api/video/generate \
  -H 'Content-Type: application/json' \
  --data @/tmp/vidreq.json \
  2>/dev/null | head -100
```

Expected: SSE events stream past — `event: progress` records, eventually `event: complete`. The `data:` line for the `complete` event should be a large JSON object containing `videoBase64` (multi-MB base64 string) and typically `posterBase64`.

If ComfyUI isn't running: you'll see an early `event: error` — that is acceptable for this task (the endpoint itself works; the upstream is offline). Note it in the commit message.

- [ ] **Step 8: Commit**

```bash
git add server/index.ts
git commit -m "feat: add /api/video/generate SSE endpoint and /interrupt for ComfyUI video pipeline"
```

---

## Task 6: Client-side firebase.ts video helpers + cascade delete

**Files:**
- Modify: `client/src/firebase.ts` (add `saveVideoGeneration`, extend `deleteGenerations` to cascade)

**Interfaces:**
- Consumes: types from Task 1 (`GenerationRecord`, `LtxParams`, media fields).
- Produces:
  - `export async function saveVideoGeneration(uid: string, args: SaveVideoArgs): Promise<GenerationRecord>` — uploads mp4 + poster to Firebase Storage, writes a `mediaType: 'video'` record to Firestore linked to `parentId`.
  - `SaveVideoArgs`:
    ```typescript
    export type SaveVideoArgs = {
      parentId: string;
      videoBase64: string;
      posterBase64?: string;
      ltxParams: LtxParams;
      timestamp: number; // unix ms
      params: GenerationParams;  // inherited from parent image so the video record round-trips
    };
    ```
  - `deleteGenerations` — extended so any record whose `parentId` matches one of the deleted records is ALSO removed (Firestore doc + Storage `videos/` + `posters/` — or `images/` + `thumbs/` on cascades of images with their own hypothetical parents; the query uses a single `where('parentId', 'in', ...)` batched at Firestore's ≤10-id limit).

- [ ] **Step 1: Read the existing `saveGeneration` and `deleteGenerations` for the patterns to mirror**

Run: `grep -n "export async function saveGeneration\|export async function deleteGenerations" client/src/firebase.ts`

Note: `saveGeneration` uses `uploadString(objectRef, base64, 'base64')` + `getDownloadURL(objectRef)` + `setDoc(docRef, record)`; `deleteGenerations` iterates records and calls `deleteObject` for each Storage path plus `deleteDoc` for each Firestore doc.

- [ ] **Step 2: Add the `SaveVideoArgs` type and `saveVideoGeneration` function**

In `client/src/firebase.ts`, find the closing brace of `saveGeneration`. Immediately after it, add:

```typescript
export type SaveVideoArgs = {
  parentId: string;
  videoBase64: string;
  posterBase64?: string;
  ltxParams: LtxParams;
  timestamp: number;
  params: GenerationParams;
};

export async function saveVideoGeneration(uid: string, args: SaveVideoArgs): Promise<GenerationRecord> {
  if (!dbInstance || !storageInstance) throw new Error('Firebase is not configured');
  const { parentId, videoBase64, posterBase64, ltxParams, timestamp, params } = args;

  // 1. Upload the mp4 bytes to users/{uid}/videos/{ts}.mp4
  const videoStoragePath = `users/${uid}/videos/generated_${timestamp}.mp4`;
  const videoRef = ref(storageInstance, videoStoragePath);
  await uploadString(videoRef, videoBase64, 'base64', { contentType: 'video/mp4' });
  const videoUrl = await getDownloadURL(videoRef);

  // 2. Upload the poster WebP (if extracted) to users/{uid}/posters/{ts}.webp
  let posterStoragePath: string | undefined;
  let posterUrl: string | undefined;
  if (posterBase64) {
    posterStoragePath = `users/${uid}/posters/generated_${timestamp}.webp`;
    const posterRef = ref(storageInstance, posterStoragePath);
    await uploadString(posterRef, posterBase64, 'base64', { contentType: 'image/webp' });
    posterUrl = await getDownloadURL(posterRef);
  }

  // 3. Write the Firestore doc
  const id = `video_${timestamp}`;
  const docRef = doc(dbInstance, `users/${uid}/generations/${id}`);
  const record: GenerationRecord = {
    ...params,
    id,
    imageUrl: videoUrl,           // legacy field carries the primary media URL
    storagePath: videoStoragePath, // legacy field carries the primary storage path
    thumbnailUrl: posterUrl,      // gallery grid uses thumbnailUrl ?? imageUrl
    timestamp,
    createdAt: new Date(timestamp).toISOString(),
    backendMode: 'firebase',
    mediaType: 'video',
    parentId,
    videoUrl,
    videoStoragePath,
    posterUrl,
    posterStoragePath,
    ltxParams,
  };
  await setDoc(docRef, record);
  return record;
}
```

- [ ] **Step 3: Extend `deleteGenerations` for cascade behavior**

Locate the existing `export async function deleteGenerations(uid: string, records: GenerationRecord[]): Promise<void> { ... }`. Rewrite its body to first collect any child records (whose `parentId` is one of the input records' ids) and then delete all of them alongside the originals.

Replace the existing function body with:

```typescript
export async function deleteGenerations(uid: string, records: GenerationRecord[]): Promise<void> {
  if (!dbInstance || !storageInstance) throw new Error('Firebase is not configured');
  if (records.length === 0) return;

  // 1. Look up children: any record whose parentId is one of the deleted records' ids.
  //    Firestore's `in` operator supports at most 10 ids per call — chunk if needed.
  const parentIds = records.map((r) => r.id).filter((id): id is string => typeof id === 'string');
  const generationsRef = collection(dbInstance, `users/${uid}/generations`);
  const childRecords: GenerationRecord[] = [];
  for (let i = 0; i < parentIds.length; i += 10) {
    const chunk = parentIds.slice(i, i + 10);
    const snap = await getDocs(query(generationsRef, where('parentId', 'in', chunk)));
    snap.forEach((d) => childRecords.push({ id: d.id, ...(d.data() as Omit<GenerationRecord, 'id'>) }));
  }

  // 2. Delete every Storage object referenced by parent OR child records (best-effort;
  //    missing objects are tolerated so partial state cleans up too).
  const allRecords = [...records, ...childRecords];
  const storagePaths = new Set<string>();
  for (const r of allRecords) {
    if (r.storagePath) storagePaths.add(r.storagePath);
    if (r.thumbnailUrl && r.storagePath) {
      // legacy: thumbnails live at users/{uid}/thumbs/... derived from imageUrl; try both
      const thumb = r.storagePath.replace('/images/', '/thumbs/').replace(/\.png$/, '.webp');
      storagePaths.add(thumb);
    }
    if (r.videoStoragePath) storagePaths.add(r.videoStoragePath);
    if (r.posterStoragePath) storagePaths.add(r.posterStoragePath);
  }
  for (const path of storagePaths) {
    await deleteObject(ref(storageInstance, path)).catch(() => { /* tolerated */ });
  }

  // 3. Delete every Firestore doc.
  for (const r of allRecords) {
    if (!r.id) continue;
    await deleteDoc(doc(dbInstance, `users/${uid}/generations/${r.id}`)).catch(() => { /* tolerated */ });
  }
}
```

Ensure the following imports are present at the top of the file (add whichever are missing to the `import { ... } from 'firebase/firestore'` block):

```typescript
import { ..., collection, query, where, getDocs, deleteDoc, doc, setDoc } from 'firebase/firestore';
```

- [ ] **Step 4: Verify types compile**

Run: `npm run build --prefix client`
Expected: `✓ built` with no TypeScript errors.

- [ ] **Step 5: Verify tests still pass**

Run: `npm run test:run --prefix client`
Expected: `Tests 172 passed (172)` (no new tests, no regression — new functions are exported but not consumed yet by any test).

- [ ] **Step 6: Commit**

```bash
git add client/src/firebase.ts
git commit -m "feat: add saveVideoGeneration and cascade-delete children in deleteGenerations"
```

---

## Task 7: Local-mode metadata + cascade delete extensions (server side)

**Files:**
- Modify: `server/index.ts` (extend the `POST /api/generations/delete` handler + the local-history save path used by the video endpoint)

**Interfaces:**
- Consumes: nothing new; extends existing local-mode helpers `getLocalHistory` / `saveLocalHistory`.
- Produces:
  - `POST /api/generations/delete` cascades: when a deleted id matches any record's `id`, records whose `parentId === id` are ALSO removed along with their sidecar files.
  - The `/api/video/generate` handler from Task 5, when NOT running in `clientPersist` mode (i.e. when the client sends no user token — signed-out), saves the resulting mp4 + poster into `server/outputs/` and appends the record to `metadata.json`.

- [ ] **Step 1: Extend the local-mode delete handler to cascade**

Locate `POST /api/generations/delete` in `server/index.ts`. The current implementation removes files + JSON entries for each id in the request body. Update it so that:
- Before removing any record, it also collects records whose `parentId` matches any id in the request.
- The sidecar-file removal loop also removes `videoStoragePath` / `posterStoragePath` (if present on the record) and `<local>_poster.webp` (local-mode video sidecar).

Concretely, find the `app.post('/api/generations/delete', ...` block. Inside its body, find the line that iterates through the requested ids to determine which records to remove — extend the collection to include any `history[i]` whose `parentId` is in the input `ids` set:

```typescript
// Cascade: pull in any local record whose parentId matches one of the requested ids
const requestedIds = new Set<string>(ids);
const cascadeChildren = history.filter((r) => r.parentId && requestedIds.has(r.parentId));
for (const child of cascadeChildren) {
  if (child.id) requestedIds.add(child.id);
}
```

Then adjust the file-cleanup loop so it also removes `videoStoragePath` / `posterStoragePath` and any `<basename>_poster.webp` sidecar. If the existing loop uses `localPath` + `thumbnailPath`, add handling for `videoLocalPath` and `posterLocalPath` (which we introduce in the next step).

- [ ] **Step 2: Add a local-mode save path in the video endpoint**

Return to the video-generate endpoint (added in Task 5, `POST /api/video/generate`). Just before the final `sse('complete', {...})` in the success path, add a client-persist branch. Change the last `sse('complete', ...)` block to:

```typescript
    // If the client is not signed in (no clientPersist=true header), save locally
    // and hand the client back a metadata record; otherwise stream the bytes back
    // for the client to upload to Firebase Storage on its own.
    const clientPersist = req.headers['x-client-persist'] === 'true';
    if (!clientPersist) {
      const timestamp = Date.now();
      const fileName = `generated_${timestamp}.mp4`;
      const localFilePath = path.join(outputsDir, fileName);
      fs.writeFileSync(localFilePath, mp4);
      let posterFileName: string | undefined;
      let posterLocalPath: string | undefined;
      if (posterBase64) {
        posterFileName = `generated_${timestamp}_poster.webp`;
        posterLocalPath = path.join(outputsDir, posterFileName);
        fs.writeFileSync(posterLocalPath, Buffer.from(posterBase64, 'base64'));
      }
      const videoUrl = `http://localhost:${PORT}/api/outputs/${fileName}`;
      const posterUrl = posterFileName ? `http://localhost:${PORT}/api/outputs/${posterFileName}` : undefined;
      const parentId = String(body['parentId'] ?? '');
      const inheritedParams = (body['params'] as GenerationMetadata | undefined) || ({} as GenerationMetadata);
      const record: GenerationMetadata = {
        ...inheritedParams,
        id: `local_video_${timestamp}`,
        imageUrl: videoUrl,
        localPath: localFilePath,
        thumbnailUrl: posterUrl,
        thumbnailPath: posterLocalPath,
        timestamp,
        createdAt: new Date(timestamp).toISOString(),
        backendMode: 'local',
        mediaType: 'video',
        parentId: parentId || undefined,
        videoUrl,
        posterUrl,
        ltxParams: {
          fidelity: args.fidelity,
          motion: args.motion,
          identity: args.identity,
          length: args.length,
          positivePrompt: args.positivePrompt,
          negativePrompt: args.negativePrompt,
        },
      };
      const history = getLocalHistory();
      history.unshift(record);
      saveLocalHistory(history);
      sse('complete', { record });
      return;
    }

    // client-persist path (signed in — the client uploads bytes itself)
    sse('complete', {
      videoBase64: mp4.toString('base64'),
      posterBase64,
      ltxParams: {
        fidelity: args.fidelity,
        motion: args.motion,
        identity: args.identity,
        length: args.length,
        positivePrompt: args.positivePrompt,
        negativePrompt: args.negativePrompt,
      },
    });
```

Two more things to check while you're here:
- The `GenerationMetadata` interface (declared near the top of `server/index.ts`) may need `mediaType` / `parentId` / `videoUrl` / `posterUrl` / `ltxParams?: { ... }` fields added, mirroring the client-side additions from Task 1. Add them if missing.
- The client's request body now optionally includes `parentId: string` and `params: GenerationMetadata`. Update the endpoint's TypeScript type on `req.body` to allow them (`parentId?: string; params?: GenerationMetadata;`).

- [ ] **Step 3: Verify server typecheck passes**

Run: `npm run typecheck --prefix server`
Expected: no output.

- [ ] **Step 4: Verify server tests still pass**

Run: `npm run test:run --prefix server`
Expected: `Tests 11 passed (11)`.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat: extend local mode with video save and cascade-delete children"
```

---

## Self-Review

**1. Spec coverage.** Against `docs/superpowers/specs/2026-08-12-comfyui-video-generation-design.md`:

- Data model additions (`mediaType`, `parentId`, `videoUrl`, `videoStoragePath`, `posterUrl`, `posterStoragePath`, `ltxParams`) → Task 1 (client) + Task 7 (server `GenerationMetadata`).
- Firestore Storage rules for `videos/` + `posters/` → Task 2.
- Workflow file bundle at `server/workflows/i2v.json` → Task 3.
- `COMFYUI_URL` + `COMFYUI_WORKFLOW_PATH` env vars → Task 3.
- ffmpeg dependency (`fluent-ffmpeg` + system binary) → Task 3.
- `server/comfyui.ts` helpers (`uploadImageToComfy`, `submitWorkflow`, `waitForCompletion`, `fetchVideo`, `extractPoster`, workflow mutation, seed clamp) → Task 4.
- Unit tests for pure workflow mutation → Task 4.
- `POST /api/video/generate` with SSE progress + Cancel + node-id substitutions → Task 5.
- `POST /api/video/generate/interrupt` → Task 5.
- `firebase.ts` `saveVideoGeneration` + cascade delete → Task 6.
- Local-mode video save + cascade delete → Task 7.
- Poster extraction (256px WebP quality 80, non-fatal on failure) → Task 4 + Task 5.
- `save_output: false` on node 597 (temp-only, so ComfyUI output/ is not written to) → Task 4's `mutateWorkflow`.

Gaps: **client-side UI, i18n, DeleteConfirmModal cascade message, Lightbox video display, ControlPanel Video mode, PreviewPanel video support, App.tsx wire-up** — all belong to **Plan 2** (Client UI), out of scope for Plan 1 by design.

**2. Placeholder scan.** No "TBD", "TODO", "implement later", "handle edge cases", "similar to Task N" — every code step contains verbatim code, every command step names the command and expected output.

**3. Type consistency.**
- `LtxParams` shape: same fields (`fidelity`, `motion`, `identity`, `length`, `referenceImageStoragePath?`, `positivePrompt`, `negativePrompt`) declared in client (`firebase.ts` — Task 1) AND redeclared as `MutateArgs` in server (`comfyui.ts` — Task 4, with additional `width`/`height` because those go into mxSlider not ltxParams). Verified in Task 5's body-validation code: `MutateArgs` includes `width`+`height` in addition to the ltxParams shape.
- `mediaType: 'image' | 'video'` — consistent across `GenerationRecord` (client, Task 1), `GenerationData` (client, Task 1), and `GenerationMetadata` (server, Task 7).
- `saveVideoGeneration(uid, args)` (Task 6) returns `GenerationRecord`; caller (Plan 2's App.tsx wire-up) will pattern-match on it.
- `deleteGenerations(uid, records)` signature unchanged in Task 6; behavior extended additively.
- Server endpoint contract: `POST /api/video/generate` accepts `sourceImageBytesBase64` (required), body-validation errors return HTTP 400; the SSE stream emits `event: progress` (various stages) and terminates with `event: complete` OR `event: error`. `event: complete` payload differs by client-persist mode — signed-out returns `{ record: GenerationMetadata }`, signed-in returns `{ videoBase64, posterBase64?, ltxParams }`. Plan 2's client handler must switch on which shape it receives.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-12-comfyui-video-server.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach? (Plan 2 — Client UI — comes next once Plan 1 verified.)
