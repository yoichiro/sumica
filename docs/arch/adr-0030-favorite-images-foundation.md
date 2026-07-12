# ADR 30: お気に入り画像機能の永続化と UI 設計

## Context

生成した画像を「お気に入り」としてマークする機能は、ユーザーの主要ユースケースから自然発生的に要求されました。何百枚も生成した中から「これは残したい・後で見返したい」と思う 1 割 2 割を、日付フィルタ ([[adr-0018-gallery-caption-static-display]] 界隈) をまたいで参照できる仕組みが欲しい、というニーズです。

設計選択の候補には次のものがありました。

- **UI の位置**: 3 タブ構成にして「フォーム / ランキング / お気に入り」を並列に置くか、既存の履歴ギャラリー内に「⭐ お気に入りのみ」トグルサブフィルタを置くか
- **日付フィルタとの関係**: お気に入り絞り込みと日付絞り込みを AND で併用するか、お気に入り時は日付を一時無効化して全期間表示するか
- **永続化**: サインイン (Firestore) では generation doc に `isFavorite` フラグを立てるだけか、専用サブコレクションに切り出すか
- **クエリ**: `where('isFavorite','==',true) + orderBy('timestamp')` に必要な composite index を張るか、client 側で全読み後にフィルタするか
- **サインアウト時**: サーバー local の `metadata.json` にフラグを持たせるか、別ファイルにするか
- **UI 応答性**: 楽観的更新 (optimistic UI update) + 失敗時ロールバックか、pessimistic に完了を待ってから UI 反映するか

Firestore 側は「1 世代 doc に単純にフラグを立てる」方式が最も自然でしたが、`where('isFavorite','==',true) + orderBy('timestamp')` は composite index が必要で、事前デプロイが必要になります。デプロイ運用が発生することで、初回セットアップの手順が 1 個増える副作用があります。

ライトボックス中に別画像をお気に入り追加/解除した場合、`displayedHistory` の中身が変わって現在表示中の画像がリストから外れる可能性があります (`favoritesOnly` トグル ON で今の画像が解除されると displayedHistory に無くなる)。何のケアもしないとライトボックスが空になってエラー状態に陥ります。

## Decision

**履歴ギャラリー内の「⭐ お気に入りのみ」トグルサブフィルタを採用し、ON 時は日付フィルタを一時無効化して全期間表示します。Firestore は generation doc に `isFavorite` フラグ + 専用 composite index + subscribeFavorites の別購読、サインアウト時は `POST /api/generations/favorite` へフォールバック、両モードとも楽観的 UI 更新 + 失敗時ロールバックにします。** 具体的な設計は次の通りです。

- **UI 配置**: 履歴ギャラリーツールバーに ⭐ トグルボタンを置きます。3 タブ並列は捨てました（既存の日付フィルタ・選択・削除フローを大きく変えずに済むため）。
- **日付フィルタの一時無効化**: `favoritesOnly === true` のときは `filterDate` に基づく `where('timestamp', >=/<=, dayBounds)` の range 制約を外し、`isFavorite === true` の全期間 doc を購読します。両フィルタを AND 併用する案は却下（お気に入りは「時間軸を跨いで見返す」ためのものなので、日付制約は本質的に不要）。
- **Firestore の実装**: 生成 doc の `isFavorite` フラグを toggle します。お気に入り一覧購読は `subscribeFavorites` として `where('isFavorite','==',true) + orderBy('timestamp','desc')` の onSnapshot、既存の日付範囲購読とは独立した subscription にします。この 2 系統は `favoritesOnly` の値によって片方だけが active になります。
- **Composite index**: `firestore.indexes.json` に `collection: generations, fields: [isFavorite ASC, timestamp DESC]` を追加してデプロイします。初回セットアップに 1 手順増える代わりに、client 側全読み → フィルタというコスト増を避けられます。
- **サインアウト時**: `POST /api/generations/favorite` エンドポイントで `metadata.json` の該当 entry の `isFavorite` を書き換えます。ファイル書き込みは atomic (temp file + rename) にします。
- **楽観的 UI 更新**: ⭐ トグルクリック → 即 UI 反映（`setHistory` を optimistic に更新）→ Firestore/server 呼び出し → 成功時は何もしない、失敗時は元の状態にロールバック + トースト通知、というフローにします。ネットワーク遅延がユーザーに見えなくなり、体感が大きく改善します。
- **ライトボックスの回復ロジック**: `displayedHistory` から現在表示中の画像が消えた場合、同じインデックス位置の次画像に自動送りします。末尾なら 1 つ手前に送り、それでも空なら閉じます。

