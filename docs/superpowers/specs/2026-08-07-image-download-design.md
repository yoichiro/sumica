# 画像ダウンロード機能 設計書

## 背景

Sumica は現在、生成した画像をブラウザ上でギャラリー / ライトボックスに表示できますが、**ユーザーがローカルディスクに保存する明示的な機能はありません**。ブラウザの標準機能 (右クリック → 「名前を付けて画像を保存」) は使えますが、ファイル名がサーバー側のもの (`generated_1784877972184.png` や `<timestamp>.png`) になるため、後から見返した時にいつ生成したものか一目で判断しづらい状態です。

洋一郎さんから「画像のダウンロード機能を追加したい」というリクエストがありました。運用パターンは「気に入った画像を 1 枚ずつローカルに保存する」で、複数枚一括ダウンロード (ZIP) や Gallery からの直接ダウンロードは今回のスコープに含めません (YAGNI)。

## スコープ

- **含む**:
  - ライトボックス (`components/Lightbox.tsx`) のツールバーに Download アイコンボタンを追加
  - fetch → Blob → objectURL 方式で cross-origin の Firebase Storage URL / same-origin の local `/api/outputs/*` の両方を扱う
  - `sumica_YYYYMMDD_HHMMSS.png` 形式 (JST) でファイル名を付与
  - 成功 / 失敗を既存の Toast システムで通知
  - 純粋関数 (`formatDownloadFilename`) の unit test

- **含まない** (別 spec とする候補):
  - ギャラリータイルからの直接ダウンロード (Lightbox を開かずに保存)
  - 複数選択 + 一括 ZIP ダウンロード
  - キーボードショートカット (D キーなど) — 必要になったら追加
  - PNG 以外の形式 (WebP サムネイル、JPEG 変換など)
  - PNG に埋め込まれた SD info metadata の抽出 / 別ファイル書き出し

## ブレスト決定事項サマリ

- **エントリーポイント**: ライトボックスのツールバー内に Download ボタンを追加 (`Info` の隣を想定、既存の toolbar パターンに合わせる)
- **ファイル名形式**: `sumica_YYYYMMDD_HHMMSS.png` (JST ローカル時刻)
- **ダウンロード方式**: fetch → Blob → objectURL → 一時 `<a download>` 要素の click → revokeObjectURL (cross-origin にも同一 origin にも動作)
- **フィードバック**: 既存の `ToastContainer` で成功 / 失敗を表示
- **不採用案**:
  - `<a href={imageUrl} download="...">` 直接: cross-origin では `download` 属性が無視される
  - `/api/download?url=xxx` server-side proxy: Sumica の server は Firebase-free 設計 (CLAUDE.md) を維持したい、Firebase Admin SDK 追加は過剰

## 設計

### アーキテクチャ概要

新規ファイル 2 個 + 既存ファイル 4 個を触ります。純粋なファイル名生成ロジックを `utils/download.ts` に切り出して単体テストを書きやすくします。DOM 副作用を含む `downloadImage` 関数は同じファイル内に置きますが、こちらは jsdom で全 API を mock するとテストが実装のミラーになるだけなので単体テスト対象外とします (既存の `utils/thumbnail.ts` と同じ方針)。

| ファイル | 種別 | 責務 |
|---|---|---|
| `client/src/utils/download.ts` | 新規 | `formatDownloadFilename(timestamp)` (pure) + `downloadImage(url, filename)` (DOM 副作用あり) |
| `client/src/utils/download.test.ts` | 新規 | `formatDownloadFilename` の unit test |
| `client/src/App.tsx` | 変更 | `handleDownload(item)` handler を追加し Lightbox に prop で渡す |
| `client/src/components/Lightbox.tsx` | 変更 | `Download` アイコンボタンを toolbar に追加、`onDownload` prop を受け取る |
| `client/src/i18n/ja.ts` / `en.ts` | 変更 | tooltip / toast text の i18n キー追加 |

### `utils/download.ts` の API

```typescript
// Pure: unix ms timestamp を「sumica_YYYYMMDD_HHMMSS.png」形式に変換する。
// タイムゾーンは JST 前提 (Date.getFullYear() 等の local time API を使う)。
// timestamp が 0 / undefined / NaN の場合は Date.now() を fallback として使う。
export function formatDownloadFilename(timestamp: number | undefined): string;

// DOM 副作用: fetch で Blob を取得、一時 <a> を作って click、objectURL を revoke する。
// エラー時は throw (呼び出し側で catch して toast dispatch)。
export async function downloadImage(url: string, filename: string): Promise<void>;
```

### データフロー

1. User が Lightbox の Download ボタンをクリック
2. `Lightbox.onDownload()` prop が発火 → App.tsx の `handleDownload(item: GenerationRecord | LocalHistoryItem)`
3. `handleDownload` が `downloadImage(item.imageUrl, formatDownloadFilename(item.timestamp))` を呼ぶ
4. `downloadImage`:
   1. `fetch(url)` で ArrayBuffer 相当を取得
   2. `res.blob()` で Blob 化
   3. `URL.createObjectURL(blob)` で local objectURL 生成
   4. 一時 `<a>` 要素を作って `href` + `download=filename` セット、`document.body.appendChild()` → `a.click()` → `a.remove()`
   5. `URL.revokeObjectURL(url)` でメモリ解放 (`finally` に置く)
