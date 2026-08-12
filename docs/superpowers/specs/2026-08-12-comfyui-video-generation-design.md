# ComfyUI 動画生成統合 設計書

## 背景

Sumica は現在、Stable Diffusion (AUTOMATIC1111) + LM Studio を組み合わせた**画像生成**の機能をひととおり備えています。洋一郎さんの環境で新たに **ComfyUI** をインストールし、生成済みの画像を入力として動画を生成するワークフロー (LTX-Video 2 系の image-to-video + FaceID + 音声、合計 64 ノード) が組み上がりました。この動画生成を Sumica 内で扱いたい、というのが本 spec の起点です。

事前の feasibility spike (2026-08-12) で確認できたことは次の通りです。

- ComfyUI は WSL2 の loopback forwarding 経由で Sumica server から HTTP + WebSocket でアクセス可能 (Windows 側 `127.0.0.1:8188` に届く)。
- REST API 一式 (`POST /prompt`, `POST /upload/image`, `GET /history/<id>`, `GET /view`, WebSocket) がすべて動作し、Sumica の既存の SD / LM Studio 連携と同じ pattern で server-to-server 通信が成立する。
- 洋一郎さんの workflow は API 形式で export 済みで、`POST /upload/image` (multipart) で md5 完全一致の byte-exact 転送ができる。
- 生成物は h264 MP4 + AAC audio, 1024×1088 @ 24fps, 10.04 秒, 約 2.8MB で 3 回とも一貫。実行時間は cold で ~300 秒、warm で ~158 秒 (実測)、RTX 5070 Ti 独占状態。
- ComfyUI プロセスはブラウザ UI と独立に動作する (`--disable-auto-launch` で auto-launch も抑止可能)。
- Sumica の生成画像 (SDXL の 1024×1024 リンゴ画像) を動画化するフルサイクルが成功。
- workflow 内の動的パラメータの候補として、Tier 1 (画像/Prompt/Seed)、Tier 2 (mxSlider × 6 の作者が意図的に露出したスライダー)、Tier 3 (出力仕様)、Tier 4 (モードスイッチ 2 個)、Tier 5 (LoRA/Sampler/UNet 等) が整理された。

同時に、Sumica の現在の UI は完全に画像専用のシンプル構成 (Gallery / Lightbox / ControlPanel / PreviewPanel / Ranking) であり、動画メディアを扱うには複数の UI 変更が必要になります。洋一郎さんは開発着手前に UI 設計を固めることを希望し、本 spec でその方針を明文化します。

## スコープ

- **含む**:
  - Sumica のデータモデルに `mediaType` (image / video) を導入し、動画は「元画像 (parentId)」を持つ **親子関係**として管理する
  - 動画生成の起点として、Lightbox のツールバー + Gallery のカードから「動画」への導線を提供する (新規生成 + 既存動画一覧へのアクセス両方)
  - Gallery を `📷 画像 / 🎬 動画` の 2 タブに分離し、混在した一覧は作らない
  - ControlPanel に `📷 Image / 🎬 Video` のモードトグルを追加し、Video モードで動画生成 form を提供する
  - PreviewPanel を動画対応させ、既存の同期 UX (画像生成中と同じ待機フロー) の延長として動画の進捗と完了 preview を表示する
  - Sumica server に ComfyUI 連携ロジックを追加し、`POST /api/video/generate` および `POST /api/video/generate/interrupt` を新設する
  - 動画の削除は cascade (親画像を削除すると子動画もまとめて削除される) semantics で実装する
  - 動画特有のパラメータのうち **Tier 1 + Tier 2 のみを UI に露出**し、他の Tier は workflow のデフォルト値で固定する
  - Firebase mode (signed in) と local mode (signed out) の両方で動作させ、Sumica server は Firebase-free の設計を維持する

- **含まない** (別 spec とする候補):
  - 動画の **Batch generation** (一括生成) — 動画は 2〜5 分/本と長く、YAGNI
  - **Ranking / Recipe** システムへの動画対応 — 動画 Recipe は SD Recipe と型が違うため、当面は image のみ
  - 動画での **Slideshow** — 画像 slideshow との UX 衝突があるため保留
  - **複数 workflow の切替 UI** — 今回は洋一郎さんの workflow (`i2v.json`) 1 本を server に bundle
  - 動画の **一括 export / ZIP ダウンロード**
  - Cold-load 時間の短縮対策 — 実測で 158s〜300s のブレはあるが、UI 側で「2〜5 分」と表示すれば実害小
  - **動画から動画の生成 (v2v)** や **inpainting** — 親子モデル自体は将来対応可能だが、本 spec 対象外

