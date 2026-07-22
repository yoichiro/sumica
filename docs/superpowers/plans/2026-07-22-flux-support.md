# Flux Support & 3-Way Architecture 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sumica を「SD1.5 / SDXL / Flux」の 3-way アーキテクチャに拡張し、Flux [schnell/dev] チェックポイントを first-class として扱う。副産物として ADR-16 の SDXL 誤判定バグ（生成時に `modelArchitecture` を永続化することで解決）も同 PR で完結させる。

**Architecture:** 既存の 2-way `modelTypeFilter: 'sd15'|'sdxl'` トグルの単一情報源設計 (ADR-29) をそのまま 3-way に拡張する。サーバー側は `isSdxlCheckpoint()` を `classifyCheckpointArch()` に置き換えて `{ type: Architecture; fluxVariant?: FluxVariant }` を返す。クライアント側は `FLUX_PRESETS` を追加し、Flux 選択時に steps / CFG / sampler / negative UI / Hires.fix / VAE / Refiner を Flux 向けの挙動に切り替える。LLM enhance は `arch` を受け取り、Flux では自然言語プロンプト + 空 negative を返す system prompt に切り替える。`GenerationMetadata.modelArchitecture` を新設し、`loadIntoForm` はそれを最優先で信頼する。

**Tech Stack:** サーバー: TypeScript + tsx + Express 5 + `sharp` (unchanged) / クライアント: React 19 + Vite 8 + TypeScript + Vitest + oxlint / 新規 npm 依存なし。

## Global Constraints

- **ESM**: 両パッケージとも `"type": "module"`。`import`/`export` 構文のみ。
- **サーバー: dist 無し**: `server/index.ts` は tsx で直接実行。ビルドステップは無い。型チェックは `npm run typecheck --prefix server` (`tsc --noEmit`) のみ。
- **クライアント: oxlint + Vitest + Vite build**: lint は `npm run lint --prefix client`、テストは `./node_modules/.bin/vitest run` (cwd = `client/`)、build は `./node_modules/.bin/vite build`。
- **既存 SD1.5 / SDXL 挙動は絶対に壊さない**: 3-way 化しても `modelTypeFilter === 'sd15' | 'sdxl'` の branch は現状の code path そのまま。
- **後方互換 (API)**: `/api/enhance` の `arch` フィールド、`/api/generate` の `modelArchitecture` フィールドはいずれも optional。未送信時は現行挙動維持。
- **後方互換 (metadata)**: 既存 Firestore/local レコードに `modelArchitecture` を後付けしない。`loadIntoForm` は `modelArchitecture` 存在時のみ信頼、なければ現行 `inferSdArchitectureFromTitle` にフォールバック。
- **命名固定**:
  - Server API 応答: `type: 'sd15'|'sdxl'|'flux'`、`fluxVariant?: 'schnell'|'dev'`
  - Client state: `modelTypeFilter: Architecture`
  - Persisted metadata: `modelArchitecture?: Architecture`
- **UI ラベル固定**: 3-way segment は `SD` / `SDXL` / `Flux`（既存の `sdLabel: 'SD'` を保持、Flux を追加）。
- **Flux モード時の除外**: Negative prompt (`disabled`)、VAE picker（SDXL 専用のまま）、Refiner（SDXL 専用のまま）、Hires.fix（新規 guard 追加）。
- **コミットメッセージ**: 英語 1 行 imperative mood。日本語不可。
- **コメントは英語**: 追加/変更する source コメントも英語。
- **`--no-verify` 禁止**: pre-commit hook が落ちたら根本を直して新規コミットにする（`--amend` 禁止）。
- **ADR 同時更新**: 実装 PR に adr-0042 新規と adr-0016/0009/0029 更新を含める（別 PR に分けない）。

---

### Task 1: presets.ts に Flux 型・FLUX_PRESETS・resolve/find 関数を追加

**Files:**
- Modify: `client/src/components/presets.ts`
- Modify: `client/src/components/presets.test.ts`

**Interfaces:**
- Consumes: 既存の `SdxlOrientation` (`'landscape'|'portrait'|'square'`) 型を Flux にも流用
- Produces:
  - `SdModel.type` を `'sd15'|'sdxl'|'flux'` に拡張、`SdModel.fluxVariant?: 'schnell'|'dev'` フィールド追加
  - `SdLora.type` を `'sd15'|'sdxl'|'flux'|'unknown'` に拡張
  - `FluxRatio`, `FluxSize`, `FluxSizeSpec`, `FluxPreset` 型
  - `FLUX_SIZES`, `FLUX_PRESETS` 定数
  - `resolveFluxDimensions(preset, orientation, size): { width; height; isFluxNative }`
  - `findFluxSelection(width, height): { ratio; orientation; size } | null`

- [ ] **Step 1: 既存 `SdModel` / `SdLora` 型 union を拡張**

`client/src/components/presets.ts` のファイル冒頭 (行 6-7) を次のように変更:

```typescript
// Before:
export type SdModel = { title: string; type: 'sd15' | 'sdxl' };
export type SdLora = { name: string; type: 'sd15' | 'sdxl' | 'unknown' };

// After:
export type Architecture = 'sd15' | 'sdxl' | 'flux';
export type FluxVariant = 'schnell' | 'dev';
export type SdModel = { title: string; type: Architecture; fluxVariant?: FluxVariant };
export type SdLora = { name: string; type: Architecture | 'unknown' };
```

`Architecture` と `FluxVariant` を再エクスポート型として置くことで、App.tsx / ControlPanel.tsx / BatchGenerationModal.tsx / loadIntoFormState.ts はすべて `presets` から import できる。

- [ ] **Step 2: `FLUX_PRESETS` および関連型を追加**

`client/src/components/presets.ts` の末尾（`findSd15Selection` 関数のあと）に次を追記します:

```typescript
// ---- Flux ----

export type FluxRatio = '1:1' | '4:3' | '9:7' | '3:2' | '16:9' | '21:9' | '3:1';
export type FluxSize = 'S' | 'M' | 'L';

export interface FluxSizeSpec {
  width: number;   // landscape width (or square side length)
  height: number;  // landscape height (or square side length)
  // Marks the ≈1MP recommendation. Flux was not trained with aspect-ratio
  // buckets like SDXL, so this is a soft quality hint rather than a hard
  // bucket identifier.
  isFluxNative: boolean;
}

export interface FluxPreset {
  ratio: FluxRatio;
  label: string;
  isSquare: boolean;
  sizes: Record<FluxSize, FluxSizeSpec>;
}

export const FLUX_SIZES: readonly FluxSize[] = ['S', 'M', 'L'];

export const FLUX_PRESETS: readonly FluxPreset[] = [
  {
    ratio: '1:1', label: '1:1', isSquare: true,
    sizes: {
      S: { width: 768,  height: 768,  isFluxNative: false },
      M: { width: 1024, height: 1024, isFluxNative: true  },
      L: { width: 1216, height: 1216, isFluxNative: false },
    },
  },
  {
    ratio: '4:3', label: '4:3', isSquare: false,
    sizes: {
      S: { width: 768,  height: 576,  isFluxNative: false },
      M: { width: 1152, height: 832,  isFluxNative: true  },
      L: { width: 1344, height: 1024, isFluxNative: false },
    },
  },
  {
    ratio: '9:7', label: '9:7', isSquare: false,
    sizes: {
      S: { width: 896,  height: 768,  isFluxNative: false },
      M: { width: 1152, height: 896,  isFluxNative: true  },
      L: { width: 1408, height: 1088, isFluxNative: false },
    },
  },
  {
    ratio: '3:2', label: '3:2', isSquare: false,
    sizes: {
      S: { width: 1152, height: 768,  isFluxNative: false },
      M: { width: 1216, height: 832,  isFluxNative: true  },
      L: { width: 1344, height: 896,  isFluxNative: false },
    },
  },
  {
    ratio: '16:9', label: '16:9', isSquare: false,
    sizes: {
      S: { width: 1024, height: 576,  isFluxNative: false },
      M: { width: 1344, height: 768,  isFluxNative: true  },
      L: { width: 1600, height: 896,  isFluxNative: false },
    },
  },
  {
    ratio: '21:9', label: '21:9', isSquare: false,
    sizes: {
      S: { width: 1344, height: 576,  isFluxNative: false },
      M: { width: 1536, height: 640,  isFluxNative: true  },
      L: { width: 1792, height: 768,  isFluxNative: false },
    },
  },
  {
    ratio: '3:1', label: '3:1', isSquare: false,
    sizes: {
      S: { width: 1344, height: 448,  isFluxNative: false },
      M: { width: 1728, height: 576,  isFluxNative: true  },
      L: { width: 1920, height: 640,  isFluxNative: false },
    },
  },
];

// (ratio, orientation, size) → concrete (width, height). Portrait swaps landscape's
// width/height; square ignores orientation. Mirrors resolveSdxlDimensions.
export function resolveFluxDimensions(
  preset: FluxPreset,
  orientation: SdxlOrientation,
  size: FluxSize,
): { width: number; height: number; isFluxNative: boolean } {
  const spec = preset.sizes[size];
  if (preset.isSquare || orientation !== 'portrait') {
    return { width: spec.width, height: spec.height, isFluxNative: spec.isFluxNative };
  }
  return { width: spec.height, height: spec.width, isFluxNative: spec.isFluxNative };
}

// Reverse-map a raw (width, height) back to Flux picker coordinates. Used to seed
// the Flux picker on architecture switches and loadIntoForm. Returns null when
// no preset matches — the caller falls back to a default (1:1 / square / M).
export function findFluxSelection(
  width: number,
  height: number,
): { ratio: FluxRatio; orientation: SdxlOrientation; size: FluxSize } | null {
  for (const preset of FLUX_PRESETS) {
    for (const size of FLUX_SIZES) {
      const spec = preset.sizes[size];
      if (preset.isSquare) {
        if (spec.width === width && spec.height === height) {
          return { ratio: preset.ratio, orientation: 'square', size };
        }
      } else {
        if (spec.width === width && spec.height === height) {
          return { ratio: preset.ratio, orientation: 'landscape', size };
        }
        if (spec.height === width && spec.width === height) {
          return { ratio: preset.ratio, orientation: 'portrait', size };
        }
      }
    }
  }
  return null;
}
```

- [ ] **Step 3: `presets.test.ts` に Flux セクションを追加**

`client/src/components/presets.test.ts` の末尾に次を追記します（既存の SDXL/SD1.5 describe ブロックは触らない）:

```typescript
import {
  FLUX_PRESETS,
  FLUX_SIZES,
  resolveFluxDimensions,
  findFluxSelection,
  type FluxSize,
} from './presets';

describe('Flux presets', () => {
  it('round-trips every (ratio, orientation, size) via resolve + find', () => {
    for (const preset of FLUX_PRESETS) {
      for (const size of FLUX_SIZES) {
        if (preset.isSquare) {
          const { width, height } = resolveFluxDimensions(preset, 'square', size);
          const found = findFluxSelection(width, height);
          expect(found).toEqual({ ratio: preset.ratio, orientation: 'square', size });
        } else {
          for (const orientation of ['landscape', 'portrait'] as const) {
            const { width, height } = resolveFluxDimensions(preset, orientation, size);
            const found = findFluxSelection(width, height);
            expect(found).toEqual({ ratio: preset.ratio, orientation, size });
          }
        }
      }
    }
  });

  it('returns null from findFluxSelection for non-preset dimensions', () => {
    expect(findFluxSelection(511, 511)).toBeNull();
    expect(findFluxSelection(1023, 1025)).toBeNull();
    expect(findFluxSelection(0, 0)).toBeNull();
  });

  it('marks only M sizes as isFluxNative', () => {
    for (const preset of FLUX_PRESETS) {
      expect(preset.sizes.M.isFluxNative).toBe(true);
      expect(preset.sizes.S.isFluxNative).toBe(false);
      expect(preset.sizes.L.isFluxNative).toBe(false);
    }
  });

  it('1:1 M resolves to 1024x1024', () => {
    const oneToOne = FLUX_PRESETS.find(p => p.ratio === '1:1')!;
    expect(resolveFluxDimensions(oneToOne, 'square', 'M')).toEqual({
      width: 1024, height: 1024, isFluxNative: true,
    });
  });
});
```

