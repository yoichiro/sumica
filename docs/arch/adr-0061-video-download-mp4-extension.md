# ADR 61: 動画のダウンロード拡張子を mediaType に応じて `.mp4` に切り替える

## Context

Sumica のダウンロード機能は [[adr-0055-image-download-with-server-proxy]] で導入された `formatDownloadFilename(timestamp)` を使い、`sumica_YYYYMMDD_HHMMSS.png` の形式でファイル名を組み立てていました。導入時点では画像しか扱っていなかったため、拡張子は `.png` にハードコードで問題ありませんでした。

その後 [[adr-0058-video-prompt-single-input-with-lm-studio-enhance]] 以降の動画生成関連の一連の対応で、Lightbox や全画面表示から動画レコードも「ダウンロード」ボタンで保存できるようになりました。しかし `formatDownloadFilename` が拡張子を出し分けない実装のままだったため、動画 record（`videoUrl` が実体だが `imageUrl` にも同じ URL が入っている設計）を保存すると `.mp4` のバイト列を持ちながら `.png` の拡張子で保存されるという状態になっていました。macOS も Windows も拡張子で MIME を推測するため、この状態のファイルは「壊れた画像」として認識され、ダブルクリックしてもプレイヤーで開けません。

`imageUrl` が実体でも動画 URL を指しているという事情自体は record の設計として既に定着していたため、fetch 対象を変える必要はなく、拡張子だけをどう切り替えるかが判断点でした。

## Decision

私たちは、`formatDownloadFilename` に第 2 引数 `mediaType: 'image' | 'video'`（デフォルト `'image'`）を追加し、`'video'` のとき `.mp4`、それ以外は `.png` を返すようにします。

具体的な実装として、`client/src/utils/download.ts` の関数シグネチャを `formatDownloadFilename(timestamp: number | undefined, mediaType: 'image' | 'video' = 'image')` に拡張し、末尾の `.png` を `mediaType === 'video' ? 'mp4' : 'png'` に切り替えます。`handleDownload` 側は `item.mediaType === 'video' ? 'video' : 'image'` を渡すだけで、fetch 対象や proxy 経路（[[adr-0055-image-download-with-server-proxy]] の Firebase Storage 用サーバプロキシ）は一切変えません。動画 record の `imageUrl` は既に `.mp4` の URL を保持しているため、URL を経由してバイト列を取ることに変更はなく、ブラウザに渡すファイル名だけが `.mp4` になります。既存のテストにも video / 明示 image の 2 ケースを追加し、default 引数のリグレッションを検知できるようにします。

代替として fetch 対象を record の `videoUrl` に切り替える案もあり得ましたが、record 設計上 `imageUrl` に動画 URL が入っていて download 系のロジックはすべて `imageUrl` に依存していたため、変更範囲を最小に留められる「拡張子だけ切り替える」案を採用しました。

## Status

Accepted

## Consequences

Lightbox・全画面表示のダウンロードボタンで動画をダウンロードすると、正しく `.mp4` で保存され、macOS / Windows どちらのファインダーからでも通常のプレイヤーで再生できるようになりました。他の legacy 動作（画像は `.png`）にはリグレッションがありません。

`formatDownloadFilename` に `mediaType` 引数が加わったことで、今後 audio や gif など別のメディアが増えた場合の拡張ポイントが自然に用意されました。ただし現状では default が `'image'` = `.png` に固定されており、拡張子と実バイト列のミスマッチを型で防ぐ仕組みは入れていません。今後 record に mediaType が付いていない legacy 画像がもし混じった場合には default 動作で問題なく落ちます。

関連 ADR: [[adr-0055-image-download-with-server-proxy]], [[adr-0058-video-prompt-single-input-with-lm-studio-enhance]].
