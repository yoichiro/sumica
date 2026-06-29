# Sumica AI Studio 🎨🌌

LM Studio (ローカルLLM) と Stable Diffusion を API 経由で連携させ、自然言語の指示からハイクオリティな画像を生成できる近未来的デザインのデスクトップ・ウェブアプリケーションです。Google アカウントでサインインすると生成画像をあなた専用の Firebase (Storage & Firestore) へ自動保存。サインアウト状態でも、サーバー内のローカルフォルダへ自動保存されるため、すぐに画像生成をお試しいただけます！

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
`server/.env` が作成されています。接続ポートの変更はここで行います。
```env
PORT=5000
LM_STUDIO_URL=http://localhost:1234
STABLE_DIFFUSION_URL=http://localhost:7860
LM_STUDIO_MODEL= # 指定しない場合は現在ロードされているモデルが使用されます

# CORS で許可するフロントエンドのオリジン (カンマ区切り)
# 未指定の場合は Vite の開発用オリジン (localhost:5173 / 127.0.0.1:5173) を許可します
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

---

## 🔥 Firebase の連携手順 (任意)

Google アカウントでサインインすることで、生成画像をあなた専用のクラウド (Firebase Storage & Firestore) に保存できます。Firebase を使用する場合は以下の設定を行ってください。

> **サービスアカウントキーは不要です。** Firebase アクセスはすべてブラウザ上のクライアントが行います。

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
   * `VITE_FIREBASE_API_KEY` が空の場合は Firebase が無効になり、ローカル保存のみになります。
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

---

## ✨ 主な機能

1. **自然言語プロンプト拡張 💫**:
   * 日本語で「ネオンに照らされた雨の渋谷を歩く黒猫」のように入力するだけで、LM Studio の LLM が Stable Diffusion 向けにディテールや照明、アングル情報を含んだハイクオリティな英語プロンプトに拡張してくれます！
2. **詳細パラメータ調整 🎛️**:
   * 画像のサイズ（幅/高さ）、サンプリングステップ数、CFGスケール、ネガティブプロンプトなどをアドバンスドメニューから直感的に操作できます。
3. **Firebase & ローカル ハイブリッド保存 💾**:
   * Google アカウントで**サインイン**すると、画像はあなた専用の Firebase Storage (`users/{uid}/images/`)、メタデータは Firestore (`users/{uid}/generations/`) へ自動保存。リアルタイムで履歴が同期されます。
   * **サインアウト**状態では、サーバー内の `server/outputs` ディレクトリに画像を保存し、`/api/history` で履歴を管理します。
4. **APIコネクションパネル ⚙️**:
   * フロント画面右上のギアアイコンから、LM Studio や Stable Diffusion の接続先URL、使用するモデル名をリアルタイムで書き換え可能です。
