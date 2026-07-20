# 拡張プロンプト使用時の排他プロンプト UI 設計書

## 背景

先行して実装された「ロード済み拡張プロンプトによる生成再現」機能（[[2026-07-17-loaded-enhanced-prompt-design]]）により、ユーザーは「フォームにロード」から拡張プロンプト（positive / negative）をフォームに引き込み、次回の生成で LM Studio の enhance ステップを完全にスキップして完全一致の画像を再生成できるようになりました。

ただし現状の UI は、原文プロンプト `<textarea>` と拡張プロンプトパネルを **同時に表示** します。実装のセマンティクスは「拡張プロンプトがセットされているとき、原文プロンプトは次回の生成に影響しない」という排他的な関係ですが、UI では両者が同格に見えるため、初見のユーザーには「今どちらが使われるのか」がわかりにくいという不整合があります。

洋一郎さんから、この 2 つの UI を **排他** に扱うべきという指摘がありました。拡張プロンプトを使用しているときは原文プロンプトの入力欄を UI から完全に外し、拡張プロンプトがクリアされたら原文プロンプトの入力欄が復活する、という一貫した表現に変えることで、セマンティクスと視覚が一致します。

なお、先行 spec が想定していた「原文プロンプト編集時の警告バッジ」（原文が loadIntoForm 時のスナップショットから乖離したときに表示される黄色のバッジ）は、原文が編集不能になるので発火しません。関連する `loadedOriginalPrompt` state、`loadedOriginalPromptSnapshot` pure function フィールド、警告バッジの i18n キーはすべて不要になり、削除の対象になります。

## スコープ

本 spec で扱うもの:

- 原文プロンプト `<textarea>` の表示を `loadedPositive || loadedNegative` の空判定で条件レンダに変更
- 拡張プロンプトパネルの警告バッジ削除
- `App.tsx` の `loadedOriginalPrompt` state と `setLoadedOriginalPrompt` の削除
- `computeLoadIntoFormState` の `loadedOriginalPromptSnapshot` フィールド削除
- 対応する unit tests から `loadedOriginalPromptSnapshot` の assertion 削除
- i18n キー `loadedEnhancedWarnPromptChanged`（ja / en 両方）の削除
- 生成ボタンの enable 条件を「原文プロンプトまたは拡張プロンプトがある」に緩和
- クリアボタンで拡張パネルが消えたとき、原文 `<textarea>` が復活し、そこには **loadIntoForm 時の原文プロンプトが入った状態** で見える

スコープ外:

- 拡張プロンプトの手入力・編集を許可する UI（先行 spec と同じくスコープ外）
- 拡張プロンプト個別のクリア粒度（Positive のみ / Negative のみ）
- 「拡張プロンプト使用中に seed を自動ロック」する UX 改善（別途フォローアップ検討）
- CLAUDE.md の「The generation pipeline」節への client-side skip の言及（別途ドキュメント更新）

## ブレスト決定事項サマリ

- **排他パターン**: 拡張プロンプトあり時、原文プロンプト `<textarea>` を **DOM から完全に外す**（条件レンダ）。read-only + muted 化や別タブ切替ではなく、最も排他性の強い「非表示」を採用
- **クリア後の原文**: `prompt` state の値は変更せず、loadIntoForm 時の原文がそのまま入った状態で `<textarea>` が復活する。ユーザーが「クリア → 少し編集して再 enhance → 新しいバリエーション生成」というフローを 1 クリックで開始できる UX
- **警告バッジは廃止**: 原文が編集できないため乖離が起こらない。関連 state / pure function フィールド / i18n キーもまとめて削除

## アーキテクチャ

前フィーチャーの「クライアント側だけで enhance の呼び出し可否を判断する」境界は据え置きです（[[adr-0031-env-only-config-no-runtime-mutation]] と一貫）。今回の変更は純粋に UI 側の表示ロジックの調整で、生成パイプライン (`handleGenerate` / `handleBatchGenerate`) は一切変更しません。サーバー側 (`server/index.ts`) にも変更なし。

先行フィーチャーの `loadedPositive` / `loadedNegative` state はそのまま残ります。それらの truthy 判定を UI の「原文表示 / 拡張表示」の排他スイッチとしても使います。

## 状態管理の変更

`client/src/App.tsx` から次を削除します。

