# ロード済み拡張プロンプトによる生成再現 設計書

## 背景

Sumica の生成パイプラインは、原文プロンプト（`prompt`）を LM Studio に渡して positive/negative の拡張プロンプトを作らせる `POST /api/enhance` の Step 1 と、その positive/negative を Stable Diffusion に渡して画像を生成させる `POST /api/generate { skipEnhance: true }` の Step 2 の 2 段構造になっています。詳細は CLAUDE.md の「The generation pipeline」節、および `client/src/App.tsx` の `enhanceOnce()` / `generateImage()` を参照してください。

現状、生成された画像から「フォームにロード」を押すと、原文プロンプト・サイズ・モデル・sampler・scheduler・steps・CFG・LoRA・Hires.fix 設定・Refiner・VAE・seed など多くのパラメータが復元されます（`loadIntoForm()` in `App.tsx:1197`、および完全なユニットテスト付きの純粋関数 `computeLoadIntoFormState`）。しかし **拡張プロンプト（`enhancedPrompt` / `negativePrompt`）はロード対象外** です。`GenerationData` 型（`App.tsx:47`）自体はこの 2 フィールドをすでに保持しており、Firestore / `metadata.json` にも保存されていますが、ロード時にフォーム側の state には流し込まれません。

結果として、seed を固定して同じサイズ・モデル・全パラメータを揃えて再生成しても、Step 1 で LLM が再度呼ばれ、そのときの LLM の出力ゆらぎ（temperature: 0.7）で positive/negative が微妙に変わり、結果として異なる画像が生成されます。**「同じ画像を再生成する」ユースケース** が現状のパイプラインでは実現できないというギャップが顕在化しました。

一方、この 2 段構造の分離は「Batch Generation」機能で活かされており（[[adr-0002-batch-generation-sequential-loop]]）、`enhanceOnce` を 1 回だけ呼び、その結果を全ジョブで再利用する `skipEnhance: true` パスが実運用されています。つまり **「拡張プロンプトを外から与えて Step 1 を丸ごとスキップする」パスは既に存在** しており、今回の変更は「そのスキップ条件を単発生成にも拡張する」ことに相当します。

## スコープ

本 spec で扱うもの:

- `loadIntoForm` が `enhancedPrompt` / `negativePrompt` もフォーム state に流し込むように拡張
- フォームに「ロード済み拡張プロンプト」の read-only 表示 UI（`ControlPanel` 内）
- ユーザーがロード済み拡張プロンプトをクリアする操作
- ロード済み拡張プロンプトがある状態での `handleGenerate`（単発）が LM Studio の enhance を **スキップ** して直接 SD に流す
- 同じく `handleBatchGenerate`（バッチ）が全ジョブでロード済み拡張プロンプトを再利用する
- 原文プロンプトがロード時のスナップショットと乖離したときの警告バッジ表示

スコープ外（別 spec 候補）:

- ロード済み拡張プロンプトの手入力・編集を許可する UI
- 拡張プロンプトを個別に（Positive のみ、Negative のみ）クリアする粒度
- ロード時の enhance 自動再実行オプション
- 拡張プロンプトの完全一致比較による「同じ画像かどうか」のバリデーション UI
- 「まとめて生成」のクロスプロダクト対応（別途検討済み、実装は保留）

## ブレスト決定事項サマリ

- **原文プロンプト編集時の挙動**: 拡張プロンプトはそのまま保持し、原文が乖離したら警告バッジを表示する（自動クリアはしない）
- **UI 配置**: 未セット時は完全非表示、ロード時のみ原文プロンプト欄の直下に自動的に現れる
- **バッチ生成での扱い**: ロード済み拡張プロンプトが存在すればバッチにも自動適用する（enhance を 0 回にする）
- **クリアの粒度**: Positive/Negative を両方同時にクリアする単一ボタン
- **警告の粒度**: 原文プロンプトが loadIntoForm 時のスナップショットから 1 文字でも変わったら警告バッジを 1 個表示

## アーキテクチャ

`enhanceOnce` → `generateImage(skipEnhance: true)` の 2 段パイプラインは変更しません。フォーム側に「ロード済み拡張プロンプト」の 3 つの新規 state を追加し、生成パイプラインの Step 1 直前で `loadedPositive` の空チェック 1 箇所によって enhance をスキップする分岐を挿入するだけの、小さな追加変更です。

サーバー側 (`server/index.ts`) は一切変更しません。`/api/enhance` は「呼ばれたら LLM を叩く」という現状の契約のままで、クライアント側が「呼ばない」判断をします。この境界の分け方は、サーバーの責務を狭く保つ既存方針（[[adr-0031-env-only-config-no-runtime-mutation]]）と一貫します。

## 新規 state（`client/src/App.tsx`）

以下の 3 つを追加します。

