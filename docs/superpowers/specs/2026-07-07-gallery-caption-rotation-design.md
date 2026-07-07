# ギャラリータイル・キャプション情報ローテーション設計

> **⚠️ Superseded** — この設計は同日中に [[2026-07-07-gallery-caption-static-design]] によって置き換えられました。理由は実装後の実運用フィードバックで「常時見えていて欲しい情報がある」「Hires・LoRA は値ではなく有無だけで十分」との判断に至ったためです。本ファイルは当時の設計判断の履歴として残していますが、現在動作しているコードは静的レイアウト版です。以降の記述は「かつて採用されていた案」として読んでください。

## 背景と目的

`HistoryGallery` の各サムネイル下の情報エリアは、現在「生成プロンプト（先頭 30〜40 字で `text-overflow: ellipsis` により切り詰め）」と「作成日付」の 2 行だけを表示しています。プロンプトの先頭数十字だけでは日本語の自然言語入力の識別性が低く、情報エリアが十分に機能していません。

一方、サムネイルサイズを維持したままの狭い領域（実効幅 1 行 20〜30 文字程度）では、生成に関する詳細情報（モデル、サイズ、Sampler、Hires.fix、LoRA など）を同時に静的表示するのは不可能です。

そこで、**キャプション部分を縦スクロール式のローテーション表示**に置き換え、複数のメタ情報を時間で切り替えながら順に表示することで、狭い空間で情報エリアを有効活用します。

## 要件

- サムネイル画像自体のサイズは現状維持。変えるのはキャプション部分のみ。
- 生成プロンプトはキャプションローテーションから除外（詳細はライトボックスで見られるため）。
- 生成日時（Seed は表示しない）、モデル名、サイズ、Sampler + Scheduler、Hires.fix、LoRA を対象フィールドとする。
- LoRA は複数適用されている場合、**1 スロット 1 LoRA** として個別に表示する（「siitake-eye, ClearHand-V2」のようにカンマ区切り 1 行ではない）。
- Hires.fix と LoRA は該当画像のみ追加スロットとする（条件付きフィールド）。
- 切替間隔は 3 秒。
- キャプションは 2 行で、フィールドが縦スクロール（上方向）で流れる形。同時に 2 つのフィールドが見える。
- 全タイルの切替タイミングは同期させる（tick は共有）。フィールドキューの内容は画像ごとに独立。
- hover 中はローテーションが停止し、現状のフィールドを読める。
- `prefers-reduced-motion: reduce` を尊重し、モーションを望まないユーザーには即時切替とする。

## アーキテクチャ

### 全体データフロー

- `App` レベルで `useState<number>('captionRotationTick')` の共有カウンタを持つ。
- `useEffect` 内で `setInterval(3000)` を張り、3 秒ごとに `setCaptionRotationTick(t => t + 1)` を実行。
- `useRef` に `setInterval` の ID を保持し、コンポーネントアンマウント時に `clearInterval` する。
- `captionRotationTick` を `HistoryGallery` に prop として渡し、そこから各タイルに伝播させる。
- 各タイルは自分の `GenerationData` から**独自のフィールドキュー**を組み立て、`tick` に応じた 2 スロットを縦スクロール表示する。

App レベルの tick は数値カウンタ 1 個だけで、履歴が空でも実質コストゼロです。既存の `useEffect` パターン（`healthInFlight`, `modelTypeInitialized`）と同じ場所に配置します。

### コンポーネント境界

- **`HistoryGallery.tsx`** に**新規サブコンポーネント `CaptionRotator`** を追加します（既存の `SelectButton`, `FavoriteButton` と同じスタイル）。
  - Props: `{ item: GenerationData; tick: number }`
  - 責務: `item` から field queue を組み立て、`tick` に応じた 2 スロットを縦スクロール表示する。
  - 依存は `tick` の値だけ。純粋な関数コンポーネント。
