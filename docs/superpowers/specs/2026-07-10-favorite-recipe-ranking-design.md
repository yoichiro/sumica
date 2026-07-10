# お気に入りレシピランキング設計

## 背景と目的

洋一郎さんはこれまでに Firestore 側だけで 1128 枚の画像を生成し、そのうち 212 枚をお気に入りとしてマークしています（お気に入り率 18.8%）。この蓄積は、「どのモデル・パラメータの組み合わせでお気に入りにマークされる確率が高いか」という **レシピレベルのランキング** を構築するのに十分な量です。ランキングを可視化して「次に何で作るか」を提案できれば、生成体験を大きく改善できます。

一方で現状の分析スクリプト `server/scripts/analyze-favorites.ts` は、実行のたびに全 1128 doc を `collectionGroup('generations')` で読み取るフルスキャン方式です。1128 doc なら 2 秒・無料枠内で回せますが、生成数が 1 万・10 万と増えていくとリードコストが線形に増えます。App 内でユーザーが「ランキングを見る」度に集計するには、コストと待ち時間の両面でスケールしません。

さらに、現行フルスキャン集計は **各生成 doc を集計時に毎回舐め直す** ため、集計結果はメモリ上にしか存在せず、他セッションと共有されず、リアルタイム性もありません。

そこで、**materialized view / rollup** パターンを採用します。ランキングに必要なパラメータの組み合わせを SHA-256 hash でユニーク識別し、hash ごとに `{ total, favs }` のカウンタを保持する **rollup collection** を用意します。画像生成・お気に入り toggle・削除のたびに rollup カウンタを原子的に加減算することで、集計は常に O(unique combinations) 個の doc を読むだけになり、リアルタイム性・スケーラビリティの両方が確保できます。

## 決定

**Firestore に `users/{uid}/rankingRollups/{sha256Hash}` サブコレクションを新設し、8 次元パラメータの組み合わせごとに `{ total, favs, params }` を rollup として維持します。** サインアウトモードでは `server/outputs/rankingRollups.json` に同一シェイプで管理します。書き込みは各生成イベントに原子的にペア付け、読み込みはクライアントが `onSnapshot`（signed-in）または `fetch` + trigger refetch（signed-out）で購読します。既存 1128 生成分は一度きりのバックフィルスクリプトで初期化します。UI は `ControlPanel` にタブ構造を追加し、「フォーム」タブと「ランキング」タブを切り替え可能にします。ランキングタブでは Wilson 下限で並び替えた Top 10 を表示し、各行の「フォームに適用」ボタンでレシピをフォーム state に流し込みます。

代替案として次を検討し、いずれも却下しました。

- **フルスキャン + キャッシュ (24h TTL)**: 実装は簡単だが、生成が増えると初回リード時間・コスト・古さの体感が悪化する。ユーザー要求はリアルタイム性 (`onSnapshot` 購読) だったので rollup 方式を採用。
- **Cloud Functions で rollup を自動維持**: サーバー側の実装コストが増える。Sumica はサーバー Firebase-free の設計原則があり ([[adr-0001-client-side-firebase-persistence]])、クライアント側での rollup 書き込みで十分。
- **hash 形式に「決定的な文字列キー」**: Firestore コンソールで人間が読める利点はあったが、複数フィールドの joinで生成する ID は長さがマチマチで doc ID の 1500 bytes 上限に接近しうる。SHA-256 hex なら常に 64 char + params は doc 内に保持できるので debug 性は維持できると判断。

## アーキテクチャ

### データモデル

**Firestore path**: `users/{uid}/rankingRollups/{sha256Hash}`
**ローカル path**: `server/outputs/rankingRollups.json`（キーが hash のオブジェクト）

**ドキュメントスキーマ**:

