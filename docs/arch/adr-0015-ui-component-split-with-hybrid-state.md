# ADR 15: App.tsxをUIコンポーネント単位に分割し、hybrid state 戦略を採用する

## Context

`client/src/App.tsx` は SDXL preset picker（[[adr-0010-sdxl-ratio-orientation-size-preset]]）、Refiner/VAE 導入（[[adr-0011-sdxl-refiner-and-external-vae]]）、SD1.5 pickerのパリティ化（[[adr-0014-sd15-ratio-orientation-size-preset]]）、ライトボックスの Info パネル、履歴の全選択ボタン、Refiner switch-at スライダーなど、数か月にわたる機能追加を経て **3913 行** にまで膨らんでいました。

CLAUDE.md の設計方針では「client stack は intentionally lean」「no router, no state library, no CSS framework」「the entire React 19 UI (~3300 lines, one component tree)」と単一コンポーネントツリー構成を明示的に選択してきました。この方針は初期には合理的でした：

- 依存関係が明示的で読み下せる
- 状態が一箇所に集約されているのでデバッグしやすい
- ライブラリ増加を避けてビルドサイズと認知負荷を最小化

しかし 3913 行を越えたあたりから、以下の摩擦が顕在化してきました：

- **ファイル内ナビゲーションが困難**：機能追加のたびに関連コードが全ファイルに散らばり、変更範囲を把握するのに時間がかかる
- **見つけたいコードを Grep 頼りに探す**しかない：例えば「ライトボックスの info パネル」を修正したいとき、ファイル内の1300行付近まで飛ぶ必要がある
- **境界の意識が薄れる**：フォーム、プレビュー、ギャラリー、モーダルなど本来独立して考えられる UI 単位が混ざり、片方への変更が意図せず他方に影響する懸念が増える
- **AI 支援のコンテキスト効率が悪化**：LLM に一部だけ渡そうとしても関連ファイルが実質1つしかなく、抜き出しが困難

洋一郎さんから「UIコンポーネント単位で分割するリファクタリング」の要望があり、実施方針を4点整理して合意しました：

1. **範囲**：全部一気に（Phase 1: 独立モーダル/ヘッダー → Phase 2: メインパネル）
2. **順序**：簡単なところから（低リスク→高リスク）
3. **state 方針**：**hybrid** — 基本は props drilling、将来必要になれば Context を追加
4. **配置**：`client/src/components/` にフラット

## Decision

`client/src/App.tsx` を以下の 8 コンポーネント + 共有モジュールに分割します。

**抽出したコンポーネント（`client/src/components/`）**：

| ファイル | 責任 | 元のJSX行数 |
|---|---|---|
| `ToastContainer.tsx` | トースト通知の描画 | 35 |
| `AppHeader.tsx` | ロゴ、認証、接続バッジ (`ServiceStatusBadge` を内包) | 85 |
| `DeleteConfirmModal.tsx` | 削除確認ダイアログ | 60 |
| `Lightbox.tsx` | 拡大表示 + Info パネル + ナビゲーション | 279 |
| `BatchGenerationModal.tsx` | まとめて生成ダイアログ（3モード）+ 内部の `buildSdxlBatchJobs`/`buildSd15BatchJobs` | 415 |
| `PreviewPanel.tsx` | プレビュー画像 + プロセストラッカー + プロンプト詳細 | 376 |
| `HistoryGallery.tsx` | 履歴グリッド + フィルタツールバー + 全選択/全解除 | 243 |
| `ControlPanel.tsx` | 左カラムのフォーム全体（プロンプト・モデル・比率ピッカー・Hires・LoRA・Refiner/VAE・Seed・生成ボタン） | 683 |
| `presets.ts` | `SDXL_PRESETS`, `SD15_PRESETS`, 型、`resolveSdxlDimensions`/`resolveSd15Dimensions`/`findSdxlSelection`/`findSd15Selection`（App と BatchGenerationModal で共有） | 250 |

**State の扱い（hybrid 方針）**：

- **すべての state は App.tsx に残す**。ホスト元は変えない。
- **各コンポーネントは props で受け取る**。setter も setter として props で渡す（`(v: T) => void` 形式が基本、functional update が必要なところだけ `Dispatch<SetStateAction<T>>` を明示的に渡す）。
- **React Context は導入しない**。将来 props drilling が耐えられなくなったら追加する余地は残す。今回のプロファイルでは prop drilling が依然として明示的でトレーサブル。
- **ControlPanel の props は約 60 個**と大きめだが、フォーム自体が単一機能なので Props インターフェース1つで受けることを許容。呼び出し側 (App.tsx) の JSX が縦に伸びるトレードオフは受け入れる。

