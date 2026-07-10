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
