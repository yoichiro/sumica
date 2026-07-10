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