```ts
{
  version: 1,            // schema version — 次元追加時の migration 用
  params: {              // 逆引き & デバッグ用の生パラメータ
    model: string;       // stripHashSuffix 済み (ADR 16 の正規化)
    sampler: string;
    scheduler: string;
    size: string;        // "WxH" 形式 (例: "512x768")
    hires: boolean;
    loras: string[];     // ソート済み配列
    refiner: string;     // 未使用時は空文字
    vae: string;         // 未使用時は空文字
  };
  total: number;         // 生成された回数
  favs: number;          // うちお気に入りにマークされた回数
  updatedAt: number;     // 最終更新時刻 (ms)
}
```

### Hash 計算

**モジュール**: `client/src/utils/rankingRollup.ts`（同一ロジックを `server/utils/rankingRollup.ts` にも独立コピー）

```ts
export function normalizeParams(p: GenerationParams): NormalizedParams {
  return {
    model: stripHashSuffix(p.model || ''),
    sampler: p.sampler || '',
    scheduler: p.scheduler || '',
    size: `${p.width}x${p.height}`,
    hires: !!p.enableHr,
    loras: (p.loras || []).map((l) => l.name).sort(),
    refiner: p.refiner || '',
    vae: p.vae || '',
  };
}

export async function buildRollupKey(p: NormalizedParams): Promise<string> {
  const canonical = JSON.stringify(p);
  const enc = new TextEncoder().encode(canonical);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

`stripHashSuffix` は ADR 16 で確立済みのモデル名正規化ヘルパーを共有します。LoRA は名前だけをソート済み配列にして順序非依存にします。

### 書き込みフロー

4 種類のイベントで rollup カウンタを更新します。**すべて既存の書き込みとペアになる原子操作**として実装します。

| イベント | 発火場所 | rollup 側の操作 |
| --- | --- | --- |
| 生成保存 (`saveGeneration`) | client (signed-in) / server (signed-out) | `total: +1` |
| お気に入り追加 (`updateFavorite(true)`) | client / server | `favs: +1` |
| お気に入り解除 (`updateFavorite(false)`) | client / server | `favs: -1` |
| 削除 (`deleteGenerations`) | client / server | `total: -1`, お気に入り時 `favs: -1` |

**Signed-in (Firestore)**: `writeBatch` + Firestore の atomic `increment()` を使い、2 書き込みを 1 コミットにまとめます。未存在の rollup doc も `set(..., { merge: true })` で 1 呼び出しで作成 or 加算できます。並列書き込みでも race condition は起きません。

**Signed-out (server local JSON)**: `server/utils/rankingRollup.ts` の共通関数 `updateLocalRollup(params, deltaTotal, deltaFavs)` が `rankingRollups.json` を read → 加減算 → temp file + rename で atomic write します。metadata.json の書き込みと必ずペアで呼び出します。

**削除時の isFavorite 情報**: 既存の `deleteGenerations` は削除対象 doc のリストを受け取っており、`isFavorite` フィールドは既にそこに含まれているため、追加のクエリなしに rollup を正しく減算できます。

**万一 rollup が実データとずれた場合**: バックフィルスクリプト（後述）を再実行すれば 0 から集計しなおせるため、恒久的な整合性は保証されます。日常運用では原子操作でずれにくく、非常時にはスクリプト実行で復旧できる 2 段構えです。

### 読み込みフロー

**Signed-in**: 新規関数 `subscribeRankingRollups(uid, cb)` を `client/src/firebase.ts` に追加し、`onSnapshot(collection(users/{uid}/rankingRollups))` で購読します。初回接続時に全 rollup doc（現状 456 doc）を読み、以降は差分配信になります。他セッションでの変更もリアルタイムで反映されます。

**Signed-out**: 新規 endpoint `GET /api/ranking-rollups` を `server/index.ts` に追加し、`rankingRollups.json` の内容をそのまま返します。クライアントは初回 fetch でロード、生成・お気に入り・削除の完了後に手動 refetch します。

### 分析ロジック

**モジュール**: `client/src/utils/rankingAnalysis.ts`

```ts
export function wilsonLower(favs: number, total: number, z = 1.96): number { /* Wilson 95% CI 下限 */ }

export interface RankedRecipe {
  hash: string;
  params: NormalizedParams;
  total: number;
  favs: number;
  rate: number;
  wilson: number;
}

