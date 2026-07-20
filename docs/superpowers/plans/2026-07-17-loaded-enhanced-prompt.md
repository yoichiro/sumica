# ロード済み拡張プロンプトによる生成再現 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「フォームにロード」時に拡張プロンプト（positive/negative）もロードし、生成時にそれをそのまま使うことで、seed 固定 + 全パラメータ揃えで完全一致画像を再生成できるようにする。

**Architecture:** 既存の `enhanceOnce` → `generateImage(skipEnhance: true)` の 2 段パイプラインは変更しない。フォーム側に 3 つの state（`loadedPositive`, `loadedNegative`, `loadedOriginalPrompt`）を追加し、生成時に `loadedPositive` が truthy なら `enhanceOnce` をスキップする分岐を 1 箇所ずつ挿入する。UI は `ControlPanel` の原文プロンプト textarea 直下に、未セット時は完全非表示、ロード時のみ現れる read-only パネル。純粋関数 `computeLoadIntoFormState` を拡張して pure function レイヤーでも新フィールドを扱う。

**Tech Stack:** React 19 + Vite 8 + TypeScript, Vitest。サーバー側 (`server/index.ts`) は一切変更しない。新規 npm 依存なし。

## Global Constraints

- **サーバー変更なし**: `server/index.ts` および `/api/enhance` の契約は据え置き（[[adr-0031-env-only-config-no-runtime-mutation]] の方針と整合）。呼ぶかどうかの判断はクライアント側だけで行う。
- **`enhanceOnce` / `generateImage` の signature を変更しない**: 既存呼び出し側（バッチ生成の [[adr-0002-batch-generation-sequential-loop]] 経路）を壊さない。
- **i18n の namespace は `controlPanel:`**: spec 内で `form:` と書いた箇所は誤り。既存の `t.controlPanel.*` パターンに合わせる。ja/en の shape 一致は TypeScript が強制する。
- **コミットメッセージは英語 1 行 imperative mood**（プロジェクト方針）。
- **`--no-verify` 禁止**、pre-commit hook が落ちたら根本を直して新規コミットにする（`--amend` 禁止）。
- **ESM**: `import`/`export` 構文。
- **Backward compat**: レガシー画像（`enhancedPrompt`/`negativePrompt` が空/undefined）でも既存挙動と完全一致すること。追加は完全に非破壊。
- **`loadingStep` のスキップ挙動**: `loadedPositive` が truthy な場合、`setLoadingStep(1)` を省略していきなり `setLoadingStep(2)` に入る（spec の「実行時間の短縮 + セマンティクスの正確性」）。

---

### Task 1: `computeLoadIntoFormState` の戻り値拡張と TDD テスト

**Files:**
- Modify: `client/src/components/loadIntoFormState.ts`
- Modify: `client/src/components/loadIntoFormState.test.ts`

**Interfaces:**
- Consumes: 既存の `LoadableGenerationItem` に optional なフィールド追加
- Produces:
  - `LoadableGenerationItem` に `enhancedPrompt?: string`, `negativePrompt?: string`, `originalPrompt?: string` を追加（全て optional）
  - `LoadIntoFormState` に `loadedPositive: string`, `loadedNegative: string`, `loadedOriginalPromptSnapshot: string` を追加（3 つとも常に string、empty string がデフォルト）
  - `computeLoadIntoFormState` の実装が上記 3 フィールドを常に埋める（missing/empty は `''` にフォールバック）

- [ ] **Step 1: 失敗テストを書く**

`client/src/components/loadIntoFormState.test.ts` の末尾に、以下のテストブロックを追加します。

