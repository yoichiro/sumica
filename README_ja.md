# Sumica AI Studio 🎨🌌

**[English](README.md) | 日本語**

LM Studio (ローカルLLM) と Stable Diffusion を API 経由で連携させ、自然言語の指示からハイクオリティな画像を生成できる近未来的デザインのデスクトップ・ウェブアプリケーションです。Google アカウントでサインインすると生成画像をあなた専用の Firebase (Storage & Firestore) へ自動保存。サインアウト状態でも、サーバー内のローカルフォルダへ自動保存されるため、すぐに画像生成をお試しいただけます！

**日本語 / 英語 UI 対応** — ブラウザ言語で自動判定。URL クエリ `?hl=ja` / `?hl=en` で強制指定も可能です。

---

## 🚀 動作に必要な前提条件

アプリを起動する前に、以下のローカルサービスが起動していることを確認してください。

### 1. LM Studio (ローカルLLM)
* **役割**: 自然言語の入力（日本語など）を、Stable Diffusion が理解しやすい詳細で高品質な英語プロンプトへ翻訳・拡張（プロンプト・エンジニアリング）します。「特に」「かなり」「強く」「めっちゃ」等の**強調キューを自動的に `(phrase:weight)` 構文へ変換**する仕組みも組み込まれています。
* **設定方法**:
  * LM Studio を起動し、お好みのLLMモデル（Llama 3、Gemma 2、Command R等）をロードします。
  * 左メニューの「**Local Server**」タブを開き、ポート番号 `1234` でサーバーを起動（**Start Server**）します。

### 2. Stable Diffusion Web UI (AUTOMATIC1111 / Forge)
* **役割**: 拡張された英語プロンプトから高画質な画像を生成します。SDXL / SD1.5 の両方に対応。
* **設定方法**:
  * 外部APIを受け付けるように、起動コマンド（`webui-user.sh` / `webui-user.bat`）の `COMMANDLINE_ARGS` に必ず **`--api`** フラグを追加してください。
  * デフォルトポート `7860`（`http://127.0.0.1:7860`）で起動します。

---

## 🛠️ セットアップ手順

### Step 1. 依存関係のインストール
プロジェクトのルートディレクトリで以下のコマンドを実行して、フロントエンド・バックエンドすべてのライブラリを一括セットアップします。
```bash
npm install
```