- [ ] **Step 4: テスト実行**

Run: `./node_modules/.bin/vitest run` (cwd = `client/`)
Expected: 全テスト green（Flux セクションの 4 test が追加され、既存の SDXL/SD1.5 テストも引き続き pass）。

- [ ] **Step 5: 型チェック**

Run: `./node_modules/.bin/tsc -b` (cwd = `client/`)
Expected: 0 errors。`SdModel.type` の union 拡張は既存の比較 (`m.type === 'sdxl'` など) と互換なので、消費側 (App.tsx / ControlPanel.tsx / BatchGenerationModal.tsx) は変更なしで build 通る。

- [ ] **Step 6: コミット**

```bash
git add client/src/components/presets.ts client/src/components/presets.test.ts
git commit -m "feat: add FLUX_PRESETS and 3-way SdModel/SdLora type unions"
```

---

### Task 2: server の `classifyCheckpointArch` を実装し `/api/sd-models` / `/api/sd-loras` の応答を拡張

**Files:**
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: 既存の `toWslPath()` ヘルパー、safetensors ヘッダー読み込みの実装パターン (行 353-373)
- Produces:
  - `classifyCheckpointArch(filename, title): Promise<{ type: Architecture; fluxVariant?: FluxVariant }>` (Architecture / FluxVariant は server 側で定義した union、client の presets.ts の union と値が一致)
  - `/api/sd-models` 応答の `models[i]` に `type: Architecture` と `fluxVariant?: FluxVariant` を含める
  - `classifyLoraArchitecture()` の返り値に `'flux'` を追加
  - 旧 `isSdxlCheckpoint()` は削除

- [ ] **Step 1: server/index.ts に Architecture / FluxVariant 型を追加**

`server/index.ts` の interface 定義群 (行 39 の `GenerationMetadata` 直前) に次を追記します:

```typescript
// Architecture union shared across the server API surface. Values match
// client/src/components/presets.ts's Architecture union.
type Architecture = 'sd15' | 'sdxl' | 'flux';
type FluxVariant = 'schnell' | 'dev';
```

- [ ] **Step 2: `isSdxlCheckpoint()` を `classifyCheckpointArch()` に置き換え**

`server/index.ts:344-373` の `isSdxlCheckpoint` 関数 (コメント含む) を次で置換します:

```typescript
// Classify a checkpoint into 'sd15' / 'sdxl' / 'flux' by reading the .safetensors
// header (an 8-byte little-endian length prefix followed by that many bytes of
// JSON tensor metadata) without loading any tensor data. Detection order:
//   1) model.diffusion_model.double_blocks.* (Flux DiT). Then peek at
//      __metadata__ for a flux1-dev reference; default to schnell otherwise.
//   2) conditioner.embedders.* (SDXL — both base and refiner).
//   3) Fallback → sd15.
// Falls back to a name heuristic on read failure so the model list keeps
// working even if the file path is unreachable.
async function classifyCheckpointArch(
  filename: string | undefined,
  title: string,
): Promise<{ type: Architecture; fluxVariant?: FluxVariant }> {
  if (filename) {
    try {
      const handle = await fs.promises.open(toWslPath(filename), 'r');
      try {
        const lengthBuffer = Buffer.alloc(8);
        await handle.read(lengthBuffer, 0, 8, 0);
        const headerLength = Number(lengthBuffer.readBigUInt64LE(0));
        const headerBuffer = Buffer.alloc(headerLength);
        await handle.read(headerBuffer, 0, headerLength, 8);
        const header = JSON.parse(headerBuffer.toString('utf-8')) as Record<string, unknown>;
        const keys = Object.keys(header).filter((k) => k !== '__metadata__');
        if (keys.some((k) => k.startsWith('model.diffusion_model.double_blocks.'))) {
          const metaStr = JSON.stringify(header.__metadata__ ?? {});
          const fluxVariant: FluxVariant = /flux1?[-_]?dev/i.test(metaStr) ? 'dev' : 'schnell';
          return { type: 'flux', fluxVariant };
        }
        if (keys.some((k) => k.startsWith('conditioner.embedders.'))) {
          return { type: 'sdxl' };
        }
        return { type: 'sd15' };
      } finally {
        await handle.close();
      }
    } catch (error) {
      console.error(`Failed to read safetensors header for ${title}, falling back to name heuristic:`, (error as Error).message);
    }
  }
  const lower = title.toLowerCase();
  if (lower.includes('flux')) {
    return { type: 'flux', fluxVariant: lower.includes('dev') ? 'dev' : 'schnell' };
  }
  if (lower.includes('xl')) return { type: 'sdxl' };
  return { type: 'sd15' };
}
```

- [ ] **Step 3: `/api/sd-models` 応答生成箇所を新関数に切り替え**

`server/index.ts:643` 付近 (`/api/sd-models` の map 内で `isSdxlCheckpoint` を呼んでいる箇所) を次のように変更します:

```typescript
// Before:
type: (await isSdxlCheckpoint(m.filename, m.title)) ? 'sdxl' as const : 'sd15' as const,

// After:
...(await classifyCheckpointArch(m.filename, m.title)),
```

`classifyCheckpointArch` の戻り値 `{ type; fluxVariant? }` がそのまま model エントリに spread される。すでにフィルタリング (XL除外) は撤廃されている (ADR-29) ので、追加のフィルタ変更は不要。

- [ ] **Step 4: `classifyLoraArchitecture()` に Flux 判定を追加**

`server/index.ts:696` 付近の `classifyLoraArchitecture` を次のように変更します:

```typescript
// Before:
function classifyLoraArchitecture(metadata: Record<string, unknown> | undefined): 'sd15' | 'sdxl' | 'unknown' {
  const arch = String(metadata?.['modelspec.architecture'] ?? metadata?.['ss_base_model_version'] ?? '').toLowerCase();
  if (arch.includes('xl')) return 'sdxl';
  if (arch.includes('stable-diffusion-v1') || arch.startsWith('sd_v1') || arch.startsWith('sd_1')) return 'sd15';
  return 'unknown';
}

// After:
function classifyLoraArchitecture(metadata: Record<string, unknown> | undefined): Architecture | 'unknown' {
  const arch = String(metadata?.['modelspec.architecture'] ?? metadata?.['ss_base_model_version'] ?? '').toLowerCase();
  // Flux markers precede SDXL because 'flux1-schnell' does not contain 'xl'
  // but SDXL merges based on Flux naming conventions may exist elsewhere;
  // ordering keeps genuine Flux LoRAs correctly typed.
  if (arch.includes('flux') || arch.startsWith('flux1')) return 'flux';
  if (arch.includes('xl')) return 'sdxl';
  if (arch.includes('stable-diffusion-v1') || arch.startsWith('sd_v1') || arch.startsWith('sd_1')) return 'sd15';
  return 'unknown';
}
```

- [ ] **Step 5: 旧 `isSdxlCheckpoint` 関数を削除**

Step 2 で `classifyCheckpointArch` に置換したので、`isSdxlCheckpoint` のコメントブロックを含む定義 (Step 2 で置換した範囲) は完全に消える。追加で `grep -n "isSdxlCheckpoint" server/index.ts` を実行して他に参照が残っていないことを確認します。予期に反して残っていたら削除 or 置換します。

- [ ] **Step 6: サーバー型チェック**

Run: `npm run typecheck --prefix server`
Expected: 0 errors。

- [ ] **Step 7: dev server を再起動して curl で挙動を確認**

Sumica が稼働中でなければ `npm run dev:server` で起動します。稼働中なら再起動して `server/index.ts` の変更を反映させます。

```bash
curl -s http://localhost:5000/api/sd-models | python3 -m json.tool | head -50
```

期待される内容:
- `2758FluxAsianUtopian_v60SchnellFp8Noclip.safetensors [ed2bd39653]` が `{ "type": "flux", "fluxVariant": "schnell" }` として返る
- `sd_xl_base_1.0.safetensors` が `{ "type": "sdxl" }`
- `v1-5-pruned-emaonly.safetensors` が `{ "type": "sd15" }`
- 他の SDXL/SD1.5 モデルも既存の分類を維持

```bash
curl -s http://localhost:5000/api/sd-loras | python3 -m json.tool | head -30
```

期待される内容:
- 既存 LoRA が `type: 'sd15'|'sdxl'|'unknown'` のまま返る（今回は Flux LoRA が入っていない場合、'flux' は現れない可能性が高い）
- 応答が壊れていないこと（少なくとも 200 OK と JSON 配列）

- [ ] **Step 8: コミット**

```bash
git add server/index.ts
git commit -m "feat: classify checkpoints into sd15/sdxl/flux with variant detection"
```

---

### Task 3: `fluxDefaults.ts` 純関数と test を追加

**Files:**
- Create: `client/src/components/fluxDefaults.ts`
- Create: `client/src/components/fluxDefaults.test.ts`

**Interfaces:**
- Consumes: `FluxVariant` 型 (Task 1 で `presets.ts` に定義済み)
- Produces:
  - `interface FluxDefaultsOverrides { stepsUserOverride: boolean; cfgUserOverride: boolean; samplerUserOverride: boolean; schedulerUserOverride: boolean; }`
  - `interface FluxCurrentValues { steps: number; cfg: number; sampler: string; scheduler: string; }`
  - `computeFluxDefaults(variant: FluxVariant | undefined, overrides: FluxDefaultsOverrides, current: FluxCurrentValues): FluxCurrentValues`

- [ ] **Step 1: `fluxDefaults.ts` を新規作成**

`client/src/components/fluxDefaults.ts` を新規作成し、次の内容を書き込みます:

```typescript
import type { FluxVariant } from './presets';

// Per-field flags flipping to true on the corresponding onChange in App.tsx.
// When a flag is true, computeFluxDefaults preserves the current value; when
// false, it applies the variant-appropriate default. Toggling modelTypeFilter
// or switching Flux checkpoints of different variants clears all flags in
// App.tsx (not here) so the new defaults land cleanly.
export interface FluxDefaultsOverrides {
  stepsUserOverride: boolean;
  cfgUserOverride: boolean;
  samplerUserOverride: boolean;
  schedulerUserOverride: boolean;
}

export interface FluxCurrentValues {
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

// Flux variant-specific defaults. schnell is the fast-distilled variant that
// only respects CFG=1.0 and produces good output at 1–4 steps; dev accepts
// CFG guidance and needs ~20–30 steps.
const SCHNELL_DEFAULTS: FluxCurrentValues = {
  steps: 4,
  cfg: 1.0,
  sampler: 'Euler',
  scheduler: 'Simple',
};

const DEV_DEFAULTS: FluxCurrentValues = {
  steps: 25,
  cfg: 3.5,
  sampler: 'Euler',
  scheduler: 'Simple',
};

// Computes what steps/cfg/sampler/scheduler should be when a Flux model is
// active. Per-field: if the user has overridden the field, keep the current
// value; otherwise return the variant default. Unknown variant (Flux checkpoint
// without variant metadata) is treated as schnell.
export function computeFluxDefaults(
  variant: FluxVariant | undefined,
  overrides: FluxDefaultsOverrides,
  current: FluxCurrentValues,
): FluxCurrentValues {
  const defaults = variant === 'dev' ? DEV_DEFAULTS : SCHNELL_DEFAULTS;
  return {
    steps: overrides.stepsUserOverride ? current.steps : defaults.steps,
    cfg: overrides.cfgUserOverride ? current.cfg : defaults.cfg,
    sampler: overrides.samplerUserOverride ? current.sampler : defaults.sampler,
    scheduler: overrides.schedulerUserOverride ? current.scheduler : defaults.scheduler,
  };
}
```

- [ ] **Step 2: `fluxDefaults.test.ts` を新規作成**

`client/src/components/fluxDefaults.test.ts` を新規作成し、次の内容を書き込みます:

