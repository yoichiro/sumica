# LoRA / Checkpoint 向けキーワード指定とプロンプト結合 設計書

## 1. 背景

Sumica の画像生成パイプラインは、ユーザーが入力した自然言語プロンプト（主に日本語）を LM Studio（OpenAI 互換 `/v1/chat/completions`）に送信して英語タグへ拡張する Step 1（`POST /api/enhance`）と、拡張された positive / negative プロンプトを Stable Diffusion（AUTOMATIC1111 / Forge の `/sdapi/v1/txt2img`）に渡して画像生成を行う Step 2（`POST /api/generate { skipEnhance: true }`）の 2 段構造で設計されています（詳細は `CLAUDE.md` および ADR-0002 / ADR-0058 参照）。

しかし、Stable Diffusion のエコシステムにおいて:
1. **Checkpoint (ベースモデル)**: Pony Diffusion 系（`score_9, score_8_up, rating_safe...`）や Animagine 系、Illustrious 系のように、モデル固有の品質タグやスタイルプレフィックスをプロンプト先頭に配置することが求められるものが多数存在します。
2. **LoRA**: 特定のキャラクター、衣装、画風、構図を反映するために、学習時に指定された固有の「トリガーワード（activation tags）」（例: `costume_a, ribbon` や `character_name`）をプロンプト内に含めることが必須となります。

現状の Sumica では、入力欄が 1 つの自然言語プロンプト欄しかなく、入力内容はすべて LM Studio によって翻訳・拡張されます。そのため、自然言語中に英語のトリガーワードや品質タグを混在させても、LM Studio による意訳・語順変更・削除などの影響を受け、SD 側へ正確なトークンとして届かない問題がありました。

本機能では、ユーザーが LoRA や Checkpoint を選択した際に、それぞれに対応するキーワード（トリガーワード・品質タグ）を明示的に指定・保持し、LM Studio の翻訳処理を介さず決定論的にプロンプトへ直接結合（injection）できる仕組みを導入します。

---

## 2. スコープ

### 本 spec で扱うもの:
- **UI / 入力欄の追加 (`ControlPanel.tsx`)**:
  - Checkpoint 選択プルダウン直下に「モデルキーワード」入力欄を配置。
  - 選択中 LoRA カード内部に各 LoRA ごとの「トリガーワード」入力欄を配置。
- **ローカル記憶・自動復元 (`localStorage`)**:
  - モデル名ごとに `sumica.modelKeywords.${modelName}` としてキーワードを自動保存・復元。
  - LoRA 名ごとに `sumica.loraKeywords.${loraName}` としてトリガーワードを自動保存・復元。
- **決定論的プロンプト結合ロジック (`client/src/utils/promptComposition.ts`)**:
  - 純粋関数 `composePositivePrompt` の新設。
  - 結合順序: `[Checkpointキーワード], [LoRAトリガーワード], [LM Studio拡張プロンプト]`。
  - カンマや空白のトリム・安全な正規化処理。
- **生成パイプラインへの統合 (`client/src/App.tsx`)**:
  - 単一生成（`handleGenerate`）でのプロンプト結合。
  - まとめて生成（`handleBatchGenerate`）でのプロンプト結合。
  - モデル切替バッチ時における各モデルの保存済みキーワードの動的適用。
- **メタデータ永続化と「フォームにロード」互換性**:
  - Firestore / local `metadata.json` の `loras` 配列（`{ name, weight, keywords? }`）へのキーワード保存。
  - `computeLoadIntoFormState` による LoRA キーワードの復元と `localStorage` フォールバック。
- **多言語対応 (i18n)**:
  - 日本語（`ja.ts`）および英語（`en.ts`）への辞書定義追加。
- **テスト (Vitest)**:
  - `promptComposition.test.ts` による網羅的な単体テスト。
  - `loadIntoFormState.test.ts` の拡張。

### スコープ外:
- ネガティブプロンプトへのキーワード指定（ブレストにてポジティブのみに絞る方針を決定）。
- LM Studio のシステムプロンプトへのキーワード強制挿入（LLM の挙動の不確実性を排除するため、直接結合を採用）。
- 外部 API（Civitai 等）からのトリガーワード自動取得。

---

## 3. ブレスト決定事項サマリ

1. **指定方式**: LoRA および Checkpoint の選択 UI に直接紐づけてインラインで指定する。
2. **記憶・永続化**: ブラウザの `localStorage` にモデル名・LoRA 名をキーとして自動保存し、次回選択時に自動入力する。
3. **対象プロンプト**: ポジティブプロンプト向けキーワードのみを対象とする（YAGNI 原則に基づくシンプル化）。
4. **結合方式**: クライアント側で LM Studio の出力と決定論的に連結して `/api/generate` に渡す。既存サーバー API の契約を破壊しない。

---

## 4. アーキテクチャとデータフロー

### 4.1 プロンプト結合アーキテクチャ

プロンプト全体の生成・送信フローは以下の通りです：

