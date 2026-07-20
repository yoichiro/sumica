# 拡張プロンプト使用時の排他プロンプト UI 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 拡張プロンプト（`loadedPositive` / `loadedNegative`）がセットされている間は原文プロンプト `<textarea>` を DOM から完全に外し、UI と生成パイプラインの排他性を視覚と一致させる。同時に、原文が編集不能になることで不要になる警告バッジ機構（`loadedOriginalPrompt` state、`loadedOriginalPromptSnapshot` フィールド、`loadedEnhancedWarnPromptChanged` i18n キー）を撤去する。

**Architecture:** 生成パイプライン (`handleGenerate` / `handleBatchGenerate`) は一切変更しない。UI 側の表示ロジックと状態管理の縮小のみの純粋な削除中心の変更。`loadedPositive` / `loadedNegative` は据え置きで、それらの truthy 判定を原文/拡張表示の排他スイッチとしても再利用する。

**Tech Stack:** React 19 + Vite 8 + TypeScript, Vitest。サーバー側 (`server/index.ts`) は一切変更しない。新規 npm 依存なし。

## Global Constraints

- **サーバー変更なし**: `server/index.ts` および `/api/enhance` の契約は据え置き。
- **`enhanceOnce` / `generateImage` の signature を変更しない**: 既存呼び出し側を壊さない。
- **生成パイプライン変更なし**: `handleGenerate` と `handleBatchGenerate` の enhance 分岐と `setGenStatus`/`setLoadingStep` ガードは先行 PR のまま維持する。
- **削除中心**: 機能を狭めるのではなく、UI の意味論を整えるもの。既存機能（loadIntoForm → 生成で完全一致画像、クリア後 enhance が走る、バッチで enhance 0 回）はすべて保たれる。
- **クリア後の原文**: `prompt` state を触らないので、原文 `<textarea>` が復活したときに loadIntoForm 時の原文が入った状態で見える。
- **生成ボタン**: `prompt.trim() || loadedPositive` の OR で有効化。拡張がセットされていれば原文が空でも生成可能に。
- **コミットメッセージ**: 英語 1 行 imperative mood（プロジェクト方針）。
- **`--no-verify` 禁止**、pre-commit hook が落ちたら根本を直して新規コミットにする（`--amend` 禁止）。
- **ESM**: `import`/`export` 構文。
- **後方互換**: `loadedPositive === ''` かつ `loadedNegative === ''`（未セット状態）では、UI は先行 PR と完全一致（原文 textarea 表示、拡張パネル非表示）。

---

### Task 1: `computeLoadIntoFormState` から `loadedOriginalPromptSnapshot` を削除し、テストの assertion も削除する

**Files:**
- Modify: `client/src/components/loadIntoFormState.ts`
- Modify: `client/src/components/loadIntoFormState.test.ts`

**Interfaces:**
- Consumes: 既存の `LoadableGenerationItem` と `LoadIntoFormState`
- Produces:
  - `LoadableGenerationItem` から `originalPrompt?: string` を削除（`enhancedPrompt?` / `negativePrompt?` は残す）
  - `LoadIntoFormState` から `loadedOriginalPromptSnapshot: string` フィールドを削除（`loadedPositive` / `loadedNegative` は残す）
  - `computeLoadIntoFormState` の初期化リテラルと末尾代入から `loadedOriginalPromptSnapshot` 関連の 2 行を削除

- [ ] **Step 1: `loadIntoFormState.ts` から 4 箇所を削除**

`client/src/components/loadIntoFormState.ts` を開き、次の 4 箇所を削除します。

1. `LoadableGenerationItem` から `originalPrompt?: string;` を削除:

```typescript
// Before:
export interface LoadableGenerationItem {
  width: number;
  height: number;
  model?: string | null;
  enhancedPrompt?: string;
  negativePrompt?: string;
  originalPrompt?: string;  // ← この行を削除
}

// After:
export interface LoadableGenerationItem {
  width: number;
  height: number;
  model?: string | null;
  enhancedPrompt?: string;
  negativePrompt?: string;
}
```

2. `LoadIntoFormState` から `loadedOriginalPromptSnapshot: string;` を削除:

```typescript
// Before:
export interface LoadIntoFormState {
  archToSet: 'sd15' | 'sdxl' | null;
  width: number;
  height: number;
  sdxlPicker: { ... } | null;
  sd15Picker: { ... } | null;
  loadedPositive: string;
  loadedNegative: string;
  loadedOriginalPromptSnapshot: string;  // ← この行と関連コメントを削除
}

// After: (loadedOriginalPromptSnapshot 行を消し、その上のコメントも整理)
export interface LoadIntoFormState {
  archToSet: 'sd15' | 'sdxl' | null;
  width: number;
  height: number;
  sdxlPicker: { ... } | null;
  sd15Picker: { ... } | null;
  loadedPositive: string;
  loadedNegative: string;
}
```

`loadedOriginalPromptSnapshot` の JSDoc / インラインコメントが直前にある場合、そのコメントも削除します（`Snapshot of the item's originalPrompt at load time` のような説明文）。`loadedPositive` / `loadedNegative` のコメントは残します。

3. `computeLoadIntoFormState` の初期化リテラルから `loadedOriginalPromptSnapshot: ''` を削除:

```typescript
// Before:
const state: LoadIntoFormState = {
  archToSet: arch,
  width: item.width,
  height: item.height,
  sdxlPicker: null,
  sd15Picker: null,
  loadedPositive: '',
  loadedNegative: '',
  loadedOriginalPromptSnapshot: '',  // ← この行を削除
};

// After:
const state: LoadIntoFormState = {
  archToSet: arch,
  width: item.width,
  height: item.height,
  sdxlPicker: null,
  sd15Picker: null,
  loadedPositive: '',
  loadedNegative: '',
};
```

4. 関数末尾の代入行を削除:

```typescript
// Before:
state.loadedPositive = item.enhancedPrompt || '';
state.loadedNegative = item.negativePrompt || '';
state.loadedOriginalPromptSnapshot = item.originalPrompt || '';  // ← この行を削除

return state;

// After:
state.loadedPositive = item.enhancedPrompt || '';
state.loadedNegative = item.negativePrompt || '';

return state;
```

- [ ] **Step 2: `loadIntoFormState.test.ts` から `loadedOriginalPromptSnapshot` の assertion を削除**

`client/src/components/loadIntoFormState.test.ts` を開き、Task 1（先行 PR）で追加された 4 つの test case から `expect(s.loadedOriginalPromptSnapshot).toBe(...)` の行だけを削除します。テスト case そのものは残します。

具体的には次の 4 箇所:

```typescript
// case 1 (populates loadedPositive/loadedNegative/loadedOriginalPromptSnapshot from item):
expect(s.loadedPositive).toBe('masterpiece, (round face:1.2), detailed');
expect(s.loadedNegative).toBe('worst quality, blurry');
expect(s.loadedOriginalPromptSnapshot).toBe('丸顔の女性');  // ← 削除

// case 2 (falls back to empty strings when the item lacks enhancedPrompt/negativePrompt):
expect(s.loadedPositive).toBe('');
expect(s.loadedNegative).toBe('');
expect(s.loadedOriginalPromptSnapshot).toBe('旧レコード');  // ← 削除

// case 3 (falls back to empty string when originalPrompt is missing too):
expect(s.loadedPositive).toBe('');
expect(s.loadedNegative).toBe('');
expect(s.loadedOriginalPromptSnapshot).toBe('');  // ← 削除

// case 4 (treats empty-string enhancedPrompt/negativePrompt the same as missing):
expect(s.loadedPositive).toBe('');
expect(s.loadedNegative).toBe('');
expect(s.loadedOriginalPromptSnapshot).toBe('');  // ← 削除
```

これに合わせて、テストのタイトルに `loadedOriginalPromptSnapshot` が含まれる場合は次のように書き換えます:

```typescript
// Before:
it('populates loadedPositive/loadedNegative/loadedOriginalPromptSnapshot from item', ...
// After:
it('populates loadedPositive/loadedNegative from item', ...
```

同じく `case 2`, `case 3` のタイトルにも `loadedOriginalPromptSnapshot` の言及がある場合は削除します。

なお、テスト内の `originalPrompt: '丸顔の女性'` や `originalPrompt: '旧レコード'` のような input フィールドも、`LoadableGenerationItem.originalPrompt?` を削除した以上 TypeScript でエラーになります。これらの input 側の `originalPrompt: ...` 行も削除します。