```typescript
describe('computeLoadIntoFormState — loaded enhanced prompt fields', () => {
  it('populates loadedPositive/loadedNegative/loadedOriginalPromptSnapshot from item', () => {
    const s = computeLoadIntoFormState(
      {
        width: 1024, height: 1024,
        model: 'juggernautXL_version6Rundiffusion.safetensors [1fe6c7ec54]',
        enhancedPrompt: 'masterpiece, (round face:1.2), detailed',
        negativePrompt: 'worst quality, blurry',
        originalPrompt: '丸顔の女性',
      },
      KNOWN,
    );
    expect(s.loadedPositive).toBe('masterpiece, (round face:1.2), detailed');
    expect(s.loadedNegative).toBe('worst quality, blurry');
    expect(s.loadedOriginalPromptSnapshot).toBe('丸顔の女性');
  });

  it('falls back to empty strings when the item lacks enhancedPrompt/negativePrompt', () => {
    // Legacy records saved before the enhanced-prompt-load feature; also
    // externally imported images that never went through the enhance step.
    const s = computeLoadIntoFormState(
      { width: 512, height: 512, model: 'yayoi_mix_v25-fp16.safetensors [ca28aa4a44]', originalPrompt: '旧レコード' },
      KNOWN,
    );
    expect(s.loadedPositive).toBe('');
    expect(s.loadedNegative).toBe('');
    expect(s.loadedOriginalPromptSnapshot).toBe('旧レコード');
  });

  it('falls back to empty string when originalPrompt is missing too', () => {
    // Theoretical fully-broken record: no fields at all. Should not crash.
    const s = computeLoadIntoFormState(
      { width: 512, height: 512, model: 'yayoi_mix_v25-fp16.safetensors [ca28aa4a44]' },
      KNOWN,
    );
    expect(s.loadedPositive).toBe('');
    expect(s.loadedNegative).toBe('');
    expect(s.loadedOriginalPromptSnapshot).toBe('');
  });

  it('treats empty-string enhancedPrompt/negativePrompt the same as missing', () => {
    // Explicit '' should be indistinguishable from undefined for callers.
    const s = computeLoadIntoFormState(
      {
        width: 1024, height: 1024,
        model: 'juggernautXL_version6Rundiffusion.safetensors [1fe6c7ec54]',
        enhancedPrompt: '',
        negativePrompt: '',
        originalPrompt: '',
      },
      KNOWN,
    );
    expect(s.loadedPositive).toBe('');
    expect(s.loadedNegative).toBe('');
    expect(s.loadedOriginalPromptSnapshot).toBe('');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm run test:run --prefix client -- loadIntoFormState.test.ts`
Expected: FAIL — 4 tests fail because `LoadIntoFormState` does not yet contain `loadedPositive`/`loadedNegative`/`loadedOriginalPromptSnapshot` (TypeScript compile error or `undefined` at runtime).

- [ ] **Step 3: 実装を追加**

`client/src/components/loadIntoFormState.ts` の `LoadableGenerationItem` interface を次のように書き換えます:

```typescript
export interface LoadableGenerationItem {
  width: number;
  height: number;
  model?: string | null;
  // Loaded enhanced prompt fields — all optional to keep legacy records
  // and pre-feature imports working without changes.
  enhancedPrompt?: string;
  negativePrompt?: string;
  originalPrompt?: string;
}
```

`LoadIntoFormState` interface に 3 フィールドを追加:

```typescript
export interface LoadIntoFormState {
  archToSet: 'sd15' | 'sdxl' | null;
  width: number;
  height: number;
  sdxlPicker: {
    ratio: SdxlRatio;
    orientation: SdxlOrientation;
    size: SdxlSize;
  } | null;
  sd15Picker: {
    ratio: Sd15Ratio;
    orientation: SdxlOrientation;
    size: SdxlSize;
  } | null;
  // Loaded enhanced prompt to seed the form's read-only panel and skip the
  // enhance step on the next generate. Empty strings when the item has no
  // enhanced prompt saved (legacy records / external imports) — the caller
  // then falls back to the normal enhance flow.
  loadedPositive: string;
  loadedNegative: string;
  // Snapshot of the item's originalPrompt at load time, used to detect
  // whether the user has since edited the form's prompt field. Empty string
  // when the item has no originalPrompt (legacy defensive default).
  loadedOriginalPromptSnapshot: string;
}
```

`computeLoadIntoFormState` の末尾（既存の `return state;` の直前）に 3 行を追加:

```typescript
  state.loadedPositive = item.enhancedPrompt || '';
  state.loadedNegative = item.negativePrompt || '';
  state.loadedOriginalPromptSnapshot = item.originalPrompt || '';
```

具体的には既存の関数末尾はこう変わります:

```typescript
  if (arch === 'sdxl') {
    state.sdxlPicker = findSdxlSelection(item.width, item.height);
  } else if (arch === 'sd15') {
    state.sd15Picker = findSd15Selection(item.width, item.height);
  }

  state.loadedPositive = item.enhancedPrompt || '';
  state.loadedNegative = item.negativePrompt || '';
  state.loadedOriginalPromptSnapshot = item.originalPrompt || '';

  return state;
}
```