- **`HistoryGallery` 本体**は、既存の `.map((item, index) => …)` の中で、現在プロンプト + 日付を表示している `<div>` を `<CaptionRotator item={item} tick={captionRotationTick} />` に置き換えます。

### フィールドキュー構築ロジック

新規ファイル **`client/src/components/captionFields.ts`** にピュア関数 `buildCaptionFieldQueue(item: GenerationData): CaptionField[]` を切り出します。

型定義:

```ts
export type CaptionField = {
  key: string;   // 一意な識別子（React key + テスト用）
  label: string; // ラベル（"モデル", "サイズ" 等）
  value: string; // 表示する値
};
```

構築ロジック（順序固定、条件付きフィールドは末尾で加算）:

| # | 条件 | key | label | value 例 |
| - | --- | --- | --- | --- |
| ① | 常に | `model` | `モデル` | `juggernautXL`（`item.model` が空／null なら `不明`） |
| ② | 常に | `size` | `サイズ` | `1024×1536 (3:2)`（比率は `presets.ts` のヘルパーを流用、マッチしなければ `1024×1536` のみ） |
| ③ | 常に | `date` | `日時` | `2026-07-05 14:23`（`toLocaleString` で日本ロケール） |
| ④ | 常に | `sampler` | `Sampler` | `DPM++ SDE · Karras`（`item.scheduler` が未設定なら `DPM++ SDE` のみ、`item.sampler` も未設定ならスキップして 4 個未満になる可能性あり） |
| ⑤ | `item.enableHr === true` | `hires` | `Hires.fix` | `×2 (denoise 0.5)`（`item.hrScale` と `item.denoisingStrength` から組み立て） |
| ⑥ | `item.loras` の各要素 | `lora-${i}` | `LoRA` | `siitake-eye × 0.8` |

エッジケース:

- モデル名など長い文字列は関数側では切り詰めない。表示側 CSS で `text-overflow: ellipsis` によって処理する。
- LoRA 0 個 / Hires オフ / Sampler 未設定 の画像は最短 3〜4 個のキュー。キュー長が 1 の画像は理論上ないが、ガードとして「長さ 1 以下ならスクロール停止で静的表示」の分岐を入れる。
- ローテーションは `[queue[tick % N], queue[(tick + 1) % N]]` で 2 スロットを取得。

### アニメーション

「本物のスクロール」感を出すため、内部に **3 スロット**をレンダーし、`translateY` のトグルで上方向スクロールを表現します。

構造:

```
container (height: 2 × lineHeight, overflow: hidden)
  └─ inner wrapper (transform: translateY(...))
       ├─ slot 0: queue[topIdx]      ← 通常時、上段に見える
       ├─ slot 1: queue[bottomIdx]   ← 通常時、下段に見える
       └─ slot 2: queue[nextIdx]     ← 通常時は見えない（次のフレーム候補）
```

`CaptionRotator` は次の state を持ちます:

- `displayTick`: 現在表示している基準 tick。初期値は prop の `tick`。
- `scrolling`: `boolean`。トランジション中かどうか。

`useEffect` で `tick !== displayTick` を検知したときの流れ:

1. `setScrolling(true)` → 内部 wrapper の transform を `translateY(-lineHeight)` にする（CSS transition が 400ms かけて上にスクロール）。
2. `setTimeout(400)` で `setDisplayTick(tick)` + `setScrolling(false)` → transform を `translateY(0)` にスナップバックし、同時にスロット内容を 1 個ずらす。
3. スナップバック時点で「見えているスロット内容」は変わっていないので、視覚的なジャンプは発生しません。

### hover による停止

- `useState<boolean>('isHovered')` + `onMouseEnter/onMouseLeave` で hover 状態を追跡。
- `useEffect` の先頭で `if (isHovered) return;` の早期リターン。tick 変化があっても animate しない。
- unhover 時に useEffect が発火し、最新の tick までスクロールしてキャッチアップ。