```ts
// ロード済み拡張プロンプト。空文字なら「未セット」= 従来通り enhance が走る。
const [loadedPositive, setLoadedPositive] = useState('');
const [loadedNegative, setLoadedNegative] = useState('');
// 「フォームにロード」時点の原文プロンプトのスナップショット。現在の prompt
// state と比較して警告バッジ表示を判定する。ロード時にセットされ、クリア時に
// 空文字に戻される。空のときは警告判定を行わない。
const [loadedOriginalPrompt, setLoadedOriginalPrompt] = useState('');
```

3 つを個別の state として持つ理由は、既存の `setPrompt` / `setWidth` などとフラットな粒度をそろえるためです。TypeScript の型は単純な `string`、初期値は空文字。永続化は行いません（リロードで失われるのが望ましい挙動 — ロード操作を再度行うのが自然）。

## 生成パイプラインの分岐

### 単発生成 (`handleGenerate`)

現状 `App.tsx:1564` あたりで `const { positive, negative } = await enhanceOnce(prompt);` を呼んでいる箇所を、次のように分岐させます。

```ts
const { positive, negative } = loadedPositive
  ? { positive: loadedPositive, negative: loadedNegative }
  : await enhanceOnce(prompt);
```

`loadedPositive` が truthy のときだけ enhance をスキップします。`loadedNegative` はスキップ条件には含めません（Positive がセットされていれば Negative も同時にセットされている前提。両者は必ずペアでセット/クリアされる）。

### バッチ生成 (`handleBatchGenerate`)

現状 `App.tsx:1656` あたりの `const { positive, negative } = await enhanceOnce(prompt);` も同じ分岐に置き換えます。

```ts
const { positive, negative } = loadedPositive
  ? { positive: loadedPositive, negative: loadedNegative }
  : await enhanceOnce(prompt);
// 以降は全ジョブで同じ positive/negative を使う（既存の skipEnhance パスと完全一致）
```

このように書くことで、ロード済み拡張プロンプトがあるときは **enhance が 0 回**（バッチ実行全体を通じても LM Studio が 1 度も呼ばれない）になります。ユーザーが「同じプロンプトでモデル軸だけバッチで比較する」といった応用ユースケースが自然に実現できます。

`enhanceOnce` 呼び出しの前後には、既存の `loadingStep`（Step 1: enhancing → Step 2: generating → Step 3: saving）の遷移があります。ロード済み拡張プロンプトが使われるときの UI 遷移は次のように扱います:

- `setLoadingStep(1)` は **省略** し、いきなり `setLoadingStep(2)` から始める
- Step 1 の視覚表示（enhancing... のスピナーやラベル）はまったく表示されない
- 結果として、ユーザーには「Step 1 を丸ごとスキップして即座に画像生成が始まる」ように見える

これは実行時間の短縮（LLM 応答待ちの数秒が消える）とセマンティクスの正確性（Step 1 が実際に実行されていないなら表示しない）の両方を満たします。

## `loadIntoForm` の拡張

`App.tsx:1197` の `loadIntoForm` 関数の末尾に、以下の 3 行を追加します。

```ts
setLoadedPositive(item.enhancedPrompt || '');
setLoadedNegative(item.negativePrompt || '');
setLoadedOriginalPrompt(item.originalPrompt);
```

`enhancedPrompt` / `negativePrompt` が空文字や undefined のレガシー画像（[[adr-0007-gallery-thumbnail-strategy]] 以前の生成データや、外部で作られた画像のインポートなど）に対しては、`|| ''` で空にフォールバックします。この場合ロード後もパネルは非表示のままで、従来通り enhance が走ります。ユーザー体験は変化しません。

同時に、ロード時のトーストメッセージ（`t.toast.loadedIntoForm`）はそのまま維持します。拡張プロンプトがロードされたことを別途通知する必要はありません（パネルが原文の直下に自動的に現れるので、視覚的に十分)。

## UI 詳細

### 配置

`ControlPanel.tsx` 内の原文プロンプト `<textarea>` の **直下** に、`loadedPositive || loadedNegative` が truthy のときだけレンダされるパネルを追加します。未セット時は DOM に一切出さない条件レンダで、フォームの縦方向のスペースを普段は 1px も消費しません。

### 構造

```
┌── 📎 ロード済み拡張プロンプト ──────────────  [クリア] ─┐
│  ⚠ 原文が変更されています （lazy: prompt !== loadedOriginalPrompt のとき） │
│                                                          │
│  Positive                                                │
│  ┌────────────────────────────────────────────────┐     │
│  │ masterpiece, ultra-detailed, (round face:1.2)… │     │
│  │                            (read-only, mono)   │     │
│  └────────────────────────────────────────────────┘     │
│                                                          │
│  Negative                                                │
│  ┌────────────────────────────────────────────────┐     │
│  │ worst quality, blurry, (birds:0.8)…            │     │
│  │                            (read-only, mono)   │     │
│  └────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
```

