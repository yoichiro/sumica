# 履歴ギャラリー・フィルタ拡張 設計書

## 背景

Sumica の履歴ギャラリー（`components/HistoryGallery.tsx`）は現在、以下 2 つのフィルタしか持ちません。

- **日付フィルタ**（`filterDate`）: `<input type="date">` で選んだ 1 日分だけを表示
- **お気に入りフィルタ**（`favoritesOnly`）: ⭐ の付いた画像だけを表示

洋一郎さんから、これに加えて **「あるモデルだけ」「SDXL のモデルだけ」「あるサンプラーだけ」** のように、生成パラメータレベルの絞り込みを行いたいというリクエストがあがりました。日々の生成量が増えるにつれて、「試したモデル別に振り返りたい」「SDXL の当たり構図だけ見比べたい」というニーズが強くなってきた背景です。

## スコープ

この設計書で扱うのは **モデル名 / アーキテクチャ（SDXL/SD1.5）/ サンプラー** の 3 種類のフィルタ追加のみです。Scheduler / LoRA / Hires / Refiner / サイズなどの追加フィルタは将来的な拡張余地として認識していますが、本設計には含めません。

## ブレスト決定事項サマリ

事前のブレスト（このセッション）で以下を決めました：

- **対象フィールド**: モデル名 + アーキテクチャ + サンプラーの 3 つ
- **フィルタ合成**: すべて AND（日付・お気に入りとも AND）
- **フィルタ範囲**: 現在選択中の日付履歴の中でのみ絞り込み（Firestore クエリは変更しない）
- **UI 配置**: ツールバーに「フィルター」ボタン → ポップオーバー展開
- **選択方式**: 各フィールドで単一選択（select / radio）
- **選択肢の中身**: 現在の日付履歴に実際に登場する値のみ（distinct 抽出）
- **永続化**: しない（セッションごとにリセット）

## 設計

### アーキテクチャとデータフロー

新フィルタは **完全にクライアントサイド、既存の `displayedHistory` 派生の後段に配置** します。Firestore の per-day range query は一切変更しません。

```
Firestore/subscription (per-day range)
        │
        ▼
     history[]  ← 既存の state
        │
        ▼
[date + favoritesOnly filter]  ← 既存ロジック
        │
        ▼
[NEW: arch + model + sampler filter]  ← 追加ロジック
        │
        ▼
   displayedHistory
```

- **`history` state のシェイプ・購読ロジックは無変更**。signed-in の Firestore range query も signed-out の `/api/history` fetch も、そのまま既存のまま
- 新フィルタは `displayedHistory` の `useMemo` 内で 3 行程度の `.filter()` を追加するだけで完結
- パフォーマンス面: `history` は per-day で数百件までの想定なので、client-side filter chain の重ねがけは実質無視できるコスト

### フィルタ状態と純粋ヘルパー

App.tsx に新規 state を追加：

```typescript
export interface GalleryFilters {
  arch: 'sdxl' | 'sd15' | null;
  model: string | null;   // モデル title 完全一致（stripHashSuffix はしない）
  sampler: string | null; // sampler 名完全一致
}

const [galleryFilters, setGalleryFilters] = useState<GalleryFilters>({
  arch: null, model: null, sampler: null,
});
```

`null` = そのフィールドは無効（"すべて" を意味する）というシンプルな 3-way の表現にします。

**テスト可能性のために、以下 3 つの pure ヘルパーを新規ファイル `client/src/components/galleryFilters.ts` に切り出します**：

```typescript
// 1. history を GalleryFilters で絞り込む主関数
export function applyGalleryFilters(
  history: GenerationData[],
  filters: GalleryFilters,
  sdModels: SdModel[],
): GenerationData[]

// 2. 履歴から distinct な model 名 / sampler 名を抽出（ソート済み）。
//    App.tsx 側では `baseScopedHistory` を渡し、date/favorites 適用後の
//    集合から distinct を取ることで、フィルタで残ってない model が
//    select に出てしまう「デッドオプション」を避ける。
export function deriveFilterOptions(history: GenerationData[]): {
  models: string[];
  samplers: string[];
}

// 3. active な（null でない）フィルタ数のカウンタ — ボタンバッジ用
export function countActiveFilters(filters: GalleryFilters): number
```

App.tsx はこの 3 つを呼ぶだけの薄い wrapper になります。**空状態のメッセージ分岐で「base だけ 0」と「gallery filter で 0」を区別する必要がある**ため、中間の `baseScopedHistory` も独立した useMemo として保持し、`HistoryGallery` に props として渡します：