初期化オブジェクトリテラルに 3 フィールドを明示的にセットする書き方（`loadedPositive: '', ...`）も等価ですが、既存の SDXL/SD15 picker と同じく「上で計算 → 下で state に代入」のスタイルを踏襲します（読みやすさ優先）。

- [ ] **Step 4: テストを実行して pass を確認**

Run: `npm run test:run --prefix client -- loadIntoFormState.test.ts`
Expected: PASS — 4 new tests green、既存 SDXL/SD15 テスト（arch / picker / dimensions を検証しているもの）も引き続き green。

- [ ] **Step 5: 型全体の build check**

Run: `./node_modules/.bin/tsc -b` (cwd = `client/`)
Expected: 出力なし（0 errors）。`LoadableGenerationItem` を使う既存呼び出し（App.tsx の `loadIntoForm` 内 `computeLoadIntoFormState(item, sdModels)`）は `item: GenerationData` を渡していて、`GenerationData` には既に `enhancedPrompt: string` / `negativePrompt: string` / `originalPrompt: string` があるので型互換性は保たれる。

- [ ] **Step 6: コミット**

```bash
git add client/src/components/loadIntoFormState.ts client/src/components/loadIntoFormState.test.ts
git commit -m "feat: extend computeLoadIntoFormState with loaded enhanced prompt fields"
```

---

### Task 2: i18n キー追加

**Files:**
- Modify: `client/src/i18n/ja.ts`
- Modify: `client/src/i18n/en.ts`

**Interfaces:**
- Produces:
  - `t.controlPanel.loadedEnhancedPanelTitle: string`
  - `t.controlPanel.loadedEnhancedClearButton: string`
  - `t.controlPanel.loadedEnhancedPositiveLabel: string`
  - `t.controlPanel.loadedEnhancedNegativeLabel: string`
  - `t.controlPanel.loadedEnhancedWarnPromptChanged: string`

- [ ] **Step 1: `ja.ts` に 5 キー追加**

`client/src/i18n/ja.ts` の `controlPanel: {` ブロック（line 20 付近）の末尾 `},` の直前に、以下 5 キーを追加します。既存キーの末尾に置けば末尾カンマなど気にせず追加できます。挿入位置は、`controlPanel` ブロック内の任意末尾（例えば既存 `noSd15ModelsFound: ...,` の直後）で問題ありません。

```typescript
    loadedEnhancedPanelTitle: '📎 ロード済み拡張プロンプト',
    loadedEnhancedClearButton: 'クリア',
    loadedEnhancedPositiveLabel: 'Positive',
    loadedEnhancedNegativeLabel: 'Negative',
    loadedEnhancedWarnPromptChanged: '⚠ 原文が変更されています（拡張プロンプトはロード時のまま使用されます）',
```

追加箇所を特定するため、まず `grep -n "controlPanel:" client/src/i18n/ja.ts` で行番号を確認、続いてその直後の閉じ `},` の行番号を確認します。挿入は閉じ `},` の直前。

- [ ] **Step 2: `en.ts` に対称に 5 キー追加**

`client/src/i18n/en.ts` の `controlPanel: {` ブロックの末尾に、同じ順序で以下 5 キーを追加します。

```typescript
    loadedEnhancedPanelTitle: '📎 Loaded enhanced prompt',
    loadedEnhancedClearButton: 'Clear',
    loadedEnhancedPositiveLabel: 'Positive',
    loadedEnhancedNegativeLabel: 'Negative',
    loadedEnhancedWarnPromptChanged: '⚠ Original prompt has changed (the loaded enhanced prompt will still be used)',
```

- [ ] **Step 3: shape 一致 build check**

Run: `./node_modules/.bin/tsc -b` (cwd = `client/`)
Expected: 出力なし（0 errors）。TypeScript は `ja.ts` の型を推論して `en.ts` に適用するため、片方に追加し忘れるとここで落ちる。

- [ ] **Step 4: テストが引き続き pass することを確認**

Run: `./node_modules/.bin/vitest run` (cwd = `client/`)
Expected: 全テスト green。i18n の shape 変更だけで既存テストへの影響はない。

- [ ] **Step 5: コミット**

```bash
git add client/src/i18n/ja.ts client/src/i18n/en.ts
git commit -m "feat: add i18n keys for loaded enhanced prompt panel"
```

---