## ブレスト決定事項サマリ

洋一郎さんとの Q&A (Q1〜Q10) で確定した設計方針は次の通りです。

- **Q1 動画生成の起点**: Lightbox toolbar + Gallery カードの両方に「動画」への導線を配置。新規動画生成と既存の子動画一覧アクセスの 2 面性を持たせる。
- **Q2 Gallery の見せ方**: 画像と動画は混在させず、`📷 画像 / 🎬 動画` タブで分離。動画は元画像経由でなくても Gallery Video タブから独立アクセス可能。
- **Q3 動画 form の位置**: 別ビュー (ControlPanel の Video モード) に遷移。Lightbox から画像を持って ControlPanel の Video モードに切り替える。
- **Q4 進捗 UI**: 既存 PreviewPanel を拡張 (同期 UX の延長)。画像生成と同じ「開始→待つ→完了 preview」のパターンを踏襲。
- **Q5 子動画一覧の見せ方**: Gallery の Video タブに「この元画像で filter」して遷移。既存の Gallery filter 機構を再利用。
- **Q6 削除 semantics**: 常に cascade delete (親画像削除 → 子動画も自動削除)。削除確認 dialog に子動画件数を明示。
- **Q7 露出パラメータ**: Tier 1 (元画像/Reference/Prompt/Seed) + Tier 2 (mxSlider × 6) のみを UI で露出。Tier 3〜5 は workflow デフォルト値で固定。
- **Q8 Cancel**: 既存の画像 Cancel と同じ pattern で対応。ComfyUI の `/interrupt` を叩き、途中結果は破棄。
- **Q9 Ranking**: 当面 image のみ、動画は Ranking / Recipe システムの対象外。
- **Q10 Batch**: 当面なし (YAGNI)。

## 設計

### アーキテクチャ概要

Sumica に動画メディア (`mediaType: 'video'`) を第一級市民として導入し、既存の image 系機能を**拡張**する形で対応します。既存の画像 UI コード (Gallery / Lightbox / ControlPanel / PreviewPanel / 削除 / i18n) は破壊せず、mediaType 分岐で拡張ポイントを追加します。

親子関係 (image が親、video が子、`parentId` で連結) をデータモデルとして持ち込むことで、UI の導線 (Lightbox から動画生成起動、動画から親画像への逆引き) と削除 semantics (cascade) が統一的に表現できます。

Sumica server は **既存の「LM Studio / SD の HTTP API を叩く」pattern を ComfyUI にも横展開**します。Server は Firebase-free の設計を維持 (`firebase-admin` を runtime に持ち込まない)、tokenized URL 経由で Firebase Storage 上の元画像を fetch できる仕組みは既に `/api/download-proxy` で確立済み ([[adr-0055-image-download-with-server-proxy]])。

### データモデル拡張

#### GenerationRecord / GenerationData

`client/src/firebase.ts` の `GenerationRecord` と `client/src/App.tsx` の `GenerationData` に次のフィールドを追加します。

```typescript
mediaType: 'image' | 'video'          // 必須。default 'image' (legacy record も image 扱い)
parentId?: string                      // 動画のみ。親 image の record id
videoUrl?: string                      // 動画 URL (mediaType === 'video' のみ)
videoStoragePath?: string              // Firebase mode の Storage path
posterUrl?: string                     // 動画の poster フレーム (1st frame) URL
posterStoragePath?: string             //
ltxParams?: {                          // 動画専用の生成パラメータ (mediaType === 'video')
  fidelity: number
  motion: number
  identity: number
  length: number
  referenceImageStoragePath?: string   // Optional Reference 画像を使った場合
  positivePrompt: string
  negativePrompt: string
}
```

`mediaType` は必須にしますが、legacy record (この機能導入以前) には存在しないため、読み込み側で `record.mediaType ?? 'image'` の default を適用します。

#### Firestore の Storage layout (Firebase mode)

同一の Firestore collection (`users/{uid}/generations/{id}`) に mediaType で分岐した record を並べます。Storage のオブジェクトは次のパスに置きます。

- `users/{uid}/images/{timestamp}.png` — 既存 (画像)
- `users/{uid}/thumbs/{timestamp}.webp` — 既存 (画像のサムネイル)
- `users/{uid}/videos/{timestamp}.mp4` — 新規 (動画)
- `users/{uid}/posters/{timestamp}.webp` — 新規 (動画の poster、既存 thumbnail spec と同じ 256px WebP quality 80)

Storage rules (`storage.rules`) に `users/{uid}/videos/*` と `users/{uid}/posters/*` の read/write 許可を追加します。