```typescript
import { describe, it, expect } from 'vitest';
import { computeFluxDefaults, type FluxDefaultsOverrides, type FluxCurrentValues } from './fluxDefaults';

const NO_OVERRIDES: FluxDefaultsOverrides = {
  stepsUserOverride: false,
  cfgUserOverride: false,
  samplerUserOverride: false,
  schedulerUserOverride: false,
};

const ARBITRARY_CURRENT: FluxCurrentValues = {
  steps: 12,
  cfg: 7,
  sampler: 'DPM++ 2M',
  scheduler: 'Karras',
};

describe('computeFluxDefaults', () => {
  it('applies schnell defaults when no overrides and variant is schnell', () => {
    const result = computeFluxDefaults('schnell', NO_OVERRIDES, ARBITRARY_CURRENT);
    expect(result).toEqual({ steps: 4, cfg: 1.0, sampler: 'Euler', scheduler: 'Simple' });
  });

  it('applies dev defaults when no overrides and variant is dev', () => {
    const result = computeFluxDefaults('dev', NO_OVERRIDES, ARBITRARY_CURRENT);
    expect(result).toEqual({ steps: 25, cfg: 3.5, sampler: 'Euler', scheduler: 'Simple' });
  });

  it('treats undefined variant as schnell', () => {
    const result = computeFluxDefaults(undefined, NO_OVERRIDES, ARBITRARY_CURRENT);
    expect(result).toEqual({ steps: 4, cfg: 1.0, sampler: 'Euler', scheduler: 'Simple' });
  });

  it('preserves per-field values when the corresponding override is true', () => {
    const overrides: FluxDefaultsOverrides = {
      stepsUserOverride: true,
      cfgUserOverride: false,
      samplerUserOverride: false,
      schedulerUserOverride: false,
    };
    const result = computeFluxDefaults('schnell', overrides, { ...ARBITRARY_CURRENT, steps: 12 });
    // steps is preserved (12), everything else takes schnell defaults.
    expect(result).toEqual({ steps: 12, cfg: 1.0, sampler: 'Euler', scheduler: 'Simple' });
  });

  it('preserves all fields when all overrides are true', () => {
    const overrides: FluxDefaultsOverrides = {
      stepsUserOverride: true,
      cfgUserOverride: true,
      samplerUserOverride: true,
      schedulerUserOverride: true,
    };
    const result = computeFluxDefaults('dev', overrides, ARBITRARY_CURRENT);
    expect(result).toEqual(ARBITRARY_CURRENT);
  });
});
```

- [ ] **Step 3: テスト実行**

Run: `./node_modules/.bin/vitest run` (cwd = `client/`)
Expected: 全テスト green（fluxDefaults の 5 test が追加され、既存テストも引き続き pass）。

- [ ] **Step 4: 型チェック**

Run: `./node_modules/.bin/tsc -b` (cwd = `client/`)
Expected: 0 errors。

- [ ] **Step 5: コミット**

```bash
git add client/src/components/fluxDefaults.ts client/src/components/fluxDefaults.test.ts
git commit -m "feat: add computeFluxDefaults pure resolver for schnell/dev variants"
```

---

### Task 4: server `/api/enhance` に `arch` 分岐と Flux LLM system prompt を追加

**Files:**
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: 既存の `enhancePrompt` 実装 (行 132-223)、LM Studio エンドポイント設定
- Produces:
  - `enhancePrompt(userPrompt: string, arch?: Architecture)` にオプショナル `arch` 引数を追加
  - `arch === 'flux'` のとき Flux 専用 system prompt を使用
  - Flux system prompt は自然言語プロンプト + 空 `<negative></negative>` を返す指示
  - `POST /api/enhance` のリクエストボディから `arch` を受け取り `enhancePrompt` に渡す

- [ ] **Step 1: `enhancePrompt` に `arch` 引数を追加し、Flux system prompt 変数を新設**

`server/index.ts:132` の `async function enhancePrompt(userPrompt: string): Promise<EnhancedPrompt> {` を次のように書き換えます:

```typescript
// Flux uses a T5 text encoder and does not honor SD-style (phrase:weight)
// emphasis, and its distilled variants ignore negative prompts. This system
// prompt tells the LLM to output natural-language prose and an empty negative.
const FLUX_SYSTEM_PROMPT = `You are an expert prompt engineer for FLUX image generation.

Flux uses a T5 text encoder which understands NATURAL LANGUAGE prompts.
Do NOT use Stable Diffusion emphasis syntax like (phrase:weight) — that
syntax does not exist in Flux and will be treated as literal text.

Instead, translate the user's concept into fluent, descriptive English
sentences that read like natural writing. Include the subject, action,
setting, lighting, mood, and camera / composition / style as prose.
Prefer 2–5 sentences over a comma-separated tag list.

Emphasis: when the user uses natural-language emphasis cues in Japanese
(かなり / めっちゃ / とびっきり / 強く / 極めて / 完全に etc.) or
English (very / strongly / extremely / prominently), express strength
through wording — repeat / rephrase the concept, use a strong adjective,
or lead the sentence with the emphasized element. Do NOT wrap anything
in parentheses with a numeric weight.

Negative prompt: Flux models do not use negative prompts effectively.
Always return an EMPTY <negative></negative> tag.

Output format:
<prompts><positive>your natural-language prompt</positive><negative></negative></prompts>
Reply ONLY with the XML structure — no introduction, no explanation.`;

// Helper: Translate and enhance prompt via LM Studio, returning positive and negative prompts in XML format
async function enhancePrompt(userPrompt: string, arch: Architecture = 'sd15'): Promise<EnhancedPrompt> {
  const defaultNegative = 'nsfw, low quality, worst quality, deformed, bad anatomy, blurry, disfigured';
  const systemPrompt = arch === 'flux' ? FLUX_SYSTEM_PROMPT : /* existing SD system prompt string, unchanged */;
```

**注意**: 既存の SD system prompt 文字列 (行 141-196 の long template literal) は変数に**抽出**して名前を付けます。抽出後の形:

1. `enhancePrompt` の**外側**に `const SD_SYSTEM_PROMPT = \`You are an expert prompt engineer for Stable Diffusion. ... Reply ONLY with the XML structure.\`;` を置く（既存の template literal をそのままコピー）
2. `enhancePrompt` 内で `const systemPrompt = arch === 'flux' ? FLUX_SYSTEM_PROMPT : SD_SYSTEM_PROMPT;`
3. `messages` の `role: 'system'` の `content:` を `systemPrompt` に差し替え

こうして 2 つの system prompt を関数外で並置します。既存 SD prompt の内容は 1 文字も変更しません。

- [ ] **Step 2: `POST /api/enhance` ハンドラを更新して `arch` を受け取る**

`server/index.ts` 内で `/api/enhance` の Express ルート定義を探し (`grep -n "'/api/enhance'" server/index.ts`)、body から `arch` を読んで `enhancePrompt` に渡すよう変更します:

```typescript
// Before:
app.post('/api/enhance', async (req: Request, res: Response) => {
  const { prompt } = req.body;
  ...
  const result = await enhancePrompt(prompt);
  ...
});

// After:
app.post('/api/enhance', async (req: Request, res: Response) => {
  const { prompt, arch } = req.body as { prompt: string; arch?: Architecture };
  ...
  const result = await enhancePrompt(prompt, arch);
  ...
});
```

`arch` を validate する追加ロジック（未指定なら SD、指定されていて union の値でなければ SD にフォールバック）は `enhancePrompt` のデフォルト引数 `= 'sd15'` に任せます。`arch === 'flux'` 以外は SD prompt という選択規則なので、無効な値も SD にフォールバックします。

- [ ] **Step 3: サーバー型チェック**

Run: `npm run typecheck --prefix server`
Expected: 0 errors。

- [ ] **Step 4: dev server 再起動して curl で挙動確認**

サーバー再起動 → LM Studio 稼働中を確認 (`/api/status` で loaded model を確認)。

**SD 側 (arch 省略 = 既存挙動)**:

```bash
curl -s -X POST http://localhost:5000/api/enhance -H 'Content-Type: application/json' \
  -d '{"prompt":"かなり丸顔な女性"}' | python3 -m json.tool
```

Expected: `positive` に `(round face:1.2)` 相当の SD emphasis が入り、`negative` にデフォルト negative が入る（既存挙動 = 破壊なし）。

**Flux 側 (arch: 'flux')**:

```bash
curl -s -X POST http://localhost:5000/api/enhance -H 'Content-Type: application/json' \
  -d '{"prompt":"かなり丸顔な女性","arch":"flux"}' | python3 -m json.tool
```

Expected: `positive` が自然言語の英文プロンプト（複数センテンス、`(phrase:weight)` を含まない）、`negative` が **空文字列**。

もし LLM が指示を守らず `(phrase:weight)` を出したり negative に文言を入れたら、system prompt の文言を強めに調整するか、Flux system prompt の末尾に few-shot example を 1〜2 個足して LLM が模倣しやすくします（この Task 内でその追加をする、後続 Task に持ち越さない）。

- [ ] **Step 5: コミット**

```bash
git add server/index.ts
git commit -m "feat: add Flux system prompt variant to /api/enhance"
```

---

### Task 5: App.tsx + ControlPanel.tsx + i18n を同時変更して 3-way toggle と Flux UX を実装

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/ControlPanel.tsx`
- Modify: `client/src/i18n/ja.ts`
- Modify: `client/src/i18n/en.ts`

**Interfaces:**
- Consumes:
  - `FLUX_PRESETS`, `resolveFluxDimensions`, `findFluxSelection`, `Architecture`, `FluxVariant`, `SdModel` (Task 1 で拡張済み)
  - `computeFluxDefaults`, `FluxDefaultsOverrides`, `FluxCurrentValues` (Task 3)
- Produces:
  - `modelTypeFilter` state 型を `Architecture` に拡張
  - Flux 用 state (`selectedFluxRatio`, `selectedFluxOrientation`, `selectedFluxSize`)
  - override flags (`stepsUserOverride`, `cfgUserOverride`, `samplerUserOverride`, `schedulerUserOverride`)
  - Flux useEffect (`modelTypeFilter === 'flux'` 時に Flux picker/defaults を適用)
  - `/api/enhance` 呼び出しに `arch: modelTypeFilter` を送信
  - ControlPanel の segment tab を 3-way に、Flux picker を追加、negative prompt を Flux 時 disabled + note 表示、Hires.fix を Flux 時非表示
  - i18n keys: `controlPanel.archFluxLabel`, `controlPanel.noFluxModelsFound`, `controlPanel.fluxNegativeDisabledNote`, `controlPanel.fluxVariantSchnellBadge`, `controlPanel.fluxVariantDevBadge`

**Note**: このタスクは複数ファイルにまたがるが、いずれも「3-way 化」という 1 つの変更単位。App.tsx を単体で変更すると ControlPanel との型不整合で build が通らず、逆も同じ。exclusive-prompt-ui plan の Task 3 と同じ「同時変更で 1 Task」パターン。

- [ ] **Step 1: i18n `ja.ts` に Flux キーを追加**

`client/src/i18n/ja.ts` の `controlPanel: { ... }` ブロック内に次の 5 キーを追加します（追加位置は既存の `noSd15ModelsFound` などの近くが自然）:

```typescript
archFluxLabel: 'Flux',
noFluxModelsFound: 'Fluxモデルが見つかりません',
fluxNegativeDisabledNote: 'Fluxモデルでは negative prompt は使用しません',
fluxVariantSchnellBadge: 'schnell',
fluxVariantDevBadge: 'dev',
```

- [ ] **Step 2: i18n `en.ts` に対応する Flux キーを追加**

`client/src/i18n/en.ts` の `controlPanel: { ... }` ブロック内に同じ 5 キーを追加します:

```typescript
archFluxLabel: 'Flux',
noFluxModelsFound: 'No Flux models found',
fluxNegativeDisabledNote: 'Negative prompt is not used with Flux models',
fluxVariantSchnellBadge: 'schnell',
fluxVariantDevBadge: 'dev',
```

- [ ] **Step 3: App.tsx で `modelTypeFilter` state 型を `Architecture` に拡張**

`client/src/App.tsx:175` (`const [modelTypeFilter, setModelTypeFilter] = useState<'sd15' | 'sdxl'>('sd15');`) を次に変更:

```typescript
import type { Architecture, FluxVariant } from './components/presets';
// ... (import 文の位置は既存 import と同じ block 内で追加)