```typescript
// Base scope（既存の date + favoritesOnly だけを適用）
const baseScopedHistory = useMemo(() => {
  if (favoritesOnly) return user ? history : history.filter((h) => !!h.isFavorite);
  return filterDate ? history.filter((it) => localYMD(it.timestamp) === filterDate) : history;
}, [history, favoritesOnly, filterDate, user]);

// 新フィルタを重ねがけした最終結果
const displayedHistory = useMemo(() => {
  return applyGalleryFilters(baseScopedHistory, galleryFilters, sdModels);
}, [baseScopedHistory, galleryFilters, sdModels]);
```

`applyGalleryFilters` の内部でアーキ判定には既存の `inferSdArchitectureFromTitle(item.model, sdModels)`（[[adr-0016-defer-sdxl-misclassification-fix]] 系のフォールバック挙動を含む）を再利用します。これは ADR 36 で新設したチップ表示ロジックと同じヘルパーで、履歴側とランキング側でアーキ判定が完全一致する副次効果もあります。

### UI: `GalleryFiltersPopover` コンポーネント

新規ファイル `client/src/components/GalleryFiltersPopover.tsx`。トグルボタンとポップオーバーを 1 コンポーネントで完結させ、`HistoryGallery` のツールバー（日付 + お気に入りの右隣）に配置します。

**ツールバー側の見た目**：

```
📅 2026-06-29   ⭐ お気に入り   [🔍 フィルター (2)]   66件
```

- `(2)` は active フィルタ数（`countActiveFilters` の返り値）。0 のときは括弧ごと非表示。
- ボタン押下でポップオーバーが開閉。外側クリック / Esc キーで閉じる。

**ポップオーバー中身**：

```
┌──────────────────────────────────────┐
│ アーキテクチャ                        │
│ ○ すべて  ○ SDXL  ○ SD1.5           │  ← 3 択ラジオ
│                                      │
│ モデル                                │
│ [すべて                        ▾]     │  ← native <select>
│                                      │
│ サンプラー                            │
│ [すべて                        ▾]     │
│                                      │
│           [🗑️ クリア]  [閉じる]       │
└──────────────────────────────────────┘
```

**UI ルール**：

- **アーキはラジオ** — 常に 3 択（すべて / SDXL / SD1.5）なので、視認性を優先してラジオボタンで並べる
- **モデル・サンプラーは native `<select>`** — 選択肢が動的（日によって数個〜十数個）で、native ドロップダウンの方が長いリストに耐える
- **選択肢が 1 個以下しかないフィールドは自動非表示** — 例：その日の全画像が同じサンプラーなら「サンプラー」フィルタは意味がないので UI に出さない。「フィルタ可能な軸」が動的に決まる直感的挙動
- **クリアボタン**: 3 フィールドすべてを null にリセット
- **閉じるボタン**: ポップオーバーを閉じる（外側クリック / Esc と等価）

**i18n 追加**（`ja.ts` / `en.ts` 両方に）：

```typescript
gallery: {
  ...,
  filters: {
    buttonLabel: 'フィルター',
    activeCountSuffix: (n: number) => ` (${n})`,
    archLabel: 'アーキテクチャ',
    archAll: 'すべて',
    modelLabel: 'モデル',
    modelAll: 'すべて',
    samplerLabel: 'サンプラー',
    samplerAll: 'すべて',
    clearButton: '🗑️ クリア',
    closeButton: '閉じる',
  },
},
```

**props インターフェース**：

```typescript
export interface GalleryFiltersPopoverProps {
  filters: GalleryFilters;
  onSetFilters: (filters: GalleryFilters) => void;
  availableModels: string[];    // deriveFilterOptions().models
  availableSamplers: string[];  // deriveFilterOptions().samplers
}
```

`sdModels` は arch 判定用に App.tsx 側で使うだけなので、ポップオーバー側には渡しません。

### 選択インタラクションと空状態

**選択との干渉解決**: フィルタ変更で「見えなくなった選択」を自動で外します。意図しない一括削除の事故を防ぐためです。

```typescript
useEffect(() => {
  const visibleKeys = new Set(displayedHistory.map(itemKey));
  setSelectedIds((prev) => {
    const next = new Set<string>();
    for (const k of prev) if (visibleKeys.has(k)) next.add(k);
    return next.size === prev.size ? prev : next;
  });
}, [displayedHistory]);
```

- サイズが変わらなければ `setSelectedIds` を呼ばずに再レンダーを抑制
- この effect は date / favoritesOnly 変更時にも自然に効く。現状はこれらの変更で選択がそのまま残っていたが、副次的にこの挙動もキレイになる

**空状態の 3 分岐**（判定順序が明確に決まっている）：

| 判定順 | 条件 | メッセージキー |
|---|---|---|
| 1 | `history.length === 0`（履歴自体がない） | 既存 `emptyStateNoHistory` |
| 2 | `history` にデータあり、かつ date + favorites の base scope で 0 件 | 既存 `emptyStateNoResults` |
| 3 | base scope はヒットするが gallery filter で 0 件になった | **新規 `emptyStateFiltered`** = `"フィルタ条件に合う画像がありません 🔍"` |