#### Local mode (`server/outputs/metadata.json`)

同じく mediaType で分岐した record を配列に混在させ、`generated_<timestamp>.mp4` + `generated_<timestamp>_poster.webp` の pair で保存します。

### UI コンポーネント変更

#### Gallery (`client/src/components/HistoryGallery.tsx`)

- **上部にメディア種別タブ**: `📷 画像 / 🎬 動画`。既存の form/ranking タブと同じ segmented button pattern。
- 表示中のタブに応じて `mediaType` で自動 filter (画像タブなら `mediaType === 'image'`、動画タブなら `'video'`)。
- Filter panel に **元画像 (parentId)** を追加。動画タブでのみ露出、値は「Sumica の画像を選ぶ」picker (Gallery の画像一覧から 1 枚選択)。
- 動画タイルは `posterUrl ?? videoUrl` (fallback) をサムネイルとし、右上に `🎬` バッジを重ねる。

#### Lightbox (`client/src/components/Lightbox.tsx`)

- **画像 Lightbox** (既存の拡大表示、拡張):
  - 既存 toolbar に 2 個ボタン追加:
    - `🎬 動画にする` — Lightbox 閉じる → ControlPanel を Video モードに切替 → 元画像を state で保持
    - `📼 動画一覧` — Gallery Video タブへ遷移、`parentId` filter を自動 apply (子動画 0 個の時は disabled 表示)
- **動画 Lightbox** (新規、mediaType で分岐):
  - `<img>` の代わりに `<video controls>` を表示、`poster={posterUrl}` を指定
  - toolbar に `🖼️ 元画像を見る` (親 image Lightbox に遷移。orphan video の場合は disabled) を追加
  - キーボードショートカット: Space で play/pause (既存 lightboxKeyboard.ts に mediaType 分岐追加)
  - Fullscreen / Info / Star / Select / Prev / Next / Close は既存挙動を踏襲

#### ControlPanel (`client/src/components/ControlPanel.tsx`)

- **上部にモードトグル追加**: `📷 Image / 🎬 Video` (既存の arch トグルの上、または並列)
- **Image モード**: 既存 form そのまま (変更しない)
- **Video モード** (新規): 動画生成 form
  - **元画像 preview thumbnail** (親から継承、read-only 表示)
  - **Reference Image picker** (optional) — 「参照画像を選ぶ」ボタン → Sumica の Gallery から 1 枚選択 modal
  - **Positive Prompt** (textarea、workflow default 初期値 `"Use the provided start image exactly as the first frame."` を表示、編集可能)
  - **Negative Prompt** (textarea、workflow default 初期値、編集可能)
  - **Video Width / Video Height** (数値入力、default: 元画像の width/height を auto inherit、override 可能)
  - **Length** (数値入力、default 240)
  - **Conditioning (Fidelity)** (数値入力 float、default 1.0)
  - **Preprocess (Motion Strength)** (数値入力 float、default 35)
  - **Identity Strength** (数値入力 float、default 1.0)
  - **Seed** (既存の SD 側と同じ pattern: number input + lock checkbox)
  - **Generate** ボタン + **Cancel** ボタン (生成中のみ)

#### PreviewPanel (`client/src/components/PreviewPanel.tsx`)

- 動画生成中の進捗を既存 step indicator (`enhancing` → `generating` → `saving`) で表示
- ComfyUI の `progress_state` (WebSocket event) を server 経由でリレー、既存の progress bar (elapsed / remaining ETA) と連携
- 生成完了時は `<video controls>` を PreviewPanel の image spot に埋め込み、`posterUrl` を poster に指定
- Cancel ボタンは既存 pattern (Sumica の Cancel ボタンが呼ぶ endpoint を分岐: 画像なら `/api/generate/interrupt`、動画なら `/api/video/generate/interrupt`)

#### 削除確認 (`client/src/components/DeleteConfirmModal.tsx`)

- 選択画像の中に子動画持ちの親が含まれる場合、confirm dialog の message を拡張:
  - 例: `"3件の画像を削除します。うち 2 件には子動画が計 5 本あり、それらもまとめて削除されます。"`
- OK なら cascade delete: Firestore doc (親と子両方) + Storage オブジェクト (画像・thumb・video・poster すべて) を削除

### データフロー (動画生成 flow)