### 詳細な視覚仕様

- **パネル外枠**: `--panel-bg-sunk` の背景色、`--panel-border` の 1px 枠、角丸 `12px`。原文プロンプトの `<textarea>` と隣接した「関連する情報」として認識される見た目
- **ヘッダー**: `📎 ロード済み拡張プロンプト` のラベル（`t.form.loadedEnhancedPanelTitle`）と右端の「クリア」ボタン。ボタンは既存のサブ操作ボタン (`.chip` 風のミニマル) スタイル
- **警告バッジ**: `prompt !== loadedOriginalPrompt` のときだけ表示。ヘッダーの直下、Positive の上に 1 個。`⚠ 原文が変更されています` のテキスト、`--pop-yellow-tint` 相当の弱い背景、8px の縦マージン
- **Positive / Negative の各 `<textarea>`**: `readOnly` 属性、`font-family: monospace`（拡張プロンプトは技術的な `(phrase:weight)` 表記が並ぶので monospace が読みやすい）、`min-height` は 4 行分、内容が長ければ内部スクロール、外部にはあふれない
- **クリアボタン**: 単一ボタンで Positive/Negative の両方を空文字に戻す。同時に `loadedOriginalPrompt` も空文字に戻し、警告バッジも消える。confirm ダイアログは挟まない（誤操作リスクはあるが、再度ロードすればすぐ戻せるので過剰）

### 実装

`ControlPanel.tsx` に新規 props を追加します:

```ts
loadedPositive: string;
loadedNegative: string;
loadedOriginalPrompt: string;
prompt: string;              // 警告バッジ判定用（既存 prop の可能性大）
onClearLoadedEnhanced: () => void;
```

`onClearLoadedEnhanced` は App.tsx 側で以下のように定義されます:

```ts
const clearLoadedEnhanced = () => {
  setLoadedPositive('');
  setLoadedNegative('');
  setLoadedOriginalPrompt('');
};
```

パネル自体は `ControlPanel.tsx` 内の JSX として直接記述します（別コンポーネントに切り出す必然性は薄く、200 行程度の実装が予想される規模なら inline で十分）。

## i18n

`client/src/i18n/ja.ts` と `en.ts` の `form: {}` ブロックに以下を追加します。

**ja.ts**:
```ts
loadedEnhancedPanelTitle: '📎 ロード済み拡張プロンプト',
loadedEnhancedClearButton: 'クリア',
loadedEnhancedPositiveLabel: 'Positive',
loadedEnhancedNegativeLabel: 'Negative',
loadedEnhancedWarnPromptChanged: '⚠ 原文が変更されています（拡張プロンプトはロード時のまま使用されます）',
```

**en.ts**:
```ts
loadedEnhancedPanelTitle: '📎 Loaded enhanced prompt',
loadedEnhancedClearButton: 'Clear',
loadedEnhancedPositiveLabel: 'Positive',
loadedEnhancedNegativeLabel: 'Negative',
loadedEnhancedWarnPromptChanged: '⚠ Original prompt has changed (the loaded enhanced prompt will still be used)',
```

TypeScript の型推論で ja/en の shape 一致が強制されるので、片方に追加し忘れるとビルドが落ちます。

## エッジケース

- **`item.enhancedPrompt` が空文字や undefined**: [[adr-0007-gallery-thumbnail-strategy]] 以前のレガシー画像や、Firestore のドキュメントが古いフィールド構造で保存されている場合。`|| ''` フォールバックで空文字が入り、パネルは非表示のまま、従来通り enhance が走ります
- **Positive だけ / Negative だけ空という壊れたデータ**: 通常発生しませんが、外部で作られた画像のインポートなど理論的にはあり得ます。パネル表示条件は `loadedPositive || loadedNegative` の or なので、片方だけでも表示されます。ユーザーが視覚的に異常を検知でき、必要ならクリアで空にできるので、非表示にする（黙って壊れたロードを許容する）よりも表示する方が安全です
- **クリア直後の生成**: `loadedPositive === ''` になるので分岐条件を通過し、`enhanceOnce` が呼ばれます。従来挙動に完全復帰
- **プレビュータブの transient 画像**: 「フォームにロード」ボタンはギャラリー・ランキング・ライトボックスからのみ押せます。プレビュータブ自体からは押せないため、保存前の transient 画像に対する挙動は考慮不要
- **バッチ実行中のクリア**: バッチループは開始時点で `positive`/`negative` をキャプチャします（既存挙動、ローカル変数のため）。実行中にクリアしてもそのバッチはロード済み拡張プロンプトを使い続けます
- **バッチのモデル軸で SDXL ↔ SD1.5 越境**: 現状の enhance 実装はモデル非依存（LM Studio 側はプロンプト形式にアーキ差を持たない）なので、既存挙動と一致します。ロード済み拡張プロンプトを両アーキで使うことに問題はありません
- **原文プロンプトを完全に空文字にした**: `prompt === ''` かつ `loadedOriginalPrompt !== ''` なので警告バッジが出ます。この状態でも生成ボタンを押せば、ロード済み拡張プロンプトで生成されます（原文プロンプトが空でもロード済み拡張が正であれば SD は動く）
- **ロード → クリア → 再ロード**: 3 つの state が全部再セットされます。前回のロード情報は完全に上書きされ、蓄積されません