### Step 2. サーバー環境変数 (.env) の作成
`server/.env` を作成し、必要に応じて接続先を書き換えます。
```env
PORT=5000
LM_STUDIO_URL=http://localhost:1234
STABLE_DIFFUSION_URL=http://localhost:7860
LM_STUDIO_MODEL= # 指定しない場合は現在ロードされているモデルが使用されます

# CORS で許可するフロントエンドのオリジン (カンマ区切り)
# 未指定の場合は Vite の開発用オリジン (localhost:5173 / 127.0.0.1:5173) を許可します
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

> 接続先は起動時に一度だけ読み込まれる設計です。変更後はサーバーの再起動が必要です。

---

## 🔥 Firebase の連携手順 (任意)

Google アカウントでサインインすることで、生成画像をあなた専用のクラウド (Firebase Storage & Firestore) に保存できます。Firebase を使用する場合は以下の設定を行ってください。

> **サービスアカウントキーは不要です。** Firebase アクセスはすべてブラウザ上のクライアントが行います。サーバー側は完全に Firebase 非依存です。

1. **Firebase Console でプロジェクト作成**:
   * [Firebase Console](https://console.firebase.google.com/) で新規プロジェクトを作成します。
2. **Firestore Database の作成**:
   * メニューから「Build > Firestore Database」を選択し、データベースを作成します。
3. **Cloud Storage バケットの作成**:
   * 「Build > Storage」を選択し、ストレージバケットを作成します。
4. **Authentication で Google ログインを有効化**:
   * 「Build > Authentication」を開き、「Sign-in method」タブから **Google** プロバイダーを有効にします。
5. **Web アプリを登録してウェブ設定をコピー**:
   * プロジェクトの設定（歯車アイコン）から「マイアプリ」タブを開き、「**ウェブ**」アプリを追加します。
   * 表示された `firebaseConfig` の値を `client/.env` に記入します（`client/.env.example` を参照）。
   ```env
   VITE_FIREBASE_API_KEY=your-api-key
   VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project-id.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   VITE_FIREBASE_APP_ID=your-app-id
   ```
   * `VITE_FIREBASE_API_KEY` が空の場合は Firebase が無効になり、ローカル保存のみになります（サインイン UI も非表示）。
6. **セキュリティルールのデプロイ**:
   * リポジトリルートにある `firestore.rules` と `storage.rules` を Firebase Console または Firebase CLI (`firebase deploy --only firestore:rules,storage`) でデプロイします。これによりユーザーごとのデータ分離が有効になります。

---

## 💻 起動方法

すべての準備ができたら、ルートディレクトリで以下のコマンドを叩くだけです！
`concurrently` により、**フロントエンドとバックエンドがワンコマンドで同時に立ち上がります**。

```bash
npm run dev
```

* **フロントエンド**: [http://localhost:5173](http://localhost:5173) (ブラウザで自動起動またはアクセス)
* **バックエンドAPI**: [http://localhost:5000](http://localhost:5000)

個別に起動したい場合は `npm run dev:server` / `npm run dev:client` も利用できます。

---

## ✨ 主な機能

### 🖼️ 生成

- **自然言語プロンプト拡張** — 日本語で書くだけで LM Studio が Stable Diffusion 向けの詳細な英語プロンプトに拡張。「特に (1.2)」「強く (1.3)」「ものすごく (1.4)」「控えめに (0.8)」等の強調キューを自動的に `(phrase:weight)` 構文へ変換します。
- **柔軟な生成パラメータ**:
  - **SDXL**: アスペクト比 (1:1, 4:3, 9:7, 3:2, 16:9, 21:9, 3:1) × 向き × サイズ (S / M / L) のプリセットピッカー。SDXL 学習バケットを ⭐ で視覚化。
  - **SD1.5**: 7 種のアスペクト比 (1:1 のみ S / M / L 対応、他は M 固定)。
  - **詳細設定**: Sampler / Scheduler / Steps / CFG / Seed / **LoRA** / **Hires.fix** / **Refiner** / **VAE** (SDXL 用)。
- **バッチ生成 (まとめて生成)** — 一度のプロンプト拡張で複数枚を連続生成:
  - **枚数モード**: N 枚を同一設定で
  - **サイズモード**: アスペクト比 × 向き × サイズの掛け合わせを一括
  - **モデルモード**: 利用可能な各チェックポイントで 1 枚ずつ試行
- **リアルタイム進捗表示** — 生成中の経過時間・残り時間・進捗バーを SD からポーリング取得して表示。
- **キャンセル** — 生成中に「生成を止める」ボタンで SD の interrupt を発火し即座に中断可能。

### 💾 保存

- **ハイブリッド保存**:
  - サインイン時: Firebase Storage (`users/{uid}/images/`) + Firestore (`users/{uid}/generations/`) にリアルタイム同期
  - サインアウト時: `server/outputs/` にローカル保存 (メタデータは `metadata.json`)
- **サムネイル**: 256px WebP を自動生成し、ギャラリー表示を高速化。

### 🔍 履歴ギャラリー

- 日付フィルタ、⭐ お気に入り絞り込み、生成情報のバッジ表示 (⚡ Hires / 🎭 LoRA)
- **Shift+クリック**で範囲選択、まとめて削除
- **ライトボックス**: 詳細情報パネル (10 パラメータ)、全画面表示、キーボード操作 (←→ / Space / F / Esc)、複数画像切替、View Transitions によるモーフアニメーション
- タイルから **「フォームにロード」** で過去の生成設定を復元 (モデル・サイズ・Seed・Sampler・LoRA など)

### 🎨 UX

- **UI 国際化 (JP / EN)** — ブラウザ言語で自動判定。`?hl=ja` / `?hl=en` の URL クエリで強制指定も可能。
- **OS 通知** — 画像生成完了時に OS のトースト通知（🔔 ヘッダートグルでオプトイン）。バッチは全体完了時に 1 回のみ。
- **View Transitions アニメーション** — サムネイル ↔ ライトボックス、まとめて生成モーダルの展開、タイル出現時のフェードイン。
- **ダークモード** — OS 設定に自動追従。
- **`prefers-reduced-motion` 尊重** — モーション低減設定で自動的にアニメーション無効化。

---

## 📚 開発者向け

- 主要なアーキテクチャ上の意思決定は **[`docs/arch/`](docs/arch/)** の ADR (Architecture Decision Records) に日本語で記録されています。設計判断の背景や却下された代替案が追えます。
- Claude Code などの AI エージェントで開発する場合は **[`CLAUDE.md`](CLAUDE.md)** を参照してください。プロジェクト構造・慣習・重要な設計原則がまとまっています。
- コマンド類:
  - `npm run lint --prefix client` — oxlint による静的解析
  - `npm run test:run --prefix client` — Vitest による単体テスト
  - `npm run build --prefix client` — TypeScript 型チェック + Vite ビルド
  - `npm run typecheck --prefix server` — サーバーの型チェック (ランタイムは `tsx` で直接実行)

---

## 📜 ライセンス

Sumica AI Studio は **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later) の下で提供されています。全文は [LICENSE](LICENSE) を参照してください。

AGPL ライセンスの意味: Sumica を改変し、その改変版をネットワークサービスとして第三者に提供する場合、**同じライセンスの下で改変版のソースコードを利用者に開示する義務があります**。これは、Sumica が API 経由で依存している [AUTOMATIC1111 Stable Diffusion Web UI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) と同じライセンスであり、**改善がクローズドな商用サービスに吸収されず、OSS エコシステムに還元され続けること**を意図しています。

---

## ⚠️ 免責事項

Sumica AI Studio は **"as is"（現状のまま）** で提供され、明示・黙示を問わずいかなる保証も伴いません。**コンテンツモデレーションや安全フィルタは意図的に実装していません** — モデレーションは本個人ユーティリティの範囲外です。

- **生成された内容および関連する各種法令・規制の遵守は、すべて利用者の責任**です。
- 著作者は、本ソフトウェアを利用した第三者による運用・展開（本ソフトウェアの上に構築されたサービスを含むがこれに限らない）について、**一切の推奨も責任も負いません**。
- 利用者は、本ソフトウェアが依存する上流サービスの各ライセンス・利用規約を**独立して遵守する責任があります** — 特に [AUTOMATIC1111 Stable Diffusion Web UI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) の AGPL v3（あるいは利用者が採用する別の Stable Diffusion フロントエンドのライセンス）、および [LM Studio](https://lmstudio.ai/) の利用規約に注意してください。
- 使用する Stable Diffusion のモデルチェックポイントや LoRA の選択は完全に利用者の責任であり、それぞれのモデルのライセンス条項の遵守も含みます。

Sumica またはその fork を第三者がアクセス可能なサービスとして運用する場合、**運用者はそのサービスの操作者として、生成される内容および関連する全法令遵守について、法的な全責任を負う立場となります**。

---

## 🤝 コントリビュート

コントリビュートは歓迎します！ 本プロジェクトへのプルリクエスト、イシューコメント、パッチ、その他の貢献を提出することにより、**貢献内容がプロジェクト本体と同じ AGPL-3.0-or-later ライセンスの下で提供されることに同意したもの**とみなします。これにより、コードベース全体が単一の一貫したライセンスの下に保たれ、すべての利用者が同じ自由を享受し続けられます。

大きな変更の PR を出す前には、まず issue で方針を相談していただけると助かります。コーディングスタイルは既存のコードベースの慣習に従ってください — 詳細は [`CLAUDE.md`](CLAUDE.md) を参照してください。
