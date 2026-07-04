# ライトボックス詳細情報パネル — 設計書

- **日付:** 2026-07-04
- **ステータス:** 設計承認済み
- **トピック:** ライトボックス（画像拡大表示）と全画面表示中に、その画像の生成パラメータ詳細を任意で表示できるトグル可能な下部オーバーレイパネルを追加する。

## ゴール

ライトボックスに Info トグルボタンを追加し、押下時のみ画像下部に半透明の
オーバーレイパネルを表示する。パネルには寸法・モデル・Seed・Sampler・
Steps・CFG・ハイレス・LoRA・Refiner・VAE の生成パラメータのみを載せ、
プロンプト類（元・強化・ネガティブ）は載せない。パネルは `object-fit: contain`
で生じる下部の余白領域に重ねる形で、画像本体の視認性を可能な限り妨げない。

サインイン状態・全画面（OS Fullscreen）状態・プレビュータブ経由での
ライトボックス表示、いずれの状況でも同じ挙動で動く。

## 決定事項（議論の収束ポイント）

1. **配置は画面下部オーバーレイ。** 側面ドロワー案（画像の横幅を圧迫）と
   左上コーナーカード案（省スペースだが情報量に限界）は却下。下部
   オーバーレイは `object-fit: contain` の縦余白を利用でき、画像そのものに
   最も重ならない。
2. **トグルはボタンのみ。** キーボードショートカット（`I` キーなど）は
   併設しない。既存のキー割り当て（Esc / ←→ / Space / F）と衝突リスクを
   減らし、UI をシンプルに保つ。
3. **ライトボックスを開いた直後は非表示。** 前回状態を `localStorage` に
   記憶する案は却下。ライトボックスの主目的は画像鑑賞であり、詳細情報は
   ユーザーが明示的に求めた時のみ出す方針。
4. **ライトボックス内ナビゲーション（←→）中は表示状態を維持。** 同じ
   セッションで複数枚のパラメータを比較したいユースケースを想定。閉じて
   再度開くと非表示にリセットされる。
5. **プロンプト類は一切表示しない。** ライトボックスは「画像を見る」画面
   であり、プロンプトはプレビュータブとギャラリーの「フォームにロード」
   経由で確認できる。パネルの高さを抑えて画像の視認性を優先する。
6. **サーバー変更ゼロ。** 既存の `GenerationRecord` / `GenerationData` に
   すべての情報が揃っているため、純粋にクライアント UI 追加。

## アーキテクチャ

### 1. UI レイアウト

- **要素:** ライトボックス `<div>` 内、画像 `<img>` の兄弟として `<div>` を
  1 つ追加（`role="region"` / `aria-label="画像の詳細情報"`）。
- **配置:**
  ```
  position: absolute;
  left: 0; right: 0; bottom: 0;
  padding: 16px 24px;
  ```
- **背景と質感:**
  ```
  background: rgba(0, 0, 0, 0.55);
  backdropFilter: blur(8px);
  color: #f1f3f5;
  borderTop: 1px solid rgba(255, 255, 255, 0.08);
  ```
- **高さと溢れ制御:**
  ```
  maxHeight: 40vh;
  overflowY: auto;
  ```
- **開閉トランジション:** パネル `<div>` は Info トグルが OFF でも DOM に
  存在させ、CSS で下方向にスライドアウトさせる（`{lightboxMeta && (...)}`
  の条件下では、`showLightboxInfo` によらず常に描画）。これは
  「条件レンダー方式では最初のクリック時に要素が生えて瞬時に translateY(0)
  になり、トランジションが発火しない」問題を避けるため。
  ```
  transform: showLightboxInfo ? translateY(0) : translateY(100%);
  opacity: showLightboxInfo ? 1 : 0;
  pointerEvents: showLightboxInfo ? 'auto' : 'none';
  transition: transform 0.2s ease, opacity 0.2s ease;
  ```
- **クリック伝播:** パネル自体は `onClick={(e) => e.stopPropagation()}` で
  背景クリック（＝ライトボックスを閉じる）を吸収する。ただし OFF 状態では
  `pointerEvents: 'none'` にして、透過状態のパネル領域をクリックした時に
  背景クリックが吸われないようにする。
- **アクセシビリティ:** `aria-hidden={!showLightboxInfo}` をトグル。

### 2. パネル内コンテンツ

プレビュータブの下部メタデータブロック（`App.tsx` 内、2338 行付近以降）と
同じ "ラベル: 値" ピル形式を踏襲するが、以下の 10 種類のみを表示する：

