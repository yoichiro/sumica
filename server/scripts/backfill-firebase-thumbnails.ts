// One-off migration for the CLOUD path: for every Firestore `generations`
// document across every user, download the full-res PNG from Storage,
// produce a 256px WebP thumbnail, upload it to `users/{uid}/thumbs/…`,
// and patch the doc with `thumbnailUrl` + `thumbnailStoragePath`.
//
// Idempotent — docs that already have a thumbnailUrl are skipped.
//
// One-shot use only. `firebase-admin` is a devDependency; the runtime
// server does not import it (see CLAUDE.md — the app stays Firebase-free
// on the server side).
//
// Setup:
//   1. Firebase Console → Project Settings → Service Accounts →
//      "Generate new private key" → download JSON
//   2. Save at server/firebase-key.json (or set
//      FIREBASE_SERVICE_ACCOUNT_KEY_PATH to a custom path). The default
//      location matches server/.gitignore's `firebase-key.json` rule.
//   3. Optional: set FIREBASE_STORAGE_BUCKET in server/.env
//      (defaults to `<project_id>.appspot.com`).
//
// Usage (from the repo root):
//   npx tsx server/scripts/backfill-firebase-thumbnails.ts
//
// Env:
//   FIREBASE_SERVICE_ACCOUNT_KEY_PATH — service account JSON path
//     (default: server/firebase-key.json)
//   FIREBASE_STORAGE_BUCKET — storage bucket name
//     (default: `${service_account.project_id}.appspot.com`)
//   THUMB_DRY_RUN=1 — report what would happen without writing anything

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load server/.env if present — same convention as the runtime server.
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_KEY_PATH = path.join(__dirname, '..', 'firebase-key.json');
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || DEFAULT_KEY_PATH;
const DRY_RUN = process.env.THUMB_DRY_RUN === '1';

const THUMBNAIL_MAX_DIMENSION = 256;
const THUMBNAIL_QUALITY = 80;

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`❌ Service account key not found at ${SERVICE_ACCOUNT_PATH}\n`);
  console.error('Setup:');
  console.error('  1. Firebase Console → Project Settings → Service Accounts');
  console.error('  2. "Generate new private key" → download JSON');
  console.error(`  3. Save at ${DEFAULT_KEY_PATH}`);
  console.error('     (or export FIREBASE_SERVICE_ACCOUNT_KEY_PATH=/custom/path.json)');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`;

const app = initializeApp({
  credential: cert(serviceAccount),
  storageBucket: bucketName,
});

const db = getFirestore(app);
const bucket = getStorage(app).bucket();

// Build the same public download URL shape that the client's getDownloadURL()
// returns: v0 REST endpoint + URL-encoded object path + alt=media + a
// firebaseStorageDownloadTokens token stored in the object metadata. Files
// uploaded by Admin SDK don't get this token automatically; the client SDK
// requires it to serve the file, so we mint one per thumbnail.
const buildDownloadUrl = (storagePath: string, token: string): string =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;

interface GenerationDoc {
  storagePath?: string;
  thumbnailUrl?: string;
  thumbnailStoragePath?: string;
  timestamp?: number;
  [key: string]: unknown;
}

async function main() {
  console.log(`Project: ${serviceAccount.project_id}`);
  console.log(`Bucket:  ${bucket.name}`);
  console.log(`Service account: ${serviceAccount.client_email}`);
  if (DRY_RUN) console.log('DRY RUN — no writes will occur\n');
  else console.log('');

  console.log('Querying generations across all users (collection group)...');
  const snap = await db.collectionGroup('generations').get();
  console.log(`Found ${snap.size} document(s).\n`);

  let skipped = 0;
  let generated = 0;
  let failed = 0;

  for (let i = 0; i < snap.docs.length; i++) {
    const doc = snap.docs[i];
    const data = doc.data() as GenerationDoc;
    // `users/{uid}/generations/{docId}` — the doc's parent is `generations`,
    // and that collection's parent doc has the uid as its id.
    const uid = doc.ref.parent.parent?.id ?? 'unknown';
    const label = `[${i + 1}/${snap.size}] ${uid.slice(0, 8)}…/${doc.id}`;

    // Skip anything already migrated (thumbnailUrl set is the authoritative marker).
    if (data.thumbnailUrl) {
      skipped++;
      continue;
    }

    if (!data.storagePath) {
      console.warn(`${label} — no storagePath, skipping`);
      failed++;
      continue;
    }

    try {
      const [pngBuffer] = await bucket.file(data.storagePath).download();

      const thumbBuffer = await sharp(pngBuffer)
        .resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: THUMBNAIL_QUALITY })
        .toBuffer();

      // Anchor the thumbnail path on the same timestamp that the client uses
      // for the original PNG. Falls back to `now` for legacy records without
      // one — either way the object lives under the user's namespace.
      const timestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now();
      const thumbnailStoragePath = `users/${uid}/thumbs/generated_${timestamp}.webp`;
      const downloadToken = randomUUID();
      const thumbnailUrl = buildDownloadUrl(thumbnailStoragePath, downloadToken);

      if (!DRY_RUN) {
        await bucket.file(thumbnailStoragePath).save(thumbBuffer, {
          metadata: {
            contentType: 'image/webp',
            metadata: { firebaseStorageDownloadTokens: downloadToken },
          },
        });
        await doc.ref.update({
          thumbnailUrl,
          thumbnailStoragePath,
        });
      }

      generated++;
      if (generated % 10 === 0 || generated === 1) {
        console.log(`${label} — ${DRY_RUN ? 'would write' : 'wrote'} thumb (${(thumbBuffer.length / 1024).toFixed(1)}KB)`);
      }
    } catch (e) {
      console.error(`${label} — failed: ${(e as Error).message}`);
      failed++;
    }
  }

  console.log(`\nSummary: generated=${generated}  skipped=${skipped}  failed=${failed}  total=${snap.size}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Backfill script crashed:', e);
    process.exit(1);
  });
