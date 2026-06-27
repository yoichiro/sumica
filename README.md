# Sumica AI Studio 🎨🌌

LM Studio (ローカルLLM) と Stable Diffusion を API 経由で連携させ、自然言語の指示からハイクオリティな画像を生成し、Firebase (Firestore & Storage) へ自動保存できる近未来的デザインのデスクトップ・ウェブアプリケーションです。

Firebase の設定がない状態でも、自動でローカル保存モードへフォールバックされるため、すぐに画像生成をお試しいただけます！

---

## 🚀 動作に必要な前提条件

アプリを起動する前に、以下のローカルサービスが起動していることを確認してください。

### 1. LM Studio (ローカルLLM)
* **役割**: 自然言語の入力（日本語など）を、Stable Diffusion が理解しやすい詳細で高品質な英語プロンプトへ翻訳・拡張（プロンプト・エンジニアリング）します。
* **設定方法**:
  * LM Studio を起動し、お好みのLLMモデル（Llama 3、Gemma 2、Command R等）をロードします。
  * 左メニューの「**Local Server**」タブを開き、ポート番号 `1234` でサーバーを起動（**Start Server**）します。

### 2. Stable Diffusion Web UI (AUTOMATIC1111 / Forge)
* **役割**: 拡張された英語プロンプトから高画質な画像を生成します。
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
`server/.env` が作成されています。接続ポートの変更やFirebaseの接続はここで行います。
```env
PORT=5000
LM_STUDIO_URL=http://localhost:1234
STABLE_DIFFUSION_URL=http://localhost:7860
LM_STUDIO_MODEL= # 指定しない場合は現在ロードされているモデルが使用されます

# Firebase Config (空の場合はローカル保存モードになります)
FIREBASE_KEY_PATH=./firebase-key.json
FIREBASE_STORAGE_BUCKET=your-project-id.firebasestorage.app
```

---

## 🔥 Firebase の連携手順 (任意)

画像をクラウドに保存し、生成パラメータをFirestoreで管理する場合は以下の設定を行ってください。

1. **Firebase Console でプロジェクト作成**:
   * [Firebase Console](https://console.firebase.google.com/) で新規プロジェクトを作成します。
2. **Firestore Database の作成**:
   * メニューから「Build > Firestore Database」を選択し、データベースを作成します。
   * セキュリティルールでテストモード（または適切な読み書き権限）を設定します。
3. **Cloud Storage バケットの作成**:
   * 「Build > Storage」を選択し、ストレージバケットを作成します。
   * バケットのURL（例: `project-id.firebasestorage.app`）を `server/.env` の `FIREBASE_STORAGE_BUCKET` に指定します。
4. **サービスアカウントキーの取得**:
   * Firebase コンソール画面左上の歯車マーク（プロジェクトの設定）から「サービスアカウント」タブを開きます。
   * 「新しい秘密鍵の生成」をクリックし、JSONファイルをダウンロードします。
   * ダウンロードしたJSONを `server/firebase-key.json` として保存します（`.env` の `FIREBASE_KEY_PATH` と一致させます）。

---

## 💻 起動方法

すべての準備ができたら、ルートディレクトリで以下のコマンドを叩くだけです！
`concurrently` により、**フロントエンドとバックエンドがワンコマンドで同時に立ち上がります**。

```bash
npm run dev
```

* **フロントエンド**: [http://localhost:5173](http://localhost:5173) (ブラウザで自動起動またはアクセス)
* **バックエンドAPI**: [http://localhost:5000](http://localhost:5000)

---

## ✨ 主な機能

1. **自然言語プロンプト拡張 💫**:
   * 日本語で「ネオンに照らされた雨の渋谷を歩く黒猫」のように入力するだけで、LM Studio の LLM が Stable Diffusion 向けにディテールや照明、アングル情報を含んだハイクオリティな英語プロンプトに拡張してくれます！
2. **詳細パラメータ調整 🎛️**:
   * 画像のサイズ（幅/高さ）、サンプリングステップ数、CFGスケール、ネガティブプロンプトなどをアドバンスドメニューから直感的に操作できます。
3. **Firebase & ローカル ハイブリッド保存 💾**:
   * Firebase 連携が有効なときは画像は Firebase Storage、メタデータは Firestore へ自動保存。
   * Firebase を設定していない状態でも、サーバー内の `server/outputs` ディレクトリに画像を保存し、履歴を管理します。
4. **APIコネクションパネル ⚙️**:
   * フロント画面右上のギアアイコンから、LM Studio や Stable Diffusion の接続先URL、使用するモデル名をリアルタイムで書き換え可能です。