```
1. Lightbox で画像 X を開く
2. [🎬 動画にする] クリック
   → Lightbox 閉じる
   → ControlPanel が Video モードに切替
   → 元画像 X を state で保持
3. ユーザーが Video form に入力 (prompt, mxSlider, seed)
   → [Generate] クリック
4. Client → Sumica server: POST /api/video/generate
   body: {
     sourceImageStoragePath?: string,      // Firebase mode
     sourceImageLocalPath?: string,        // Local mode
     referenceImageStoragePath?: string,   // optional
     positivePrompt: string,
     negativePrompt: string,
     width: number, height: number,
     length: number,
     fidelity: number, motion: number, identity: number,
     seed: number,
     parentId: string,                     // 元画像 record の id
     clientPersist: boolean                // signed-in なら true
   }
   Response: SSE stream with progress events + final result
5. Sumica server:
   a. 元画像を Firebase Storage (tokenized URL) or server/outputs/ から fetch (byte 列)
   b. Reference image があれば同様に fetch
   c. ComfyUI に POST /upload/image で送信 (画像 1 or 2 枚) → ComfyUI 側 filename を取得
   d. workflow JSON を編集:
      - wf['837']['inputs']['image'] = 元画像 filename
      - wf['923']['inputs']['image'] = Reference filename (Reference 使わない場合は元 workflow の値のまま)
      - wf['524']['inputs']['seed'] = seed
      - wf['791']['inputs']['Xi'/'Xf'] = width
      - wf['792']['inputs']['Xi'/'Xf'] = height
      - wf['796']['inputs']['Xi'/'Xf'] = length
      - wf['797']['inputs']['Xi'/'Xf'] = fidelity
      - wf['915']['inputs']['Xi'/'Xf'] = motion
      - wf['941']['inputs']['Xi'/'Xf'] = identity
      - wf['536']['inputs']['text'] = positivePrompt
      - wf['537']['inputs']['text'] = negativePrompt
      - wf['597']['inputs']['save_output'] = false  (temp 保存で ComfyUI 側 output/ を汚さない)
   e. POST /prompt に workflow を投げる → prompt_id 取得
   f. WebSocket に接続 or /history polling で completion 監視
      → progress_state event を受信して SSE で client にリレー
6. Client PreviewPanel:
   - progress_state を受け取って既存 progress bar 更新
   - Cancel クリック → POST /api/video/generate/interrupt
7. ComfyUI 完了 → Sumica server:
   a. history から動画 filename を取得 (node 597 の gifs[0].filename)
   b. GET /view?type=temp&filename=<X>&subfolder= で mp4 バイト列取得
   c. ffmpeg (server 側にインストール) で 1 フレーム目を抽出 → 256px WebP に (既存 thumbnail spec と統一)
   d. Firebase mode (clientPersist: true):
      - Client に { videoBase64, posterBase64, params } を返す
      - Client が Firebase Storage に upload (videos/ と posters/)
      - Firestore に record 作成 (mediaType='video', parentId=X.id, ltxParams=...)
   e. Local mode:
      - server/outputs/ に .mp4 + _poster.webp 保存
      - metadata.json に追記
      - Client に metadata を返す
8. Client PreviewPanel:
   - 完了通知 (toast)
   - <video controls> で preview 表示
   - Gallery Video タブに record 追加 (Firebase onSnapshot subscription が自動反映 or 手動 refresh)
```

### サーバー実装 (ComfyUI 連携)

#### 新規 endpoint (`server/index.ts`)

- **`POST /api/video/generate`**: 上記フロー全体を実行。SSE (`text/event-stream`) で progress を stream、完了時に final result を送る
- **`POST /api/video/generate/interrupt`**: ComfyUI の `/interrupt` を叩いて cancel。Sumica 側でも in-flight フラグを立てて、`/api/video/generate` handler が history fetch 前に abort する
- `GET /api/video/models` などの補助 endpoint は今回スコープ外 (workflow は 1 本固定)

#### 新規 config (`server/.env`)

```
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_WORKFLOW_PATH=./workflows/i2v.json
```

`COMFYUI_WORKFLOW_PATH` は洋一郎さんの workflow (`10Eros_10SNodes_I2V_FaceID_v2.json`) を **`server/workflows/i2v.json`** として commit した位置を指します。

#### 新規 helper (`server/comfyui.ts`)

- `uploadImageToComfy(bytes: Buffer, filename: string): Promise<string>` — multipart POST /upload/image、response の name を返す
- `submitWorkflow(workflow: object, clientId: string): Promise<string>` — POST /prompt、prompt_id を返す
- `waitForCompletion(promptId: string, onProgress: (event) => void): Promise<HistoryEntry>` — WebSocket 接続 or /history polling、progress event を callback で流し完了時に history entry を返す
- `fetchVideo(filename: string, subfolder: string): Promise<Buffer>` — GET /view?type=temp
- `extractPoster(mp4Buffer: Buffer): Promise<Buffer>` — ffmpeg で 1 フレーム目を 256px WebP に