- `loadedOriginalPrompt` state と `setLoadedOriginalPrompt` setter
- `clearLoadedEnhanced` 関数内の `setLoadedOriginalPrompt('')` 呼び出し

`loadedPositive` / `loadedNegative` は据え置きです。

`client/src/components/loadIntoFormState.ts` から次を削除します。

- `LoadIntoFormState` interface の `loadedOriginalPromptSnapshot: string` フィールド
- `LoadableGenerationItem` interface の `originalPrompt?: string` フィールド（先行実装で optional として追加したが、`loadedOriginalPromptSnapshot` を生成する用途のみだったため一緒に消える）
- `computeLoadIntoFormState` 関数末尾の `state.loadedOriginalPromptSnapshot = item.originalPrompt || '';` 行
- 初期化リテラルの `loadedOriginalPromptSnapshot: ''` シード

`client/src/components/loadIntoFormState.test.ts` から次を削除します。

- `loadedOriginalPromptSnapshot` を検証する assertion（4 つの新規テストのうち、該当行のみ削除。テストそのものは残る）
- 「populates loadedOriginalPromptSnapshot」を主目的にしたテストは Positive/Negative の検証だけ残す形にリネームなしで縮小

## 生成ボタンの enable 条件

現状の `handleGenerate` は原文 `prompt` state が空でないことを前提とした disable 条件を持っています。拡張プロンプトがある場合は原文が空でも生成できるようにする必要があるため、条件を次のように緩和します。

```ts
const generateDisabled = !(prompt.trim() || loadedPositive);
```

具体的には `ControlPanel.tsx` の生成ボタン `disabled` 属性、および `App.tsx` 側の同種の判定箇所を上記の OR に置き換えます（該当箇所は実装フェーズで grep して特定）。

## UI 詳細

### 原文プロンプト `<textarea>` の条件レンダ

`client/src/components/ControlPanel.tsx` の原文プロンプト部分（ラベル + `<textarea>`）を、次の条件でラップします。

```tsx
{!(p.loadedPositive || p.loadedNegative) && (
  <>
    <label ...>{t.controlPanel.promptLabel}</label>
    <textarea placeholder={t.controlPanel.promptPlaceholder} ... />
  </>
)}
```

`loadedPositive` または `loadedNegative` が truthy のとき、原文 `<textarea>` と対応するラベルは DOM から完全に消えます。

### 拡張プロンプトパネル

先行実装のパネル JSX はそのまま維持しますが、内部の警告バッジ部分（`p.loadedOriginalPrompt && p.loadedOriginalPrompt !== p.prompt && (...)` の条件レンダ全体）を削除します。

パネル自体は原文 `<textarea>` があった位置に相対配置される形になります（親の flex 縦並びは維持されるので、原文 textarea が消えた分だけパネルが上に詰まる自然な挙動）。

### ControlPanel の props 変更

削除:
- `loadedOriginalPrompt: string`

`loadedPositive`, `loadedNegative`, `onClearLoadedEnhanced` は維持。`prompt` も維持（生成ボタン disable 判定などで引き続き使う）。

## 削除するもの

コードから削除する要素の一覧：

- `App.tsx`: `loadedOriginalPrompt` state 宣言、`setLoadedOriginalPrompt` を含む行、`loadIntoForm` 末尾の `setLoadedOriginalPrompt(s.loadedOriginalPromptSnapshot);`、`clearLoadedEnhanced` の `setLoadedOriginalPrompt('');`、`<ControlPanel>` に渡している `loadedOriginalPrompt={loadedOriginalPrompt}` prop
- `ControlPanel.tsx`: `loadedOriginalPrompt: string` props フィールド、警告バッジの JSX ブロック全体
- `loadIntoFormState.ts`: `LoadIntoFormState` の `loadedOriginalPromptSnapshot`, `LoadableGenerationItem` の `originalPrompt?`, 初期化リテラルの `loadedOriginalPromptSnapshot: ''`, 末尾代入行
- `loadIntoFormState.test.ts`: `loadedOriginalPromptSnapshot` を assertion している行のみ削除（テスト caseは残す）
- `i18n/ja.ts`: `loadedEnhancedWarnPromptChanged`
- `i18n/en.ts`: `loadedEnhancedWarnPromptChanged`

## エッジケース

