# ADR 55: 画像ダウンロード機能とサーバー側プロキシによる Firebase Storage の CORS 回避

## Context

Sumica は生成した画像を、Firestore/Firebase Storage (signed in) と server local (`server/outputs/`, signed out) に振り分けて保存する構成を採ってきました ([[adr-0001-client-side-firebase-persistence]])。一方、ユーザーが生成画像をローカルディスクに保存する明示的な UI はなく、ブラウザ右クリックの「名前を付けて画像を保存」しか手段がありませんでした。この方法ではファイル名がサーバー側の `generated_<timestamp>.png` や Firebase の `<timestamp>.png` になり、後から日付でソートしたり内容を判別したりしにくい状態が続いていました。

洋一郎さんから「気に入った画像を 1 枚ずつローカルに保存する」用途で明示的なダウンロード機能の追加依頼があり、複数枚一括 ZIP や gallery hover からの直接ダウンロードは今回のスコープ外 (YAGNI) と決まりました。

技術的な制約として、Firebase Storage の tokenized URL (`getDownloadURL()` の返り値) はブラウザから直接 fetch できません。bucket に CORS ヘッダーがデフォルトで設定されていないため、`fetch` / `XMLHttpRequest` / Firebase Storage SDK の `getBlob` すべてがブラウザの CORS policy でブロックされます。これは Firebase 公式 docs が明記する動作 (`https://firebase.google.com/docs/storage/web/download-files#cors_configuration`) であり、実機で `getBlob` を試したところ SDK 内部が XMLHttpRequest を使うことも観測できました。

さらに Sumica の server は当初から Firebase-free (`firebase-admin` を runtime に持たない) 設計であり ([[adr-0001-client-side-firebase-persistence]])、この設計を維持することが望ましい状況でした。

追加のプロジェクト固有事情として、洋一郎さんは gcloud CLI で bucket CORS を手動設定する運用ではなく「code 側で完結する解決」を選好しました。これにより Firebase 公式推奨の bucket CORS 設定案が本 ADR の対象外となりました。

## Decision

私たちは、Lightbox のツールバーに Download ボタンを追加し、次の 2 段構成で画像をローカル保存します。

- **クライアント側**: fetch → Blob → `URL.createObjectURL` → 一時 `<a download>` → click → `URL.revokeObjectURL` の pattern で画像を Blob 化してから保存します。ファイル名は `item.timestamp` (unix ms) から `sumica_YYYYMMDD_HHMMSS.png` を JST (UTC+9) で決定論的に生成します (`utils/download.ts` の pure `formatDownloadFilename`)。timestamp が undefined / 0 / NaN / 負値の場合は `Date.now()` にフォールバックします。
- **サーバー側**: `GET /api/download-proxy?url=<url>` エンドポイントを新設し、`item.storagePath` を持つ record (signed in 時) は必ず Firebase Storage 由来なのでこのプロキシ経由で fetch します。Signed-out の local record は `imageUrl` が `http://localhost:5000/api/outputs/*.png` (server の `CORS_ORIGINS` 設定で許可済み origin) なので直接 fetch します。分岐条件は `item.storagePath` の有無で判定します。

代替案として次を比較検討し、いずれも却下しました。

- **`<a href={imageUrl} download="...">` を anchor.click() する直接方式**: `download` 属性は cross-origin URL に対して大多数のブラウザで silently 無視されるため、Firebase URL でも Vite dev の 5173→5000 の cross-port 転送でもファイル名制御が効かず却下しました。
- **Firebase Storage bucket に CORS 設定を追加 (gcloud CLI で `cors.json` を登録)**: Firebase 公式の推奨方式で最もシンプルですが、洋一郎さんが「code 側で完結させたい」と選択したため却下しました。将来運用が変われば追加可能で、その際は本 ADR の Decision を supersede する形になります。
- **Firebase Storage SDK の `getBlob(ref)` を経由する**: 「SDK 経由なら CORS を bypass できるのでは」と一度実装しましたが、SDK 内部は XMLHttpRequest で HTTP リクエストを発行しており、ブラウザの CORS gate に等しく阻まれることを実機で確認しました。この経路は使えません。
- **`/api/download-proxy` を Sumica server ではなく Firebase Cloud Functions で実装する**: Sumica server は既に client との CORS 設定が済み、tsx watch の dev 環境で稼働しています。新規 Functions のデプロイと監視を追加する方が運用複雑度が高く、同一 server 内で完結させる方がシンプルと判断しました。