#### workflow ファイル

洋一郎さんの `10Eros_10SNodes_I2V_FaceID_v2.json` を `server/workflows/i2v.json` として commit (project にバンドル)。ノード番号 (837 / 923 / 524 / 536 / 537 / 549 / 597 / 596 / 791 / 792 / 796 / 797 / 915 / 941) は workflow の内部 identifier なので、洋一郎さんが将来 workflow を差し替えた際に `server/comfyui.ts` の mapping 更新が必要になる旨を server/README に注記します。

#### ffmpeg 導入

Poster フレーム抽出のために server 側で ffmpeg を実行します。Sumica は既に `sharp` を使用していますが、動画の 1 フレーム抽出は sharp では不可能なため、**`fluent-ffmpeg` npm パッケージ + ffmpeg バイナリ (WSL 側 apt でインストール)** を追加します。

### エラーハンドリング

- **ComfyUI 未接続 / 500**: server で catch → client に 502 + toast エラー ("ComfyUI が起動していないか、応答しません")
- **Node error (workflow バリデーション失敗)**: `POST /prompt` response の `node_errors` を検出 → toast エラー + server log
- **画像 upload 失敗**: retry なし、toast エラー
- **Generation 失敗** (WebSocket `execution_error` / history status `error`): toast エラー + server log
- **Timeout** (10 分超): 強制 cancel + toast
- **WebSocket 切断**: history polling (2s 間隔) に fallback
- **Cancel**: `/interrupt` 叩く → 途中結果破棄、client には `{ success: false, cancelled: true }` を返す (既存の `/api/generate` の cancel semantics と同じ)
- **Poster extraction 失敗** (ffmpeg エラー): 非致命的 → 動画は保存、`posterUrl` は undefined (gallery 側は `posterUrl ?? videoUrl` fallback で対応)

### テスト方針

- **Pure functions** (`server/workflowMod.ts` 相当) に unit test:
  - workflow JSON の mxSlider セット (`Xi` と `Xf` を同時に書き換える)
  - image slot 差し替え (node 837/923)
  - seed clamp (2^50 未満に丸める)
  - filename 生成 (既存の `formatDownloadFilename` を横展開して `sumica_YYYYMMDD_HHMMSS.mp4`)
- **DOM 副作用系** (`<video>` の再生制御、Lightbox の分岐): 既存の `utils/thumbnail.ts` pattern に合わせて unit test なし
- **Integration test**: server の ComfyUI 連携部分は実 ComfyUI が必要なので、CI 環境では対象外
- **Manual test**: `npm run dev` → Sumica の生成画像を Lightbox → 動画にする → 生成完走 → Gallery Video タブで確認 の end-to-end 手動テストで完了判定

### 実装完了の判定基準

- Sumica 画像を Lightbox で開き `🎬 動画にする` を押すと ControlPanel が Video モードに切替、元画像が state で保持される
- Video form に prompt / mxSlider を入力して Generate すると、動画が生成され、Firebase mode / local mode の両方で永続化される
- 生成された動画は Gallery の 🎬 動画タブに poster サムネイル + バッジ付きで表示される
- 動画 Lightbox で `<video controls>` で再生でき、`🖼️ 元画像を見る` で親画像 Lightbox に戻れる
- 画像 Lightbox の `📼 動画一覧` ボタンで Gallery Video タブに parent filter apply された状態で遷移できる
- 親画像を削除すると子動画も cascade で削除される (confirm dialog で件数明示)
- 動画生成中は Cancel ボタンで途中中断できる
- server tsc / client tsc + build / oxlint clean / vitest 全 pass
- 既存の画像生成 / Ranking / Batch / お気に入り / i18n 全機能に回帰なし

## 影響を受けないこと

- 既存の画像生成 pipeline (LM Studio + SD) — 変更なし。Video モードは Image モードと完全に分離
- Firestore のセキュリティルール — 追加は `videos/` と `posters/` の read/write のみ、既存 rules は触らない
- 既存 55 個の ADR の Decision — 本 spec は既存 ADR を supersede しない (mediaType 拡張は additive、既存の image 系設計は無変更)
- Sumica server の Firebase-free 設計 — `firebase-admin` を追加せず、tokenized URL で fetch する既存 pattern を踏襲
- 既存の client CORS 設定 (`CORS_ORIGINS`) — server 側の endpoint 追加のみで origin 制約は変わらない
- 既存の i18n 構造 — 新規 key の追加のみ、既存 key の rename / 削除はしない