### Task 3: App.tsx に 3 state と `clearLoadedEnhanced` を追加し、`loadIntoForm` を拡張

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: Task 1 で拡張された `computeLoadIntoFormState`
- Produces:
  - App component 内に 3 つの新 state: `loadedPositive`, `loadedNegative`, `loadedOriginalPrompt`（と対応する setter）
  - `clearLoadedEnhanced()` 関数（3 つの state をまとめて空文字に戻す）
  - `loadIntoForm(item)` が末尾で 3 つの state をセット

- [ ] **Step 1: 3 つの state を追加**

`client/src/App.tsx` の `App()` 関数内、既存 state 宣言のブロックに以下 3 つを追加します。挿入位置は、既存の `[prompt, setPrompt]` 宣言（`App.tsx:88` 付近）の直後が最も自然です。

`grep -n "const \[prompt, setPrompt\]" client/src/App.tsx` で行番号を確認して、その直後の行に以下を追加:

```typescript
  // Loaded enhanced prompt fields — populated by loadIntoForm when the user
  // clicks "フォームにロード" on a gallery/ranking item, and cleared by the
  // dedicated clear button in ControlPanel. When loadedPositive is truthy,
  // the generate pipeline skips the enhance step entirely and reuses this
  // exact positive/negative pair, letting the user reproduce the same image
  // bit-for-bit (given the same seed + all other params). loadedOriginalPrompt
  // stores the item's originalPrompt at load time so we can detect and warn
  // when the user has since edited the prompt field.
  const [loadedPositive, setLoadedPositive] = useState('');
  const [loadedNegative, setLoadedNegative] = useState('');
  const [loadedOriginalPrompt, setLoadedOriginalPrompt] = useState('');
```

- [ ] **Step 2: `loadIntoForm` の末尾に 3 行追加**

`grep -n "const loadIntoForm = " client/src/App.tsx` で行番号を確認。既存の `loadIntoForm` は約 `App.tsx:1197-1250` にあり、末尾は `addToast(t.toast.loadedIntoForm, 'success');` の直前で return（暗黙）します。その `addToast` の直前に 3 行を挿入します。

```typescript
    // Populate the loaded-enhanced-prompt fields from the pure function's
    // result. Empty strings when the item lacks enhancedPrompt/negativePrompt
    // (legacy records) — in that case the panel stays hidden and the next
    // generate falls back to the normal enhance flow, unchanged.
    setLoadedPositive(s.loadedPositive);
    setLoadedNegative(s.loadedNegative);
    setLoadedOriginalPrompt(s.loadedOriginalPromptSnapshot);
```

具体的な挿入位置は、`loadIntoForm` 関数内の既存最後行（トースト表示直前）です。目安として `switchControlTab('form');` の直後、`addToast(...)` の直前。

- [ ] **Step 3: `clearLoadedEnhanced` 関数を追加**

`loadIntoForm` 関数の直後（`App.tsx:1250` 付近の閉じ `};` の直後）に、以下の関数を追加します:

```typescript
  // Clear the loaded enhanced prompt fields. Called by ControlPanel's clear
  // button. After this, the next generate goes through the normal enhance
  // flow (LLM invoked, positive/negative re-derived from the current prompt).
  const clearLoadedEnhanced = () => {
    setLoadedPositive('');
    setLoadedNegative('');
    setLoadedOriginalPrompt('');
  };
```

- [ ] **Step 4: build と tests を実行**

Run:
```bash
./node_modules/.bin/tsc -b
./node_modules/.bin/vitest run
```

Expected: build 0 errors、全テスト green。この時点では UI もパイプライン分岐もまだないので、動作上の変化はゼロだが、TypeScript が state 追加を認めていること + 既存テスト非破壊であることを確認。

- [ ] **Step 5: コミット**

```bash
git add client/src/App.tsx
git commit -m "feat: add loaded enhanced prompt state and clear helper in App"
```

---

### Task 4: `ControlPanel.tsx` にパネル UI を追加し、App.tsx で配線する

**Files:**
- Modify: `client/src/components/ControlPanel.tsx`
- Modify: `client/src/App.tsx`（`<ControlPanel />` に prop を渡す部分）

**Interfaces:**
- Consumes: Task 2 の i18n キー、Task 3 の state（`loadedPositive` / `loadedNegative` / `loadedOriginalPrompt`）と関数（`clearLoadedEnhanced`）
- Produces:
  - `ControlPanel` の props に `loadedPositive: string`, `loadedNegative: string`, `loadedOriginalPrompt: string`, `onClearLoadedEnhanced: () => void` を追加
  - `ControlPanel` 内、原文プロンプト `<textarea>` の直下に条件レンダされるパネル JSX

