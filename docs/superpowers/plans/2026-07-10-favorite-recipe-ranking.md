# Favorite-Recipe Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `users/{uid}/rankingRollups/{sha256Hash}` materialized-view collection (mirrored to `server/outputs/rankingRollups.json` for the signed-out path) that keeps per-recipe `{ total, favs }` counters current via atomic increments, subscribe to it from the client, and surface it as a new "🏆 ランキング" tab inside `ControlPanel` where each Top-10 row has a "フォームに適用" button.

**Architecture:** SHA-256 hash of an 8-dimension normalised recipe (`model, sampler, scheduler, size, hires, loras, refiner, vae`) is the rollup doc ID. Firestore writes stay atomic via `writeBatch` + `increment()` alongside the existing generation writes; the server does the same on `metadata.json` via a temp-file+rename to `rankingRollups.json`. A one-off backfill script rebuilds either side from scratch and doubles as recovery. The client subscribes with `onSnapshot` (signed-in) or an `/api/ranking-rollups` fetch + refetch-on-mutation (signed-out) and displays Wilson-lower-bound-ranked Top 10 recipes.

**Tech Stack:** TypeScript, React 19, Vite, Vitest, Firebase Web SDK, Firebase Admin SDK (backfill only), Express 5.

## Global Constraints

- Server stays Firebase-free at runtime (`firebase-admin` is a devDependency used only by scripts) — per [[adr-0001-client-side-firebase-persistence]].
- SHA-256 hex (64 chars) is the rollup doc ID; `params` field on each doc mirrors the source values for debug.
- 8 dimensions in the hash: `model` (stripHashSuffix-normalised), `sampler`, `scheduler`, `size` = `"WxH"`, `hires` (boolean), `loras` (sorted array of names), `refiner`, `vae`. Empty strings for unset optional string fields; empty array for no LoRAs.
- Rollup schema starts at `version: 1`. Any future dimension addition must bump the version and re-run backfill.
- Wilson 95% CI lower bound is the ranking sort key; ties break on `total` descending.
- Ranking display: `minSample = 3`, `topN = 10`.
- Firestore atomic writes: use `writeBatch` + `increment()` in the same batch as the existing generation write.
- Server-side atomic writes: temp file + `fs.renameSync`.
- Client is ESM; use `import`.
- Commit messages: one-line English, no `Claude` / `Co-Authored-By` trailers.
- All new pure logic covered by Vitest tests.
- Do NOT modify `GenerationData` / `GenerationRecord` shape or existing gallery/lightbox/batch behavior.

---

## File Structure

**New files:**
- `client/src/utils/rankingRollup.ts` — pure `normalizeParams` + `buildRollupKey`
- `client/src/utils/rankingRollup.test.ts` — Vitest for the above
- `client/src/utils/rankingAnalysis.ts` — pure `wilsonLower` + `rankRecipes` + types
- `client/src/utils/rankingAnalysis.test.ts` — Vitest for the above
- `client/src/components/RankingPanel.tsx` — Ranking tab UI (rendered inside ControlPanel)
- `server/utils/rankingRollup.ts` — server-side counterpart of `normalizeParams` + `buildRollupKey` + `updateLocalRollup`
- `server/utils/rankingRollup.test.ts` — Vitest (client/server hash parity)
- `server/scripts/backfill-ranking-rollups-cloud.ts` — one-off Firestore backfill
- `server/scripts/backfill-ranking-rollups-local.ts` — one-off local JSON backfill

**Modified files:**
- `client/src/firebase.ts` — extend `saveGeneration` / `updateFavorite` / `deleteGenerations`; add `subscribeRankingRollups`; export `RankingRollup` type
- `client/src/App.tsx` — subscribe to rollups, add `applyRecipe` handler, thread props to `ControlPanel`
- `client/src/components/ControlPanel.tsx` — tab UI wrapper, render `RankingPanel` when tab active
- `client/src/i18n/ja.ts` / `en.ts` — new keys
- `server/index.ts` — extend save/favorite/delete handlers to update local rollup; add `GET /api/ranking-rollups`
- `firestore.rules` — rules for `users/{uid}/rankingRollups/{hash}` (owner-only R/W)

**Backfill artifacts (not committed to git):**
- `server/outputs/rankingRollups.json` (local mode; produced by `backfill-ranking-rollups-local.ts`)
- Firestore `users/{uid}/rankingRollups/*` docs (cloud mode; produced by `backfill-ranking-rollups-cloud.ts`)

---

## Task 1: Rollup key hashing (client-side pure module + tests)

**Files:**
- Create: `client/src/utils/rankingRollup.ts`
- Create: `client/src/utils/rankingRollup.test.ts`

**Interfaces:**
- Consumes: `stripHashSuffix` from `../components/loadIntoFormState`
- Produces:
  - `export type NormalizedParams = { model: string; sampler: string; scheduler: string; size: string; hires: boolean; loras: string[]; refiner: string; vae: string; }`
  - `export function normalizeParams(p: unknown): NormalizedParams` — accepts any object with the relevant fields
  - `export async function buildRollupKey(p: NormalizedParams): Promise<string>` — SHA-256 hex

- [ ] **Step 1: Write the failing test file**

Create `client/src/utils/rankingRollup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeParams, buildRollupKey } from './rankingRollup';

describe('normalizeParams', () => {
  it('strips the SD hash-suffix from model title', () => {
    const p = normalizeParams({ model: 'foo.safetensors [abcdef1234]', width: 512, height: 768 });
    expect(p.model).toBe('foo.safetensors');
  });

  it('produces "WxH" for the size field', () => {
    const p = normalizeParams({ width: 512, height: 768 });
    expect(p.size).toBe('512x768');
  });

  it('sorts loras by name', () => {
    const p = normalizeParams({
      loras: [{ name: 'zeta', weight: 0.8 }, { name: 'alpha', weight: 0.7 }],
    });
    expect(p.loras).toEqual(['alpha', 'zeta']);
  });

  it('defaults empty strings for missing optional string fields', () => {
    const p = normalizeParams({});
    expect(p.sampler).toBe('');
    expect(p.scheduler).toBe('');
    expect(p.refiner).toBe('');
    expect(p.vae).toBe('');
    expect(p.loras).toEqual([]);
    expect(p.hires).toBe(false);
    expect(p.model).toBe('');
  });

  it('coerces enableHr truthiness to boolean', () => {
    expect(normalizeParams({ enableHr: true }).hires).toBe(true);
    expect(normalizeParams({ enableHr: false }).hires).toBe(false);
    expect(normalizeParams({ enableHr: undefined }).hires).toBe(false);
  });
});

describe('buildRollupKey', () => {
  const base = {
    model: 'foo.safetensors',
    sampler: 'Euler a',
    scheduler: 'Karras',
    size: '512x768',
    hires: true,
    loras: ['alpha', 'zeta'],
    refiner: '',
    vae: '',
  } as const;

  it('produces a 64-char lowercase hex string', async () => {
    const h = await buildRollupKey(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic (same input → same hash)', async () => {
    const h1 = await buildRollupKey(base);
    const h2 = await buildRollupKey(base);
    expect(h1).toBe(h2);
  });

  it('is invariant to LoRA order (input already sorted by normalizeParams)', async () => {
    const h1 = await buildRollupKey({ ...base, loras: ['alpha', 'zeta'] });
    const h2 = await buildRollupKey({ ...base, loras: ['alpha', 'zeta'] });
    expect(h1).toBe(h2);
  });

  it('changes when any field changes', async () => {
    const h1 = await buildRollupKey(base);
    const h2 = await buildRollupKey({ ...base, sampler: 'DPM++ SDE' });
    const h3 = await buildRollupKey({ ...base, hires: false });
    const h4 = await buildRollupKey({ ...base, size: '512x1024' });
    expect(new Set([h1, h2, h3, h4]).size).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run --prefix client -- rankingRollup`