代替案として次を比較検討し、いずれも却下しました。

- **3 タブ並列 (フォーム / ランキング / お気に入り)**: タブが増えて form の縦スペースが削られ、既存 UI 全体の一貫性が損なわれます ([[adr-0021-favorite-recipe-rollup-ranking]] の 2 タブ拡張の議論参照)。既存ギャラリー内のサブフィルタで済む機能に対しては、タブ増加はやりすぎと判断しました。
- **お気に入りと日付フィルタの AND 併用**: 「今日お気に入りにした画像だけ」を見たいユースケースは稀で、「お気に入りは時間を跨いで振り返る」が本来の意図。AND だと ⭐ を押しても大半のケースで空表示になり、ユーザー体験を壊します。
- **専用サブコレクション**: `users/{uid}/favorites/{id}` のような別コレクションに doc を複製する案です。書き込みが 2 箇所になり、整合性を [[adr-0021-favorite-recipe-rollup-ranking]] の rollup と同じく `writeBatch` で守る複雑さが発生します。単純にフラグを立てる案が最もシンプルで、既存の `writeBatch` オペレーションに 1 フィールド追加するだけで済みます。
- **client 側全読み → フィルタ**: 初回セットアップに index デプロイ手順を追加せずに済みますが、生成数が増えるにつれて全 doc 読み取りコスト（Firestore の read 課金）が増え続けます。生成が 1 万件超えたときに顕在化する潜在コストを、composite index という 1 手順で予防しました。
- **pessimistic UI**: ⭐ クリック → 完了待ち → UI 反映。安全ですが、Firestore の write 遅延（数百 ms）がユーザーに見え、体感が鈍くなります。失敗率は極めて低いため楽観的で問題ないと判断しました。

## Status

承認済み

## Consequences

- **お気に入りフローが 1 クリックで完結**します。⭐ トグルの応答は即座で、Firestore 同期は裏で走ります。失敗時はロールバック + トースト通知で状態が正しく戻ります。
- **[[adr-0021-favorite-recipe-rollup-ranking]] と [[adr-0024-ranking-recipe-full-form-restore]] の基盤**として本 ADR が働いています。これらの ADR は「`isFavorite` フラグと `writeBatch` で rollup を維持する」ことを既存前提として書かれていますが、その前提はこの ADR で確立されています。
- **Composite index のデプロイ手順が 1 個増えました**。初回セットアップで `firebase deploy --only firestore:indexes` を実行し忘れると、お気に入り購読が失敗します。エラーは `subscribeFavorites` からトーストで表示されるので、気づけないケースは無いです。
- **ライトボックスの回復ロジック**により、⭐ で解除した瞬間に自動で次画像に送られる挙動が実現しました。ユーザーは「解除したら次を見る」フローで連続作業でき、いちいち閉じて開き直す必要がありません。
- **サブコレクションを分けなかったことで、rollup ([[adr-0021-favorite-recipe-rollup-ranking]]) との `writeBatch` が 1 トランザクションで済む**ようになりました。generation doc と rollup doc の同時更新に加えて、`isFavorite` toggle だけを別トランザクションにする必要が無く、race condition の余地が減っています。
- **サインアウト時の `metadata.json` は単一ファイル**なので、複数プロセスから同時書き込みするとレースの可能性があります。Sumica は単一ローカルユーザー想定なので実運用では発生しませんが、将来複数プロセスが `metadata.json` を書く可能性が出てきたら、file locking が必要になります。