const [modelTypeFilter, setModelTypeFilter] = useState<Architecture>('sd15');
```

`Architecture` の import は既存の `SDXL_PRESETS` import と同じ block (行 15-17) に統合。

- [ ] **Step 4: App.tsx に Flux 用 state と override flags を追加**

既存の SDXL state (`selectedRatio`, `selectedOrientation`, `selectedSize`) と SD1.5 state (`selectedSd15Ratio`, ...) の直後に次の Flux state を追加します:

```typescript
// Flux picker state — mirrors the SDXL trio. Resolved to (width, height)
// by the same useEffect chain when modelTypeFilter === 'flux'.
const [selectedFluxRatio, setSelectedFluxRatio] = useState<import('./components/presets').FluxRatio>('1:1');
const [selectedFluxOrientation, setSelectedFluxOrientation] =
  useState<import('./components/presets').SdxlOrientation>('square');
const [selectedFluxSize, setSelectedFluxSize] = useState<import('./components/presets').FluxSize>('M');

// Per-field override flags for Flux defaults. Flip to true on the
// corresponding onChange (steps, cfg, sampler, scheduler). Cleared when
// modelTypeFilter changes or when the active Flux model's variant changes,
// so the arch/variant defaults reapply cleanly.
const [stepsUserOverride, setStepsUserOverride] = useState(false);
const [cfgUserOverride, setCfgUserOverride] = useState(false);
const [samplerUserOverride, setSamplerUserOverride] = useState(false);
const [schedulerUserOverride, setSchedulerUserOverride] = useState(false);
```

- [ ] **Step 5: App.tsx の `modelTypeFilter` useEffect に Flux branch を追加**

`client/src/App.tsx:825-870` 付近の `useEffect(() => { ... }, [modelTypeFilter]);` に、SDXL/SD1.5 の分岐と並列で Flux 分岐を追加します。既存の分岐は変更せず、末尾に append。

```typescript
} else if (modelTypeFilter === 'sd15') {
  // ... existing sd15 branch, unchanged ...
} else if (modelTypeFilter === 'flux') {
  // Seed the Flux picker from the current width/height. If nothing matches,
  // fall back to 1:1 M (1024x1024).
  const found = findFluxSelection(width, height);
  if (found) {
    setSelectedFluxRatio(found.ratio);
    setSelectedFluxOrientation(found.orientation);
    setSelectedFluxSize(found.size);
  } else {
    setSelectedFluxRatio('1:1');
    setSelectedFluxOrientation('square');
    setSelectedFluxSize('M');
    setWidth(1024);
    setHeight(1024);
  }
  // Clear override flags so Flux defaults reapply on model select
  setStepsUserOverride(false);
  setCfgUserOverride(false);
  setSamplerUserOverride(false);
  setSchedulerUserOverride(false);
  // Rescope selectedModel to a Flux model (falls back to '' when none)
  setSelectedModel((prev) =>
    sdModels.some((m) => m.type === 'flux' && m.title === prev)
      ? prev
      : sdModels.find((m) => m.type === 'flux')?.title ?? ''
  );
}
```

**Import 追加**: `findFluxSelection` を presets からの import に追加します（Step 3 の import block を拡張）:

```typescript
import {
  SDXL_PRESETS,
  ...
  FLUX_PRESETS,
  findFluxSelection,
  resolveFluxDimensions,
} from './components/presets';
```

- [ ] **Step 6: App.tsx に Flux picker → (width, height) 反映 useEffect を追加**

既存の SDXL 用 (`useEffect(() => { ... }, [modelTypeFilter, selectedRatio, selectedOrientation, selectedSize]);`) の直後に、Flux 用の対応 useEffect を追加します:

```typescript
useEffect(() => {
  if (modelTypeFilter !== 'flux') return;
  const preset = FLUX_PRESETS.find(p => p.ratio === selectedFluxRatio);
  if (!preset) return;
  const { width: w, height: h } = resolveFluxDimensions(preset, selectedFluxOrientation, selectedFluxSize);
  setWidth(w);
  setHeight(h);
}, [modelTypeFilter, selectedFluxRatio, selectedFluxOrientation, selectedFluxSize]);
```

- [ ] **Step 7: App.tsx で Flux モデル選択時に fluxDefaults を適用する useEffect を追加**

既存の autoswitch 系 useEffect の後に、次を追加します:

```typescript
import { computeFluxDefaults } from './components/fluxDefaults';
// ... (import 文の位置は既存 import 側に統合)