Expected: FAIL with "Cannot find module './rankingRollup'".

- [ ] **Step 3: Implement the module**

Create `client/src/utils/rankingRollup.ts`:

```ts
// Pure helpers for the favorite-recipe ranking feature. `normalizeParams`
// canonicalises a raw generation params object into the 8-dimension shape
// that identifies a "recipe"; `buildRollupKey` produces the SHA-256 hex
// that acts as the Firestore doc ID for the rollup counter.
//
// Extracted from firebase.ts / App.tsx callers so the hashing logic can
// be unit-tested in isolation and shared verbatim with the server-side
// counterpart (server/utils/rankingRollup.ts) — the two files intentionally
// duplicate this small amount of code because they run in different module
// systems and typechecking pipelines.

import { stripHashSuffix } from '../components/loadIntoFormState';

export type NormalizedParams = {
  model: string;
  sampler: string;
  scheduler: string;
  size: string;
  hires: boolean;
  loras: string[];
  refiner: string;
  vae: string;
};

// Any object with the (optional) shape of a saved generation.
type RawParams = {
  model?: string | null;
  sampler?: string;
  scheduler?: string;
  width?: number;
  height?: number;
  enableHr?: boolean;
  loras?: { name: string; weight?: number }[];
  refiner?: string;
  vae?: string;
};

export function normalizeParams(p: RawParams | Record<string, unknown>): NormalizedParams {
  const src = p as RawParams;
  return {
    model: stripHashSuffix(src.model || ''),
    sampler: src.sampler || '',
    scheduler: src.scheduler || '',
    size: `${src.width ?? 0}x${src.height ?? 0}`,
    hires: !!src.enableHr,
    loras: (src.loras || []).map((l) => l.name).sort(),
    refiner: src.refiner || '',
    vae: src.vae || '',
  };
}

export async function buildRollupKey(p: NormalizedParams): Promise<string> {
  // JSON.stringify preserves object key order in modern V8 for own enumerable
  // string keys inserted in code order — safe because we always build the
  // NormalizedParams object with the same key order in this file. The `loras`
  // array is sorted by `normalizeParams`, so ordering is fully deterministic.
  const canonical = JSON.stringify(p);
  const enc = new TextEncoder().encode(canonical);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run --prefix client -- rankingRollup`

Expected: PASS. All test cases green.

- [ ] **Step 5: Run full test suite + build to make sure nothing broke**

```bash
npm run test:run --prefix client
npm run build --prefix client
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/rankingRollup.ts client/src/utils/rankingRollup.test.ts
git commit -m "feat: add rollup-key hashing pure helpers for favorite-recipe ranking"
```

---

## Task 2: Ranking analysis pure module + tests

**Files:**
- Create: `client/src/utils/rankingAnalysis.ts`
- Create: `client/src/utils/rankingAnalysis.test.ts`

**Interfaces:**
- Consumes: `NormalizedParams` from `./rankingRollup`
- Produces:
  - `export interface RankingRollup { hash: string; params: NormalizedParams; total: number; favs: number; updatedAt: number; version?: number; }`
  - `export interface RankedRecipe extends RankingRollup { rate: number; wilson: number; }`
  - `export function wilsonLower(favs: number, total: number, z?: number): number`
  - `export function rankRecipes(rollups: RankingRollup[], minSample?: number, topN?: number): RankedRecipe[]`

- [ ] **Step 1: Write the failing test file**

Create `client/src/utils/rankingAnalysis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { wilsonLower, rankRecipes, type RankingRollup } from './rankingAnalysis';

const P = {
  model: 'm', sampler: '', scheduler: '', size: '', hires: false, loras: [], refiner: '', vae: '',
};

function rollup(hash: string, total: number, favs: number): RankingRollup {
  return { hash, params: { ...P, model: hash }, total, favs, updatedAt: 0 };
}

describe('wilsonLower', () => {
  it('returns 0 for total=0', () => {
    expect(wilsonLower(0, 0)).toBe(0);
  });

  it('approximates known values for 5/7 (~0.359)', () => {
    expect(wilsonLower(5, 7)).toBeGreaterThan(0.35);
    expect(wilsonLower(5, 7)).toBeLessThan(0.37);
  });

  it('approximates known values for 20/25 (~0.61) — larger sample is closer to raw rate', () => {
    // Wilson lower ~ 0.61; raw rate = 0.80
    expect(wilsonLower(20, 25)).toBeGreaterThan(0.60);
    expect(wilsonLower(20, 25)).toBeLessThan(0.63);
  });

  it('penalises singleton wins (1/1) — Wilson << 1.0', () => {
    expect(wilsonLower(1, 1)).toBeLessThan(0.3);
  });

  it('is monotonic non-decreasing when adding a fav without adding a loss', () => {
    expect(wilsonLower(6, 10)).toBeGreaterThan(wilsonLower(5, 10));
  });
});

describe('rankRecipes', () => {
  it('filters out entries below minSample', () => {
    const out = rankRecipes([rollup('a', 2, 1), rollup('b', 5, 1)], 3, 10);
    expect(out.map((r) => r.hash)).toEqual(['b']);
  });

  it('sorts by wilson descending; tie-break by total descending', () => {
    // Both have wilson 0 (favs=0), so tie-break puts higher total first
    const out = rankRecipes([rollup('small', 3, 0), rollup('big', 10, 0)], 3, 10);
    expect(out.map((r) => r.hash)).toEqual(['big', 'small']);
  });

  it('caps the output length at topN', () => {
    const many = Array.from({ length: 15 }, (_, i) => rollup(`r${i}`, 5, i));
    const out = rankRecipes(many, 3, 10);
    expect(out).toHaveLength(10);
  });

  it('includes rate and wilson on every row', () => {
    const out = rankRecipes([rollup('a', 4, 2)], 3, 10);
    expect(out[0]).toMatchObject({ total: 4, favs: 2, rate: 0.5 });
    expect(typeof out[0].wilson).toBe('number');
  });

  it('handles empty input', () => {
    expect(rankRecipes([], 3, 10)).toEqual([]);
  });

  it('does not crash on rollup with 0 total (filtered out by minSample)', () => {
    expect(rankRecipes([rollup('x', 0, 0)], 3, 10)).toEqual([]);
  });

  it('applies default minSample=3 and topN=10 when omitted', () => {
    const out = rankRecipes([rollup('a', 2, 1), rollup('b', 3, 1)]);
    expect(out.map((r) => r.hash)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run --prefix client -- rankingAnalysis`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the module**

Create `client/src/utils/rankingAnalysis.ts`:

```ts
// Pure ranking logic for the favorite-recipe feature. Given a set of
// rollup counters, produces a Top-N list sorted by the Wilson 95% CI
// lower bound of the binomial proportion (favs / total). Wilson lower
// bound is the standard "how do I rank things by percentage when sample
// sizes vary" trick — a 1/1 lucky-hit gets a much lower lower-bound than
// a 20/25 well-established recipe, so the ranking rewards evidence, not
// luck.

import type { NormalizedParams } from './rankingRollup';

export interface RankingRollup {
  hash: string;
  params: NormalizedParams;
  total: number;
  favs: number;
  updatedAt: number;
  version?: number;
}

export interface RankedRecipe extends RankingRollup {
  rate: number;
  wilson: number;
}

export function wilsonLower(favs: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = favs / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return (centre - spread) / denom;
}

export function rankRecipes(
  rollups: RankingRollup[],
  minSample = 3,
  topN = 10,
): RankedRecipe[] {
  return rollups
    .filter((r) => r.total >= minSample)
    .map((r) => ({
      ...r,
      rate: r.favs / r.total,
      wilson: wilsonLower(r.favs, r.total),
    }))
    .sort((a, b) => b.wilson - a.wilson || b.total - a.total)
    .slice(0, topN);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run --prefix client -- rankingAnalysis`

Expected: PASS.

- [ ] **Step 5: Run full test suite + build**

```bash
npm run test:run --prefix client
npm run build --prefix client
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/rankingAnalysis.ts client/src/utils/rankingAnalysis.test.ts
git commit -m "feat: add Wilson-lower-bound ranking helper for favorite recipes"
```

---

## Task 3: Server-side rollup helpers (hash parity + local JSON updater)

**Files:**
- Create: `server/utils/rankingRollup.ts`
- Create: `server/utils/rankingRollup.test.ts`

**Interfaces:**
- Consumes: none (self-contained; must produce identical hashes to `client/src/utils/rankingRollup.ts`)
- Produces:
  - `export type NormalizedParams = { ... same shape as client ... }`
  - `export function normalizeParams(p: unknown): NormalizedParams`
  - `export function buildRollupKey(p: NormalizedParams): string` — synchronous, uses Node `crypto`
  - `export interface LocalRollupFile { [hash: string]: { version: number; params: NormalizedParams; total: number; favs: number; updatedAt: number; }; }`
  - `export function updateLocalRollup(filePath: string, params: NormalizedParams, deltaTotal: number, deltaFavs: number): void` — reads, mutates, atomic-writes

- [ ] **Step 1: Write the failing test file**

Create `server/utils/rankingRollup.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  normalizeParams,
  buildRollupKey,
  updateLocalRollup,
  type NormalizedParams,
} from './rankingRollup';

let tmpDir: string;
let tmpFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollup-test-'));
  tmpFile = path.join(tmpDir, 'rankingRollups.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const P: NormalizedParams = {
  model: 'foo.safetensors',
  sampler: 'Euler a',
  scheduler: 'Karras',
  size: '512x768',
  hires: true,
  loras: ['alpha', 'zeta'],
  refiner: '',
  vae: '',
};

describe('normalizeParams (server)', () => {
  it('strips hash suffix from model', () => {
    const p = normalizeParams({ model: 'foo.safetensors [abcdef1234]', width: 512, height: 768 });
    expect(p.model).toBe('foo.safetensors');
  });

  it('sorts loras', () => {
    const p = normalizeParams({ loras: [{ name: 'zeta' }, { name: 'alpha' }] });
    expect(p.loras).toEqual(['alpha', 'zeta']);
  });
});

describe('buildRollupKey (server)', () => {
  it('produces 64-char hex', () => {
    expect(buildRollupKey(P)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(buildRollupKey(P)).toBe(buildRollupKey(P));
  });

  it('changes when any field changes', () => {
    const alt = { ...P, sampler: 'DPM++ SDE' };
    expect(buildRollupKey(P)).not.toBe(buildRollupKey(alt));
  });

  // KNOWN: expected hash for the fixed P above — pin the value so this
  // test also asserts client/server hash-format compatibility. The client's
  // test uses the same P and must produce the same hex string.
  it('matches the expected fixed hash for P', () => {
    // computed manually via `echo -n '<canonical JSON>' | sha256sum`.
    // Update this constant if the NormalizedParams shape or serialisation changes.
    const expected = 'PLACEHOLDER_TO_BE_COMPUTED_AT_STEP_1';
    // The placeholder is intentional — Step 3 computes it and replaces
    // this line; running the test at Step 4 will confirm the hash is stable.
    expect(buildRollupKey(P).length).toBe(64); // shape check only until we replace expected
    if (expected !== 'PLACEHOLDER_TO_BE_COMPUTED_AT_STEP_1') {
      expect(buildRollupKey(P)).toBe(expected);
    }
  });
});

describe('updateLocalRollup', () => {
  it('creates the file if missing and writes one entry', () => {
    expect(fs.existsSync(tmpFile)).toBe(false);
    updateLocalRollup(tmpFile, P, 1, 0);
    const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    const hash = buildRollupKey(P);
    expect(data[hash].total).toBe(1);
    expect(data[hash].favs).toBe(0);
    expect(data[hash].params).toEqual(P);
    expect(data[hash].version).toBe(1);
  });

  it('increments an existing entry', () => {
    updateLocalRollup(tmpFile, P, 1, 0);
    updateLocalRollup(tmpFile, P, 1, 1);
    const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    const hash = buildRollupKey(P);
    expect(data[hash].total).toBe(2);
    expect(data[hash].favs).toBe(1);
  });

  it('decrements without going below zero', () => {
    updateLocalRollup(tmpFile, P, 2, 1);
    updateLocalRollup(tmpFile, P, -1, -1);
    const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    const hash = buildRollupKey(P);
    expect(data[hash].total).toBe(1);
    expect(data[hash].favs).toBe(0);
  });

  it('clamps counters at zero even if callers pass excessive negatives', () => {
    updateLocalRollup(tmpFile, P, 1, 0);
    updateLocalRollup(tmpFile, P, -5, -5);
    const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    const hash = buildRollupKey(P);
    expect(data[hash].total).toBe(0);
    expect(data[hash].favs).toBe(0);
  });

  it('preserves other entries when updating one', () => {
    const P2 = { ...P, sampler: 'DPM++ SDE' };
    updateLocalRollup(tmpFile, P, 1, 0);
    updateLocalRollup(tmpFile, P2, 1, 0);
    const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(Object.keys(data)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run --prefix client -- server/utils/rankingRollup 2>&1 || cd server && npx vitest run utils/rankingRollup 2>&1 | tail -10`

Expected: FAIL with "Cannot find module". Note: the server package currently has no `vitest` in scripts; if this test needs its own runner setup, do that inside Step 3 by adding a minimal vitest config to `server/package.json`.

- [ ] **Step 3: Implement the module**

Create `server/utils/rankingRollup.ts`:

```ts
// Server-side counterpart of client/src/utils/rankingRollup.ts. Kept
// deliberately as an independent copy so the two files can be typechecked
// and tested in their own module systems (client: Vite/Vitest; server:
// tsx + Node's native fs). The hash format MUST stay in lockstep with
// the client — the pinned-hash test in this file catches accidental
// divergence.

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

export type NormalizedParams = {
  model: string;
  sampler: string;
  scheduler: string;
  size: string;
  hires: boolean;
  loras: string[];
  refiner: string;
  vae: string;
};

type RawParams = {
  model?: string | null;
  sampler?: string;
  scheduler?: string;
  width?: number;
  height?: number;
  enableHr?: boolean;
  loras?: { name: string; weight?: number }[];
  refiner?: string;
  vae?: string;
};

function stripHashSuffix(title: string): string {
  return title.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
}

export function normalizeParams(p: RawParams | Record<string, unknown>): NormalizedParams {
  const src = p as RawParams;
  return {
    model: stripHashSuffix(src.model || ''),
    sampler: src.sampler || '',
    scheduler: src.scheduler || '',
    size: `${src.width ?? 0}x${src.height ?? 0}`,
    hires: !!src.enableHr,
    loras: (src.loras || []).map((l) => l.name).sort(),
    refiner: src.refiner || '',
    vae: src.vae || '',
  };
}

export function buildRollupKey(p: NormalizedParams): string {
  return createHash('sha256').update(JSON.stringify(p)).digest('hex');
}

export interface LocalRollupEntry {
  version: number;
  params: NormalizedParams;
  total: number;
  favs: number;
  updatedAt: number;
}

export interface LocalRollupFile {
  [hash: string]: LocalRollupEntry;
}

function readLocal(filePath: string): LocalRollupFile {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as LocalRollupFile;
  } catch {
    return {};
  }
}

function writeAtomically(filePath: string, obj: LocalRollupFile): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

export function updateLocalRollup(
  filePath: string,
  params: NormalizedParams,
  deltaTotal: number,
  deltaFavs: number,
): void {
  const data = readLocal(filePath);
  const hash = buildRollupKey(params);
  const existing = data[hash] || {
    version: 1,
    params,
    total: 0,
    favs: 0,
    updatedAt: 0,
  };
  data[hash] = {
    version: 1,
    params,
    total: Math.max(0, existing.total + deltaTotal),
    favs: Math.max(0, existing.favs + deltaFavs),
    updatedAt: Date.now(),
  };
  writeAtomically(filePath, data);
}
```

- [ ] **Step 3b: Set up server-side Vitest if not already configured**

Check `server/package.json` scripts. If no `test` script exists:

```bash
cd server && npm install --save-dev vitest && cd ..
```

Then add to `server/package.json` scripts:

```json
"test:run": "vitest run"
```

- [ ] **Step 3c: Compute the pinned expected hash and update the test**

Run the following at repo root to compute the fixed hash for `P` (must match what `buildRollupKey` will produce):

```bash
node -e "
const P = {model:'foo.safetensors',sampler:'Euler a',scheduler:'Karras',size:'512x768',hires:true,loras:['alpha','zeta'],refiner:'',vae:''};
const c=require('crypto');
console.log(c.createHash('sha256').update(JSON.stringify(P)).digest('hex'));
"
```

Copy the printed 64-char hex. Edit `server/utils/rankingRollup.test.ts` and replace `PLACEHOLDER_TO_BE_COMPUTED_AT_STEP_1` with the exact hex string.

- [ ] **Step 3d: Copy the same pinned assertion to the client test**

To catch client/server hash divergence, add a matching test in `client/src/utils/rankingRollup.test.ts` at the end of the `describe('buildRollupKey', ...)` block:

```ts
  it('matches the pinned expected hash for a known P (must match server test)', async () => {
    const P = {
      model: 'foo.safetensors', sampler: 'Euler a', scheduler: 'Karras',
      size: '512x768', hires: true, loras: ['alpha', 'zeta'], refiner: '', vae: '',
    };
    const expected = 'PASTE_SAME_HEX_HERE';
    expect(await buildRollupKey(P)).toBe(expected);
  });
```

Replace `PASTE_SAME_HEX_HERE` with the same value pasted into the server test.

- [ ] **Step 4: Run both test suites**

```bash
npm run test:run --prefix client
cd server && npx vitest run && cd ..
```

Expected: All PASS.

- [ ] **Step 5: Build**

```bash
npm run typecheck --prefix server
npm run build --prefix client
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/utils/rankingRollup.ts server/utils/rankingRollup.test.ts client/src/utils/rankingRollup.test.ts server/package.json server/package-lock.json
git commit -m "feat: add server-side rollup hashing + updateLocalRollup with atomic writes"
```

---

## Task 4: Extend firebase.ts client SDK — write rollups + subscribe

**Files:**
- Modify: `client/src/firebase.ts`

**Interfaces:**
- Consumes: `normalizeParams` / `buildRollupKey` from `./utils/rankingRollup`, `RankingRollup` type from `./utils/rankingAnalysis`
- Produces:
  - `saveGeneration` — same signature, now also updates rollup in the same `writeBatch`
  - `updateFavorite` — same signature, now also updates rollup
  - `deleteGenerations` — same signature, now also updates rollup for each deleted item
  - `subscribeRankingRollups(uid: string, cb: (rollups: RankingRollup[]) => void, onError?: (e: Error) => void): () => void` — new export

- [ ] **Step 1: Add rollup writes to `saveGeneration`**

Open `client/src/firebase.ts` and locate `saveGeneration`. Add these imports at the top of the file if not already present:

```ts
import { doc, setDoc, writeBatch, increment, collection, onSnapshot } from 'firebase/firestore';
import { normalizeParams, buildRollupKey } from './utils/rankingRollup';
import type { RankingRollup } from './utils/rankingAnalysis';
```

Inside `saveGeneration`, right before the final `return`, replace the current single-doc write with a batched write that also updates the rollup:

```ts
// Compute the rollup key and prepare an atomic batch: the generation doc
// and its rollup counter are updated in one commit so a partial failure
// cannot leave the rollup ahead of/behind the underlying data.
const normalised = normalizeParams({ ...params, width: params.width, height: params.height });
const rollupHash = await buildRollupKey(normalised);
const genRef = doc(dbInstance!, 'users', uid, 'generations', generationId);
const rollupRef = doc(dbInstance!, 'users', uid, 'rankingRollups', rollupHash);

const batch = writeBatch(dbInstance!);
batch.set(genRef, docData);
batch.set(
  rollupRef,
  {
    version: 1,
    params: normalised,
    total: increment(1),
    favs: increment(docData.isFavorite ? 1 : 0),
    updatedAt: Date.now(),
  },
  { merge: true },
);
await batch.commit();
```

Replace whichever single-doc write existed there before. The rollup write is folded into the same batch so both succeed or neither does.

- [ ] **Step 2: Add rollup writes to `updateFavorite`**

Locate `updateFavorite`. Its signature is roughly `(uid, generationId, next: boolean) => Promise<void>`. Before the current single-doc update, load the current doc to get the recipe params, then batch both writes:

```ts
export async function updateFavorite(uid: string, generationId: string, next: boolean): Promise<void> {
  if (!dbInstance) throw new Error('Firebase is not configured');
  const genRef = doc(dbInstance, 'users', uid, 'generations', generationId);
  const genSnap = await getDoc(genRef);
  if (!genSnap.exists()) throw new Error('Generation not found');
  const data = genSnap.data() as GenerationRecord;
  const normalised = normalizeParams(data);
  const rollupHash = await buildRollupKey(normalised);
  const rollupRef = doc(dbInstance, 'users', uid, 'rankingRollups', rollupHash);

  const batch = writeBatch(dbInstance);
  batch.update(genRef, { isFavorite: next });
  batch.set(
    rollupRef,
    {
      version: 1,
      params: normalised,
      favs: increment(next ? 1 : -1),
      updatedAt: Date.now(),
    },
    { merge: true },
  );
  await batch.commit();
}
```

Add `getDoc` to the firestore import at the top if not already present.

- [ ] **Step 3: Add rollup writes to `deleteGenerations`**

