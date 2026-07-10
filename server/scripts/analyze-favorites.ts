// Feasibility / recommendation analysis: given every Firestore `generations`
// document across every user, produce a hybrid ranking:
//
//   • Combination ranking (main output) — treats each real generation recipe
//     as a whole and ranks by Wilson lower bound of the favorite rate.
//     Captures interaction effects that per-parameter rankings miss (e.g.
//     "this model prefers 512×768 even though the overall best size is
//     512×1024"). Filtered to combinations with `total >= MIN_SAMPLE`
//     to avoid singleton noise.
//   • Per-parameter ranking (secondary output) — for each dimension in
//     isolation, ranks values by Wilson lower bound. Uses all data for
//     each dimension, so it retains statistical power even when the
//     combination cells are sparse.
//
// Dimensions with zero variance in the data (all rows identical) are
// automatically skipped — they contribute no ranking information and
// would otherwise clutter the output.
//
// Model names are normalised via `stripHashSuffix` so that the same
// underlying model file recorded with or without the SD short-hash
// suffix aggregates into a single row (see ADR 16 for the SD-side
// hash-suffix quirk).
//
// Setup: reuses `server/firebase-key.json` (same convention as
// backfill-firebase-thumbnails.ts).
//
// Usage (from the repo root):
//   npx tsx server/scripts/analyze-favorites.ts

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_KEY_PATH = path.join(__dirname, '..', 'firebase-key.json');
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || DEFAULT_KEY_PATH;

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
  steps?: number;
  cfgScale?: number;
  width?: number;
  height?: number;
  enableHr?: boolean;
  loras?: { name: string; weight: number }[];
  refiner?: string;
  vae?: string;
  isFavorite?: boolean;
  timestamp?: number;
}

// Configurable knobs
const MIN_SAMPLE_FOR_COMBO = 5; // combinations with fewer gens are hidden
const TOP_N_COMBOS = 15;
const TOP_N_PER_DIM = 10;
const Z = 1.96; // 95% CI

/** Strip the trailing ` [hexhash]` from an SD checkpoint title (see ADR 16). */
function stripHashSuffix(title: string): string {
  return title.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
}

/** Wilson lower bound of a 95% CI for a binomial proportion. */
function wilsonLower(favs: number, total: number, z = Z): number {
  if (total === 0) return 0;
  const p = favs / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return (centre - spread) / denom;
}

interface Bucket {
  key: string;
  total: number;
  favs: number;
}

interface Ranked extends Bucket {
  rate: number;
  wilson: number;
}

function tally(items: Gen[], keyOf: (g: Gen) => string): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const it of items) {
    const k = keyOf(it);
    if (!m.has(k)) m.set(k, { key: k, total: 0, favs: 0 });
    const b = m.get(k)!;
    b.total++;
    if (it.isFavorite) b.favs++;
  }
  return [...m.values()];
}

function rank(buckets: Bucket[]): Ranked[] {
  return buckets
    .map((b) => ({
      ...b,
      rate: b.total > 0 ? b.favs / b.total : 0,
      wilson: wilsonLower(b.favs, b.total),
    }))
    .sort((a, b) => b.wilson - a.wilson || b.total - a.total);
}

function fmtRow(r: Ranked, keyWidth = 60): string {
  const key = r.key.length > keyWidth ? r.key.slice(0, keyWidth - 3) + '...' : r.key;
  return `${(r.wilson * 100).toFixed(1).padStart(5)}%  ${(r.rate * 100).toFixed(1).padStart(5)}%  ${String(r.favs).padStart(4)}/${String(r.total).padStart(4)}  ${key}`;
}

/** Return true iff every value in `values` is the same (zero-variance dimension). */
function hasZeroVariance(items: Gen[], keyOf: (g: Gen) => string): boolean {
  const seen = new Set<string>();
  for (const it of items) {
    seen.add(keyOf(it));
    if (seen.size > 1) return false;
  }
  return true;
}