export function rankRecipes(rollups: RankingRollup[], minSample = 3, topN = 10): RankedRecipe[] {
  return rollups
    .filter((r) => r.total >= minSample)
    .map((r) => ({
      hash: r.hash,
      params: r.params,
      total: r.total,
      favs: r.favs,
      rate: r.favs / r.total,
      wilson: wilsonLower(r.favs, r.total),
    }))
    .sort((a, b) => b.wilson - a.wilson || b.total - a.total)
    .slice(0, topN);
}
```

Wilson 下限は Binomial proportion の 95% CI 下限で、少ないサンプルの過大評価を自動的に抑制します。閾値は minSample=3、topN=10 に固定します（将来的にはユーザー設定可能にする余地）。

### バックフィル

**スクリプト 2 本**を新規作成します。

- **`server/scripts/backfill-ranking-rollups-cloud.ts`** (Firestore 用): `collectionGroup('generations')` で全ユーザーの全生成を取得し、ユーザー別に集計、`users/{uid}/rankingRollups/{hash}` に `writeBatch` で書き込み。完全再構築モード（既存 rollup を捨てて 0 から作り直す）で idempotent。
- **`server/scripts/backfill-ranking-rollups-local.ts`** (ローカル用): `server/outputs/metadata.json` を読み、集計、`server/outputs/rankingRollups.json` に atomic write。

両者とも `--dry-run` フラグに対応し、書き込みなしの検証モードを提供します。実行後、既存の `analyze-favorites.ts` (フルスキャン) と結果が一致することでクロスチェック可能です。

### UI

`ControlPanel` をタブ構造化します。

- **タブ切替**: セグメント型タブ「📝 フォーム」「🏆 ランキング」を `ControlPanel` 冒頭に配置。既存の View Transitions API パターン（バッチモーダルと同じ）でタブ間の切替を滑らかに。
- **フォームタブ**: 現状の form 全体をここに包む。挙動変更なし。
- **ランキングタブ**: 新規サブコンポーネント `RankingPanel.tsx` に切り出し。Top 10 レシピを Wilson 下限順で表示。順位絵文字 (🥇🥈🥉 + 4-10 位は数字)、Wilson%、favs/total、パラメータ 3-4 行、右端に「フォームに適用」ボタン。
- **empty state**: rollup が空 or `total >= 3` の recipe が 0 の場合、「まだランキングを作るためのデータが不足しています。もっと生成してみましょう 🎨」を表示。
- **「フォームに適用」ボタン**: 対応 rollup の params から form state (model/sampler/scheduler/width/height/enableHr/loras/refiner/vae) に反映、Form タブに自動切替、トーストで完了通知。model 名は stripHash 済みなので、現行の SD モデルリストから `startsWith` で完全 title を復元して setState する（既存 `loadIntoFormState.ts` の `inferSdArchitectureFromTitle` パターンを流用）。

### i18n 新規キー

`i18n/ja.ts` と `i18n/en.ts` に以下を追加します。

- `controlPanel.tabForm: '📝 フォーム'` / `'📝 Form'`
- `controlPanel.tabRanking: '🏆 ランキング'` / `'🏆 Ranking'`
- `ranking.emptyState: 'まだランキングを作るための生成データが不足しています。もっと生成してみましょう 🎨'` / 英訳
- `ranking.applyToForm: 'フォームに適用'` / `'Apply to form'`
- `ranking.favsShort: (favs, total) => '${favs}/${total} fav'`
- `ranking.applyToast: 'レシピをフォームに適用しました 🎨'` / 英訳

## テスト戦略

Vitest でカバー:

- **`client/src/utils/rankingRollup.test.ts`** (新規): `normalizeParams` + `buildRollupKey`。同一 params → 同一 hash / LoRA 順序違い → 同一 hash / stripHash 済みモデル / 空 refiner/VAE で hash 決定的、など 8+ ケース。
- **`client/src/utils/rankingAnalysis.test.ts`** (新規): `wilsonLower` の代表値検証 (5/7 → ~0.359, 20/25 → ~0.689) / `rankRecipes` の順序 (Wilson 降順、tie-break は total 降順) / minSample フィルタ / topN 切り / 空入力・0 total で crash なし。
- **`server/utils/rankingRollup.test.ts`** (新規): server 版が client 版と同一 hash を生成することのクロス互換確認。

書き込みフローの原子性は Firebase SDK の責務なので Vitest では検証しません。代わりに Chrome DevTools MCP + 実 Firestore 環境で以下のシナリオを Loop Engineering (最大 10 反復) で確認:

- 生成 → rollup `total: +1`
- お気に入り toggle → `favs: +1 / -1`
- 削除 → `total: -1`（isFavorite なら `favs: -1` も）
- 「フォームに適用」→ form state 反映 + Form タブ切替 + トースト

バックフィルスクリプトは `--dry-run` の出力を既存 `analyze-favorites.ts` の結果とクロスチェックすることで検証します。ユニットテストはワンオフ用途のため作成しません。

## 影響範囲

**新規ファイル**:
- `client/src/utils/rankingRollup.ts` — normalize + hash
- `client/src/utils/rankingAnalysis.ts` — Wilson + ranking
- `client/src/utils/rankingRollup.test.ts` / `rankingAnalysis.test.ts` — Vitest
- `client/src/components/RankingPanel.tsx` — Ranking タブ UI
- `server/utils/rankingRollup.ts` — server 版 hash + updateLocalRollup
- `server/utils/rankingRollup.test.ts` — server 版 Vitest
- `server/scripts/backfill-ranking-rollups-cloud.ts` — ワンオフスクリプト (Firestore)
- `server/scripts/backfill-ranking-rollups-local.ts` — ワンオフスクリプト (local)

**修正ファイル**:
- `client/src/firebase.ts` — `saveGeneration` / `updateFavorite` / `deleteGenerations` に rollup 書き込みを追加、`subscribeRankingRollups` を新規 export
- `client/src/components/ControlPanel.tsx` — タブ化、Ranking タブへの分岐、`onApplyRecipe` prop
- `client/src/App.tsx` — `rankingRollups` state、`subscribeRankingRollups` 購読、`applyRecipe` handler、`ControlPanel` に prop 渡し
- `server/index.ts` — `/api/generate`、`/api/generations/favorite`、`/api/generations/delete` の save 部分に rollup 更新を追加、`GET /api/ranking-rollups` を新規追加
- `client/src/i18n/ja.ts` / `en.ts` — 新規 keys
- `firestore.rules` — `users/{uid}/rankingRollups/{hash}` への read/write を owner だけに許可するルール追加

**変更なし**:
- `GenerationData` / `GenerationRecord` の型
- 既存の gallery / lightbox / batch modal / preview の挙動

**ADR**: 実装完了後に新規 ADR (adr-0021 付近) を作成予定。materialized view パターンの採用理由、代替案（フルスキャン+キャッシュ / Cloud Functions）却下理由、schema version フィールドによる将来の migration 戦略などを記録します。

## 却下した代替案（詳細）

- **hash 形式を決定的文字列キーに**: Firestore コンソールで人間が読める利点はあったが、doc ID の 1500 bytes 上限に接近するリスク。SHA-256 hex + params フィールドで debug 性は同等に確保できる。
- **rollup 書き込みを Cloud Functions で自動化**: サーバー側の Firebase 依存を復活させることになり、Sumica の設計原則 ([[adr-0001-client-side-firebase-persistence]]) に反する。クライアント側の `writeBatch` で十分。
- **Ranking UI をヘッダーモーダルに配置**: ワンクリックで見られる利点はあったが、「見た瞬間からフォームに反映しやすい導線」を優先して ControlPanel 内タブに決定。
- **hash に steps/CFG も含める**: 現状のデータではすべて `steps=30, cfgScale=7` で分散ゼロ。含めても combination は増えず、将来 steps/CFG を実験するようになった時点で version フィールドで migration すれば十分。
