# ADR 47: ギャラリー削除フローをクライアント/サーバーで分担する

## Context

履歴ギャラリーで画像を選択して一括削除するフローを追加する必要が生じました。永続化は [[adr-0001-client-side-firebase-persistence]] に基づき 2 系統に分かれています。

- **サインイン時**: 画像本体は Firebase Storage、メタデータは Firestore
- **サインアウト時** (ローカルモード): 画像は `server/outputs/*.png`、メタデータは `server/outputs/metadata.json`

削除ロジックの配置には次の 2 通りが考えられました。

- (A) 全ての削除を `POST /api/generations/delete` エンドポイントに一元化し、Firebase 側の削除もサーバーが `firebase-admin` 経由で実施する
- (B) Firebase パスはクライアント側で SDK を叩き、ローカルパスは `POST /api/generations/delete` でサーバー処理を行う (2 経路)

## Decision

私たちは (B) を採用します。削除フローをクライアント/サーバーで分担します。

- **サインイン時**: クライアントが Firestore の doc.delete() と Storage の object.delete() を Firebase SDK で直接実行します。サーバーは経由しません。
- **サインアウト時** (ローカルモード): クライアントが `POST /api/generations/delete` に `{ ids: [...] }` を送信し、サーバーが対応する画像 PNG、サムネイル WebP、`metadata.json` のエントリを削除します。

(A) を却下した主な理由は次の通りです。第一に、サーバーに `firebase-admin` を組み込むことになり、[[adr-0001-client-side-firebase-persistence]] で定めた「サーバーは Firebase 非依存」の原則に反します。ADR-1 では、サーバー起動に `firebase-key.json` のようなサービスアカウント資格情報を要求しないことを明示的な設計として選んでおり、この判断を維持する価値の方が、削除処理の一元化による構造の対称性より重要と判断しました。第二に、Firebase SDK はクライアント側での認証済みユーザーのみが自身のリソースを削除できる Rules を強制できるため、サーバー中継より原理的に安全です。

## Status

承認済み

## Consequences

- CLAUDE.md でも「When signed in, deletion is handled client-side via Firebase SDK calls, not this endpoint」と明記され、後続の削除機能追加でも常に前提となっています。
- 副作用として、削除フローがクライアント/サーバーの 2 経路に分かれるため、削除ロジックの重複 (Firestore SDK 呼び出しとローカルエンドポイント呼び出し) がクライアント側に発生します。ただし [[adr-0001-client-side-firebase-persistence]] の設計原則との整合を優先しました。
- `POST /api/generations/delete` はローカルモード専用のエンドポイントであり、Firebase モードでは呼び出されません。CLAUDE.md でも「local-only」と明記されています。
- この分担は後続の関連機能でも維持されました。[[adr-0019-gallery-shift-click-range-selection]] の Shift+クリック範囲選択、[[adr-0034-gallery-d-key-delete-shortcut]] の D キーショートカット、[[adr-0033-lightbox-eye-button-open-in-preview]] からのプレビュー削除、いずれも同じ 2 経路構造を使う `requestDelete(ids)` 関数を呼び出す形で実装されています ([[adr-0050-main-preview-toolbar-and-load-into-form]] で汎用化)。
- サーバー側 `POST /api/generations/delete` は idempotent で、既に存在しない ids を送っても静かにスキップします。この振る舞いにより、削除中の他タブ操作や部分失敗からのリトライで問題が発生しません。