- [ ] **Step 3: テストを実行して pass を確認**

Run: `./node_modules/.bin/vitest run` (cwd = `client/`)
Expected: 全テスト green。テストの assertion 数は減るが case 数は 4 つのまま。既存 SDXL/SD1.5 テストも引き続き pass。

- [ ] **Step 4: TypeScript build check**

Run: `./node_modules/.bin/tsc -b` (cwd = `client/`)
Expected: 0 errors。

**ただしこの時点で、`App.tsx` の `loadIntoForm` が `s.loadedOriginalPromptSnapshot` を参照しているため、`loadIntoFormState.ts` の型変更により `App.tsx` 側で TypeScript エラーが出るはずです**。これは Task 3 で修正する予定の transient error なので、`App.tsx` の該当行以外にエラーがないことを確認して次に進みます。

Run: `./node_modules/.bin/tsc -b 2>&1 | grep -v "loadedOriginalPromptSnapshot"` — 予期しないエラーがないことを確認。もし `loadedOriginalPromptSnapshot` 以外のエラーが出た場合は、Step 1/2 の削除が過剰だった可能性があるので見直します。

- [ ] **Step 5: コミット**

```bash
git add client/src/components/loadIntoFormState.ts client/src/components/loadIntoFormState.test.ts
git commit -m "refactor: drop loadedOriginalPromptSnapshot from pure function"
```

---

### Task 2: i18n `loadedEnhancedWarnPromptChanged` キーを ja / en から削除

**Files:**
- Modify: `client/src/i18n/ja.ts`
- Modify: `client/src/i18n/en.ts`

**Interfaces:**
- Consumes: 既存の `controlPanel:` 名前空間
- Produces: 名前空間から `loadedEnhancedWarnPromptChanged` を削除

- [ ] **Step 1: `ja.ts` から 1 行削除**

`client/src/i18n/ja.ts` の `controlPanel: { ... }` ブロック内から次の行を削除します（先行 PR の Task 2 で追加された行）:

```typescript
loadedEnhancedWarnPromptChanged: '⚠ 原文が変更されています（拡張プロンプトはロード時のまま使用されます）',
```

他の `loadedEnhanced*` キー（`loadedEnhancedPanelTitle`, `loadedEnhancedClearButton`, `loadedEnhancedPositiveLabel`, `loadedEnhancedNegativeLabel`）はすべて維持します。

- [ ] **Step 2: `en.ts` から対応する 1 行を削除**

`client/src/i18n/en.ts` の `controlPanel: { ... }` ブロック内から次の行を削除します:

```typescript
loadedEnhancedWarnPromptChanged: '⚠ Original prompt has changed (the loaded enhanced prompt will still be used)',
```

- [ ] **Step 3: shape 一致の build check**

Run: `./node_modules/.bin/tsc -b` (cwd = `client/`)
Expected: **`loadedOriginalPromptSnapshot` 関連の Task 1 起因の transient error だけ** が残る（`App.tsx` の該当箇所）。`loadedEnhancedWarnPromptChanged` に関する新規エラーはないこと。

もし `ControlPanel.tsx` 内で `t.controlPanel.loadedEnhancedWarnPromptChanged` を参照している行があると新たにエラーになる可能性があります（実際に警告バッジ JSX で参照している）。これは Task 3 で削除する transient error なので許容し、次に進みます。

- [ ] **Step 4: テストが引き続き pass することを確認**

Run: `./node_modules/.bin/vitest run` (cwd = `client/`)
Expected: 全テスト green。i18n の変更なので既存 test への影響はゼロ。

- [ ] **Step 5: コミット**

```bash
git add client/src/i18n/ja.ts client/src/i18n/en.ts
git commit -m "refactor: drop loadedEnhancedWarnPromptChanged i18n keys"
```

---