async function main(): Promise<void> {
  console.log('Fetching all generations across users …');
  const snap = await db.collectionGroup('generations').get();
  const items: Gen[] = snap.docs.map((d) => d.data() as Gen);

  const total = items.length;
  const favs = items.filter((x) => x.isFavorite).length;
  const overallRate = total > 0 ? (favs / total) * 100 : 0;

  console.log(`\n=== Overview ===`);
  console.log(`Total generations: ${total}`);
  console.log(`Favorited:         ${favs}`);
  console.log(`Overall fav rate:  ${overallRate.toFixed(2)}%`);
  console.log(`Users represented: ${new Set(snap.docs.map((d) => d.ref.parent.parent?.id)).size}`);

  // Each dimension is a (label, keyOf) pair. Only dimensions with variance
  // contribute both to the per-parameter ranking and to the combination
  // recipe — zero-variance dims add no ranking information.
  const allDims: [string, (g: Gen) => string][] = [
    ['model', (g) => stripHashSuffix(g.model || '(unknown)')],
    ['sampler', (g) => g.sampler || '(none)'],
    ['scheduler', (g) => g.scheduler || '(none)'],
    ['size', (g) => (g.width && g.height ? `${g.width}×${g.height}` : '(unknown)')],
    ['hires', (g) => (g.enableHr ? 'HR-on' : 'HR-off')],
    ['steps', (g) => String(g.steps ?? '(none)')],
    ['cfg', (g) => String(g.cfgScale ?? '(none)')],
    [
      'loras',
      (g) =>
        (g.loras || [])
          .map((l) => l.name)
          .sort()
          .join(',') || '(none)',
    ],
  ];

  const variantDims: typeof allDims = [];
  const invariantDims: string[] = [];
  for (const dim of allDims) {
    if (hasZeroVariance(items, dim[1])) invariantDims.push(dim[0]);
    else variantDims.push(dim);
  }

  if (invariantDims.length > 0) {
    console.log(
      `\n(Dimensions with zero variance across all ${total} generations — excluded from ranking: ${invariantDims.join(', ')})`,
    );
  }

  // ==============================================================
  // MAIN OUTPUT: combination ranking
  // ==============================================================
  const comboKey = (g: Gen): string => variantDims.map(([, keyOf]) => keyOf(g)).join(' | ');
  const combos = tally(items, comboKey);
  const usableCombos = combos.filter((c) => c.total >= MIN_SAMPLE_FOR_COMBO);

  console.log(`\n=== Combination ranking (recipe → favorite rate) ===`);
  console.log(`Combinations across ${variantDims.length} dims: ${combos.length} unique`);
  console.log(
    `≥${MIN_SAMPLE_FOR_COMBO} samples: ${usableCombos.length}  |  singletons dropped: ${
      combos.filter((c) => c.total === 1).length
    }  |  with ≥1 fav: ${combos.filter((c) => c.favs > 0).length}`,
  );
  console.log(`Header order: ${variantDims.map(([n]) => n).join(' | ')}`);
  console.log(`\nTop ${TOP_N_COMBOS} recipes (Wilson lower ↓)`);
  console.log('Wilson%  Rate%   favs/total  recipe');
  const topCombos = rank(usableCombos).slice(0, TOP_N_COMBOS);
  for (const r of topCombos) console.log(fmtRow(r, 100));

  // ==============================================================
  // SECONDARY OUTPUT: per-dimension rankings
  // ==============================================================
  console.log(`\n=== Per-dimension rankings (helpful to explain WHY the top recipes win) ===`);
  for (const [name, keyOf] of variantDims) {
    console.log(`\n--- ${name} ---`);
    console.log('Wilson%  Rate%   favs/total  value');
    const rows = rank(tally(items, keyOf)).slice(0, TOP_N_PER_DIM);
    for (const r of rows) console.log(fmtRow(r));
  }

  // ==============================================================
  // Feasibility verdict
  // ==============================================================
  const modelsWithFav = tally(items, (g) => stripHashSuffix(g.model || '(unknown)')).filter(
    (b) => b.favs > 0,
  ).length;
  console.log(`\n=== Feasibility verdict ===`);
  console.log(`Models with ≥1 fav: ${modelsWithFav}`);
  console.log(`Combinations with ≥${MIN_SAMPLE_FOR_COMBO} samples: ${usableCombos.length}`);
  console.log(`Total favs: ${favs}`);
  if (modelsWithFav >= 3 && favs >= 20 && usableCombos.length >= 5) {
    console.log(`✅ Data volume is sufficient for a directional ranking.`);
  } else {
    console.log(`⚠️  Data volume is still thin — treat rankings as directional at best.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Analysis failed:', e);
    process.exit(1);
  });