## テスト戦略

### ユニットテスト

- **`loadIntoFormState.test.ts` を拡張**: `computeLoadIntoFormState` の戻り値に `enhancedPrompt` / `negativePrompt` / `originalPromptSnapshot` を含めるように仕様を拡張し、pure function レベルで load 挙動を検証。既存のアーキ切替・サイズ選択などのテストとフラットに並ぶ形
- 新規テストケース: enhanced/negative 空のレガシー画像でも他パラメータが正常にロードされる / enhanced/negative がセットされていればそのまま返る

### 統合テスト（ブラウザ）

- **ロード → 生成で完全一致画像が再生成できる**: seed 固定 + サイズ・モデル・全パラメータ揃え + ロード済み拡張プロンプトあり → SD が受け取る positive/negative がロード済みと完全一致（Network タブで `/api/generate` の body を確認、`/api/enhance` は呼ばれていない）
- **クリア後の生成で enhance が走る**: 上記状態からクリアボタンを押 → 生成 → `/api/enhance` が呼ばれ、`/api/generate` の positive/negative が LLM 出力
- **原文編集で警告バッジ**: ロード後に原文プロンプトを 1 文字変更 → 警告バッジが出現、拡張プロンプトの内容は変わらない
- **バッチで LLM 呼ばれない**: ロード済み状態で「まとめて生成」を実行 → 全ジョブの `/api/generate` が同じ positive/negative を使い、`/api/enhance` は 0 回
- **バッチ実行中のクリア**: バッチを開始してから途中でクリアボタンを押 → 開始時点でキャプチャした positive/negative が使い続けられ、残りのジョブも同じ拡張プロンプトで完走
- **未セット状態は UI が完全に非表示**: 初期状態のフォームで DOM を検査、`loadedEnhancedPanelTitle` を含む要素が存在しないこと

## 影響を受けるファイル一覧

- `client/src/App.tsx`: 新規 state 3 つ、`loadIntoForm` 末尾に 3 行、`handleGenerate` と `handleBatchGenerate` の enhance 分岐、`clearLoadedEnhanced` 関数、`<ControlPanel>` に prop 4 つ追加。合計 +20 行前後
- `client/src/components/ControlPanel.tsx`: 新規 props 5 つ、原文 textarea 直下にパネル JSX（推定 60〜80 行）。合計 +80 行前後
- `client/src/components/loadIntoFormState.ts`: `computeLoadIntoFormState` の戻り値型に `enhancedPrompt: string`, `negativePrompt: string`, `originalPromptSnapshot: string` の 3 フィールドを追加します。純粋関数側で受け取り値を空文字フォールバックしておく形にすることで、App.tsx の `loadIntoForm` は結果を素直にそのまま state に流し込むだけで済みます。既存の pure function + テストの分離パターン（[[adr-0015-ui-component-split-with-hybrid-state]]）と一貫し、フォールバック処理も同じ場所で単体テスト可能になります
- `client/src/components/loadIntoFormState.test.ts`: 上記追加に対応するテスト 2〜3 件
- `client/src/i18n/ja.ts`: 5 キー追加
- `client/src/i18n/en.ts`: 5 キー追加

合計で 6 ファイル、+120〜150 行程度の変更を見込みます。既存機能を壊さない純粋な追加なので、後方互換性の懸念はほぼありません。

## 参照

- 生成パイプライン全体: CLAUDE.md「The generation pipeline」節、`server/index.ts:107-206` の `enhancePrompt`、`App.tsx:1384-1396` の `enhanceOnce`、`App.tsx:1398-1450` の `generateImage`
- 「フォームにロード」の既存実装: `App.tsx:1197` の `loadIntoForm`、`client/src/components/loadIntoFormState.ts` の `computeLoadIntoFormState`
- 関連 ADR: [[adr-0002-batch-generation-sequential-loop]]（`skipEnhance` パスの既存活用）、[[adr-0015-ui-component-split-with-hybrid-state]]（純粋関数化のパターン）、[[adr-0024-ranking-recipe-full-form-restore]]（「フォームにロード」の拡張履歴）