```
[ ユーザー入力 (自然言語) ]
           │
           ▼
[ POST /api/enhance (LM Studio) ] ──> [ enhancedPositive, enhancedNegative ]
                                                   │
[ Checkpointキーワード (localStorage) ] ──────────┼──> [ composePositivePrompt() ]
[ 各LoRAトリガーワード (localStorage) ] ──────────┘               │
                                                                   ▼
                                                       [ combinedPositivePrompt ]
                                                                   │
                                                                   ▼
                                                       [ POST /api/generate ]
                                                                   │
                                                                   ▼ (サーバー側で <lora:name:weight> 付与)
                                                       [ Stable Diffusion txt2img ]
```

### 4.2 結合の優先順位・配置理由

- **第 1 要素: Checkpoint キーワード**
  - Stable Diffusion の CLIP / Text Encoder において、先頭付近のトークンは最も強い影響を持ちます。Pony 系の品質タグやスタイル指定タグは先頭に配置されることが前提でチューニングされているため、最前頭に置きます。
- **第 2 要素: LoRA トリガーワード**
  - キャラクター名や特定の特徴タグなど、被写体のコアとなる識別子を配置します。
- **第 3 要素: LM Studio 拡張プロンプト**
  - ユーザーが自然言語で意図した構図、背景、ライティング、服装の詳細描写が続きます。
- **末尾: `<lora:name:weight>` 構文**
  - SD WebUI (A1111 / Forge) の仕様通り、サーバー側が末尾に付加します。

---

## 5. UI / コンポーネント設計 (`client/src/components/ControlPanel.tsx`)

### 5.1 Checkpoint キーワード入力欄
- **位置**: `ControlPanel.tsx` の Checkpoint 選択プルダウン（`<select>`）直下。
- **表示条件**: チェックポイントモデルが選択されている（`selectedModel` が空でない）場合に表示。
- **UI 要素**:
  - ラベル: `🏷️ モデルキーワード` (`t.controlPanel.modelKeywordsLabel`)
  - 入力コンポーネント: `<input type="text" className="input-field" ... />`
  - プレースホルダー: `例: score_9, score_8_up, masterpiece` (`t.controlPanel.modelKeywordsPlaceholder`)
  - スタイル: `fontSize: '12px'`, `borderRadius: '8px'`。

### 5.2 LoRA トリガーワード入力欄
- **位置**: `selectedLoras.map((l) => ...)` でレンダリングされる各 LoRA カード内部。
- **カード構成**:
  - 1行目: LoRA 名、重み数値表示（`0.80`）、削除ボタン（`×`）
  - 2行目: 重み調整スライダー（0.0 〜 2.0）
  - 3行目（新設）:
    - 入力コンポーネント: `<input type="text" className="input-field" ... />`
    - プレースホルダー: `トリガーワード (例: costume_a, ribbon)` (`t.controlPanel.loraKeywordsPlaceholder`)
    - スタイル: `fontSize: '11px'`, `padding: '4px 8px'`, `borderRadius: '6px'`。

---

## 6. State ＆ localStorage 設計

### 6.1 State 定義 (`client/src/App.tsx`)

```typescript
// Checkpoint キーワード用 State
const [modelKeywords, setModelKeywords] = useState<string>('');

// LoRA 型の拡張
export interface SelectedLora {
  name: string;
  weight: number;
  keywords: string;
}
const [selectedLoras, setSelectedLoras] = useState<SelectedLora[]>([]);
```

### 6.2 localStorage キー命名規約

- Checkpoint: `sumica.modelKeywords.${modelName}`
- LoRA: `sumica.loraKeywords.${loraName}`

### 6.3 ライフサイクルとイベントハンドラ

1. **モデル変更時 (`handleSelectModel`)**:
   - 変更先モデルのキーから `localStorage.getItem(`sumica.modelKeywords.${newModel}`)` を取得し、`setModelKeywords` にセット。
2. **モデルキーワード編集時 (`handleModelKeywordsChange`)**:
   - `modelKeywords` を更新し、同時に `localStorage.setItem(`sumica.modelKeywords.${selectedModel}`, val)` を実行。
3. **LoRA 追加時 (`addLora`)**:
   - 追加対象の LoRA 名から `localStorage.getItem(`sumica.loraKeywords.${name}`) || ''` を読み出し、初期 `keywords` としてオブジェクトを生成。
4. **LoRA トリガーワード編集時 (`handleLoraKeywordsChange`)**:
   - 対象 LoRA の `keywords` を更新し、同時に `localStorage.setItem(`sumica.loraKeywords.${name}`, val)` を実行。

---

## 7. プロンプト結合純粋関数 (`client/src/utils/promptComposition.ts`)

### 7.1 関数シグネチャ