| ラベル | 元フィールド | 表示形式 | 表示条件 |
|---|---|---|---|
| 寸法 | `width × height` | `1024×1024` | 常に |
| モデル | `model` | 文字列 | `model` が truthy |
| Seed | `seed` | monospace | `seed !== undefined` |
| Sampler | `sampler` | 文字列 | `sampler` が truthy |
| Steps | `steps` | 数値 | 常に |
| CFG | `cfgScale` | 数値 | 常に |
| ハイレス | `hrScale`/`hrUpscaler` | `ON (2.0×, R-ESRGAN 4x+)` | `enableHr === true` |
| LoRA | `loras[]` | `name (weight)` をカンマ連結 | `loras && loras.length > 0` |
| Refiner | `refiner` + `refinerSwitchAt` | `<name> (switch @ 0.80)` | `refiner` が truthy |
| VAE | `vae` | 文字列 | `vae && vae !== 'Automatic'` |

**プロンプト類（`originalPrompt` / `enhancedPrompt` / `negativePrompt`）と
`scheduler` / `timestamp` / `createdAt` は表示しない**。

レイアウトは `display: flex; flex-wrap: wrap; gap: 8px 20px;` で 1 行に
可能な限り詰め、狭幅で折り返す。各項目は
`<span><span style={{opacity: 0.7}}>ラベル:</span> <strong>値</strong></span>`
の形。

### 3. Info トグルボタン

- **アイコン:** `lucide-react` の `Info`（既存 import に `Info` を追加）。
- **位置:** ライトボックス上部ボタン列に挿入。既存のボタン群は右端から
  順に `[閉じる (20px)] [全画面 (72px)] [→ (124px)] [← (176px)] [○選択 (228px)] [★お気に入り (280px)]`
  という absolute 配置。**お気に入りボタンの左隣（`right: 332px`）** に
  Info を挿入する（＝新設ボタンが列の一番左端に来る）。他のボタンの
  `right` 値は変更しない（Info だけを新設）。
- **大きさ・見た目:** 既存の他のボタン（44×44px、`borderRadius: 50%`）と
  同一。
- **背景色（トグル状態表現）:**
  - OFF: `background: rgba(255, 255, 255, 0.15)`（他ボタンと同一）
  - ON: `background: rgba(255, 255, 255, 0.28)` + `boxShadow: 0 0 0 2px rgba(255, 255, 255, 0.35)`
- **`title` 属性:** OFF `"詳細情報を表示"` / ON `"詳細情報を隠す"`。
- **表示条件:** `lightboxMeta`（後述）が null でない時のみレンダリング。
  実装上は現状すべてのライトボックス経由で null にならないが、防御的に
  ガードする。

### 4. State とデータソース

- **新規 state:** `App` コンポーネント関数内に 1 個。
  ```ts
  const [showLightboxInfo, setShowLightboxInfo] = useState(false);
  ```
- **リセットのタイミング:** `closeLightbox()` の中で `setShowLightboxInfo(false)`
  を呼ぶ。これにより「閉じて再度開くと非表示スタート」の要件を満たす。
  ライトボックス内での ←→ ナビゲーションでは `lightboxUrl` は変わるが
  `showLightboxInfo` は触らないので、表示状態が保持される。
- **メタソース:** 派生値として
  ```ts
  const lightboxMeta =
    lightboxIndex >= 0
      ? displayedHistory[lightboxIndex]
      : (morphSourceKey === '__preview__' ? currentGeneration : null);
  ```
  を用意する（memo 不要、参照コスト極小）。
  - ギャラリー画像経由: `displayedHistory[lightboxIndex]` は `GenerationRecord`。
  - プレビュータブ画像経由: `openLightbox(currentGeneration.imageUrl, '__preview__')`
    で開かれ、`lightboxIndex` は -1、`morphSourceKey === '__preview__'`。
    このケースでは `currentGeneration` を使う。
  - どちらでもない状況は現状の実装では発生しないが、`null` の時は Info
    ボタンごと非表示にする。

### 5. Fullscreen（OS 全画面）との相互作用

パネルは `lightboxRef` の子要素であるため、`lightboxRef.current.requestFullscreen()`
の対象内に含まれる。特別な処理は不要で、全画面時にも同じ位置・同じ
挙動でパネルが表示される。

### 6. スコープの境界

- **サーバー変更なし。** `server/index.ts` は触らない。
- **既存キーボードショートカット・ナビゲーション・全画面切替・選択・
  お気に入り・削除**への影響なし。追加はボタン 1 つと state 1 つのみ。
- **CSS:** `App.tsx` 内のインライン style で完結。`App.css` / `index.css`
  は変更しない（既存の他のライトボックスボタンも全て inline style で
  書かれている）。
