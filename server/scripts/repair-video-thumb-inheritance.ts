// One-off repair for a bug where saveVideoGeneration inherited the parent
// image record's Firebase Storage refs into video records via `...params`,
// most damagingly `thumbnailStoragePath`. On video delete, deleteGenerations
// then unlinked the parent's thumb Storage object as a side effect, breaking
// the parent's gallery card.
//
// This script does two passes:
//   1. Video records — rewrite thumbnailStoragePath / thumbnailUrl so each
//      video points at its own poster (or clears both fields if no poster
//      was extracted).
//   2. Parent image thumbs — for every thumb path a video previously
//      inherited, verify the Storage object still exists; if it has already
//      been deleted, regenerate the WebP from the parent's PNG and rewrite
//      the parent doc's thumbnailUrl with a fresh token.
//
// Idempotent: a second run finds no video with inherited paths and no
// missing parent thumbs, so it does nothing.
//
// Setup / usage / env: identical to backfill-firebase-thumbnails.ts —
// service-account key at server/firebase-key.json (or
// FIREBASE_SERVICE_ACCOUNT_KEY_PATH), THUMB_DRY_RUN=1 for a dry run.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_KEY_PATH = path.join(__dirname, '..', 'firebase-key.json');
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || DEFAULT_KEY_PATH;
const DRY_RUN = process.env.THUMB_DRY_RUN === '1';

const THUMBNAIL_MAX_DIMENSION = 256;
const THUMBNAIL_QUALITY = 80;

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`Service account key not found at ${SERVICE_ACCOUNT_PATH}`);
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

const buildDownloadUrl = (storagePath: string, token: string): string =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;

interface GenerationDoc {
  mediaType?: 'image' | 'video';
  storagePath?: string;
  thumbnailUrl?: string;
  thumbnailStoragePath?: string;
  posterUrl?: string;
  posterStoragePath?: string;
  timestamp?: number;
  [key: string]: unknown;
}

async function main() {
  console.log(`Project: ${serviceAccount.project_id}`);
  console.log(`Bucket:  ${bucket.name}`);
  if (DRY_RUN) console.log('DRY RUN — no writes\n'); else console.log('');

  const snap = await db.collectionGroup('generations').get();
  console.log(`Scanning ${snap.size} generation doc(s)...\n`);

  // Build a lookup from thumbnailStoragePath -> owning docs, so pass 2 can
  // find the image record that owns a broken thumb without needing a
  // collection-group index on that field.
  const thumbPathIndex = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const d of snap.docs) {
    const data = d.data() as GenerationDoc;
    if (data.mediaType === 'video') continue; // videos temporarily point at parent thumbs; skip
    if (!data.thumbnailStoragePath) continue;
    const list = thumbPathIndex.get(data.thumbnailStoragePath) ?? [];
    list.push(d);
    thumbPathIndex.set(data.thumbnailStoragePath, list);
  }

  // Pass 1: rewrite each video record's thumbnail fields to point at its
  // OWN poster (or clear them). Collect the OLD paths — those are parent
  // thumbs a video was inheriting, and may need recovery in pass 2.
  const suspectParentThumbPaths = new Set<string>();
  let videosSeen = 0;
  let videosFixed = 0;

  for (const d of snap.docs) {
    const data = d.data() as GenerationDoc;
    if (data.mediaType !== 'video') continue;
    videosSeen++;

    const currentThumbPath = data.thumbnailStoragePath;
    const ownPosterPath = data.posterStoragePath;
    const ownPosterUrl = data.posterUrl;

    // Already correct: thumb == own poster (or both absent).
    if (currentThumbPath === ownPosterPath) continue;

    // The current thumb path is the parent's — remember it for pass 2.
    if (currentThumbPath) suspectParentThumbPaths.add(currentThumbPath);

    const update: Record<string, unknown> = {};
    if (ownPosterPath) {
      update.thumbnailStoragePath = ownPosterPath;
      update.thumbnailUrl = ownPosterUrl ?? FieldValue.delete();
    } else {
      update.thumbnailStoragePath = FieldValue.delete();
      update.thumbnailUrl = FieldValue.delete();
    }

    console.log(`video ${d.id}: thumb ${currentThumbPath ?? '(none)'} -> ${ownPosterPath ?? '(cleared)'}`);
    if (!DRY_RUN) await d.ref.update(update);
    videosFixed++;
  }

  console.log(`\nPass 1: videos seen=${videosSeen}, fixed=${videosFixed}`);
  console.log(`Suspect parent thumb paths to verify: ${suspectParentThumbPaths.size}\n`);

  // Pass 2: for every suspect parent-thumb path, check the Storage object.
  // If missing, find the image doc that owns it and regenerate from PNG.
  let recoveredThumbs = 0;
  let stillIntact = 0;
  let recoveryFailed = 0;

  for (const thumbPath of suspectParentThumbPaths) {
    const [exists] = await bucket.file(thumbPath).exists();
    if (exists) {
      stillIntact++;
      continue;
    }

    // Look up the image doc that references this thumbnail path.
    const owners = thumbPathIndex.get(thumbPath) ?? [];

    if (owners.length === 0) {
      console.warn(`thumb ${thumbPath}: MISSING and no owning doc found`);
      recoveryFailed++;
      continue;
    }

    for (const owner of owners) {
      const ownerData = owner.data() as GenerationDoc;
      if (!ownerData.storagePath) {
        console.warn(`owner ${owner.id}: no storagePath, cannot regenerate`);
        recoveryFailed++;
        continue;
      }

      try {
        const [pngBuffer] = await bucket.file(ownerData.storagePath).download();
        const thumbBuffer = await sharp(pngBuffer)
          .resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: THUMBNAIL_QUALITY })
          .toBuffer();
        const downloadToken = randomUUID();
        const freshUrl = buildDownloadUrl(thumbPath, downloadToken);

        if (!DRY_RUN) {
          await bucket.file(thumbPath).save(thumbBuffer, {
            metadata: {
              contentType: 'image/webp',
              metadata: { firebaseStorageDownloadTokens: downloadToken },
            },
          });
          await owner.ref.update({ thumbnailUrl: freshUrl });
        }

        console.log(`recovered ${thumbPath} (owner ${owner.id}, ${(thumbBuffer.length / 1024).toFixed(1)}KB)`);
        recoveredThumbs++;
      } catch (e) {
        console.error(`recovery failed for ${thumbPath}: ${(e as Error).message}`);
        recoveryFailed++;
      }
    }
  }

  console.log(`\nPass 2: recovered=${recoveredThumbs}, intact=${stillIntact}, failed=${recoveryFailed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Repair script crashed:', e);
    process.exit(1);
  });