```typescript
export interface ComposePositivePromptOptions {
  modelKeywords?: string;
  loraKeywords?: string[];
  enhancedPrompt: string;
}

/**
 * Checkpoint キーワード、LoRA トリガーワード、および LM Studio 拡張プロンプトを
 * 決定論的かつ安全に単一のカンマ区切り文字列に結合する。
 */
export function composePositivePrompt(options: ComposePositivePromptOptions): string {
  const parts: string[] = [];

  const cleanPart = (text?: string): string => {
    if (!text) return '';
    return text
      .trim()
      .replace(/^,+|,+$/g, '') // 先頭・末尾のカンマを除去
      .trim();
  };

  const modelPart = cleanPart(options.modelKeywords);
  if (modelPart) parts.push(modelPart);

  if (options.loraKeywords) {
    for (const kw of options.loraKeywords) {
      const cleanKw = cleanPart(kw);
      if (cleanKw) parts.push(cleanKw);
    }
  }

  const enhancedPart = cleanPart(options.enhancedPrompt);
  if (enhancedPart) parts.push(enhancedPart);

  return parts.join(', ');
}
```

---

## 8. 生成パイプライン・バッチ生成との統合

### 8.1 単一画像生成 (`handleGenerate`)
1. 自然言語プロンプトを `/api/enhance` で拡張（または `loadedPositive` を再利用）。
2. `composePositivePrompt({ modelKeywords, loraKeywords: selectedLoras.map(l => l.keywords), enhancedPrompt: positive })` を実行して `effectivePositive` を生成。
3. `/api/generate` へ `prompt: effectivePositive` を渡して生成をリクエスト。

### 8.2 まとめて生成 (`handleBatchGenerate`)
- **回数指定 / サイズ組み合わせ**:
  - 事前に 1 回 `composePositivePrompt` で組み立てられた `effectivePositive` を全ジョブで再利用。
- **モデル切替（Model Cycling）**:
  - 各ジョブ実行ループにおいて、`job.model` が指定されている場合：
    - `const jobModelKeywords = localStorage.getItem(`sumica.modelKeywords.${job.model}`) || '';`
    - ジョブごとに `composePositivePrompt({ modelKeywords: jobModelKeywords, ... })` を実行し、モデル固有のキーワードを正確に注入。

---

## 9. メタデータ永続化と「フォームにロード」

### 9.1 メタデータ型定義の更新
- `client/src/firebase.ts` および `server/index.ts`:
  - `loras?: { name: string; weight: number; keywords?: string }[]`

### 9.2 `computeLoadIntoFormState` の更新
- 画像をフォームへ復元する際、各 LoRA の `keywords` は以下のように解決します：
  ```typescript
  keywords: lora.keywords ?? (localStorage.getItem(`sumica.loraKeywords.${lora.name}`) || '')
  ```
  - レコードに `keywords` が残っている場合はその値を忠実に復元。
  - レコードに `keywords` がない旧データの場合は、ローカルに現在保存されているキーワードをフォールバックとして適用。

---

## 10. テスト計画

### 10.1 `client/src/utils/promptComposition.test.ts` (Vitest)
- **正常系**:
  - モデルキーワード + LoRAキーワード（単一・複数） + 拡張プロンプトの完全結合。
  - カンマ区切りの正しい配置。
- **部分指定**:
  - モデルキーワードのみ指定 / LoRAキーワードのみ指定 / 拡張プロンプトのみ。
- **正規化・エッジケース**:
  - ユーザーが先頭・末尾にカンマを入力した場合（例: `,score_9,`）。
  - 余分な空白、空文字、空白のみの入力の無視。
  - 拡張プロンプトが空の場合（キーワードのみで構成）。

### 10.2 `client/src/components/loadIntoFormState.test.ts`
- レコードに `keywords` を持つ LoRA を読み込んだとき、State に `keywords` が復元されること。
- レコードに `keywords` を持たない旧データの場合、`localStorage` の値にフォールバックすること。

---

## 11. 実装タスク一覧

1. **ユーティリティ＆テスト作成**:
   - `client/src/utils/promptComposition.ts` 実装。
   - `client/src/utils/promptComposition.test.ts` 作成・検証。
2. **多言語定義の追加**:
   - `client/src/i18n/ja.ts` / `en.ts` にラベル・プレースホルダー追加。
3. **State ＆ ハンドラ実装 (`App.tsx`)**:
   - `modelKeywords` State、`selectedLoras` 型拡張。
   - `handleSelectModel`、`addLora`、編集ハンドラの localStorage 連携。
   - `handleGenerate` / `handleBatchGenerate` への `composePositivePrompt` 組み込み。
4. **UI 反映 (`ControlPanel.tsx`)**:
   - モデルキーワード入力欄追加。
   - LoRA カード内トリガーワード入力欄追加。
5. **「フォームにロード」対応 (`loadIntoFormState.ts` & テスト)**:
   - LoRA `keywords` の復元ロジックとテスト。
6. **動作確認・型チェック・リント**:
   - `npm run typecheck --prefix server`
   - `npm run test:run --prefix client`
   - `npm run lint --prefix client`
   - `npm run build --prefix client`