- **CLAUDE.md 更新なし。** 既存の「Lightbox」に関する記述は変わらない
  範囲の追加で、追記すべき固有パターンは特にない（開発者が `App.tsx` を
  読めば構造は明らか）。
- **ADR 作成なし。** アーキテクチャ上の重要な決定はなく、既存の
  クライアントサイド UI の追加に留まる。

## ファイル影響範囲

| ファイル | 変更内容 |
|---|---|
| `client/src/App.tsx` | `Info` アイコン import 追加、`showLightboxInfo` state 追加、`closeLightbox` 内でのリセット、ライトボックス JSX に Info ボタン 1 個と下部パネル 1 個を追加、`lightboxMeta` 派生値の追加 |

他ファイルへの変更はなし。

## テスト（手動確認）

自動テストは無いプロジェクト（`npm test` はプレースホルダ）なので、
実装後に以下を手動で確認する。

### 基本フロー
1. ギャラリーの任意の画像をクリック → ライトボックス表示、Info ボタンは
   OFF 状態（背景 `rgba(255,255,255,0.15)`）で、詳細パネルは非表示。
2. Info ボタンを押す → 背景色が変わり、下部から詳細パネルがスライド
   イン。寸法・Model・Seed・Sampler・Steps・CFG が最低限並ぶ。
3. もう一度 Info を押す → パネルが下にスライドアウトして消える。
4. ← / → キーで隣の画像に移動 → Info 状態は維持され、パネルの中身だけ
   更新される。
5. Esc または背景クリックで閉じる → 再度別画像を開くと Info は再び OFF。

### 条件付き項目
6. LoRA を使った画像 → 「LoRA: name (0.8), ...」が表示される。使ってない
   画像では LoRA 行が消える。
7. Hires.fix を使った画像 → 「ハイレス: ON (2.0×, ...)」が表示される。
   使ってない画像では消える。
8. Refiner を指定した SDXL 画像 → 「Refiner: <name> (switch @ 0.80)」が
   表示される。
9. VAE を `"Automatic"` 以外に指定した画像 → 「VAE: <名前>」が表示される。
   `"Automatic"` または未設定の画像では消える。
10. Seed / Sampler / Model が未設定の古い画像でも、その行だけ消え、他の
    行は正常に表示される。

### プレビュータブと全画面
11. 生成直後にプレビュータブの画像をクリック → 同じ挙動でパネルが機能
    する（`currentGeneration` 経由）。
12. 全画面ボタン（`Maximize`）で OS 全画面に入った状態でも Info ボタンと
    パネルが機能する。
13. 全画面中 → 全画面解除 → ライトボックス閉じる の順で操作しても、
    再度開いた時に Info は OFF に戻っている。

### レイアウト
14. 情報が多い画像（LoRA 複数 + Refiner + VAE + Hires 全部盛り）でも、
    パネル高さは 40vh を超えず、内部スクロールで全項目に到達できる。
15. 幅の狭いウィンドウ（例: 600px）でも、パネル内の項目が `flex-wrap`
    で折り返し、はみ出さない。
16. ライトボックス背景の外側（画像の左右余白）をクリックしても、Info
    パネル上をクリックした時はライトボックスが閉じない。

### 環境
17. Windows Chrome から `http://<wsl-host>:5173/` で `localhost` 経由の
    閲覧に問題なし（既存フロー確認）。

## 却下された代替案

- **右サイドドロワー:** 縦長プロンプトが読みやすくなるが、今回プロンプトは
  表示しない方針のため利点が消え、逆に横幅を狭めるデメリットだけが残る。
- **左上コーナーカード:** 省スペースだが、寸法・Model・Seed・Sampler・
  Steps・CFG・LoRA・Refiner・VAE の 10 項目を全部載せるとどうしても
  詰め込みすぎる。
- **`I` キーによるショートカット:** 既存のキー割り当てが多く（Esc / ←→ /
  Space / F）、`I` は他の可能性（Import 等）を潰す可能性がある。ボタン
  1 個で明示的な UI 操作に絞る。
- **常時表示 + `X` で閉じる:** 「ライトボックスは画像鑑賞優先」の設計
  思想と噛み合わない。初回開くたびに手動で消す作業を強いる。
- **`localStorage` で前回状態を記憶:** ユーザー間の設定同期・端末間の
  同期などのメンテナンスコストに対し、得られるメリット（毎回のボタン
  クリック省略）が薄い。YAGNI。
- **プロンプト類も一部表示:** 元プロンプトだけでも掲載する案があったが、
  最終確認で「プロンプトは一切表示しない」で確定。表示項目を最小化する
  ことで画像鑑賞への邪魔を最小化する。