### Task 3: App.tsx と ControlPanel.tsx を同時修正して排他 UI を実現し、Task 1/2 起因の transient errors を消す

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/ControlPanel.tsx`

**Interfaces:**
- Consumes: Task 1 で縮小された `LoadIntoFormState`、Task 2 で削減された i18n
- Produces:
  - `loadedOriginalPrompt` state を App.tsx から削除
  - `<ControlPanel>` に渡す `loadedOriginalPrompt` prop を削除
  - `ControlPanel` の props 型から `loadedOriginalPrompt` を削除
  - 警告バッジの JSX ブロックを `ControlPanel.tsx` から削除
  - 原文プロンプト（ラベル + `<textarea>`）を条件レンダで囲み、拡張プロンプトがセットされているときは非表示にする
  - 生成ボタンの disable 条件を `prompt.trim() || loadedPositive` の OR に緩和

- [ ] **Step 1: App.tsx から `loadedOriginalPrompt` state を削除**

`client/src/App.tsx` を開き、`grep -n "loadedOriginalPrompt" client/src/App.tsx` で使用箇所を全部確認します。すべての使用箇所を削除します。

具体的には:

1. state 宣言（先行 PR で追加された、`const [loadedOriginalPrompt, setLoadedOriginalPrompt] = useState('');` を含む行）を削除。付随する JSDoc / コメントも `loadedOriginalPrompt` を言及している部分だけ削除（`loadedPositive` と `loadedNegative` に関するコメントは残す）。

2. `loadIntoForm` 関数末尾の `setLoadedOriginalPrompt(s.loadedOriginalPromptSnapshot);` の行を削除。この行は Task 1 で `loadedOriginalPromptSnapshot` フィールドがなくなったことで既に TypeScript error になっているはずなので、削除するとエラーも消える。

3. `clearLoadedEnhanced` 関数内の `setLoadedOriginalPrompt('');` の行を削除。

- [ ] **Step 2: App.tsx の `<ControlPanel>` から `loadedOriginalPrompt` prop 渡しを削除**

`grep -n "loadedOriginalPrompt={loadedOriginalPrompt}" client/src/App.tsx` で位置を特定し、その行を削除します。他の 3 つの loaded 関連 prop（`loadedPositive={loadedPositive}`, `loadedNegative={loadedNegative}`, `onClearLoadedEnhanced={clearLoadedEnhanced}`）はそのまま残します。

- [ ] **Step 3: App.tsx の生成ボタン disable 条件を緩和**

`grep -n "画像を生成する\|generateButton\|disabled=" client/src/App.tsx` で、生成ボタンの `disabled` 属性を持つ箇所を特定します。現状はおそらく `disabled={!prompt.trim() || ...(他の条件)}` の形。

`prompt.trim()` 単独で判定している箇所を `!(prompt.trim() || loadedPositive)` に緩和します。他の disable 条件（生成中・SD 未接続など）はそのまま維持。

具体的な変更（実際のコード次第で微調整）:

```typescript
// Before の例:
disabled={!prompt.trim() || genStatus === 'enhancing' || genStatus === 'generating' || ...}