- [ ] **Step 1: `ControlPanel.tsx` の props 型を拡張**

`client/src/components/ControlPanel.tsx` の props interface（コンポーネント宣言の直前）に以下 4 プロパティを追加します。まず現状の props interface の場所と名前を `grep -n "interface.*Panel.*Props\|type.*PanelProps" client/src/components/ControlPanel.tsx` で確認。次にその interface / type 内の任意末尾（他の `on*` 系ハンドラの近く）に追加:

```typescript
  // Loaded enhanced prompt panel: rendered inline below the prompt textarea
  // only when either loadedPositive or loadedNegative is truthy. The 3 fields
  // are read-only from the panel's perspective — the only user action is
  // clicking the clear button. loadedOriginalPrompt is a snapshot of the
  // prompt at load time; when the current `prompt` prop differs, a warning
  // badge is displayed inside the panel.
  loadedPositive: string;
  loadedNegative: string;
  loadedOriginalPrompt: string;
  onClearLoadedEnhanced: () => void;
```

`prompt` prop は既存で存在するはず（ControlPanel は原文 textarea を制御する）。存在しなければ、その時点で既に大きな乖離があるので Step 4 の build で落ちる。

- [ ] **Step 2: props の destructure に 4 つを追加**

`ControlPanel` 関数コンポーネントの引数 destructure（`export function ControlPanel({ ... }: Props)` の中身）に以下を追加します:

```typescript
  loadedPositive,
  loadedNegative,
  loadedOriginalPrompt,
  onClearLoadedEnhanced,
```

- [ ] **Step 3: パネル JSX を原文プロンプト `<textarea>` 直下に追加**

`grep -n "controlPanel.promptPlaceholder\|controlPanel.promptLabel" client/src/components/ControlPanel.tsx` で原文 textarea の位置を確認します。textarea の閉じタグ（`/>` または `</textarea>`）の直後に、次の JSX を挿入します。

```tsx
{(loadedPositive || loadedNegative) && (
  <div
    style={{
      marginTop: '8px',
      padding: '12px 14px',
      background: 'var(--panel-bg-sunk)',
      border: '1px solid var(--panel-border)',
      borderRadius: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    }}
  >
    {/* Header row: title + clear button. */}
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: 0.02 }}>
        {t.controlPanel.loadedEnhancedPanelTitle}
      </span>
      <button
        type="button"
        onClick={onClearLoadedEnhanced}
        className="scale-hover"
        style={{
          padding: '4px 10px',
          fontSize: '11px',
          fontWeight: 700,
          background: 'transparent',
          color: 'var(--text-muted)',
          border: '1px solid var(--panel-border)',
          borderRadius: '8px',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {t.controlPanel.loadedEnhancedClearButton}
      </button>
    </div>

    {/* Warning badge: shown only when the current prompt has drifted from
        the snapshot captured at load time. The loaded enhanced prompt is
        still what gets used at generate time, but the user should know the
        original text no longer matches. */}
    {loadedOriginalPrompt && loadedOriginalPrompt !== p.prompt && (
      <div
        style={{
          padding: '6px 10px',
          fontSize: '11px',
          fontWeight: 600,
          color: '#8a6d00',
          background: 'rgba(252, 196, 25, 0.16)',
          border: '1px solid rgba(252, 196, 25, 0.4)',
          borderRadius: '8px',
        }}
      >
        {t.controlPanel.loadedEnhancedWarnPromptChanged}
      </div>
    )}

    {/* Positive */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.02 }}>
        {t.controlPanel.loadedEnhancedPositiveLabel}
      </span>
      <textarea
        readOnly
        value={loadedPositive}
        style={{
          minHeight: '4.5em',
          maxHeight: '8em',
          resize: 'vertical',
          padding: '8px 10px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '11px',
          lineHeight: 1.4,
          color: 'var(--text-primary)',
          background: 'var(--input-bg)',
          border: '1px solid var(--panel-border)',
          borderRadius: '8px',
          overflowY: 'auto',
        }}
      />
    </div>

    {/* Negative */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.02 }}>
        {t.controlPanel.loadedEnhancedNegativeLabel}
      </span>
      <textarea
        readOnly
        value={loadedNegative}
        style={{
          minHeight: '4.5em',
          maxHeight: '8em',
          resize: 'vertical',
          padding: '8px 10px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '11px',
          lineHeight: 1.4,
          color: 'var(--text-primary)',
          background: 'var(--input-bg)',
          border: '1px solid var(--panel-border)',
          borderRadius: '8px',
          overflowY: 'auto',
        }}
      />
    </div>
  </div>
)}
```