判定 2 と 3 を区別するには「gallery filter を適用する前の中間結果」も参照する必要があるので、App.tsx 側で `displayedHistory` に加えて中間の `baseScopedHistory`（date + favorites だけ適用したもの）も useMemo として保持し、`HistoryGallery` に渡します。ロジックは次のとおり：

```typescript
if (displayedHistory.length === 0) {
  if (history.length === 0) return t.gallery.emptyStateNoHistory;
  if (baseScopedHistory.length === 0) return t.gallery.emptyStateNoResults;
  return t.gallery.emptyStateFiltered;  // base はある、フィルタが 0 にした
}
```

**Lightbox ナビゲーションとの整合**: 既存の `navigateLightbox` / `randomizeLightbox` は `displayedHistory` 配列上をなぞるだけなので、フィルタ結果内で自動的にナビゲートする挙動になります。追加実装は不要。

### テスト戦略

**新規テストファイル `client/src/components/galleryFilters.test.ts`**（Vitest）：

**`applyGalleryFilters`**:
- model 単独マッチ / 非マッチ
- sampler 単独マッチ / 非マッチ
- arch=sdxl（sdModels に登録済み）
- arch=sd15（sdModels に登録済み）
- arch フォールバック（sdModels に無いモデル名、"xl" 含む → sdxl 判定）
- arch と model と sampler の 3 条件 AND での複合マッチ
- 全部 null なら pass-through（履歴が返り値と等価）
- 空配列の入力 → 空配列

**`deriveFilterOptions`**:
- 重複除去（同じ model 名が複数回登場しても distinct 1 個）
- null / 空文字 model / 空文字 sampler は除外
- 出力配列はソート済み（determinism 保証）

**`countActiveFilters`**:
- 全部 null → 0
- 1 個だけセット → 1
- 3 個セット → 3

**既存テストへの影響**: なし。`RankingPanel.test.tsx` / `loadIntoFormState.test.ts` / `presets.test.ts` などは無関係。

**手動検証手順**（実装完了後）：

1. dev サーバー起動、日付を画像がある日にセット
2. フィルタ「SDXL」ON → SDXL モデルの画像だけになることを確認
3. さらにモデルを 1 つ選ぶ → 該当モデル + SDXL の交差集合になることを確認
4. サンプラーも指定して 0 件になる組み合わせを試す → 新しい空状態メッセージ確認
5. 画像を 5 個選択 → フィルタでそのうち 3 個が非表示になるよう変更 → 選択が 2 個に減ることを確認
6. クリアボタン → フィルタが全部 null に戻り、履歴が元通り

## 影響を受けるファイル一覧

**新規作成**:

- `client/src/components/galleryFilters.ts` — pure ヘルパー 3 つ
- `client/src/components/galleryFilters.test.ts` — 上記のユニットテスト
- `client/src/components/GalleryFiltersPopover.tsx` — トグルボタン + ポップオーバー

**編集**:

- `client/src/App.tsx` — `galleryFilters` state 追加、`displayedHistory` に `applyGalleryFilters` を組み込み、フィルタ変更時に隠れた選択を落とす useEffect 追加、`HistoryGallery` に新 props をパス
- `client/src/components/HistoryGallery.tsx` — ツールバーに `GalleryFiltersPopover` を配置、空状態の 3 分岐対応
- `client/src/i18n/ja.ts` / `en.ts` — `gallery.filters.*` セクション追加、`emptyStateFiltered` メッセージ追加

## 想定される Consequences

- **フィルタ機能により「振り返り」品質が向上**。特に「試したモデル別に絞って見比べる」「SDXL の日だけ全部見る」といった振り返り作業がワンクリックで完結するようになる
- **選択肢を distinct 抽出する方針の副次効果**として、その日に登場しないモデル・サンプラーが select に出ないため「なぜ選んでも 0 件になるの？」という混乱を回避
- **選択が自動で消える挙動**は「便利」でも「予想外」でもありうる。手動検証の項目 5 で必ず動作を確認し、違和感があれば UI で 1 回警告を出す等の追加検討を将来的な余地として残す
- **`sdModels` への依存**が gallery filter に追加される。SD が未接続の場合 arch フィルタは常に "xl"-in-name の fallback だけで動くため、SD が接続復帰した瞬間に一部レコードの arch 判定が変わりうる副作用がある。ただし ADR 36 と同じ挙動なので、ADR 36 で許容した副作用の延長線上として整理できる
- **将来 Scheduler / LoRA / Hires / Refiner / サイズフィルタを追加したくなった場合**、`GalleryFilters` 型と `GalleryFiltersPopover` に 1 フィールドずつ足すだけで拡張できる。distinct 抽出のパターンも `deriveFilterOptions` に足すだけ。段階的拡張に耐える設計になっている
