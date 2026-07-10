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
