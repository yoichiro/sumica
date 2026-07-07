# ギャラリータイル・キャプション静的レイアウト設計

## 背景と目的

同日先行した [[2026-07-07-gallery-caption-rotation-design]] は「メタ情報を縦スクロールで順次見せるローテーション」という設計でした。実装して実運用してみた結果、次のフィードバックがユーザーから出ました。

- **常に見えていて欲しい情報がある**（モデル名とサイズ）。ローテーションで時々消えるとスキャンしづらい。
- **Hires.fix や LoRA は「適用されているかどうか」だけ分かれば十分**。具体的な数値・LoRA 名は不要。
- **日付はあると便利だが、他より視認性が下がっても良い**。

つまり「常時見せるコア情報」と「補助的なバッジ」の階層に分ける方が、狭いキャプション領域を有効活用できます。これは前 spec の「情報を時間で見せる」発想の反対で、**「情報を視覚的階層で見せる」**アプローチに切り替えることを意味します。

## 要件

- サムネイル画像自体のサイズは現状維持。変えるのはキャプション部分のみ。
- **モデル名**と**サイズ**（W×H とアスペクト比）は常時表示する。
- **Hires.fix 適用有無**を絵文字バッジ ⚡ で示す（適用時のみ表示、値は出さない）。
- **LoRA 適用有無**を絵文字バッジ 🎭 で示す（1 個以上適用時のみ表示、名前・weight は出さない）。
- 作成**日付**は `MM-DD` 短縮形式で控えめに表示する（他フィールドより視認性が下がって良い）。
- 生成プロンプト、Seed、Sampler + Scheduler、Steps、CFG などはキャプションに出さない。詳細はライトボックスで確認できるため。
- ローテーション・アニメーション・hover 停止のインフラは完全に不要（削除する）。

## 決定

**ローテーションを廃止し、静的 2 行レイアウトの `CaptionInfo` コンポーネントに置き換えます。**

新レイアウトは次の 2 行構成です。

- **Row 1**: モデル名（太字、`--text-primary` 色、`fontSize: 13px`、はみ出しは `…` で省略）
- **Row 2**: `display: flex; justifyContent: space-between` で左右分割。
  - 左グループ: サイズ（`fontSize: 11px`、weight 500、`--text-primary` 色、必要なら ellipsis） + Hires バッジ ⚡（`hasHires` 時のみ、`fontSize: 12px`）+ LoRA バッジ 🎭（`hasLora` 時のみ、`fontSize: 12px`）
  - 右: 日付 `MM-DD`（`fontSize: 10px`、`--text-muted` 色、`flexShrink: 0`）

絵文字バッジには `title="Hires.fix 適用"` / `title="LoRA 適用"` を付け、ホバーで意味が確認できるようにします。

代替案として次を検討し、いずれも却下しました。

- **案 X: ローテーションを維持しつつコア情報のみ固定表示**: 実装は可能だが、「片方だけ回転」「片方は静的」という視覚言語の混在が生じ、ユーザーの認知負荷が増える。前 spec で問題だった「情報を追いづらい」体験を根本解決するには、ローテーションを外すのが素直。
- **案 Y: lucide-react アイコン（`Zap`, `Palette`）でバッジを表現**: 一貫性は良いが、絵文字（⚡🎭）のほうがコンパクトかつ既に色分けされていて視認性が高い。ユーザーの好みは絵文字。将来アイコンに寄せたければ差し替えは容易。
- **案 Z: 日付を完全に省く**: 「あると便利」というユーザー要望を尊重して残す。控えめな表示（10px、muted 色）にすることで、コア情報の邪魔にはならない。

## アーキテクチャ

### コンポーネント境界

`HistoryGallery.tsx` に新規サブコンポーネント **`CaptionInfo`** を追加します（既存の `SelectButton`, `FavoriteButton` と同様、非 export のサブコンポーネント）。

- Props: `{ info: CaptionInfoData }`
- 責務: 引数のプレーンなデータ構造をそのまま静的な 2 行 JSX に落とし込む。React hooks は使わない。副作用なし、内部 state なし。
- 依存: `CaptionInfoData` 型のみ。

呼び出し側は、既存の caption 用の外側 `<div>`（`onClick={() => onOpenInPreview(item)}` を持つ）の子として `<CaptionInfo info={buildCaptionInfo(item)} />` を配置します。既存の「クリックでプレビュー呼び出し」の affordance は保存されます。

### データ形状

新規ピュア関数を `client/src/components/captionFields.ts` に置きます（既存の `buildCaptionFieldQueue` は全面置き換え）。

```ts
export type CaptionInfoData = {
  model: string;      // 表示用モデル名（空/null なら "不明"）
  size: string;       // "1024×1536 (3:2)" 形式、比率マッチしなければ "999×555"
  date: string;       // "MM-DD" 短縮形式（システムローカルタイムゾーン）
  hasHires: boolean;  // Hires.fix 適用有無
  hasLora: boolean;   // LoRA 1個以上適用有無
};

export function buildCaptionInfo(item: GenerationData): CaptionInfoData;
```

構築ロジック:

| フィールド | 元データ | ルール |
| --- | --- | --- |
| `model` | `item.model` | 空/null なら `"不明"` にフォールバック |
| `size` | `item.width, item.height` | 既存 `formatSize` を流用（`findSdxlSelection` → `findSd15Selection` の順で比率検出、非マッチなら W×H のみ） |
| `date` | `item.timestamp` | 新規 `formatDateShort`: `MM-DD` 形式（例 `07-05`） |
| `hasHires` | `item.enableHr` | `!!item.enableHr` |
| `hasLora` | `item.loras` | `!!(item.loras && item.loras.length > 0)` |

### 削除する既存コード

置き換えなので、以下は全て削除します。

- `client/src/App.tsx`: `captionRotationTick` state、対応する `useEffect` + `setInterval(6000)`、`<HistoryGallery>` への `captionRotationTick` prop 渡し
- `client/src/components/HistoryGallery.tsx`: `CaptionRotator`, `CaptionSlot` サブコンポーネント、`captionRotationTick` prop、`useState`/`useEffect` の import（他で使っていなければ）、`buildCaptionFieldQueue` の import（新 `buildCaptionInfo` へ差し替え）
- `client/src/components/captionFields.ts`: `CaptionField` 型、`buildCaptionFieldQueue` 関数、`formatDate` (YYYY-MM-DD HH:mm)、`formatSampler`, `formatHires` ヘルパー
- `client/src/index.css`: `.caption-rotator-inner` 用の `@media (prefers-reduced-motion: reduce)` ブロック（もう不要）
- `client/src/components/captionFields.test.ts`: `buildCaptionFieldQueue` 用の 10 個のテストを全て削除し、`buildCaptionInfo` 用の新テストに置き換え

### 保持する既存コード

- `formatSize` ヘルパー（`captionFields.ts`）: そのまま流用
- `findSdxlSelection`, `findSd15Selection`（`presets.ts`）: 変更なし
- 既存の caption 外側 `<div>` の `onClick` / `title` / `style`（`HistoryGallery.tsx`）: 変更なし

### 表示例

- **通常の SD1.5 画像**（Hires なし、LoRA なし）:
  ```
  yayoi_mix_v25-fp16.safetensors [ca28aa4a44]
  512×512 (1:1)                         07-05
  ```
- **SDXL + Hires + LoRA 適用**:
  ```
  juggernautXL_version6Rundiffusion.safetensors [1fe6c7ec54]
  1024×1536 (3:2) ⚡ 🎭                  07-05
  ```
- **サイズが既存プリセット非マッチ**:
  ```
  someModel
  999×555                               07-05
  ```

## テスト

`client/src/components/captionFields.test.ts` を全面書き直し。Vitest で以下をカバーします。

- 基本ケース（Hires なし、LoRA なし）→ `hasHires: false`, `hasLora: false`
- `model: null` → `"不明"` にフォールバック
- `model: ''` → `"不明"` にフォールバック
- サイズがプリセットマッチ → `"512×512 (1:1)"` 形式
- サイズがプリセット非マッチ → `"999×555"` のみ
- SDXL 3:2 portrait 認識 → `"832×1216 (3:2)"`
- `enableHr: true` → `hasHires: true`
- LoRA 1 個適用 → `hasLora: true`
- LoRA 複数適用 → `hasLora: true`（個数は問わない）
- LoRA 空配列 (`loras: []`) → `hasLora: false`
- 日付形式は `MM-DD` shape（`/^\d{2}-\d{2}$/`）、タイムゾーン非依存
- Hires かつ LoRA 複数の複合ケース → `hasHires: true, hasLora: true`

アニメーションはゼロなので視覚テストは不要。`CaptionInfo` コンポーネント自体は関数コンポーネントかつ hooks 不要なので、スモークテストは任意（必要になったら追加）。

## 影響範囲

- **変更ファイル**:
  - `client/src/App.tsx` — rotation tick インフラを削除、`<HistoryGallery>` の prop 1 個削除
  - `client/src/components/HistoryGallery.tsx` — CaptionRotator/CaptionSlot 削除、CaptionInfo 追加、caption `<div>` の子を差し替え
  - `client/src/components/captionFields.ts` — 全面書き直し（`buildCaptionInfo` + `formatDateShort` + 既存 `formatSize` 流用）
  - `client/src/components/captionFields.test.ts` — 全面書き直し
  - `client/src/index.css` — `.caption-rotator-inner` メディアクエリ削除
- **サーバー・Firebase**: 変更なし。`GenerationData` シェイプにも触らない。
- **ADR**: 起こしません（前 spec 同様、ローカル UX 変更）。前 spec ([[2026-07-07-gallery-caption-rotation-design]]) に Superseded ノートを追記して本 spec へポインタを張ります。

## 却下した代替案の詳細（参考）

- **バッジをテキストピル（`[Hires]` `[LoRA]`）にする**: 絵文字より視認性が明確・読み間違いにくいが、キャプション幅が狭いので文字数が増えるとサイズや日付を圧迫する。絵文字 1 文字ならほぼコスト 0 で表示できるので採用。
- **バッジを画像サムネイル上に重ねる（半透明ピル）**: 情報密度は高いが、画像自体の視認性を損なうデメリットが大きい。キャプション欄が空いているので、そこに置くのが素直。
- **日付を相対時間（`3日前` など）に変換**: 「作成日付がわかる」目的なら相対でも良いが、複数画像を並べて比較する用途では絶対日付のほうが判別しやすい。実装コストも `MM-DD` の方が低い。