Locate `deleteGenerations`. It currently loops over records and deletes each. Modify each iteration to also decrement the corresponding rollup counter within the same batch (or one batch per group of 500, respecting Firestore's write limit):

```ts
export async function deleteGenerations(uid: string, records: GenerationRecord[]): Promise<void> {
  if (!dbInstance || !storageInstance) throw new Error('Firebase is not configured');
  // Chunk into batches of ≤500 operations to respect Firestore's writeBatch limit.
  // Each record contributes 2 writes (doc delete + rollup update) so max 250 records/batch.
  for (let i = 0; i < records.length; i += 250) {
    const chunk = records.slice(i, i + 250);
    const batch = writeBatch(dbInstance);
    for (const rec of chunk) {
      const genRef = doc(dbInstance, 'users', uid, 'generations', rec.id);
      batch.delete(genRef);
      const normalised = normalizeParams(rec);
      const rollupHash = await buildRollupKey(normalised);
      const rollupRef = doc(dbInstance, 'users', uid, 'rankingRollups', rollupHash);
      batch.set(
        rollupRef,
        {
          version: 1,
          params: normalised,
          total: increment(-1),
          favs: increment(rec.isFavorite ? -1 : 0),
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
  // Existing Storage deletion loop stays unchanged (image + thumbnail).
  await Promise.all(
    records.flatMap((r) => [
      r.storagePath ? deleteObject(ref(storageInstance!, r.storagePath)) : Promise.resolve(),
      r.thumbnailStoragePath ? deleteObject(ref(storageInstance!, r.thumbnailStoragePath)) : Promise.resolve(),
    ]),
  );
}
```

- [ ] **Step 4: Add the `subscribeRankingRollups` export**

Append to the end of `client/src/firebase.ts`:

```ts
export function subscribeRankingRollups(
  uid: string,
  cb: (rollups: RankingRollup[]) => void,
  onError?: (err: Error) => void,
): () => void {
  if (!dbInstance) {
    cb([]);
    return () => {};
  }
  const collRef = collection(dbInstance, 'users', uid, 'rankingRollups');
  return onSnapshot(
    collRef,
    (snap) => {
      const rollups: RankingRollup[] = snap.docs.map((d) => {
        const raw = d.data() as Omit<RankingRollup, 'hash'>;
        return { hash: d.id, ...raw };
      });
      cb(rollups);
    },
    (err) => {
      console.error('Ranking rollup subscription failed:', err);
      cb([]);
      onError?.(err);
    },
  );
}
```

- [ ] **Step 5: Build + typecheck**

```bash
npm run build --prefix client
```

Expected: PASS.

- [ ] **Step 6: Run tests (existing suite continues to pass; no new Vitest for this task — Firebase SDK behavior isn't unit-testable and is exercised via manual + Loop Engineering steps later)**

```bash
npm run test:run --prefix client
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/firebase.ts
git commit -m "feat: write rollup counters atomically alongside generation writes in firebase.ts"
```

---

## Task 5: Extend server/index.ts — write local rollups + expose GET endpoint

**Files:**
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: `normalizeParams`, `buildRollupKey`, `updateLocalRollup` from `./utils/rankingRollup`
- Produces:
  - `POST /api/generate` — same contract, now also updates local rollup when saving locally
  - `POST /api/generations/favorite` — same, now also updates local rollup
  - `POST /api/generations/delete` — same, now also updates local rollup for each deletion
  - `GET /api/ranking-rollups` — new endpoint returning `{ [hash]: LocalRollupEntry }`

- [ ] **Step 1: Add the import at the top of `server/index.ts`**

```ts
import { normalizeParams, updateLocalRollup, type LocalRollupFile } from './utils/rankingRollup.js';
```

The `.js` extension is required because server is ESM + tsx.

- [ ] **Step 2: Locate the LOCAL_ROLLUPS_PATH constant near OUTPUTS_DIR and add:**

Find where `OUTPUTS_DIR` (or the equivalent server-output directory constant) is defined near the top and add just below it:

```ts
const LOCAL_ROLLUPS_PATH = path.join(OUTPUTS_DIR, 'rankingRollups.json');
```

- [ ] **Step 3: Update the save handler**

In the `/api/generate` handler, right after the block that writes `metadata.json` in the local-save (not-clientPersist) path, add:

```ts
try {
  updateLocalRollup(
    LOCAL_ROLLUPS_PATH,
    normalizeParams({ ...metadataEntry, loras: metadataEntry.loras || [] }),
    +1,
    metadataEntry.isFavorite ? +1 : 0,
  );
} catch (e) {
  console.error('Failed to update local rollup on save:', e);
  // Non-fatal: the image is saved; rollup can be rebuilt with the backfill script.
}
```

`metadataEntry` here is whatever variable your existing code uses for the just-saved metadata record — grep for `metadata.json` writes to find the exact name.

- [ ] **Step 4: Update the favorite endpoint**

In the `POST /api/generations/favorite` handler, after updating `metadata.json`, add:

```ts
const rec = existingRecords.find((r) => r.id === id);
if (rec) {
  try {
    updateLocalRollup(
      LOCAL_ROLLUPS_PATH,
      normalizeParams({ ...rec, loras: rec.loras || [] }),
      0,
      isFavorite ? +1 : -1,
    );
  } catch (e) {
    console.error('Failed to update local rollup on favorite:', e);
  }
}
```

Field names may differ; adapt to whatever variable holds the pre-update record.

- [ ] **Step 5: Update the delete endpoint**

In the `POST /api/generations/delete` handler, for each deleted record, add:

```ts
for (const rec of deletedRecords) {
  try {
    updateLocalRollup(
      LOCAL_ROLLUPS_PATH,
      normalizeParams({ ...rec, loras: rec.loras || [] }),
      -1,
      rec.isFavorite ? -1 : 0,
    );
  } catch (e) {
    console.error('Failed to update local rollup on delete:', e);
  }
}
```

- [ ] **Step 6: Add the GET endpoint**

Anywhere near the other GET endpoints, add:

```ts
app.get('/api/ranking-rollups', (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(LOCAL_ROLLUPS_PATH)) return res.json({});
    const data = JSON.parse(fs.readFileSync(LOCAL_ROLLUPS_PATH, 'utf8')) as LocalRollupFile;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck --prefix server
```

Expected: PASS.

- [ ] **Step 8: Smoke test the endpoint manually**

Start the server and probe the new endpoint:

```bash
npm run dev:server &
sleep 3
curl -sS http://localhost:5000/api/ranking-rollups | head -c 200
```

Expected: `{}` (empty until Task 8's backfill runs).

- [ ] **Step 9: Commit**

```bash
git add server/index.ts
git commit -m "feat: server-side local-mode rollup writes and GET /api/ranking-rollups"
```

---

## Task 6: Backfill script — Firestore (cloud)

**Files:**
- Create: `server/scripts/backfill-ranking-rollups-cloud.ts`

**Interfaces:**
- Consumes: `normalizeParams`, `buildRollupKey` (via a small copy of the shared logic — this script runs under Node with firebase-admin, not through the client bundle)
- Produces: writes to `users/{uid}/rankingRollups/*` for every user with generations

- [ ] **Step 1: Implement the script**

Create `server/scripts/backfill-ranking-rollups-cloud.ts`:

```ts
// One-off: rebuild `users/{uid}/rankingRollups/*` from scratch by scanning
// every user's `generations` subcollection and aggregating totals + favs.
// Idempotent — running twice produces the same result. Doubles as recovery
// if the rollup counters ever drift from the underlying doc set.
//
// Usage (from repo root):
//   npx tsx server/scripts/backfill-ranking-rollups-cloud.ts           # write
//   npx tsx server/scripts/backfill-ranking-rollups-cloud.ts --dry-run # report only
//
// Setup: reuses server/firebase-key.json (same convention as
// backfill-firebase-thumbnails.ts).

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { normalizeParams, buildRollupKey } from '../utils/rankingRollup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_KEY_PATH = path.join(__dirname, '..', 'firebase-key.json');
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || DEFAULT_KEY_PATH;
const DRY_RUN = process.argv.includes('--dry-run');

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`❌ Service account key not found at ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

interface Gen {
  model?: string | null;
  sampler?: string;
  scheduler?: string;
  width?: number;
  height?: number;
  enableHr?: boolean;
  loras?: { name: string; weight?: number }[];
  refiner?: string;
  vae?: string;
  isFavorite?: boolean;
}

async function main(): Promise<void> {
  console.log(`Fetching all generations across users${DRY_RUN ? ' (DRY RUN)' : ''}…`);
  const snap = await db.collectionGroup('generations').get();

  // Group by owning user (parent.parent.id is uid).
  const perUser = new Map<string, Map<string, { total: number; favs: number; params: ReturnType<typeof normalizeParams> }>>();
  for (const d of snap.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    const g = d.data() as Gen;
    const normalised = normalizeParams(g);
    const hash = buildRollupKey(normalised);
    if (!perUser.has(uid)) perUser.set(uid, new Map());
    const userMap = perUser.get(uid)!;
    if (!userMap.has(hash)) userMap.set(hash, { total: 0, favs: 0, params: normalised });
    const b = userMap.get(hash)!;
    b.total++;
    if (g.isFavorite) b.favs++;
  }

  console.log(`Users: ${perUser.size}`);
  let totalRollups = 0;
  for (const [uid, userMap] of perUser) {
    console.log(`  ${uid}: ${userMap.size} rollups`);
    totalRollups += userMap.size;
  }
  console.log(`Total rollups to write: ${totalRollups}`);

  if (DRY_RUN) {
    console.log('DRY RUN — no writes performed.');
    return;
  }

  const now = Date.now();
  for (const [uid, userMap] of perUser) {
    // Clear existing rollups for this user, then re-write in chunks of 500.
    const existing = await db.collection(`users/${uid}/rankingRollups`).listDocuments();
    if (existing.length > 0) {
      for (let i = 0; i < existing.length; i += 500) {
        const batch = db.batch();
        existing.slice(i, i + 500).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }
      console.log(`  ${uid}: cleared ${existing.length} old rollup docs`);
    }
    const entries = [...userMap.entries()];
    for (let i = 0; i < entries.length; i += 500) {
      const batch = db.batch();
      for (const [hash, b] of entries.slice(i, i + 500)) {
        const ref = db.doc(`users/${uid}/rankingRollups/${hash}`);
        batch.set(ref, {
          version: 1,
          params: b.params,
          total: b.total,
          favs: b.favs,
          updatedAt: now,
        });
      }
      await batch.commit();
    }
    console.log(`  ${uid}: wrote ${userMap.size} rollups`);
  }
  console.log(`✅ Done.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  });
```

- [ ] **Step 2: Run in `--dry-run` mode to verify counts**

```bash
npx tsx server/scripts/backfill-ranking-rollups-cloud.ts --dry-run 2>&1 | tail -20
```

Expected output should include a line like `Users: N`, per-user rollup counts, and end with `DRY RUN — no writes performed.`. Cross-check the total rollup count against the number produced by the existing `analyze-favorites.ts` script's combination table (≥5-sample line count) — should be in the same ballpark.

- [ ] **Step 3: Run the actual backfill**

```bash
npx tsx server/scripts/backfill-ranking-rollups-cloud.ts 2>&1 | tail -20
```

Expected: ends with `✅ Done.`. Manually verify in the Firebase Console that `users/{uid}/rankingRollups/*` documents now exist with the expected shape.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/backfill-ranking-rollups-cloud.ts
git commit -m "feat: add backfill script rebuilding Firestore rankingRollups from generations"
```

---

## Task 7: Backfill script — local JSON

**Files:**
- Create: `server/scripts/backfill-ranking-rollups-local.ts`

- [ ] **Step 1: Implement the script**

Create `server/scripts/backfill-ranking-rollups-local.ts`:

```ts
// One-off: rebuild server/outputs/rankingRollups.json from scratch by
// aggregating server/outputs/metadata.json. Idempotent.
//
// Usage:
//   npx tsx server/scripts/backfill-ranking-rollups-local.ts           # write
//   npx tsx server/scripts/backfill-ranking-rollups-local.ts --dry-run # report only

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeParams, buildRollupKey, type LocalRollupFile } from '../utils/rankingRollup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');
const METADATA_PATH = path.join(OUTPUTS_DIR, 'metadata.json');
const ROLLUP_PATH = path.join(OUTPUTS_DIR, 'rankingRollups.json');
const DRY_RUN = process.argv.includes('--dry-run');

if (!fs.existsSync(METADATA_PATH)) {
  console.log(`No local metadata at ${METADATA_PATH} — nothing to backfill.`);
  process.exit(0);
}

const records = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8')) as Array<{
  isFavorite?: boolean;
  loras?: { name: string; weight?: number }[];
  [key: string]: unknown;
}>;

console.log(`Aggregating ${records.length} local records${DRY_RUN ? ' (DRY RUN)' : ''}…`);
const rollups: LocalRollupFile = {};
for (const r of records) {
  const params = normalizeParams(r);
  const hash = buildRollupKey(params);
  if (!rollups[hash]) rollups[hash] = { version: 1, params, total: 0, favs: 0, updatedAt: 0 };
  rollups[hash].total++;
  if (r.isFavorite) rollups[hash].favs++;
}

const now = Date.now();
for (const k of Object.keys(rollups)) rollups[k].updatedAt = now;

console.log(`Produced ${Object.keys(rollups).length} unique rollup keys.`);

if (DRY_RUN) {
  console.log('DRY RUN — not writing.');
  process.exit(0);
}

fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
const tmp = `${ROLLUP_PATH}.tmp-${process.pid}-${Date.now()}`;
fs.writeFileSync(tmp, JSON.stringify(rollups, null, 2), 'utf8');
fs.renameSync(tmp, ROLLUP_PATH);
console.log(`✅ Wrote ${ROLLUP_PATH}`);
```

- [ ] **Step 2: Run dry-run**

```bash
npx tsx server/scripts/backfill-ranking-rollups-local.ts --dry-run
```

Expected: prints count of records and unique rollup keys.

- [ ] **Step 3: Run for real**

```bash
npx tsx server/scripts/backfill-ranking-rollups-local.ts
```

Expected: writes `server/outputs/rankingRollups.json` and ends with `✅ Wrote …`.

- [ ] **Step 4: Verify via the GET endpoint**

Server should already be running from Task 5's smoke test; if not, start it. Then:

```bash
curl -sS http://localhost:5000/api/ranking-rollups | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('keys:',Object.keys(j).length);console.log('sample:',Object.entries(j)[0]);})"
```

Expected: prints the count of unique rollup entries and one sample entry.

- [ ] **Step 5: Commit**

```bash
git add server/scripts/backfill-ranking-rollups-local.ts
git commit -m "feat: add backfill script rebuilding local rankingRollups.json from metadata"
```

---

## Task 8: Firestore security rules for rankingRollups

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Add owner-only R/W rule for the new subcollection**

Open `firestore.rules`. Inside the `users/{uid}` block, add:

```
match /users/{uid} {
  // ... existing generations rule ...
  match /rankingRollups/{hash} {
    allow read, write: if request.auth != null && request.auth.uid == uid;
  }
}
```

Verify the exact indentation matches the surrounding rules.

- [ ] **Step 2: Deploy**

```bash
firebase deploy --only firestore:rules
```

Expected: success message.

- [ ] **Step 3: Verify from browser**

Open the app, sign in, and open DevTools console. Attempt to fetch a rollup doc:

```js
const uid = firebase.auth().currentUser.uid;
firebase.firestore().collection(`users/${uid}/rankingRollups`).get().then(s => console.log('rollup count:', s.size));
```

Expected: prints a non-zero count (the backfilled documents). No permission-denied errors.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "chore: add owner-only Firestore rules for rankingRollups subcollection"
```

---

## Task 9: RankingPanel component + i18n strings

**Files:**
- Create: `client/src/components/RankingPanel.tsx`
- Modify: `client/src/i18n/ja.ts`
- Modify: `client/src/i18n/en.ts`

**Interfaces:**
- Consumes: `rankRecipes`, `RankingRollup`, `RankedRecipe` from `../utils/rankingAnalysis`; `t` from `../i18n`; `SdModel` from `./presets`
- Produces:
  - Default export `RankingPanel({ rollups, sdModels, onApplyRecipe })`
  - `RankingPanel` renders Top 10 recipes or empty state

- [ ] **Step 1: Add i18n keys to `ja.ts`**

Open `client/src/i18n/ja.ts`. Under `controlPanel`, add:

```ts
    tabForm: '📝 フォーム',
    tabRanking: '🏆 ランキング',
```

Then add a new top-level section (adjacent to existing sections):

```ts
  ranking: {
    emptyState: 'まだランキングを作るための生成データが不足しています。もっと生成してみましょう 🎨',
    applyToForm: 'フォームに適用',
    favsShort: (favs: number, total: number) => `${favs}/${total} fav`,
    applyToast: 'レシピをフォームに適用しました 🎨',
    headerWilson: 'Wilson',
    headerRate: 'Rate',
  },
```

- [ ] **Step 2: Mirror in `en.ts`**

Open `client/src/i18n/en.ts`. Add matching keys:

```ts
    tabForm: '📝 Form',
    tabRanking: '🏆 Ranking',
```

```ts
  ranking: {
    emptyState: 'Not enough data to build a ranking yet. Keep generating! 🎨',
    applyToForm: 'Apply to form',
    favsShort: (favs, total) => `${favs}/${total} fav`,
    applyToast: 'Recipe applied to form 🎨',
    headerWilson: 'Wilson',
    headerRate: 'Rate',
  },
```

- [ ] **Step 3: Create `RankingPanel.tsx`**

Create `client/src/components/RankingPanel.tsx`:

```tsx
import { rankRecipes, type RankingRollup, type RankedRecipe } from '../utils/rankingAnalysis';
import { t } from '../i18n';
import type { SdModel } from './presets';

interface Props {
  rollups: RankingRollup[];
  sdModels: SdModel[];
  onApplyRecipe: (recipe: RankedRecipe) => void;
}

const RANK_EMOJI = ['🥇', '🥈', '🥉'];

export default function RankingPanel({ rollups, sdModels: _sdModels, onApplyRecipe }: Props) {
  const top = rankRecipes(rollups, 3, 10);
  if (top.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
        {t.ranking.emptyState}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 4px' }}>
      {top.map((r, i) => {
        const badge = RANK_EMOJI[i] ?? `${i + 1}`;
        return (
          <div
            key={r.hash}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              padding: 12,
              border: '1px solid var(--panel-border)',
              borderRadius: 8,
              background: 'var(--panel-bg-inset, rgba(0,0,0,0.02))',
            }}
          >
            <div style={{ fontSize: 20, minWidth: 32, textAlign: 'center' }}>{badge}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, color: 'var(--accent, #339af0)' }}>
                  {t.ranking.headerWilson} {(r.wilson * 100).toFixed(1)}%
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  ({t.ranking.favsShort(r.favs, r.total)})
                </span>
              </div>
              <div style={{ fontSize: 13, wordBreak: 'break-all', marginBottom: 4 }}>
                {r.params.model || '(unknown)'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {r.params.sampler || '—'} · {r.params.scheduler || '—'} · {r.params.size} ·{' '}
                {r.params.hires ? 'HR-on' : 'HR-off'}
              </div>
              {r.params.loras.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  LoRA: {r.params.loras.join(', ')}
                </div>
              )}
              {(r.params.refiner || r.params.vae) && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {r.params.refiner && `Refiner: ${r.params.refiner}`}
                  {r.params.refiner && r.params.vae && ' · '}
                  {r.params.vae && `VAE: ${r.params.vae}`}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onApplyRecipe(r)}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--accent, #339af0)',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                alignSelf: 'center',
                flexShrink: 0,
              }}
            >
              {t.ranking.applyToForm}
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Build + typecheck**

```bash
npm run build --prefix client
```

Expected: PASS. (No behavior change yet — component isn't wired in.)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/RankingPanel.tsx client/src/i18n/ja.ts client/src/i18n/en.ts
git commit -m "feat: add RankingPanel component and ranking i18n keys"
```

---

## Task 10: Wire ranking into ControlPanel (tab UI) + App.tsx state + applyRecipe handler

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/ControlPanel.tsx`

**Interfaces:**
- Consumes: `subscribeRankingRollups` from `../firebase`; `RankingRollup`, `RankedRecipe` from `../utils/rankingAnalysis`; `RankingPanel` default export from `./RankingPanel`
- Produces: no new exports; the `ControlPanel` prop surface gains `rollups`, `sdModels` (already passed), `onApplyRecipe`

- [ ] **Step 1: Add rollup subscription state in App.tsx**

Open `client/src/App.tsx`. Near the other useState declarations, add:

```ts
const [rollups, setRollups] = useState<RankingRollup[]>([]);
```

Add the import:

```ts
import type { RankingRollup, RankedRecipe } from './utils/rankingAnalysis';
import { subscribeRankingRollups } from './firebase';
```

Then add a subscription useEffect (signed-in path) and a fetch path (signed-out) — put next to the existing `subscribeGenerations` effect:

```ts
useEffect(() => {
  if (user) {
    return subscribeRankingRollups(user.uid, setRollups);
  }
  // Signed-out: fetch from server, refetch on save/favorite/delete completion
  const refetch = () => {
    fetch(`${API_BASE}/ranking-rollups`)
      .then((r) => r.json())
      .then((data: Record<string, Omit<RankingRollup, 'hash'>>) => {
        setRollups(Object.entries(data).map(([hash, v]) => ({ hash, ...v })));
      })
      .catch((e) => console.error('Ranking rollups fetch failed:', e));
  };
  refetch();
  return () => {}; // fetch has no cleanup; refetch is triggered by state below
}, [user]);
```

For signed-out refetch, add a state trigger:

```ts
const [rollupsRefreshTick, setRollupsRefreshTick] = useState(0);
```

Then in the fetch path, depend on this tick too, and call `setRollupsRefreshTick((n) => n + 1)` at the end of every local-mode save / favorite / delete success handler.

- [ ] **Step 2: Add `applyRecipe` handler in App.tsx**

Add the handler that maps a `RankedRecipe` back to form state:

```ts
const applyRecipe = (recipe: RankedRecipe) => {
  const p = recipe.params;
  // Find the full model title (with hash suffix) from currently loaded SD models.
  // stripHashSuffix is idempotent so we compare with equal-or-startsWith on the base name.
  const stripped = p.model;
  const fullTitle = sdModels.find((m) => {
    const base = m.title.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
    return base === stripped;
  })?.title;
  setSelectedModel(fullTitle ?? p.model);
  setSelectedSampler(p.sampler);
  setSelectedScheduler(p.scheduler);
  const [wStr, hStr] = p.size.split('x');
  const w = Number(wStr);
  const h = Number(hStr);
  if (Number.isFinite(w) && Number.isFinite(h)) {
    setWidth(w);
    setHeight(h);
  }
  setHiresFixEnabled(p.hires);
  setSelectedLoras(p.loras.map((name) => ({ name, weight: 0.8 })));
  setSelectedRefiner(p.refiner);
  setSelectedVae(p.vae || 'Automatic');
  addToast(t.ranking.applyToast, 'success');
};
```

State-setter names above are approximate — adapt to whatever your existing `App.tsx` calls them.

- [ ] **Step 3: Pass props to `ControlPanel`**

Locate the `<ControlPanel …/>` invocation in App.tsx and add three new props:

```tsx
<ControlPanel
  /* ...existing props... */
  rollups={rollups}
  onApplyRecipe={applyRecipe}
  onFormTabRequested={() => {/* filled in by ControlPanel tab state itself; may be optional */}}
/>
```

(If ControlPanel manages the tab state internally, `onFormTabRequested` isn't needed — depends on Step 4's design. Prefer internal tab state; delete this line if so.)

- [ ] **Step 4: Add tab UI inside `ControlPanel.tsx`**

Open `client/src/components/ControlPanel.tsx`. At the top, add imports and props:

```ts
import { useState } from 'react';
import RankingPanel from './RankingPanel';
import { t } from '../i18n';
import type { RankingRollup, RankedRecipe } from '../utils/rankingAnalysis';
```

Extend the Props type:

```ts
rollups: RankingRollup[];
onApplyRecipe: (recipe: RankedRecipe) => void;
```

Inside the component, wrap the existing form return with a tab shell. Use a `tab` state and a `switchTab` helper that goes through `document.startViewTransition` when available (mirrors the existing batch-modal-tabs pattern already used elsewhere in the codebase for smooth resize):

```tsx
const [tab, setTab] = useState<'form' | 'ranking'>('form');

const switchTab = (next: 'form' | 'ranking') => {
  if (tab === next) return;
  const apply = () => setTab(next);
  const start = (document as unknown as {
    startViewTransition?: (cb: () => void) => unknown;
  }).startViewTransition;
  if (typeof start === 'function') start.call(document, apply);
  else apply();
};

// When the user picks a recipe, switch back to the form tab automatically.
const handleApply = (r: RankedRecipe) => {
  props.onApplyRecipe(r);
  switchTab('form');
};

return (
  <div /* existing outer wrapper */>
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => switchTab('form')}
        style={{
          flex: 1,
          padding: '8px 12px',
          border: 'none',
          borderRadius: 6,
          background: tab === 'form' ? 'var(--accent, #339af0)' : 'var(--panel-bg-inset, rgba(0,0,0,0.04))',
          color: tab === 'form' ? 'white' : 'var(--text)',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {t.controlPanel.tabForm}
      </button>
      <button
        type="button"
        onClick={() => switchTab('ranking')}
        style={{
          flex: 1,
          padding: '8px 12px',
          border: 'none',
          borderRadius: 6,
          background: tab === 'ranking' ? 'var(--accent, #339af0)' : 'var(--panel-bg-inset, rgba(0,0,0,0.04))',
          color: tab === 'ranking' ? 'white' : 'var(--text)',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {t.controlPanel.tabRanking}
      </button>
    </div>
    {tab === 'form' ? (
      /* existing form JSX unchanged */
      <form>...</form>
    ) : (
      <RankingPanel rollups={props.rollups} sdModels={props.sdModels} onApplyRecipe={handleApply} />
    )}
  </div>
);
```

Wrap the entire existing form return in the ternary — do not delete or rewrite it.

- [ ] **Step 5: Build + full test suite**

```bash
npm run build --prefix client
npm run test:run --prefix client
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/components/ControlPanel.tsx
git commit -m "feat: wire rankingRollups subscription and RankingPanel tab into ControlPanel"
```

---

## Task 11: End-to-end verification with Chrome DevTools MCP (Loop Engineering, up to 10 iterations)

**Files:** None modified — verification only. If issues surface, patch the responsible task's files and re-run tests + browser check.

- [ ] **Step 1: Restart dev servers**

Ensure both `dev:server` and `dev:client` are running (`npm run dev` at repo root). Confirm `http://localhost:5173/` loads.

- [ ] **Step 2: Connect Chrome DevTools MCP and navigate to app**

Use `mcp__chrome-devtools__new_page` with `url: http://localhost:5173/?hl=ja` (or `?hl=en` for English UI). Take a snapshot to confirm the page loaded.

- [ ] **Step 3: Verify Ranking tab renders**

Via `mcp__chrome-devtools__evaluate_script`, click the "🏆 ランキング" tab and check:

```js
async () => {
  // Find and click the ranking tab
  const rankingTab = Array.from(document.querySelectorAll('button')).find((b) =>
    (b.textContent || '').includes('ランキング') || (b.textContent || '').includes('Ranking'),
  );
  if (!rankingTab) return { error: 'ranking tab not found' };
  rankingTab.click();
  await new Promise((r) => setTimeout(r, 400));
  // Count recipe cards (each has a "フォームに適用" button)
  const applyButtons = Array.from(document.querySelectorAll('button')).filter((b) =>
    (b.textContent || '').includes('フォームに適用') || (b.textContent || '').includes('Apply to form'),
  );
  return { recipeCount: applyButtons.length };
}
```

Expected: `recipeCount` is between 1 and 10 (probably 10 given the backfilled data volume).

- [ ] **Step 4: Verify "Apply to form" changes form state and switches tab**

```js
async () => {
  const applyBtns = Array.from(document.querySelectorAll('button')).filter((b) =>
    (b.textContent || '').includes('フォームに適用') || (b.textContent || '').includes('Apply to form'),
  );
  if (!applyBtns.length) return { error: 'no apply buttons' };
  applyBtns[0].click();
  await new Promise((r) => setTimeout(r, 600));
  // Verify form tab is now active
  const formTab = Array.from(document.querySelectorAll('button')).find((b) =>
    ((b.textContent || '').includes('フォーム') || (b.textContent || '').includes('Form')) &&
    !(b.textContent || '').includes('複数枚')
  );
  const modelSelect = document.querySelector('select[value]') as HTMLSelectElement | null;
  return {
    formTabActive: formTab ? getComputedStyle(formTab).color : null,
    modelValue: modelSelect?.value,
  };
}
```

Expected: form tab reactivated (color contrast), model field populated.

- [ ] **Step 5: Verify rollup counter increments on new generation**

Note the current top recipe's `total` value from the DOM. Trigger a generation with matching params, wait for completion, then re-check the Ranking tab and verify `total` went up by 1 for the corresponding row.

If any of Steps 3–5 fail, patch the responsible task's implementation, re-run the failing test suite, and re-run this task. Repeat up to 10 times.

- [ ] **Step 6: No commit needed unless a fix was applied in a prior task**

If a fix was needed, commit within the responsible task's boundary, not here.

---

## Post-Implementation

Once Tasks 1–11 are all complete and browser verification passes, the user can push to origin. This plan does not include a push step — that stays under explicit user control per project convention.

An ADR (`adr-0021-favorite-recipe-ranking-rollup.md` or similar) documenting the design decision (materialised view pattern, SHA-256 hash format, version-based migration strategy) may be added as a separate follow-up commit after user review.
