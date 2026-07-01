// One-off migration: generate the sidecar 256px WebP thumbnails for every
// pre-existing PNG in server/outputs/, and record thumbnailUrl +
// thumbnailPath into metadata.json.
//
// Idempotent — items that already have a thumbnailUrl and whose thumbnail
// file exists on disk are skipped. Safe to re-run after new local generations
// (though new generations produce their own thumbnail inline, so a re-run is
// usually a no-op).
//
// Usage (from the repo root):
//   npx tsx server/scripts/backfill-thumbnails.ts
//
// Env:
//   PORT — server port used to build the returned URL (default 5000).
//          Should match the running server's PORT so URLs are reachable.
//   THUMB_DRY_RUN=1 — report what would happen without writing anything.

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputsDir = path.resolve(__dirname, '..', 'outputs');
const metadataPath = path.join(outputsDir, 'metadata.json');

const PORT = process.env.PORT || '5000';
const DRY_RUN = process.env.THUMB_DRY_RUN === '1';

const THUMBNAIL_MAX_DIMENSION = 256;
const THUMBNAIL_QUALITY = 80;

interface GenerationMetadata {
  id?: string;
  imageUrl: string;
  thumbnailUrl?: string;
  localPath?: string;
  thumbnailPath?: string;
  timestamp: number;
  [key: string]: unknown;
}

const readMetadata = (): GenerationMetadata[] => {
  if (!fs.existsSync(metadataPath)) {
    console.error(`metadata.json not found at ${metadataPath}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse metadata.json: ${(e as Error).message}`);
    process.exit(1);
  }
};

const writeMetadata = (history: GenerationMetadata[]): void => {
  fs.writeFileSync(metadataPath, JSON.stringify(history, null, 2));
};

// Return the on-disk PNG path for a record. Prefers the stored localPath when
// present; falls back to reconstructing from the imageUrl (…/generated_TS.png)
// so records written before localPath was added still process.
const resolveImagePath = (item: GenerationMetadata): string | null => {
  if (item.localPath && fs.existsSync(item.localPath)) return item.localPath;
  const match = item.imageUrl?.match(/generated_\d+\.png$/);
  if (match) {
    const candidate = path.join(outputsDir, match[0]);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const thumbPathFor = (imagePath: string): string => {
  const base = path.basename(imagePath, path.extname(imagePath));
  return path.join(outputsDir, `${base}_thumb.webp`);
};

async function main() {
  const history = readMetadata();
  console.log(`Loaded ${history.length} records from metadata.json`);
  if (DRY_RUN) console.log('DRY RUN — no files or metadata will be written');

  let skipped = 0;
  let generated = 0;
  let failed = 0;

  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    const label = `[${i + 1}/${history.length}] ${item.id ?? item.timestamp}`;

    // Skip records that already have a thumbnail whose file is present.
    if (item.thumbnailUrl && item.thumbnailPath && fs.existsSync(item.thumbnailPath)) {
      skipped++;
      continue;
    }

    const imagePath = resolveImagePath(item);
    if (!imagePath) {
      console.warn(`${label} — original image not found, skipping`);
      failed++;
      continue;
    }

    const thumbPath = thumbPathFor(imagePath);
    const thumbFileName = path.basename(thumbPath);
    const thumbnailUrl = `http://localhost:${PORT}/api/outputs/${thumbFileName}`;

    try {
      if (!DRY_RUN) {
        const buffer = await sharp(imagePath)
          .resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: THUMBNAIL_QUALITY })
          .toBuffer();
        fs.writeFileSync(thumbPath, buffer);
        item.thumbnailUrl = thumbnailUrl;
        item.thumbnailPath = thumbPath;
      }
      generated++;
      if (generated % 10 === 0 || generated === 1) {
        console.log(`${label} — thumbnail ${DRY_RUN ? 'would be' : 'written'}: ${thumbFileName}`);
      }
    } catch (e) {
      console.error(`${label} — failed: ${(e as Error).message}`);
      failed++;
    }
  }

  if (!DRY_RUN && generated > 0) {
    writeMetadata(history);
    console.log(`\nmetadata.json updated (${generated} record${generated === 1 ? '' : 's'} touched).`);
  }

  console.log(`\nSummary: generated=${generated}  skipped=${skipped}  failed=${failed}  total=${history.length}`);
}

main().catch((e) => {
  console.error('Backfill script crashed:', e);
  process.exit(1);
});