**データモデル・パイプラインは無変更**：

- `GenerationData`, `BatchJob`, `GenerationParams`, `SdxlRatio`/`Sd15Ratio` などの型は既存の場所か `components/presets.ts` に移動しただけで、フィールドは一切変えず。
- サーバー API (`/api/enhance`, `/api/generate`, `/api/history` など) は完全に無変更。
- Firestore/local storage スキーマ無変更。
- 実行時の挙動は完全に保存。純粋な構造リファクタリング。

**段階的なコミット戦略**：

3回のコミットに分けて反映：

1. `a123785` — Phase 1: Toast, Header, DeleteConfirm, Lightbox, BatchGenerationModal + presets 抽出
2. `b7ae890` — Phase 2a: PreviewPanel と HistoryGallery
3. `f318bda` — Phase 2b: ControlPanel（最大の抽出）

各コミットで `npm run build` が通過し、rollback しやすい形。

## Status

承認済み

- CLAUDE.md の「the entire React 19 UI (~3300 lines, one component tree)」という記述は本 ADR で supersede します。UI は今後、複数コンポーネントで構成されます。CLAUDE.md 側の記述の更新は別途行います。
- CLAUDE.md の「No router, no state library, no CSS framework」の方針はそのまま維持されます（本 ADR は state library や Context を新規導入しません）。

## Consequences

- **App.tsx が 3913 → 1471 行（-62%）** に縮小。オーケストレーション（state, useEffect, ハンドラ, 生成パイプライン）に集中する構造になりました。
- **総行数は 3913 → 約 4187 行に微増**。props インターフェース宣言や import 文、コンポーネント境界のボイラープレートが増えるため。この増加は個々のファイルが独立に読める価値と引き換え。
- 各コンポーネントは **単体で読める規模**（35〜769 行）に収まり、機能単位の変更がファイル境界で完結しやすくなりました。
- **props インターフェースが暗黙の契約から明示的な契約になった**。ControlPanel の 60 props は多いですが、コンパイラでチェックされるので「どの state を使っているか」が型定義を読めば把握できます。
- **共有ユーティリティ（presets）が正式に分離**され、App.tsx と BatchGenerationModal の両方から同じ resolver/finder を参照します。以前は BatchGenerationModal 抽出時に一時的にコード重複していましたが、今回で解消。
- **AspectRatioPicker のさらなる細分化は見送り**。当初計画では SDXL/SD1.5 の比率ピッカーを別コンポーネント化する Phase 3 も検討しましたが、ControlPanel のインライン展開のままでも読める規模に収まっており、prop 数の増加コストの方が上回るため今回は実施しません。将来ピッカーの UI が独立して進化する需要が明確になったら再考します。
- **React Context の導入は保留**。ControlPanel の 60 props は現時点の耐性内。ただし将来「複数の子コンポーネントが同じ state を大量に参照する」パターンが増えたら Context 化を検討します。判断基準は「新規に共有 state が 3 つ以上増えるか」と「同一 state を 4 つ以上のコンポーネントが読むか」あたり。
- **AI 支援（Claude Code）のコンテキスト効率が向上**。個別の UI 変更なら該当コンポーネントファイルだけを LLM に渡せる。フィーチャー横断の変更は App.tsx + 該当コンポーネント の 2〜3 ファイルで済む。
- **CLAUDE.md の記述と実態が乖離**。「the entire React 19 UI (~3300 lines, one component tree)」は今後更新が必要。本 ADR コミットに続いて CLAUDE.md も更新します（本 ADR のスコープ外）。
- **CSS スコープは変わらず**。すべてのコンポーネントは引き続き `App.css`/`index.css` のグローバルクラス（`.glass-panel`, `.input-field`, `.scale-hover` 等）と、インライン `style={{}}` 属性を併用します。CSS Modules や styled-components には移行しません。
- **Playwright スモークテストで主要 UI 要素（Header, プロンプト, SD/SDXL トグル, 比率ピッカー, ギャラリー, 生成ボタン）の描画を確認済み**。生成パイプラインへの影響なし。