5. 成功 → `addToast(t.toast.imageDownloaded, 'success')`
6. 失敗 → `addToast(t.toast.imageDownloadFailed, 'error')`

### ライトボックス UI 変更

`Lightbox.tsx` の toolbar (現状: Info / 選択 / Star / Preview / Slideshow / Random / Fullscreen / Close) の中に **Download ボタンを Info の右隣に追加**します。既存の button スタイル (半透明の丸ボタン、22px アイコン) を踏襲し、`lucide-react` の `Download` アイコンを使用します。

Props に `onDownload: () => void` を追加、App.tsx から `() => handleDownload(currentItem)` を渡す形にします。selected mode やお気に入り mode とは独立で、常時有効です。

### 失敗時のハンドリング

- **network / CORS / 404 / 5xx**: `fetch` が reject or `res.ok === false` になる。呼び出し側で `try/catch`、error message を toast に表示。
- **Blob 変換失敗**: 同じく try/catch。
- **timestamp 欠損** (legacy record や外部インポート): `formatDownloadFilename` 内で `Date.now()` に fallback。ファイル名は生成できるので downstream には影響しない。
- **メモリリーク防止**: `URL.revokeObjectURL()` を必ず `finally` で呼ぶ。

### テスト

- **`formatDownloadFilename`** (pure): 以下のケースを `download.test.ts` で網羅
  - 既知の unix ms (例: `2026-08-07 17:05:01 JST` の timestamp) から `sumica_20260807_170501.png` を生成できる
  - 二桁 0-padding が効いている (`sumica_20260107_090501.png` のような 1 月 / 7 日 / 9 時 のケース)
  - `undefined` → `Date.now()` fallback (Date.now を mock して deterministic に)
  - `0` → `Date.now()` fallback
  - `NaN` → `Date.now()` fallback

- **`downloadImage`** (DOM 副作用): **単体テストは書かない**。理由は `fetch`, `URL.createObjectURL`, `HTMLAnchorElement.click()`, `URL.revokeObjectURL` すべてを jsdom で mock する必要があり、テストが実装のミラーになるだけで挙動保証にならないため。既存の `utils/thumbnail.ts` (Canvas API を扱う) も同じ理由で unit test は書かれていません。

- **Lightbox / App の統合テスト**: **書かない**。既存の Lightbox 関連テスト (`lightboxKeyboard.test.ts` など) は key → action の pure resolver だけをテストしており、UI 表示や onClick handler は unit test の対象外という方針が既に確立されています。今回もこの方針に従います。

### i18n 追加キー

`ja.ts` / `en.ts` の 2 ファイルに以下を追加:

```typescript
// controlPanel / lightbox の section 下に追加
lightbox: {
  // ... 既存のキー ...
  downloadTooltip: '画像をダウンロード', // en: 'Download image'
},
toast: {
  // ... 既存のキー ...
  imageDownloaded: 'ダウンロードしました', // en: 'Image downloaded'
  imageDownloadFailed: 'ダウンロードに失敗しました', // en: 'Download failed'
},
```

### CORS の考察

- **Firebase Storage の tokenized URL** (`https://firebasestorage.googleapis.com/v0/b/...?alt=media&token=...`): Firebase の公式挙動として `getDownloadURL()` で生成された URL は CORS ヘッダー付きで返され、fetch 可能。tokenized URL は署名済みなので追加の Auth も不要。
- **Local mode の `/api/outputs/*`**: Express の `express.static(outputsDir)` で serve され、`http://<hostname>:5000/api/outputs/...` として返される。client は同じ `hostname` (`window.location.hostname`) の 5000 port を叩くため、CORS (5173 → 5000) を server の `CORS_ORIGINS` で許可済み。fetch も blob 化も問題なく動作。

### 実装完了の判定基準

- Lightbox に Download ボタンが表示され、クリックすると画像が `sumica_YYYYMMDD_HHMMSS.png` としてダウンロードフォルダに保存される
- Firebase mode (signed in) / local mode (signed out) の両方で動作する
- ダウンロード成功時に Toast で通知が出る
- ネットワークエラー等の失敗時に error Toast が出る
- `formatDownloadFilename` の unit test が全 pass する
- 既存の 167 tests が全 pass のまま (回帰なし)
- server tsc / client tsc + build / oxlint が clean

## 影響を受けないこと

- server コード (`server/index.ts`) — 変更なし。既存の `/api/outputs/*` static serve をそのまま使う
- Firestore / local metadata のスキーマ — 変更なし。`item.imageUrl` と `item.timestamp` を読むだけ
- 既存の Delete / Favorite / Preview / Select / Slideshow の各機能 — 変更なし