**注意**: JSX 内で参照している変数は、`ControlPanel` の props シグネチャ次第で 2 通りある。既存の実装が props を `p` にまとめて `p.prompt` の形で参照しているなら（`grep -n "p\\.prompt" client/src/components/ControlPanel.tsx` で確認）、警告バッジ判定は上記のように `p.prompt` を使う。既存の実装が destructure で個別に `prompt` を受け取っているなら、`loadedOriginalPrompt !== prompt` に置換する。判断は Step 2 の destructure 追加時点で明確になっている。

- [ ] **Step 4: `App.tsx` で `<ControlPanel>` に 4 つの prop を渡す**

`grep -n "<ControlPanel" client/src/App.tsx` で使用箇所を確認。既存の props 列挙の末尾に以下を追加します:

```tsx
              loadedPositive={loadedPositive}
              loadedNegative={loadedNegative}
              loadedOriginalPrompt={loadedOriginalPrompt}
              onClearLoadedEnhanced={clearLoadedEnhanced}
```

- [ ] **Step 5: build と tests を実行**

Run:
```bash
./node_modules/.bin/tsc -b
./node_modules/.bin/vite build
./node_modules/.bin/vitest run
```

Expected: TypeScript 0 errors、build clean、全テスト green。

- [ ] **Step 6: ブラウザで UI を目視確認**

ブラウザで `http://localhost:5173/?hl=ja` にアクセス（dev server 既起動を前提。起動していなければ `npm run dev` 実行）:

1. **未セット時**: 通常のフォームを表示。原文プロンプト textarea の直下にパネルが **一切表示されていない** ことを確認（DOM に `📎 ロード済み拡張プロンプト` の要素がない）。
2. **ロード時**: ギャラリータブに切り替え、任意の画像で「フォームにロード」ボタンをクリック。フォームタブに戻ると原文プロンプト textarea の直下にパネルが出現し、Positive と Negative の textarea に該当画像のメタデータが read-only で表示されていることを確認。
3. **クリア時**: パネル右上の「クリア」ボタンを押 → パネルが完全に消滅、フォームは通常状態に戻る。
4. **原文編集時の警告**: ロード状態のまま原文プロンプト textarea を 1 文字編集 → パネル内に `⚠ 原文が変更されています...` の黄色バッジが出現。同じ 1 文字を戻す（`Ctrl+Z` など）と警告バッジも消える。

- [ ] **Step 7: コミット**

```bash
git add client/src/components/ControlPanel.tsx client/src/App.tsx
git commit -m "feat: render loaded enhanced prompt panel below prompt textarea"
```

---

### Task 5: 生成パイプラインの分岐（単発 + バッチ）

**Files:**
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: Task 3 の `loadedPositive` / `loadedNegative` state
- Produces: `handleGenerate` と `handleBatchGenerate` の enhance 呼び出しが loadedPositive の truthy チェックで分岐する

- [ ] **Step 1: `handleGenerate` の enhance 呼び出しを条件分岐に置き換える**

`grep -n "enhanceOnce(prompt)" client/src/App.tsx` で 2 箇所の呼び出しを特定。1 つ目は単発生成（`handleGenerate`）、2 つ目はバッチ生成（`handleBatchGenerate`）。まず 1 つ目を書き換えます。

現状のコード（`App.tsx:1564` 付近）:

```typescript
      const { positive, negative } = await enhanceOnce(prompt);
```

これを次のように書き換えます:

```typescript
      // If the user has previously loaded an enhanced prompt from a past
      // image, reuse it verbatim and skip the LM Studio round-trip entirely.
      // The generate pipeline's loadingStep is also nudged to step 2 directly
      // because step 1 (enhancing) is being skipped semantically.
      const { positive, negative } = loadedPositive
        ? { positive: loadedPositive, negative: loadedNegative }
        : await enhanceOnce(prompt);
```

- [ ] **Step 2: `loadingStep` の遷移を調整**

`handleGenerate` 関数内、`setLoadingStep(1)` を呼んでいる箇所（`grep -n "setLoadingStep(1)" client/src/App.tsx` で確認）が上記 `enhanceOnce` 呼び出しの直前にあるはずです。それを次のように書き換えます:

現状:
```typescript
      setLoadingStep(1);
      const { positive, negative } = await enhanceOnce(prompt);
```

書き換え後:
```typescript
      // Only enter step 1 (enhancing) when actually calling the LLM. When a
      // loaded enhanced prompt is present we go straight to step 2.
      if (!loadedPositive) setLoadingStep(1);
      const { positive, negative } = loadedPositive
        ? { positive: loadedPositive, negative: loadedNegative }
        : await enhanceOnce(prompt);
```

**注意**: 上記 Step 1 の書き換えと Step 2 は同じ箇所に対する連続変更なので、実装時は 1 回のエディットで両方をまとめて適用する方が安全（片方だけ適用して build を挟むと不整合が出るリスク）。

- [ ] **Step 3: `handleBatchGenerate` にも同じ分岐を適用**

同様に `enhanceOnce(prompt)` の 2 つ目の呼び出し（バッチ生成側、`App.tsx:1656` 付近）を書き換えます:

現状:
```typescript
      const { positive, negative } = await enhanceOnce(prompt);
```

書き換え後:
```typescript
      // Batch generation: reuse loaded enhanced prompt across all jobs when
      // present. LM Studio is not called even once. When absent, the current
      // behavior (enhance once, reuse across jobs) is preserved unchanged.
      const { positive, negative } = loadedPositive
        ? { positive: loadedPositive, negative: loadedNegative }
        : await enhanceOnce(prompt);
```

バッチ側にも `setLoadingStep(1)` を条件付きにする調整があれば同じ形にする（`grep -n "setLoadingStep(1)" client/src/App.tsx` で 2 箇所目の位置を確認して、あれば `if (!loadedPositive) setLoadingStep(1);` に）。

- [ ] **Step 4: build と tests を実行**

Run:
```bash
./node_modules/.bin/tsc -b
./node_modules/.bin/vitest run
```

Expected: TypeScript 0 errors、既存の全テスト green。この時点で「機能としては動く」状態が完成しているはずです。

- [ ] **Step 5: コミット**

```bash
git add client/src/App.tsx
git commit -m "feat: skip enhance step when loaded enhanced prompt is present"
```

---

### Task 6: 統合検証（build + tests + browser E2E）

**Files:** なし（検証のみ、コード変更なし）

**Interfaces:** Tasks 1〜5 を統合した状態が期待通り動くことをブラウザで確認

- [ ] **Step 1: 全テストと build を最終確認**

Run:
```bash
./node_modules/.bin/tsc -b
./node_modules/.bin/vitest run
./node_modules/.bin/vite build
./node_modules/.bin/oxlint  # lint（既存の pre-existing warning のみ、新規 warning ゼロ）
```

Expected:
- TypeScript 0 errors
- vitest 158+ tests pass（Task 1 で 4 tests 追加されているので、baseline 154 → 158）
- vite build clean、`built in NNNms`
- oxlint: 既存の pre-existing warnings のみ

- [ ] **Step 2: ブラウザで完全再現を検証**

前提: dev server 起動済み、`?hl=ja` でアクセス、ローカルモード（Firebase 未サインイン）でテスト。過去の生成画像が数枚あるギャラリーを使う。

**シナリオ 1: ロード → 生成で `/api/enhance` が呼ばれないこと**

1. ギャラリータブから任意の画像で「フォームにロード」を押 → フォームタブに移り、パネルが出現、Positive/Negative が read-only で表示
2. 「Seed を固定する」チェック ON（元画像と完全一致する再生成を狙う）
3. 生成ボタンを押す
4. Chrome DevTools → Network タブで、`/api/enhance` が **呼ばれていない** ことを確認（バッチではないので 1 回の生成につき通常 1 回だけ enhance が走るはずが、0 回になる）
5. 同時に `/api/generate` の request body を確認: `prompt` フィールドに Positive がそのまま、`negativePrompt` に Negative がそのまま入っている
6. 生成完了後、元画像と新画像が視覚的に **一致** すること（seed / model / size / sampler / scheduler / steps / CFG / Hires.fix 設定 / LoRA / VAE / Refiner が全部揃っていれば、通常ビット完全一致するはず）

**シナリオ 2: クリア後は通常の enhance が走る**

1. シナリオ 1 の状態から、パネル右上「クリア」を押 → パネルが完全消滅
2. 生成ボタンを押す
3. Network タブで `/api/enhance` が **呼ばれる** ことを確認（LLM を通常通り叩く）
4. 生成される画像は temperature=0.7 のゆらぎで元画像と異なる（seed 一致でも Positive/Negative が別なので）

