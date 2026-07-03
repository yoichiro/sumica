# ADR 1: サーバーをFirebase非依存にし、永続化をクライアント側Firebaseとローカルフォールバックに分離する

## Context

ユーザーがGoogleでサインインした場合に、生成した画像とそのメタデータをどこに永続化するかを決める必要がありました。初期の実装ではサーバー側で`firebase-admin`を使ってFirestore/Storageへの書き込みを行っており、この方式ではサーバーの起動そのものにFirebaseのサービスアカウントキー（秘密鍵）が必須になっていました。これはローカル環境でのセットアップの手軽さを損なうものでした。

洋一郎さんはこの変更を検討するにあたり、Pros/Consの整理を明示的に依頼し、比較検討したうえで意思決定を行いました。

## Decision

サーバーからFirebase関連の処理を完全に取り除き、サインイン時の永続化をクライアント（ブラウザ）側に一本化します。

- クライアントはFirebase Authによる Googleサインイン、Firebase Storageへの画像アップロード（`users/{uid}/images/…`）、Firestoreへのメタデータ書き込み（`users/{uid}/generations/{id}`）を直接行います。
- サーバーはサインイン状態を意識せず、`/api/generate`に`clientPersist: true`が渡された場合は画像を保存せずbase64のまま返却するだけの役割に徹します。
- サインアウト時は従来通りサーバーが`server/outputs/`にローカル保存し、`metadata.json`で管理します。

この結果、Expressサーバーの実行時には`firebase-admin`のインストールもサービスアカウントキーも不要になり、`npm run dev`がFirebaseの設定なしで動作するようになりました。

## Status

承認済み

## Consequences

- サーバーは完全にFirebase非依存で起動できるようになり、ローカル開発・デプロイが単純化しました。
- 永続化ロジックが認証状態によって「クライアントFirebase」と「サーバーローカル」の2系統に分かれ、両方のパスを意識した実装・検証が必要になりました。
- 後にサムネイル生成（[[adr-0007-gallery-thumbnail-strategy]]）やクラウド側の遡及処理で`firebase-admin`を使うワンオフスクリプト（`server/scripts/`配下）が必要になった際も、これらはdevDependency止まりとしランタイムには一切ロードしない、という境界線がこの決定によって明確になりました。