`/api/download-proxy` は自身が open web proxy になるリスクを避けるため、次の 2 重の防御を持たせます。

- URL を `new URL()` で parse し、`hostname === 'firebasestorage.googleapis.com'` と `protocol === 'https:'` を**厳格一致**で検証します。素朴な `startsWith('https://firebasestorage.googleapis.com/')` 型の prefix check は、userinfo (`@` trick) や subdomain 名の偽装で回避可能なため採用しません。
- `axios.get(url, { maxRedirects: 0, ... })` でリダイレクトの自動 follow を禁止します。Firebase Storage の tokenized URL は通常 200 で bytes を直接返すため実運用への影響はなく、SSRF-via-redirect (Firebase が 3xx で内部サービスに誘導される仮想シナリオ) を根本的に閉じます。

この 2 段防御は、自動バックグラウンド security review が指摘した MEDIUM level の finding「SSRF via redirect (allowlist bypass)」に基づいて追加したものです。

Firebase の tokenized URL は URL 内の `?token=...` が署名済み短命アクセストークンなので、server 側から追加認証なしで fetch できます。したがってこのプロキシは `firebase-admin` を必要とせず、Sumica の「Firebase-free server」設計を維持します ([[adr-0001-client-side-firebase-persistence]])。

## Status

承認済み

## Consequences

- Lightbox から 1 枚ずつ画像をローカル保存できるようになりました。ファイル名は JST timestamp で人間が読める形式 (`sumica_20260807_101507.png`) になり、ダウンロードフォルダで日付ソートが自然に効くようになりました。
- Signed-in / signed-out どちらのモードでも動作し、preview 画像 (`lightboxMeta` 経由、まだ `displayedHistory` に入っていない fresh generation) もダウンロード可能です。最終レビューで発見された「preview 時に `displayedHistory[-1]` が undefined で silent no-op になる」バグは `lightboxMeta` に切り替えることで解消しました。
- **`/api/download-proxy` は将来同種の「browser CORS に阻まれる upstream からのダウンロード」に再利用できる allowlist 型 proxy primitive** として残ります。現時点では Firebase Storage 専用ですが、hostname 検証を拡張することで他 origin も追加できます。汎用化が必要になった時点で本 ADR を supersede する新 ADR で対応します。
- Server が Firebase Storage の upstream を経由するようになったため、大きな画像 (SDXL Hires.fix 適用時の 5–10MB PNG など) は server memory と bandwidth を通過します。`responseType: 'stream'` で pipe しているため server 側での in-memory buffering はしていませんが、client が接続を途中で切断した場合の upstream cancellation は現状明示的に実装していません。単一ローカルユーザー環境では実害はほぼありませんが、複数ユーザー環境や production 運用に移行する際は再検討が必要です。
- 洋一郎さんが手動で bucket CORS 設定を追加する運用に踏み切った場合は、client の分岐 (`item.storagePath` 有無での proxy 経由/直接 fetch) と server の `/api/download-proxy` を削除して直接 fetch に単純化するリファクタが可能です。将来そちらに舵を切る際は本 ADR の Decision を supersede します。
- テストカバレッジは `formatDownloadFilename` の pure function 部分のみで 5 つの unit test を追加しました (JST 変換、二桁 padding、undefined/0/NaN フォールバック)。DOM 副作用のある `downloadImage` および server の `/api/download-proxy` endpoint は unit test 対象外としました。前者は既存の `utils/thumbnail.ts` (Canvas API 副作用あり、unit test なし) の pattern を踏襲、後者は integration/E2E 領域として将来的な Playwright テスト補強候補になります。
- SSRF-via-redirect 防御 (`maxRedirects: 0`) は Firebase Storage が redirect しない現在の仕様に依存しています。Firebase 側の仕様変更でリダイレクトが必要になった場合、Location ヘッダーを手動で読み hostname を再検証する形に proxy を書き換える必要があります。バックグラウンド security review が指摘した MEDIUM level finding への恒久対応として本 ADR に記録します。
- 実装は spec → plan → subagent-driven execution → final review + fix wave の superpowers Subagent-Driven Development フルサイクルで進めました。spec と plan は `docs/superpowers/{specs,plans}/2026-08-07-image-download*` に残っています。5 task の SDD 実装が終わったあとで実機テストにより Firebase CORS 問題が発覚し、追加で server proxy パターンを導入した経緯が本 ADR の主内容です。