**シナリオ 3: 原文編集で警告バッジ**

1. ロード状態のまま原文プロンプト textarea を 1 文字編集
2. パネル内に `⚠ 原文が変更されています（拡張プロンプトはロード時のまま使用されます）` の黄色バッジが出現
3. Positive/Negative textarea の内容は変わらない
4. 生成ボタンを押 → ロード時の Positive/Negative がそのまま使われる（`/api/enhance` は呼ばれない）
5. 編集した文字を元に戻す（`Ctrl+Z` など） → 警告バッジが消える

**シナリオ 4: バッチ生成で `/api/enhance` が 0 回**

1. ロード状態のまま「複数枚をまとめて生成」を開き、任意モード（例: 「枚数 3」）で「生成する」
2. Network タブで、バッチ全体を通じて `/api/enhance` が **1 度も呼ばれない** ことを確認
3. 各ジョブの `/api/generate` request body に同じ Positive/Negative が入っている
4. 生成 3 枚がすべて（seed が変わる想定なら異なる絵、seed 固定なら同一の絵）期待通りの内容

**シナリオ 5: レガシー画像（`enhancedPrompt` 空）は従来通り**

これは既存動作の非破壊確認。もし `enhancedPrompt` を持たないレガシー画像が gallery にあれば:

1. その画像で「フォームにロード」を押 → パネルは表示されない（`loadedPositive` が空文字なので条件レンダで消える）
2. 生成ボタンを押 → 従来通り `/api/enhance` が呼ばれる

該当画像がなければこのシナリオはスキップして構いません（代わりに Firestore/metadata.json 内で `enhancedPrompt` が実際に空文字のレコードを人為的に作れるなら試すが、通常は不要）。

- [ ] **Step 3: 検証結果を報告**

Task 1〜6 のコミットログを `git log --oneline` で確認し、`Base commit .. HEAD` の範囲を進捗レジャー（`.superpowers/sdd/progress.md`）に記録。ブラウザ検証のシナリオ 1〜4 の結果（`/api/enhance` の呼ばれる/呼ばれないの実測値、画像の一致確認）を残す。この Task 6 はコミットを生成しない（コード変更ゼロ）。

---

## Self-Review Notes

Spec に対する plan の網羅性を再確認:

1. **Spec coverage**: Spec の各節を task に mapping。
   - 「新規 state」→ Task 3
   - 「生成パイプラインの分岐」（単発 + バッチ + loadingStep）→ Task 5
   - 「loadIntoForm の拡張」→ Task 3
   - 「UI 詳細」→ Task 4
   - 「i18n」→ Task 2 (namespace は `controlPanel:` に修正、Global Constraints で明示)
   - 「エッジケース」→ Task 1 の 4 tests でカバー（enhancedPrompt 空 / 全部空 / 明示的な空文字 / 正常ケース）+ Task 6 のシナリオ 3 (原文編集) + シナリオ 5 (レガシー)
   - 「テスト戦略」→ Task 1（unit） + Task 6（統合ブラウザ）
   - 「影響ファイル一覧」→ Tasks 1〜5 で全 6 ファイルを触る

2. **Placeholder scan**: TBD / TODO / 未確定要件はゼロ。各 step に具体的コード + exact コマンド + 期待出力を記載。

3. **Type consistency**:
   - `LoadIntoFormState` の新フィールド名（`loadedPositive`, `loadedNegative`, `loadedOriginalPromptSnapshot`）が Task 1 と Task 3 で一致。
   - App.tsx の state 名（`loadedPositive`, `loadedNegative`, `loadedOriginalPrompt`）と `<ControlPanel>` に渡す prop 名（`loadedOriginalPrompt`）が Task 3, 4 で一致。
   - i18n キー（`loadedEnhancedPanelTitle` など）が Task 2 と Task 4 の JSX で一致。
   - 生成側の分岐条件 `loadedPositive` truthy check が Task 5 の単発とバッチで一致。
   - 純粋関数側のスナップショットは `loadedOriginalPromptSnapshot`、App state 側は `loadedOriginalPrompt`。これは意図的で、pure function の戻り値名にはっきり「snapshot」性質を残しつつ、App 側の state 名は短く保つ。

4. **Scope check**: 単一 subsystem（ロード済み拡張プロンプト機能）に閉じ、単一 plan で完結。他機能への波及ゼロ。