useEffect(() => {
  if (modelTypeFilter !== 'flux') return;
  const activeModel = sdModels.find(m => m.title === selectedModel);
  if (!activeModel || activeModel.type !== 'flux') return;
  const next = computeFluxDefaults(
    activeModel.fluxVariant,
    { stepsUserOverride, cfgUserOverride, samplerUserOverride, schedulerUserOverride },
    { steps, cfg: cfgScale, sampler: selectedSampler, scheduler: selectedScheduler },
  );
  if (next.steps !== steps) setSteps(next.steps);
  if (next.cfg !== cfgScale) setCfgScale(next.cfg);
  if (next.sampler !== selectedSampler) setSelectedSampler(next.sampler);
  if (next.scheduler !== selectedScheduler) setSelectedScheduler(next.scheduler);
  // Note: intentionally NOT depending on the current values of the fields
  // being computed — we want this to re-fire ONLY when the model changes
  // (or arch toggles clear the overrides).
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [modelTypeFilter, selectedModel, stepsUserOverride, cfgUserOverride, samplerUserOverride, schedulerUserOverride]);
```

`steps`, `cfgScale`, `selectedSampler`, `selectedScheduler` は本当は依存に入るべきだが、上のロジックが自己再帰的に fire するので依存から意図的に除く（既存の autoswitch パターンでも同種の抑止をやっているならそのコメントスタイルに合わせる。なければこの逃げが最小）。

**別解を実装フェーズで検討**: 上の eslint-disable が oxlint 側で警告になるようなら、ロジックを 1 shot resolver に切り出して `useEffect` 内で「モデル切替イベントのみに反応」する形に書き換えます。実装者は `client/.oxlintrc.json` の rules をまず確認してください。

- [ ] **Step 8: App.tsx で steps/cfg/sampler/scheduler の onChange に override flag セットを追加**

`grep -n "setSteps\|setCfgScale\|setSelectedSampler\|setSelectedScheduler" client/src/App.tsx` で該当箇所を洗い出し、**UI の onChange 経由の setter 呼び出し**（`loadIntoForm`, `applyRecipeToForm` 等の内部同期経由ではなく、`ControlPanel` から props で渡した setter がユーザー操作で呼ばれるケース）を特定します。

ControlPanel 側の onChange から `p.setSteps(newVal)` などが呼ばれる箇所は、App.tsx で新規 wrapper を用意して override flag も一緒に立てます。

```typescript
// App.tsx 内で定義:
const setStepsFromUser = (v: number) => { setSteps(v); setStepsUserOverride(true); };
const setCfgFromUser = (v: number) => { setCfgScale(v); setCfgUserOverride(true); };
const setSamplerFromUser = (v: string) => { setSelectedSampler(v); setSamplerUserOverride(true); };
const setSchedulerFromUser = (v: string) => { setSelectedScheduler(v); setSchedulerUserOverride(true); };

// ControlPanel に渡すのは新 wrapper:
<ControlPanel
  ...
  setSteps={setStepsFromUser}
  setCfgScale={setCfgFromUser}
  setSelectedSampler={setSamplerFromUser}
  setSelectedScheduler={setSchedulerFromUser}
  ...
/>
```

`loadIntoForm` および他の内部同期関数 (`applyRecipeToForm` 等) は override flag を立てない `setSteps` (raw) を引き続き使う。同時に、`loadIntoForm` の末尾で override flags をすべて `true` に立てて、「ロードした画像が Flux でも default で上書きされない」ようにします:

```typescript
// loadIntoForm 関数の末尾 (setSelectedModel など既存 setter のあとに):
setStepsUserOverride(true);
setCfgUserOverride(true);
setSamplerUserOverride(true);
setSchedulerUserOverride(true);
```

- [ ] **Step 9: App.tsx で `/api/enhance` 呼び出しに `arch: modelTypeFilter` を送信**

`grep -n "'/api/enhance'\|api/enhance" client/src/App.tsx` で fetch 呼び出し箇所を特定します（`enhanceOnce` ヘルパー内）。body に `arch` を追加:

```typescript
// Before:
body: JSON.stringify({ prompt })

// After:
body: JSON.stringify({ prompt, arch: modelTypeFilter })
```

**注意**: `enhanceOnce` が現在 arch を引数で受け取っていない場合は、シグネチャに追加する（`enhanceOnce(prompt: string, arch: Architecture)`）か、closure 経由で `modelTypeFilter` を参照するかどちらか。既存呼び出し側（handleGenerate と handleBatchGenerate）を全部 grep で洗って、両方の呼び出し側で `modelTypeFilter` を渡すよう修正します。

- [ ] **Step 10: ControlPanel.tsx の props に Flux 関連を追加**

`client/src/components/ControlPanel.tsx` の props interface 冒頭付近 (行 29 の `modelTypeFilter: 'sd15' | 'sdxl';` 行) を次のように変更します:

```typescript
// Before:
modelTypeFilter: 'sd15' | 'sdxl';
setModelTypeFilter: (v: 'sd15' | 'sdxl') => void;

// After:
modelTypeFilter: Architecture;
setModelTypeFilter: (v: Architecture) => void;
selectedFluxRatio: FluxRatio;
setSelectedFluxRatio: (v: FluxRatio) => void;
selectedFluxOrientation: SdxlOrientation;
setSelectedFluxOrientation: (v: SdxlOrientation) => void;
selectedFluxSize: FluxSize;
setSelectedFluxSize: (v: FluxSize) => void;
```

対応する import を presets からの import に追加します:

```typescript
import {
  SDXL_PRESETS,
  ...
  FLUX_PRESETS,
  FLUX_SIZES,
  type Architecture,
  type FluxRatio,
  type FluxSize,
  type SdxlOrientation,
} from '../components/presets';
```

- [ ] **Step 11: ControlPanel.tsx の segment tab loop を 3-way に拡張**

`client/src/components/ControlPanel.tsx:327` 付近 (現行 `{modelType === 'sd15' ? 'SD' : 'SDXL'}`) を含む segment tab 全体を確認します（`grep -n "modelTypeFilter === modelType\|['sd15', 'sdxl']" client/src/components/ControlPanel.tsx`）。

現状 segment ループの `.map` 対象が `(['sd15', 'sdxl'] as const)` のような形なら、`(['sd15', 'sdxl', 'flux'] as const)` に拡張し、ラベル部分を:

```typescript
{modelType === 'sd15' ? 'SD' : modelType === 'sdxl' ? 'SDXL' : t.controlPanel.archFluxLabel}
```

に書き換えます。segment button の disable 条件や onClick は既存パターンをそのまま踏襲（3 値目でも同じ挙動）。

- [ ] **Step 12: ControlPanel.tsx の preset picker JSX を 3-way に拡張**

`client/src/components/ControlPanel.tsx:395` (`p.modelTypeFilter === 'sdxl' ? (() => {` から始まる ternary) を確認。現状 SDXL ブランチと SD1.5 ブランチが分岐している構造を、Flux ブランチを追加した 3-way ternary に拡張します:

```typescript
{p.modelTypeFilter === 'sdxl' ? (() => {
  // ... existing SDXL picker JSX, unchanged
})()
: p.modelTypeFilter === 'flux' ? (() => {
  // Flux picker — mirrors the SDXL picker structure but uses FLUX_PRESETS
  // and the Flux state props.
  const currentPreset = FLUX_PRESETS.find(pp => pp.ratio === p.selectedFluxRatio) ?? FLUX_PRESETS[0];
  const isSquare = currentPreset.isSquare;
  return (
    <>
      {/* ratio chips */}
      <div style={{ /* same style as SDXL ratio row */ }}>
        {FLUX_PRESETS.map((preset) => (
          <button
            key={preset.ratio}
            type="button"
            onClick={() => p.setSelectedFluxRatio(preset.ratio)}
            style={{ /* selected / unselected style matching SDXL chip */ }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {/* orientation toggle (skip when isSquare) */}
      {!isSquare && (
        <div style={{ /* SDXL orientation style */ }}>
          {(['landscape', 'portrait'] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => p.setSelectedFluxOrientation(o)}
              style={{ /* selected style */ }}
            >
              {o === 'landscape' ? '横' : '縦'}
            </button>
          ))}
        </div>
      )}
      {/* size chips */}
      <div style={{ /* SDXL size row style */ }}>
        {FLUX_SIZES.map((s) => {
          const spec = currentPreset.sizes[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => p.setSelectedFluxSize(s)}
              style={{ /* selected style, plus native badge treatment if spec.isFluxNative */ }}
            >
              {s} {spec.isFluxNative ? '⭐' : ''} {spec.width}×{spec.height}
            </button>
          );
        })}
      </div>
    </>
  );
})()
: (() => {
  // ... existing SD1.5 picker JSX, unchanged
})()}
```

具体的な style は SDXL picker と完全に揃えます (`isSdxlBucket` の ⭐ 表示 と同じ形で `isFluxNative` の ⭐ を出す)。SDXL の該当箇所を写経しつつ `SDXL_PRESETS` → `FLUX_PRESETS`, `p.selectedRatio` → `p.selectedFluxRatio` に置換するイメージです。

- [ ] **Step 13: ControlPanel.tsx で Flux 時に negative prompt を disabled にする**

`grep -n "negativePrompt\|Negative\|Task" client/src/components/ControlPanel.tsx` で既存の negative prompt textarea 箇所を特定します（既存の拡張プロンプトパネル内の Negative 表示ではなく、original 原文の negative textarea を探します。存在しない可能性もあります — 拡張プロンプトを sever に投げるフローでは negative textarea を UI に露出させていないため）。

**もし negative textarea が UI に無い場合**: `<textarea disabled>` を追加するのではなく、Flux 選択時に「Flux モデルでは negative prompt は使用しません」のノートを拡張プロンプトパネルの Negative ラベル脇か、フォーム末尾に表示するだけで OK です。実装フェーズで既存 UI を再確認して以下 2 パターンから適切な方を選びます:

- **Pattern A**: 拡張プロンプトパネル (loadedPositive/loadedNegative パネル) の Negative ブロックに `p.modelTypeFilter === 'flux'` の条件で `{t.controlPanel.fluxNegativeDisabledNote}` を表示し、`<textarea disabled>` にする。
- **Pattern B**: Flux モード時、拡張プロンプトパネル自体は残しつつ、Negative の textarea を灰色表示 + ノート表示。

実装フェーズで `grep -n "loadedNegative\|LoadedNegative" client/src/components/ControlPanel.tsx` の結果に基づき Pattern A/B のどちらかを実装。どちらの場合も i18n キー `t.controlPanel.fluxNegativeDisabledNote` を使用。

- [ ] **Step 14: ControlPanel.tsx で Hires.fix を Flux 時非表示にする**

`client/src/components/ControlPanel.tsx:681` (`{/* Hires.fix */}`) から始まる Hires.fix セクションを、`{p.modelTypeFilter !== 'flux' && (...)}` の条件レンダで囲みます:

```typescript
{p.modelTypeFilter !== 'flux' && (
  <>
    {/* Hires.fix */}
    ... existing Hires.fix JSX ...
  </>
)}
```

Hires.fix セクションの終了位置は次の JSX ブロック (LoRA 等) が始まる直前まで。範囲を正確に判定するために、`grep -n "Hires\|LoRA\|Refiner" client/src/components/ControlPanel.tsx` で境界を確認します。

- [ ] **Step 15: ControlPanel.tsx で モデルドロップダウンの「該当モデルなし」メッセージを 3-way に拡張**

`client/src/components/ControlPanel.tsx:347` (`t.controlPanel.modelsUnavailable : p.modelTypeFilter === 'sdxl' ? t.controlPanel.noSdxlModelsFound : t.controlPanel.noSd15ModelsFound`) を次に変更:

```typescript
{p.sdModels.length === 0
  ? t.controlPanel.modelsUnavailable
  : p.modelTypeFilter === 'sdxl' ? t.controlPanel.noSdxlModelsFound
  : p.modelTypeFilter === 'flux' ? t.controlPanel.noFluxModelsFound
  : t.controlPanel.noSd15ModelsFound}
```

- [ ] **Step 16: ControlPanel.tsx で Flux モデル選択時に schnell/dev バッジを表示**

モデルドロップダウンの `<option>` 生成箇所（`grep -n "modelsInScope.map\|sdModels.filter" client/src/components/ControlPanel.tsx`）を特定し、Flux モデルには variant バッジを付ける:

```typescript
// Before:
{modelsInScope.map((m) => (
  <option key={m.title} value={m.title}>{m.title}</option>
))}

// After:
{modelsInScope.map((m) => (
  <option key={m.title} value={m.title}>
    {m.title}
    {m.type === 'flux' && m.fluxVariant === 'schnell' ? ` [${t.controlPanel.fluxVariantSchnellBadge}]` : ''}
    {m.type === 'flux' && m.fluxVariant === 'dev' ? ` [${t.controlPanel.fluxVariantDevBadge}]` : ''}
  </option>
))}
```

- [ ] **Step 17: App.tsx から ControlPanel に新規 Flux prop を渡す**

App.tsx の `<ControlPanel ... />` に Flux state と setter を渡します:

```typescript
<ControlPanel
  ...
  selectedFluxRatio={selectedFluxRatio}
  setSelectedFluxRatio={setSelectedFluxRatio}
  selectedFluxOrientation={selectedFluxOrientation}
  setSelectedFluxOrientation={setSelectedFluxOrientation}
  selectedFluxSize={selectedFluxSize}
  setSelectedFluxSize={setSelectedFluxSize}
  ...
/>
```

- [ ] **Step 18: build と tests を実行**

Run:
```bash
./node_modules/.bin/tsc -b
./node_modules/.bin/vitest run
./node_modules/.bin/vite build
```

Expected: TypeScript 0 errors、tests 全 pass（Task 1 と Task 3 で追加したテストが今回の変更でも通ること）、vite build clean。

- [ ] **Step 19: oxlint 確認**

Run: `npm run lint --prefix client`
Expected: 既存の pre-existing warnings のみ、新規 warning ゼロ。Step 7 の eslint-disable コメントが oxlint で警告になった場合はここで対処 (別解のロジック書き換え)。

- [ ] **Step 20: dev server + client を起動してブラウザで軽く動作確認**

```bash
npm run dev
```

ブラウザで `http://localhost:5173/?hl=ja` を開き:
- Segment tab に `SD` / `SDXL` / `Flux` の 3 ボタンが表示される
- `Flux` をクリック → モデルドロップダウンが Flux モデル (2758FluxAsian...) のみに絞られる、または「Fluxモデルが見つかりません」が出る
- Flux モデル選択後、steps=4 / CFG=1.0 / sampler=Euler / scheduler=Simple が自動セット
- Preset picker が Flux 用に切り替わり、1:1 M が 1024×1024 になる
- Hires.fix セクションが非表示になる

エラーが出たら Step 3-17 を再確認。この Step でエラーがあれば必ず解消してから次に進む。

- [ ] **Step 21: コミット**

```bash
git add client/src/App.tsx client/src/components/ControlPanel.tsx client/src/i18n/ja.ts client/src/i18n/en.ts
git commit -m "feat: add 3-way arch toggle and Flux picker to control panel"
```

---

### Task 6: BatchGenerationModal.tsx に Flux batch を追加

**Files:**
- Modify: `client/src/components/BatchGenerationModal.tsx`

**Interfaces:**
- Consumes: `FLUX_PRESETS`, `FLUX_SIZES`, `resolveFluxDimensions`, `Architecture`, `FluxRatio`, `FluxSize`, `SdxlOrientation` (Task 1)
- Produces:
  - Props 型: `modelTypeFilter: Architecture` (Task 5 と揃える)
  - `buildFluxBatchJobs()`: FLUX_PRESETS × orientations × sizes のクロス積を `{ width, height }` の配列で返す
  - 3-way dispatch: `modelTypeFilter === 'flux' ? buildFluxBatchJobs() : modelTypeFilter === 'sdxl' ? buildSdxlBatchJobs() : buildSd15BatchJobs()`
  - Flux 用 UI: ratio/orientation/size のクロス積選択チェックボックス（SDXL パターンの写経）
  - `noModelsOfType` label: Flux 選択時に `'Flux'` を渡す

- [ ] **Step 1: Props 型と import を 3-way 化**

`client/src/components/BatchGenerationModal.tsx:31` (`modelTypeFilter: 'sd15' | 'sdxl';`) を次に変更:

```typescript
modelTypeFilter: Architecture;
```

対応する型 import を presets からに追加:

```typescript
import {
  ...
  FLUX_PRESETS,
  FLUX_SIZES,
  resolveFluxDimensions,
  type Architecture,
  type FluxRatio,
  type FluxSize,
  type SdxlOrientation,
} from './presets';
```

- [ ] **Step 2: Flux batch selection state を追加**

`selectedSd15BatchRatios` 等の既存 state (行 745 付近) と並列で、Flux 用の state を追加:

```typescript
const [selectedFluxBatchRatios, setSelectedFluxBatchRatios] =
  useState<Set<FluxRatio>>(new Set(FLUX_PRESETS.map(p => p.ratio)));
const [selectedFluxBatchOrientations, setSelectedFluxBatchOrientations] =
  useState<Set<SdxlOrientation>>(new Set(['landscape', 'portrait']));
const [selectedFluxBatchSizes, setSelectedFluxBatchSizes] =
  useState<Set<FluxSize>>(new Set(FLUX_SIZES));
```

- [ ] **Step 3: `buildFluxBatchJobs()` を追加**

`buildSdxlBatchJobs()` の直後に、同じ構造で Flux 用ジョブビルダを追加:

```typescript
const buildFluxBatchJobs = (): BatchJob[] => {
  const jobs: BatchJob[] = [];
  for (const preset of FLUX_PRESETS) {
    if (!selectedFluxBatchRatios.has(preset.ratio)) continue;
    for (const size of FLUX_SIZES) {
      if (!selectedFluxBatchSizes.has(size)) continue;
      if (preset.isSquare) {
        const { width, height } = resolveFluxDimensions(preset, 'square', size);
        jobs.push({ width, height });
      } else {
        for (const orientation of ['landscape', 'portrait'] as const) {
          if (!selectedFluxBatchOrientations.has(orientation)) continue;
          const { width, height } = resolveFluxDimensions(preset, orientation, size);
          jobs.push({ width, height });
        }
      }
    }
  }
  return jobs;
};
```

- [ ] **Step 4: batch dispatch と "size combinations" UI 分岐を 3-way に**

`client/src/components/BatchGenerationModal.tsx:256` 付近 (`modelTypeFilter === 'sdxl' ? (() => {` から始まる ternary) と `client/src/components/BatchGenerationModal.tsx:536` (`? (modelTypeFilter === 'sdxl' ? buildSdxlBatchJobs() : buildSd15BatchJobs())`) を次のように 3-way 化します:

```typescript
// dispatch:
? (modelTypeFilter === 'flux' ? buildFluxBatchJobs()
   : modelTypeFilter === 'sdxl' ? buildSdxlBatchJobs()
   : buildSd15BatchJobs())

// size-combinations UI (256付近):
modelTypeFilter === 'sdxl' ? (() => { /* SDXL UI */ })()
: modelTypeFilter === 'flux' ? (() => {
    // Flux size-combinations UI — mirrors SDXL: ratio checkboxes,
    // orientation checkboxes, size checkboxes with a live job-count preview.
    return (
      <>
        <div>ratio chips (checkbox) using FLUX_PRESETS and selectedFluxBatchRatios</div>
        <div>orientation checkboxes (landscape/portrait) using selectedFluxBatchOrientations</div>
        <div>size checkboxes (S/M/L) using selectedFluxBatchSizes</div>
        <div>Live count: {buildFluxBatchJobs().length} 枚</div>
      </>
    );
  })()
: (() => { /* SD1.5 UI, unchanged */ })()
```

具体的な checkbox JSX は SDXL 側 (行 256-459 付近) を写経して `SDXL_PRESETS`→`FLUX_PRESETS`, `selectedBatchRatios`→`selectedFluxBatchRatios`, `buildSdxlBatchJobs`→`buildFluxBatchJobs` に置換します。

- [ ] **Step 5: `noModelsOfType` label を Flux 対応に**

`client/src/components/BatchGenerationModal.tsx:519` を次に変更:

```typescript
// Before:
{sdModels.length === 0 ? t.batchModal.noModelsFetched : t.batchModal.noModelsOfType(modelTypeFilter === 'sdxl' ? 'SDXL' : 'SD')}

// After:
{sdModels.length === 0
  ? t.batchModal.noModelsFetched
  : t.batchModal.noModelsOfType(
      modelTypeFilter === 'sdxl' ? 'SDXL'
      : modelTypeFilter === 'flux' ? 'Flux'
      : 'SD'
    )}
```

- [ ] **Step 6: `selectedBatchModels` の初期化 useEffect を 3-way に**

`grep -n "setSelectedBatchModels\|selectedBatchModels" client/src/components/BatchGenerationModal.tsx` および同 App.tsx 側で、`sdModels.filter((m) => m.type === modelTypeFilter)` に依存した useEffect が既に generalize されているか確認します。既に `type === modelTypeFilter` の比較でフィルタしているなら 3-way 化しても自動で動く。追加の変更不要。

- [ ] **Step 7: build と tests を実行**

Run:
```bash
./node_modules/.bin/tsc -b
./node_modules/.bin/vitest run
./node_modules/.bin/vite build
```

Expected: 0 errors、全テスト green、vite build clean。

- [ ] **Step 8: dev で "まとめて生成" モーダルを開いて Flux 動作確認**

`npm run dev` で dev サーバー起動、ブラウザで `?hl=ja`、Flux 選択状態でモーダルを開き:
- "サイズの組合せ" タブで ratio/orientation/size のチェックボックスが FLUX_PRESETS 由来で出る
- Live count が変化する
- "モデル切替" タブで Flux モデルだけがリストされる
- "生成する" ボタンで実際にバッチが走ることは この Task では確認しない（実生成は Task 9 の E2E で）

- [ ] **Step 9: コミット**

```bash
git add client/src/components/BatchGenerationModal.tsx
git commit -m "feat: add Flux size-combinations mode to batch generation modal"
```

---

### Task 7: `GenerationMetadata.modelArchitecture` 永続化 (ADR-16 解消)

**Files:**
- Modify: `server/index.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/firebase.ts`
- Modify: `client/src/components/loadIntoFormState.ts`
- Modify: `client/src/components/loadIntoFormState.test.ts`

**Interfaces:**
- Consumes: `Architecture` 型 (server 側は Task 2、client 側は Task 1)
- Produces:
  - `GenerationMetadata.modelArchitecture?: Architecture` (server)
  - `GenerationRecord.modelArchitecture?: Architecture` (client の firebase.ts)
  - `POST /api/generate` の body を read して metadata に含める (server)
  - App.tsx から `/api/generate` 呼び出しに `modelArchitecture: modelTypeFilter` を送信
  - Firebase 保存パス (client 経由) にも同じフィールドを含める
  - `computeLoadIntoFormState` で `item.modelArchitecture` を最優先で使用、なければ現行 fallback

- [ ] **Step 1: server の `GenerationMetadata` interface に `modelArchitecture?` を追加**

`server/index.ts:39` の `interface GenerationMetadata { ... }` に:

```typescript
// Ground-truth architecture from the user's toggle at generation time.
// Absent on legacy records; loadIntoForm falls back to name/title heuristics.
modelArchitecture?: Architecture;
```

`refiner` フィールドなどと同じセクションに追加。

- [ ] **Step 2: server の `/api/generate` ハンドラで `modelArchitecture` を受け取り persist**

`server/index.ts` の `/api/generate` ハンドラ (`grep -n "'/api/generate'" server/index.ts`) を確認します。body から `modelArchitecture` を分割代入し、`GenerationMetadata` を作る箇所で spread に含めます:

```typescript
// Before (概略):
const { prompt, negativePrompt, width, height, steps, cfgScale, model, seed, sampler, ... } = req.body;
...
const metadata: GenerationMetadata = {
  ...
  refiner: refiner || undefined,
  ...
};

// After:
const { prompt, negativePrompt, width, height, steps, cfgScale, model, seed, sampler, modelArchitecture, ... } = req.body as { ...; modelArchitecture?: Architecture };
...
const metadata: GenerationMetadata = {
  ...
  refiner: refiner || undefined,
  modelArchitecture: modelArchitecture,  // undefined でも問題なし、下流の JSON.stringify で自動的にキー省略される
};
```

`clientPersist` 経路 (body の `modelArchitecture` は client がすでに送っているので、client 側の Firebase 書き込みで同じフィールドを含めさせる)。**server は clientPersist 経路では metadata を保存しないので、この step 2 は主に「local 保存経路」の話**。

- [ ] **Step 3: client の firebase.ts の `GenerationRecord` interface に `modelArchitecture?` を追加**

`client/src/firebase.ts` の `GenerationRecord` (と `GenerationParams` 型) に:

```typescript
import type { Architecture } from './components/presets';

// ... 既存 interface に追記:
modelArchitecture?: Architecture;
```

- [ ] **Step 4: App.tsx で `/api/generate` 呼び出し body に `modelArchitecture` を含める**

`grep -n "'/api/generate'\|api/generate" client/src/App.tsx` で fetch 呼び出しを特定し、body に追加:

```typescript
body: JSON.stringify({
  ...,
  modelArchitecture: modelTypeFilter,
})
```

- [ ] **Step 5: App.tsx で Firebase 永続化パスにも `modelArchitecture` を含める**

`grep -n "addDoc\|setDoc\|generations" client/src/App.tsx` で Firestore 書き込み箇所を特定し、書き込みオブジェクトに:

```typescript
await addDoc(collection(db, ...), {
  ...,
  modelArchitecture: modelTypeFilter,
});
```

または `client/src/firebase.ts` にヘルパー関数がある場合、そのヘルパーに `modelArchitecture` パラメータを追加して呼び出し側で渡す。

- [ ] **Step 6: `LoadableGenerationItem` に `modelArchitecture?` を追加**

`client/src/components/loadIntoFormState.ts` の `LoadableGenerationItem` interface に:

```typescript
import type { Architecture } from './presets';

export interface LoadableGenerationItem {
  ...
  modelArchitecture?: Architecture;
}
```

- [ ] **Step 7: `LoadIntoFormState` に Flux picker と 3-way archToSet を追加**

`LoadIntoFormState` interface と関連 field を 3-way 対応に:

```typescript
export interface LoadIntoFormState {
  archToSet: Architecture | null;  // was 'sd15' | 'sdxl' | null
  width: number;
  height: number;
  sdxlPicker: { ... } | null;
  sd15Picker: { ... } | null;
  fluxPicker: { ratio: FluxRatio; orientation: SdxlOrientation; size: FluxSize } | null;
  loadedPositive: string;
  loadedNegative: string;
}
```

- [ ] **Step 8: `computeLoadIntoFormState` を `modelArchitecture` 最優先ロジックに拡張**

`computeLoadIntoFormState` 関数の arch 決定ロジック（現状 `inferSdArchitectureFromTitle` を呼んでいる箇所）を次の precedence に置き換えます:

```typescript
// New precedence:
// 1. Trust item.modelArchitecture when present (ground truth from generation time).
// 2. Else, use inferSdArchitectureFromTitle (existing behavior).
const arch: Architecture | null = item.modelArchitecture
  ?? inferSdArchitectureFromTitle(item.model ?? '', sdModels);
```

Flux picker の seed 追加:

```typescript
if (arch === 'flux') {
  state.fluxPicker = findFluxSelection(item.width, item.height);
  // sdxlPicker と sd15Picker は null のまま
} else if (arch === 'sdxl') {
  state.sdxlPicker = findSdxlSelection(...);
} else if (arch === 'sd15') {
  state.sd15Picker = findSd15Selection(...);
}
```

対応する import 追加 (presets から `findFluxSelection`, `FluxRatio`, `FluxSize`, `Architecture`)。

- [ ] **Step 9: `loadIntoFormState.test.ts` に Flux 関連ケースを追加**

`client/src/components/loadIntoFormState.test.ts` に新規テストを追加:

```typescript
describe('Flux records', () => {
  it('trusts modelArchitecture: flux and populates fluxPicker from dimensions', () => {
    const item = {
      width: 1024, height: 1024,
      model: '2758FluxAsianUtopian_v60SchnellFp8Noclip.safetensors [ed2bd39653]',
      modelArchitecture: 'flux' as const,
    };
    const s = computeLoadIntoFormState(item, sdModelsForTest);
    expect(s.archToSet).toBe('flux');
    expect(s.fluxPicker).toEqual({ ratio: '1:1', orientation: 'square', size: 'M' });
    expect(s.sdxlPicker).toBeNull();
    expect(s.sd15Picker).toBeNull();
  });

  it('falls back to inferSdArchitectureFromTitle when modelArchitecture is absent (legacy record)', () => {
    const item = {
      width: 1024, height: 1024,
      model: 'sd_xl_base_1.0.safetensors [31e35c80fc]',
      // no modelArchitecture
    };
    const s = computeLoadIntoFormState(item, sdModelsForTest);
    // sdModelsForTest must include sd_xl_base_1.0 with type: 'sdxl'
    expect(s.archToSet).toBe('sdxl');
  });

  it('fluxPicker is null for non-preset Flux dimensions and falls through to defaults', () => {
    const item = {
      width: 999, height: 999,
      model: 'some-flux.safetensors',
      modelArchitecture: 'flux' as const,
    };
    const s = computeLoadIntoFormState(item, sdModelsForTest);
    expect(s.archToSet).toBe('flux');
    expect(s.fluxPicker).toBeNull();  // Caller applies Flux default (1:1 M)
  });
});
```

`sdModelsForTest` の fixture 定義は既存 test の pattern をコピーして拡張します（Flux モデルを 1 件加える）。

- [ ] **Step 10: App.tsx で `loadIntoForm` の Flux picker 反映 branch を追加**

App.tsx の `loadIntoForm` 関数内、既存の SDXL/SD1.5 picker 反映ロジックの隣に:

```typescript
if (s.fluxPicker) {
  setSelectedFluxRatio(s.fluxPicker.ratio);
  setSelectedFluxOrientation(s.fluxPicker.orientation);
  setSelectedFluxSize(s.fluxPicker.size);
}
```

- [ ] **Step 11: サーバー & クライアント型チェック**

```bash
npm run typecheck --prefix server
./node_modules/.bin/tsc -b  # cwd = client/
```

Expected: 両者 0 errors。

- [ ] **Step 12: テスト実行**

Run: `./node_modules/.bin/vitest run` (cwd = `client/`)
Expected: 全テスト green（Flux ケース 3 個が追加され、既存テストも引き続き pass）。

- [ ] **Step 13: dev で軽い動作確認**

`npm run dev` → ブラウザで:
1. Flux モードで 1 枚生成 → gallery に保存される
2. Firebase mode の場合、Firestore console で該当ドキュメントに `modelArchitecture: 'flux'` が入っていることを確認 (Firestore サインイン中の場合)、または local mode の場合 `server/outputs/metadata.json` に `"modelArchitecture": "flux"` が入っていることを `grep` で確認
3. その画像を preview に開いて "フォームにロード" → 自動的に Flux モードに切り替わる

- [ ] **Step 14: コミット**

```bash
git add server/index.ts client/src/App.tsx client/src/firebase.ts client/src/components/loadIntoFormState.ts client/src/components/loadIntoFormState.test.ts
git commit -m "feat: persist modelArchitecture on generation metadata to fix load-into-form"
```

---

### Task 8: ADR 更新 (adr-0042 新規、adr-0016 status、adr-0009/0029 append)

**Files:**
- Create: `docs/arch/adr-0042-flux-support-3way-architecture.md`
- Modify: `docs/arch/adr-0016-defer-sdxl-misclassification-fix.md`
- Modify: `docs/arch/adr-0009-safetensors-header-sdxl-detection.md`
- Modify: `docs/arch/adr-0029-sd-sdxl-architecture-ui-handling.md`

**Interfaces:** 純粋にドキュメントの追加/更新。コードへの影響なし。

- [ ] **Step 1: `adr-0042-flux-support-3way-architecture.md` を新規作成**

`docs/arch/adr-0042-flux-support-3way-architecture.md` に次の内容を書き込みます。**既存 ADR (adr-0009 / adr-0029 / adr-0016) の文体・章立て（Context / Decision / Status / Consequences、「です・ます」調）に完全に合わせます。**

```markdown
# ADR 42: Flux アーキテクチャを 3-way トグルの第 3 値として扱い、生成時に modelArchitecture を永続化する

## Context

[[adr-0009-safetensors-header-sdxl-detection]] では `conditioner.embedders.*` を陽性判定する形で「SDXL かどうか」の 2 分類を採用し、Flux 等の未知アーキテクチャは意図的に「除外しない (＝SD1.5 バケツ)」側に倒す設計にしていました。[[adr-0029-sd-sdxl-architecture-ui-handling]] でも、`type: 'unknown'` を独立 3 値目としてトグルに追加する案を「実データでは Flux モデル数がまだ少なく、UI 複雑化のコストが利得を上回る」として却下し、「将来の必要性に応じて再検討します」と Consequences に明記していました。

その後、洋一郎さんの環境で Flux [schnell] 系のチェックポイント (`2758FluxAsianUtopian_v60SchnellFp8Noclip.safetensors`) が日常生成で使われるようになりました。実際にヘッダーを検査したところ 776 個のテンソルすべてが `model.diffusion_model.double_blocks.*` / `single_blocks.*` / `img_in.weight` / `txt_in.weight` / `vector_in.*` / `time_in.*` の Flux DiT パターンで、`__metadata__` には `flux1-schnell.safetensors` の参照が含まれていました。AUTOMATIC1111 は v1.10.0 (2024-08) から Flux をネイティブサポートしており、素の AUTOMATIC1111 環境で Flux 生成が動くこと自体には矛盾はありません。

Flux は distilled model なので、SDXL/SD1.5 と同じ UX を適用すると次の落とし穴があります。

- Steps: schnell では 1–4 が推奨、dev では 20–30。Sumica のデフォルト 20 は schnell では過剰、dev では不足気味。
- CFG: schnell では 1.0 固定推奨（それ以外は無視される）、dev では 3.5 前後。Sumica のデフォルト 7 は両方で外している。
- Negative prompt: schnell では CFG=1.0 のため実質完全無視、dev でも効果は薄い。
- LLM の `(phrase:weight)` emphasis: Flux の T5 テキストエンコーダーはこの構文を解釈しないため、リテラルな文字列として扱われる。
- 解像度ピッカー: SD1.5 の 512² 中心は Flux では低解像度すぎる。

同時に、[[adr-0016-defer-sdxl-misclassification-fix]] で保留していた「非 "XL" 命名 SDXL チェックポイントの `loadIntoForm` バグ」は、案 A（生成時に `modelArchitecture` を metadata に永続化する）が推奨として書かれており、今回 Flux 対応で `GenerationMetadata` のスキーマに手を入れるので同時解消できます。

## Decision

**Flux を SD1.5 / SDXL と並ぶ第 3 のアーキテクチャとして first-class に扱い、既存の `modelTypeFilter: 'sd15' | 'sdxl'` トグルを 3-way `Architecture = 'sd15' | 'sdxl' | 'flux'` に拡張します。同時に、[[adr-0016-defer-sdxl-misclassification-fix]] の案 A（生成時に `modelArchitecture` を metadata に永続化する）を本 ADR の付随変更として実装します。** 具体的な設計は次の通りです。

- **`classifyCheckpointArch()` によるヘッダー検査の 3 分類化**: [[adr-0009-safetensors-header-sdxl-detection]] のヘッダー検査ロジックを継承しつつ、`isSdxlCheckpoint()` を廃止して `classifyCheckpointArch(filename, title): Promise<{ type: Architecture; fluxVariant?: 'schnell' | 'dev' }>` に置き換えます。検出順序は「Flux (`model.diffusion_model.double_blocks.*`) → SDXL (`conditioner.embedders.*`) → SD1.5」の順です。Flux が検出された場合は `__metadata__` を stringify して `/flux1?[-_]?dev/i` にマッチすれば dev、しなければ schnell と判定します。フォールバック（ヘッダー読み込み失敗）でも同じ 3 分類を名前ヒューリスティックで復元します。
- **3-way segment トグル (SD / SDXL / Flux)**: [[adr-0029-sd-sdxl-architecture-ui-handling]] の「単一情報源」設計をそのまま踏襲し、`modelTypeFilter: Architecture` として model picker / preset picker / batch scope / default 適用を制御します。
- **Flux 用の `FLUX_PRESETS`**: [[adr-0010-sdxl-ratio-orientation-size-preset]] と [[adr-0014-sd15-ratio-orientation-size-preset]] と同じ「aspect ratio × orientation × size」構造で、SDXL とほぼ同じ数値（Flux も 1MP native）にしました。ただし Flux は aspect ratio bucket 学習ではないため、`isSdxlBucket` の代わりに `isFluxNative: boolean` を採用し、M サイズのみを ⭐ として印します。
- **Flux 特有 UX**: `modelTypeFilter === 'flux'` のとき、`selectedModel.fluxVariant` に応じて steps (schnell=4 / dev=25) と CFG (schnell=1.0 / dev=3.5) と sampler (Euler + Simple scheduler) をデフォルト適用します。ユーザーが手動で触った場合は per-field override flag (`stepsUserOverride` 等) で保持。Negative prompt textarea は `disabled` にし、「Flux モデルでは negative prompt は使用しません」ノートを表示。Hires.fix / VAE / Refiner は Flux 時に非表示。
- **LLM system prompt の Flux バリアント**: `enhancePrompt(userPrompt, arch)` を拡張し、`arch === 'flux'` のとき自然言語プロンプト + 空 negative を返す system prompt に切り替えます。既存の SD system prompt (`(phrase:weight)` emphasis 変換) は `arch === 'sd15' | 'sdxl'` または省略時にそのまま使います。
- **`GenerationMetadata.modelArchitecture?: Architecture` の永続化**: client が `/api/generate` の body に `modelArchitecture: modelTypeFilter` を含めて送り、server は local metadata.json に、client は Firestore に、それぞれ保存します。`loadIntoForm` は保存された `modelArchitecture` を最優先で信頼し、なければ現行の `inferSdArchitectureFromTitle` フォールバックを維持します。既存レコード（`modelArchitecture` 無し）は現行挙動そのまま。
- **Batch generation の 3-way 化**: `BatchGenerationModal` に `buildFluxBatchJobs()` を追加し、`modelTypeFilter === 'flux'` 時は FLUX_PRESETS のクロス積でジョブを生成します。バッチのモデル切替モードは既に `sdModels.filter(m => m.type === modelTypeFilter)` で一般化されているため追加変更なし。
- **LoRA の 4 値化**: `classifyLoraArchitecture()` に `'flux'` 判定を追加し、Flux LoRA も `⚠(for Flux/SDXL/SD1.5)` バッジで不一致警告するようにします（除外はしない、[[adr-0029-sd-sdxl-architecture-ui-handling]] の「バッジのみ、選択自体は許容」方針を継承）。

代替案として次を比較検討し、いずれも却下しました。

- **検出だけ・UX 変更なし (Flux モデルを SD1.5 バケツに残す)**: 実装コスト最小ですが、SD1.5 の 512² デフォルトや CFG=7 デフォルトを Flux モデルで使うと画質が明確に劣化し、ユーザーが原因を追いにくくなります。「Fluxモデルで動く」ことが目的ではなく「Fluxモデルで最良の結果を得る」ことが目的なので却下。
- **schnell/dev を区別せず一括 `'flux'`**: UI 単純ですが、schnell/dev で steps・CFG の推奨値が桁違い（4 vs 25、1.0 vs 3.5）なので、片方向のデフォルトが常に不適切になります。`__metadata__` からの判別コストは低いので区別する方針にしました。
- **ADR-16 と分けて別 PR で対応**: `GenerationMetadata` のスキーマ変更が両 ADR で必要なので、同時実装のほうが自然。Flux 対応の副産物として ADR-16 も解消するのが本 ADR の付加価値。

## Status

承認済み

## Consequences

- **Flux モデルが専用 UX で使えるようになる**: 3-way トグルで Flux を選ぶと、preset / steps / CFG / sampler / negative disabled / Hires.fix 非表示すべてが Flux 向けに切り替わります。schnell/dev の variant 判別で defaults も自動的に適切な値が入るので、初回ユーザーでも失敗しにくくなります。
- **[[adr-0016-defer-sdxl-misclassification-fix]] のバグが解消される**: 新規生成レコードには `modelArchitecture` が保存され、`loadIntoForm` はそれを最優先で信頼します。非 "XL" 命名 SDXL チェックポイントで生成した画像を「フォームにロード」しても、arch トグルが自動的に正しく SDXL に切り替わり、解像度も保たれます。ただし本 ADR より前に生成された既存レコードには `modelArchitecture` が無いので、既存レコード側では引き続き ADR-16 のワークアラウンド（手動でトグル切替）が必要です。ADR-16 の Status は本 ADR で「置き換え済み」に更新します。
- **単一情報源の設計が保たれる**: [[adr-0029-sd-sdxl-architecture-ui-handling]] の「トグル 1 つが model / preset / batch を制御する」設計は 3-way 化しても崩れず、むしろ将来 SD3 / Sana など 4 値目・5 値目が必要になったときの拡張パターンが確立します。
- **LLM system prompt が 2 バリアント持ちになる**: Flux 用と SD 用の system prompt を並置する形で保守負荷が微増しますが、両者は完全に独立した文書なので、片方の変更が他方に影響しない構造です。
- **Hires.fix / Refiner / VAE の Flux 対応は保留**: Flux は SD のこれらのアップスケール・VAE フローと非互換なので、本 ADR では Flux 時に非表示にするだけで、Flux 向けの upscale パスは将来課題として残します。
- **schnell vs dev の判別は heuristic**: safetensors の `__metadata__` に `flux1-dev` の文字列が入っていなければ schnell と判定します。誤判定 (dev モデルが schnell 扱いになる) 場合、ユーザーは steps / CFG を手動で override すればよいので実害は小さいですが、`__metadata__` を持たない Flux checkpoint が増えた場合は判定精度が下がります。
- **Flux LoRA の一部誤判定リスク**: `classifyLoraArchitecture()` の Flux 判定は `modelspec.architecture` / `ss_base_model_version` の substring 検査に依存するため、Flux 用にトレーニングされた LoRA でメタデータが欠落しているものは `'unknown'` 扱いになります。[[adr-0029-sd-sdxl-architecture-ui-handling]] の「バッジのみ」方針により誤判定の影響は限定的で、ユーザー側で手動で使うことに変わりありません。
```

- [ ] **Step 2: `adr-0016-defer-sdxl-misclassification-fix.md` の Status を更新**

`docs/arch/adr-0016-defer-sdxl-misclassification-fix.md` の Status セクション (行 52-54) を次のように書き換えます:

```markdown
## Status

置き換え済み（[[adr-0042-flux-support-3way-architecture]] により置き換え）。本 ADR で保留していた「案 A: 生成時に arch を metadata に永続化」の実装が ADR-42 の Flux 対応と同時に行われました。新規生成レコードは `modelArchitecture` を保存するため本 ADR の症状は起きません。ただし ADR-42 以前に生成された既存レコードにはフィールドが無いため、そちらでは引き続き本 ADR のワークアラウンド（トグルの手動切替）が有効です。
```

本文の Context / Decision / Consequences は一切変更しません。

- [ ] **Step 3: `adr-0009-safetensors-header-sdxl-detection.md` の Consequences 末尾を追記**

`docs/arch/adr-0009-safetensors-header-sdxl-detection.md` の Consequences 最終箇条書き (行 38) の末尾に、次を追記します（既存の記述を残し、この文だけ append）:

```markdown
- Flux等、SD1.5にもSDXLにも一致しないアーキテクチャのモデルは、判定上「除外しない」側に倒れます。これは意図した挙動です。この将来課題は [[adr-0042-flux-support-3way-architecture]] で 3-way 分類として扱われるようになりました。
```

- [ ] **Step 4: `adr-0029-sd-sdxl-architecture-ui-handling.md` の Consequences 末尾を追記**

`docs/arch/adr-0029-sd-sdxl-architecture-ui-handling.md` の Consequences 最終箇条書き (行 48) を次のように書き換えます（既存の記述を残し、末尾に追記）:

```markdown
- **Flux 系新アーキテクチャの正式対応**は将来課題として残ります。SD3・Flux・Sana 等が広まると、2 値トグルでは足りなくなる可能性があります。3 値化のコスト vs 利得を再評価する時期がきたら、この ADR を supersede する新 ADR を書くことになります。→ [[adr-0042-flux-support-3way-architecture]] で 3-way 化を実装しました。本 ADR の「単一情報源」設計は N-way にそのまま拡張できる形で保たれています。
```

- [ ] **Step 5: 4 つの ADR ファイルをまとめてコミット**

```bash
git add docs/arch/adr-0042-flux-support-3way-architecture.md docs/arch/adr-0016-defer-sdxl-misclassification-fix.md docs/arch/adr-0009-safetensors-header-sdxl-detection.md docs/arch/adr-0029-sd-sdxl-architecture-ui-handling.md
git commit -m "docs: add ADR-42 for Flux support and mark ADR-16 superseded"
```

---

### Task 9: 統合検証 E2E (chrome-devtools MCP + curl + tests)

**Files:** なし（検証のみ）

**Interfaces:** Task 1〜8 を統合した状態が期待通り動くことをブラウザとサーバー API で確認。コミットは生成しない。

- [ ] **Step 1: 全ての自動テスト & build を最終確認**

Run:
```bash
./node_modules/.bin/tsc -b                  # cwd = client/
./node_modules/.bin/vitest run              # cwd = client/
./node_modules/.bin/vite build              # cwd = client/
npm run lint --prefix client                # oxlint
npm run typecheck --prefix server           # tsc --noEmit
```

Expected:
- Client TypeScript: 0 errors
- Client tests: 全 pass（既存分 + Flux presets 4 + fluxDefaults 5 + loadIntoFormState Flux 3 = 全部 green）
- Client vite build: clean
- Client oxlint: 既存 pre-existing warnings のみ、新規 warning ゼロ
- Server typecheck: 0 errors

- [ ] **Step 2: サーバー API を curl で確認**

`npm run dev:server` で稼働中を前提。

```bash
# /api/sd-models: Flux モデルが type: 'flux' で返る
curl -s http://localhost:5000/api/sd-models | python3 -c "import json,sys; d=json.load(sys.stdin); [print(m['title'], m['type'], m.get('fluxVariant','')) for m in d['models']]"
```

Expected: `2758FluxAsianUtopian_v60SchnellFp8Noclip... flux schnell`、他 SDXL / SD1.5 モデルは既存分類。

```bash
# /api/enhance の SD 側 (arch 省略) — 既存挙動
curl -s -X POST http://localhost:5000/api/enhance -H 'Content-Type: application/json' -d '{"prompt":"かなり丸顔の女性"}' | python3 -m json.tool

# /api/enhance の Flux 側
curl -s -X POST http://localhost:5000/api/enhance -H 'Content-Type: application/json' -d '{"prompt":"かなり丸顔の女性","arch":"flux"}' | python3 -m json.tool
```

Expected: SD 側は `positive` に `(round face:1.2)` 相当が入り negative もデフォルトが埋まる（既存挙動）。Flux 側は `positive` が自然言語文で `(phrase:weight)` を含まず、`negative` が **空文字列**。

- [ ] **Step 3: chrome-devtools MCP で 3-way 切替を E2E 検証**

以下のシナリオを chrome-devtools MCP で自動化して検証します。`fetch` monkey-patch でリクエスト body を記録し、期待した field が入っているかを assertion します。

**シナリオ 1: 3-way toggle 表示**
- `http://localhost:5173/?hl=ja` にアクセス
- Segment tab に `SD` / `SDXL` / `Flux` の 3 ボタンが表示されていることを snapshot で確認

**シナリオ 2: Flux モード切替 → defaults 自動適用**
- Flux ボタンをクリック
- モデルドロップダウンが Flux モデルのみに絞られる (2758FluxAsianUtopian... [schnell])
- steps = 4, CFG = 1.0, sampler = Euler, scheduler = Simple が自動セットされる（`document.querySelector('input[name="steps"]').value === '4'` などで確認）
- Preset picker が 1:1 M = 1024x1024 で選択されている
- Hires.fix セクションが非表示（`document.querySelector('...hires wrapper...')` が null）
- Negative prompt textarea が `disabled`、ノート `Fluxモデルでは negative prompt は使用しません` が表示

**シナリオ 3: SDXL/SD1.5 → Flux → SDXL 往復**
- Flux → SDXL → Flux → SD1.5 → Flux の順にトグルを切り替え
- 各切替で picker (SDXL_PRESETS / SD15_PRESETS / FLUX_PRESETS) が正しく切り替わる
- 各切替で override flags がクリアされて defaults が適用される

**シナリオ 4: `/api/enhance` の body に arch が含まれる**
- Flux モードで原文プロンプト入力 → 生成ボタンクリック
- `fetch` monkey-patch のログで `POST /api/enhance` の body が `{"prompt":"...","arch":"flux"}` を含むことを確認
- 応答の negative が空文字列であることを確認

**シナリオ 5: `/api/generate` の body に modelArchitecture が含まれる**
- 同じく生成ボタンクリック
- `POST /api/generate` の body が `"modelArchitecture":"flux"` を含むことを確認

**シナリオ 6: Flux で 1 枚生成 → gallery → 「フォームにロード」→ Flux トグルに戻る**
- 生成完了後、preview / gallery に画像が出る
- 「フォームにロード」ボタンクリック
- Segment tab が自動的に Flux に切り替わる
- Preset picker が生成時のサイズ (1024×1024) にマッチしていることを確認
- Steps / CFG / sampler / scheduler が保存された値のまま復元される (Task 5 Step 8 の override flags を true にセットするロジックが効いている)

**シナリオ 7: Batch generation の Flux 対応**
- Flux モードで「まとめて生成」を開く
- "サイズの組合せ" タブで FLUX_PRESETS 由来のクロス積 UI (7 ratio × 2 orientation × 3 size のチェックボックス群) が表示される
- "モデル切替" タブで Flux モデルだけがリスト
- （実生成テストは省略可 = 挙動は SDXL バッチと同構造）

**シナリオ 8: SD1.5 / SDXL 側の既存挙動が壊れていない**
- SD1.5 で 1 枚生成、`/api/enhance` body に `arch: 'sd15'` が入り、negative が既存デフォルトの形で返る
- SDXL で 1 枚生成、`arch: 'sdxl'`、negative 既存デフォルト
- gallery からの loadIntoForm で SD1.5 / SDXL 側の picker が正しく復元される

- [ ] **Step 4: 検証結果を進捗レジャーに記録**

`git log --oneline` で Task 1〜8 のコミットログを確認し、`Base commit .. HEAD` の範囲を `.superpowers/sdd/progress.md` に記録します。8 シナリオの結果と、発見された Minor 問題（あれば）も残します。この Task 9 はコミットを生成しません。

- [ ] **Step 5: SDD 完了報告**

進捗レジャーで全 Task が complete、Minor が 0 or 記載済みの状態で、writing-plans → subagent-driven-development の handoff がクロージング。次のステップは merge (ユーザーが `finishing-a-development-branch` を invoke するのを待つ) です。

---

## Self-Review Notes

### 1. Spec coverage

Spec の各節を task に mapping。

- **Common type (Architecture, FluxVariant)** → Task 1 (presets.ts) + Task 2 (server/index.ts)
- **classifyCheckpointArch (server 検出)** → Task 2
- **API surface: /api/sd-models 拡張** → Task 2
- **API surface: /api/sd-loras 拡張** → Task 2
- **API surface: /api/enhance に arch** → Task 4 (server) + Task 5 (client 送信)
- **API surface: /api/generate に modelArchitecture** → Task 7
- **Client 3-way toggle** → Task 5
- **FLUX_PRESETS** → Task 1
- **Flux useEffect branch** → Task 5
- **Flux-specific UX (steps/CFG/sampler defaults, negative disabled, Hires.fix hidden)** → Task 3 (defaults pure resolver) + Task 5 (統合)
- **LLM system prompt for Flux** → Task 4
- **Metadata persistence (modelArchitecture)** → Task 7
- **loadIntoForm precedence** → Task 7
- **Batch generation の Flux 対応** → Task 6
- **i18n keys** → Task 5 (Step 1-2)
- **LoRA 3-way (classifyLoraArchitecture 拡張)** → Task 2 (Step 4)
- **Testing: Vitest 追加分** → Task 1 (presets) + Task 3 (fluxDefaults) + Task 7 (loadIntoFormState)
- **Testing: Server 手動検証** → Task 2 (Step 7) + Task 4 (Step 4)
- **Testing: E2E chrome-devtools MCP** → Task 9
- **ADR 更新** → Task 8

すべての spec 要件が task にマッピングされています。

### 2. Placeholder scan

以下の点だけ「実装フェーズで判断」を含みますが、いずれも「両方の可能性を明示的に扱った分岐指示」であり placeholder ではありません:

- **Task 5 Step 7 の eslint-disable の別解**: oxlint 側で警告になった場合の逃げ道を明示。
- **Task 5 Step 13 の Pattern A/B**: 実際の UI 構造を見てから決める（両パターンを具体的に記述済み）。
- **Task 6 Step 6**: 既に generalize されているかの確認指示。既に generalize なら変更不要と明記。

その他 TBD / TODO / vague requirement はゼロ。全 step に具体的なコード + exact コマンド + 期待出力を記載。

### 3. Type consistency

- `Architecture` 型名が Task 1 (presets.ts, client 側), Task 2 (server/index.ts), Task 5 (App.tsx state), Task 7 (metadata) で全て一致。
- `FluxVariant` 型名が Task 1 (presets.ts), Task 2 (server), Task 3 (fluxDefaults) で全て一致。
- `FLUX_PRESETS` の値 (7 ratio × 3 size = 21 数値) が Task 1, Task 5, Task 6 で同じテーブルを参照。
- `resolveFluxDimensions` / `findFluxSelection` のシグネチャが Task 1 定義と Task 5/Task 6/Task 7 消費で一致。
- `computeFluxDefaults(variant, overrides, current)` の 3 引数が Task 3 定義と Task 5 Step 7 消費で一致。
- `modelArchitecture` フィールド名が Task 2 (server API), Task 5 (send), Task 7 (persistence, loadIntoForm) で一致。
- i18n key 名 (`archFluxLabel`, `noFluxModelsFound`, `fluxNegativeDisabledNote`, `fluxVariantSchnellBadge`, `fluxVariantDevBadge`) が Task 5 の Step 1-2 (追加) と Step 11-16 (参照) で一致。

### 4. Scope check

Flux 対応は「単一の 3-way architecture 拡張 + ADR-16 の付随修正」で、単一 subsystem に閉じます。9 task で完結し、単一 PR として merge 可能。他のオープン feature（Inpaint など）と干渉しません。