これにより、hover 中はタイル単位で自然に「止まる」挙動になります。App レベルの状態には触りません。

### アクセシビリティ

CSS メディアクエリでトランジションを無効化します:

```css
@media (prefers-reduced-motion: reduce) {
  .caption-rotator-inner {
    transition: none;
  }
}
```

これで OS 設定が「モーションを減らす」の場合、スロットは即時切り替わります（内容変化自体は続く）。React 側の分岐は不要です。

## テスト

Vitest でカバーするのは `buildCaptionFieldQueue` ピュア関数のみです。アニメーション自体は視覚的テストが必要になるため単体テスト対象外とします。

新規ファイル **`client/src/components/captionFields.test.ts`** で以下のケースを検証します:

- 基本ケース（LoRA なし、Hires オフ、全メタ揃い）→ 4 個のキュー
- Hires 有効ケース → 5 個のキュー
- LoRA 1 個ケース → 5 個のキュー
- LoRA 3 個ケース → 7 個のキュー
- Hires + LoRA 2 個の複合ケース → 7 個のキュー
- モデル未設定（`null` / `undefined` / 空文字）→ `不明` にフォールバック
- サイズ比率が既存プリセットにマッチしない画像 → `WxH` のみ
- Sampler / Scheduler の一方または両方が未設定
- `hrScale` や `denoisingStrength` が未設定な Hires（想定外だが防御的テスト）

`CaptionRotator` 自体は依存の少ない小さなコンポーネントで、レンダリング結果は `tick` と `queue` から決まるため、必要ならスモークテスト（tick=0 のとき queue[0] と queue[1] のラベルが DOM に含まれる程度）を追加可能ですが、まずは必須ではないと判断します。

## 影響範囲

- **変更ファイル**:
  - `client/src/App.tsx` — `captionRotationTick` state + `useEffect`（setInterval）+ `HistoryGallery` への prop 追加
  - `client/src/components/HistoryGallery.tsx` — `CaptionRotator` サブコンポーネント追加、既存のプロンプト＋日付表示を置き換え
- **新規ファイル**:
  - `client/src/components/captionFields.ts` — `buildCaptionFieldQueue` ピュア関数
  - `client/src/components/captionFields.test.ts` — Vitest ユニットテスト
- **サーバー・Firebase**: 変更なし。既存の `GenerationData` フィールドで完結します。
- **ADR**: このローテーション設計自体はギャラリーのローカル UX 改善で、システム全体の構造変更ではないので新規 ADR は起こしません。将来もし他コンポーネント（Preview 側など）にも展開する場合は、その時点で ADR 化を検討します。

## 却下した代替案

- **静的パラレル表示（複数チップを同時に見せる）**: 幅が足りずスマホでも詰まりすぎて実用にならないと判断（狭い領域制約が支配的）。
- **表示フィールドをユーザーが選ぶ切替 UI**: 実装は可能ですが、ローテーションの「情報が流れてくる」体験を損なうのと、まず MVP でシンプルに始めたいので今回は不採用。将来オプションとして追加余地は残す。
- **横スクロール（マーキー）で 1 行に詰め込む**: 情報密度は最大だが動きがうるさく、CSS のみで自然に止められないため hover 停止と噛み合わない。
- **hover でポップアップ表示**: グリッドを静かに保てるが、touch デバイスで機能せず、また「情報エリアを有効活用」という本要件の主旨（常時何かが見える状態）と合わない。

## オープンな判断（実装フェーズで確定させる）

- 日時のフォーマット文字列（`toLocaleString(ja-JP, ...)` のオプション詳細）— 実装時に既存のギャラリー日時表記と揃える。
- Sampler + Scheduler の連結記号（現在案は `·`）— 実装時に他画面との統一を確認。
- CSS の具体的な line-height / padding — 既存キャプションの高さと視覚的な連続性が保てるよう実装時に調整。

これらは意思決定というより実装時の細部なので、仕様のブロッカーにはしません。