- **loadIntoForm 直後**: 原文 `<textarea>` は消え、拡張プロンプトパネルが現れる。`prompt` state には loadIntoForm 時の原文が入っているが、UI では見えない
- **クリア直後**: 拡張プロンプトパネルが消え、原文 `<textarea>` が復活。中身は loadIntoForm 時の原文がそのまま見える（`prompt` state を触らないため）
- **loadIntoForm 直後にすぐ生成**: 原文 UI が非表示のまま生成ボタンを押しても、`prompt` state（loadIntoForm 時の原文）は既に入っているし、拡張プロンプトがあるので `enhanceOnce` はスキップされる。実質的に「Positive/Negative がロード済みのまま生成される」流れが自然に成立
- **クリア後にすぐ生成**: 原文 `<textarea>` は編集されていないので loadIntoForm 時の原文がそのまま。`loadedPositive` は空になったので `enhanceOnce` が走る。原文から新規に enhance をかけて生成される
- **原文プロンプトが完全に空でロード**: 通常発生しないが、レガシー画像で `originalPrompt` が空の場合。この場合 `prompt` state も空 + `loadedPositive` は truthy（`enhancedPrompt` があるならパネルが出る）→ 原文 UI 非表示、生成ボタンは `prompt.trim() || loadedPositive` により有効
- **`enhancedPrompt` が空文字のレガシー画像**: 先行 spec のとおり、`loadedPositive` が空文字にフォールバックされる → 原文 UI 表示・拡張パネル非表示 = 従来通り。今回の変更で挙動は変わらない

## テスト戦略

### ユニットテスト

- **`loadIntoFormState.test.ts`**: 4 つの新規テスト（Task 1 で追加）から `loadedOriginalPromptSnapshot` の assertion 行のみ削除。テスト case 自体（4 個）は残し、`loadedPositive` / `loadedNegative` の検証は維持

### ブラウザ E2E（手動）

- **loadIntoForm 直後の UI**: フォーム画面で「フォームにロード」を押 → 原文プロンプトの `<textarea>` と `プロンプト...` ラベルが両方消え、拡張プロンプトパネルが表示されることを確認
- **クリア後**: パネル右上「クリア」を押 → パネルが消え、原文 `<textarea>` が復活。中身が loadIntoForm 時の原文であることを確認
- **クリア後の生成**: そのまま生成ボタンを押 → `/api/enhance` が呼ばれる（fetch intercept で確認）
- **loadIntoForm → 生成**: `/api/enhance` が呼ばれない（fetch intercept、先行 spec の再現テストと同じ）
- **警告バッジ**: 原文が非表示のため編集できない → 警告バッジは絶対に出ない。UI 上で `⚠ 原文が変更されています` の文字列が DOM に存在しないことを確認
- **生成ボタン**: 原文が空 + 拡張プロンプトがあるとき、生成ボタンが有効化されていること

## 影響を受けるファイル一覧

- `client/src/App.tsx`: state 1 個削除、setter 呼び出し 2 箇所削除、prop 渡し 1 個削除、生成ボタン disable 条件緩和（推定 -6〜-8 行）
- `client/src/components/ControlPanel.tsx`: props 1 個削除、原文 `<textarea>` を条件レンダで囲む、警告バッジ JSX ブロック削除（推定 +5 / -30 行）
- `client/src/components/loadIntoFormState.ts`: interface 2 個修正、初期化リテラル 1 行削除、末尾代入 1 行削除（-4 行）
- `client/src/components/loadIntoFormState.test.ts`: `loadedOriginalPromptSnapshot` の assertion 4 箇所削除（-4 行）
- `client/src/i18n/ja.ts`: 1 キー削除
- `client/src/i18n/en.ts`: 1 キー削除

合計で 6 ファイル、-40 行程度の変更を見込みます。純粋な削除中心で、既存機能を壊す変更ではありません（機能を狭めるのではなく、UI の意味論を整えるもの）。

## 参照

- 先行 spec: [[2026-07-17-loaded-enhanced-prompt-design]]
- 先行実装 plan: [[2026-07-17-loaded-enhanced-prompt]]
- 関連 ADR: [[adr-0015-ui-component-split-with-hybrid-state]]（純粋関数化パターン）、[[adr-0031-env-only-config-no-runtime-mutation]]（クライアント側で enhance の呼び出し可否を判断する境界）