// After:
disabled={!(prompt.trim() || loadedPositive) || genStatus === 'enhancing' || genStatus === 'generating' || ...}
```

生成ボタンが `ControlPanel.tsx` にある場合は App.tsx ではなく ControlPanel.tsx 側の変更になるので、Step 8 に含めます（実装フェーズで確認）。

- [ ] **Step 4: ControlPanel.tsx から `loadedOriginalPrompt` prop 型を削除**

`client/src/components/ControlPanel.tsx` の props 型宣言から次の行を削除:

```typescript
loadedOriginalPrompt: string;
```

先行 PR で追加した JSDoc / コメントで `loadedOriginalPrompt` を言及している部分もあわせて削除します（`prompt` を snapshot と比較する意図の説明など）。他の 3 つの props（`loadedPositive`, `loadedNegative`, `onClearLoadedEnhanced`）はそのまま維持します。

`p.xxx` 参照パターンなので、destructure 側の変更は不要です。

- [ ] **Step 5: ControlPanel.tsx から警告バッジ JSX ブロックを削除**

`grep -n "loadedEnhancedWarnPromptChanged\|p.loadedOriginalPrompt" client/src/components/ControlPanel.tsx` で警告バッジの箇所を特定します。次のような JSX ブロック全体を削除:

```tsx
{p.loadedOriginalPrompt && p.loadedOriginalPrompt !== p.prompt && (
  <div style={{ ... 警告バッジのスタイル ... }}>
    {t.controlPanel.loadedEnhancedWarnPromptChanged}
  </div>
)}
```

この block を削除することで、Task 2 で消した i18n キー `loadedEnhancedWarnPromptChanged` への参照もなくなり、Task 2 起因の transient error が消えます。

パネル外枠（`<div style={{ ...panel styles ... }}>`）と、ヘッダー（title + clear button）、Positive / Negative の 2 つの textarea はそのまま残します。

- [ ] **Step 6: ControlPanel.tsx で原文プロンプト UI を条件レンダで囲む**

`grep -n "controlPanel.promptLabel\|controlPanel.promptPlaceholder" client/src/components/ControlPanel.tsx` で原文プロンプトの JSX を特定します。ラベル `<label>{t.controlPanel.promptLabel}</label>` と `<textarea placeholder={t.controlPanel.promptPlaceholder} ... />` の一連を、次の条件レンダで囲みます:

```tsx
{!(p.loadedPositive || p.loadedNegative) && (
  <>
    <label style={{ ... }}>{t.controlPanel.promptLabel}</label>
    <textarea
      placeholder={t.controlPanel.promptPlaceholder}
      value={p.prompt}
      onChange={(e) => p.setPrompt(e.target.value)}
      style={{ ... }}
    />
  </>
)}
```

具体的な JSX の詳細（style / onChange / value）は現状のコードをそのまま維持し、外側に `{!(p.loadedPositive || p.loadedNegative) && (<>...</>)}` の Fragment 条件レンダを追加するだけです。原文の周りを Fragment (`<>...</>`) で囲むと、既存のフォーム縦並び (flex-column の子要素) が保たれます。

拡張プロンプトパネル (Step 5 で警告バッジを消した後のパネル) は、原文 textarea の直下という位置は変わりません。原文 textarea が消えた分、パネルが上に詰まる形で自然に見えます。

- [ ] **Step 7: ControlPanel.tsx の生成ボタン disable 条件（もし ControlPanel 側にあれば）緩和**

Step 3 で生成ボタンが App.tsx 側でなく ControlPanel.tsx 側にあることが分かった場合、ここで同じく `disabled={!(p.prompt.trim() || p.loadedPositive) || ...}` の OR に緩和します。

`grep -n "generateButton\|画像を生成する" client/src/components/ControlPanel.tsx` で確認します。

- [ ] **Step 8: build と tests を実行**

Run:
```bash
./node_modules/.bin/tsc -b
./node_modules/.bin/vitest run
./node_modules/.bin/vite build
```

Expected: TypeScript 0 errors、tests 全 pass、vite build clean。ここで Task 1 / Task 2 の transient errors が全部消えているはず。

- [ ] **Step 9: コミット**

```bash
git add client/src/App.tsx client/src/components/ControlPanel.tsx
git commit -m "feat: hide original prompt textarea when loaded enhanced prompt is set"
```

---

### Task 4: 統合検証（build + tests + oxlint + ブラウザ E2E）

**Files:** なし（検証のみ、コード変更なし）

**Interfaces:** Tasks 1〜3 を統合した状態が期待通り動くことをブラウザで確認

- [ ] **Step 1: 自動テストと build を最終確認**

Run:
```bash
./node_modules/.bin/tsc -b
./node_modules/.bin/vitest run
./node_modules/.bin/vite build
./node_modules/.bin/oxlint
```

Expected:
- TypeScript 0 errors
- vitest 158/158 tests pass（assertion 数は 4 減ったが case 数は変わらず）
- vite build clean
- oxlint: 既存の pre-existing warnings のみ、新規 warning ゼロ

- [ ] **Step 2: ブラウザで排他 UI を検証**

前提: dev server 起動済み、`?hl=ja` でアクセス、ローカルモード（Firebase 未サインイン）でテスト。過去の生成画像があるギャラリーを使う。

**シナリオ 1: 通常状態（未セット）**

1. フォーム画面を開く（新規セッション、または `clearLoadedEnhanced` を通す）
2. 原文プロンプト `<textarea>` が **表示されている** ことを確認
3. 拡張プロンプトパネル（`📎 ロード済み拡張プロンプト` のヘッダー）が **DOM に存在しない** ことを確認

**シナリオ 2: loadIntoForm → 排他化**

1. ギャラリータブから任意の画像でプレビューに読み込み、「フォームにロード」を押 → フォームタブに切替わる
2. 原文プロンプト `<textarea>` と `プロンプト...` ラベルが **DOM から消えている** ことを確認（`document.querySelector('textarea[placeholder*="生成したい画像"]')` が `null`）
3. 拡張プロンプトパネルが表示され、Positive / Negative の read-only textarea に内容が入っていることを確認
4. 警告バッジ `⚠ 原文が変更されています` の文字列は **DOM に存在しない**（削除済みなので絶対に出ない）

**シナリオ 3: クリア → 原文復活**

1. シナリオ 2 の状態から、パネル右上「クリア」を押
2. 拡張プロンプトパネルが **消滅** することを確認
3. 原文プロンプト `<textarea>` が **復活** し、その中身が loadIntoForm 時の原文（ギャラリー元画像の originalPrompt）が入った状態で見えることを確認
4. `document.querySelector('textarea[placeholder*="生成したい画像"]').value.length > 0` が true

**シナリオ 4: 拡張セット中の生成ボタン有効化**

1. loadIntoForm で拡張プロンプトをセット
2. 生成ボタンが有効化されていることを確認（`disabled` 属性が false）
3. （オプション、`prompt` state を空にする方法があれば）原文 state を空にした状態でも `loadedPositive` があれば生成ボタン有効

**シナリオ 5: クリア後の enhance 復活**

1. loadIntoForm → クリアの流れの後、そのまま生成ボタンを押す
2. Chrome DevTools → Network タブで、`/api/enhance` が **呼ばれる**（従来通り LLM に enhance を投げる）
3. これは先行 PR の挙動と一致することを確認

**シナリオ 6: 既存機能の非破壊**

1. loadIntoForm → 生成: `/api/enhance` が呼ばれない（先行 PR と同じ）
2. バッチ生成: `/api/enhance` が 0 回（先行 PR と同じ）

- [ ] **Step 3: 検証結果を報告**

Task 1〜3 のコミットログを `git log --oneline` で確認し、`Base commit .. HEAD` の範囲を進捗レジャー（`.superpowers/sdd/progress.md`）に記録。ブラウザ検証の 6 シナリオの結果を残す。この Task 4 はコミットを生成しない。

---

## Self-Review Notes

Spec に対する plan の網羅性を再確認:

1. **Spec coverage**: Spec の各節を task に mapping。
   - 「表示ロジックの排他化」→ Task 3（Step 6 の条件レンダ）
   - 「警告バッジは廃止」→ Task 3（Step 5）
   - 「`loadedOriginalPrompt` state も廃止」→ Task 3（Step 1）
   - 「`loadedOriginalPromptSnapshot` フィールド削除」→ Task 1
   - 「`LoadableGenerationItem.originalPrompt?` 削除」→ Task 1
   - 「i18n `loadedEnhancedWarnPromptChanged` 削除」→ Task 2
   - 「生成ボタン enable 条件緩和」→ Task 3（Step 3, 7）
   - 「クリア後の原文保持」→ Task 3 の Step 1 で `setPrompt('')` を追加しない自然な結果（`prompt` state を触らない）
   - 「テスト戦略」→ Task 1（unit test assertion 削除）+ Task 4（統合ブラウザ 6 シナリオ）
   - 「影響ファイル一覧」→ Tasks 1〜3 で 6 ファイルすべて触れる

2. **Placeholder scan**: TBD / TODO / 未確定要件はゼロ。各 step に具体的なコード + exact コマンド + 期待出力を記載。Task 3 の Step 3 / Step 7 で「生成ボタンが App.tsx 側か ControlPanel.tsx 側かは実装フェーズで grep 確認」と書いた箇所は、両方の可能性を明示的に扱っており placeholder ではなく分岐指示。

3. **Type consistency**:
   - `loadedPositive`, `loadedNegative` の名前が Task 1（削除しない）と Task 3（残す）で一致。
   - `loadedOriginalPromptSnapshot`（pure function 側）と `loadedOriginalPrompt`（App state 側）の両方が Task 1 / Task 3 で削除される整合。
   - `loadedEnhancedWarnPromptChanged` の削除が Task 2（i18n）と Task 3（JSX 参照）で連動。
   - ControlPanel の `p.xxx` 参照パターンが Task 3 の全 Step で一貫。

4. **Scope check**: 単一 subsystem（排他プロンプト UI）に閉じ、単一 plan で完結。純粋な削除中心で、他機能への波及ゼロ。
