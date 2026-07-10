# ADR 21: お気に入りレシピランキングを rollup 集計で実装する

## Context

Sumica は生成した画像を [[adr-0001-client-side-firebase-persistence]] に沿って、サインイン時は Firestore、サインアウト時は `server/outputs/` にメタデータごと永続化してきました。各生成には `model` / `sampler` / `scheduler` / `size` / `hires` / `LoRA-set` / `refiner` / `vae` の 8 次元のパラメータが付随し、`updateFavorite` で `isFavorite` フラグがトグルされます。

Firestore 側だけで 1128 枚、うち 212 枚がお気に入り（率 18.8%）に達した時点で、「どのパラメータの組み合わせでお気に入りにマークされる確率が高いか」を可視化できれば、次の生成での意思決定を支援できるという着想が生まれました。実データを `server/scripts/analyze-favorites.ts` で集計したところ、Wilson 下限 35.9%（生 71.4%）を叩き出すレシピが実在し、パラメータ次元の相互作用（同じモデルでもサイズによってお気に入り率が大きく変わる、モデル固有の "得意な Sampler/Scheduler" が存在する）も確認できました。ランキング化は統計的に十分意味のある規模のデータであると分かりました。

ただしこの分析スクリプトはフルスキャン方式で、実行のたびに `collectionGroup('generations')` で全 1128 doc を読み取ります。1128 doc なら 2 秒・Firestore 無料枠内で完結しますが、生成数が 1 万・10 万と増えると読み取り件数がそのまま線形に増え、無料枠を突破するリスクと待ち時間の悪化があります。加えて、集計結果はプロセスメモリ上にしか存在せず、他セッションとリアルタイム同期されず、App 内で「ランキングを見る」たびに再スキャンする素朴実装は現実的ではありません。

一方で、Sumica の設計原則としてサーバーは Firebase 非依存 ([[adr-0001-client-side-firebase-persistence]]) であり、Cloud Functions などバックエンド側のトリガーで rollup を維持する構成は選択肢に入りません。ランキング機能は「クライアント主導 + サインアウト時のみサーバー local JSON」の既存パターンに準拠する必要があります。

## Decision

**materialized view / rollup パターンを採用し、ランキングに必要な 8 次元パラメータの組み合わせを SHA-256 hex で識別する rollup コレクションを新設します。** 具体的な設計は次の通りです。

- **Firestore path**: `users/{uid}/rankingRollups/{sha256Hash}` に、`{ version: 1, params, total, favs, updatedAt }` を持つ doc を積みます。`params` は正規化済み 8 次元の生値を持ち、debug 性を担保します。
- **ローカルパス**: サインアウトモードでは `server/outputs/rankingRollups.json` に同一シェイプのオブジェクト（キー = hash）で保持します。[[adr-0001-client-side-firebase-persistence]] のハイブリッド保存パターンを踏襲する形です。
- **Hash 計算**: `stripHashSuffix(model)` でモデル名を正規化した後、8 次元を決定的な順序で正規化した JSON 表現を SHA-256 でハッシュ化します。LoRA は sort 済み配列にしてから join することで、順序違いで別 doc が作られる問題を避けます。
- **書き込みフロー**: 生成保存・お気に入り toggle・削除のそれぞれに rollup 加減算をペア付けします。Firestore 側は `writeBatch` + `increment()` で generation doc の書き込みと同一トランザクションにまとめ、race condition を封じます。サーバー側は `server/outputs/rankingRollups.json` の read → 差分適用 → temp file + rename の atomic write で耐障害性を確保します。
- **読み込みフロー**: クライアントは Firestore 側では `onSnapshot(users/{uid}/rankingRollups)` でリアルタイム差分購読、サインアウトモードでは `GET /api/ranking-rollups` を fetch し、生成・お気に入り操作・削除の後に refetch trigger を張ります。
- **分析ロジック**: `client/src/utils/rankingAnalysis.ts` のピュア関数として `wilsonLower` と `rankRecipes` を実装します。`total >= 3` でシングルトンを弾き、Wilson 下限で降順ソートして Top 10 を返します。Wilson を選ぶのは、5/7 のような小サンプルの生 rate（71.4%）を信頼度に応じて割り引くためです（例: Wilson 下限は 35.9%）。
- **UI**: `ControlPanel` を「フォーム」タブと「ランキング」タブの 2 タブ構成に変更します。ランキングタブでは各行に Wilson% と favs/total を表示し、「フォームに適用」ボタンで対応するレシピを form state に流し込みます。
- **バックフィル**: `server/scripts/backfill-ranking-rollups.ts`（Firestore 用）と `server/scripts/backfill-local-ranking-rollups.ts`（ローカル用）を 1 回きり実行して既存 1128 doc 分の rollup を初期化します。冪等で、途中失敗しても再実行で必ず整合状態に収束します。
- **Firestore セキュリティルール**: `rankingRollups` サブコレクションに `users/{uid}` オーナーだけが read/write できるルールを追加します。

代替案として次を比較検討し、いずれも却下しました。

- **フルスキャン + 24h キャッシュ**: 実装は最も簡単ですが、初回リード時間が悪化し続けます。1 万・10 万生成にスケールすると 10 秒・100 秒の初期化待ちが発生し、キャッシュが古い時のリアルタイム性も損なわれます。ユーザーが「他の Chrome セッションでお気に入り toggle した結果を即反映してほしい」と期待するなら `onSnapshot` のリアルタイム性が必要で、キャッシュ方式ではこれが満たせません。
- **Cloud Functions で rollup を自動維持**: サーバーレスバックエンドで書き込みトリガーを張れば実装は堅牢ですが、[[adr-0001-client-side-firebase-persistence]] の「サーバー Firebase-free」原則に反します。クライアント側で `writeBatch` + `increment()` を使えば同等の原子性が得られるため、Cloud Functions を導入する追加インフラコストは正当化できません。
- **決定的な文字列キー**（例: `v1:model|sampler|scheduler|size|hr|loras|refiner|vae`）: Firestore コンソールで人が読めるという debug 性の利点はありましたが、モデル名や LoRA 名を含めるとキー長が可変で、doc ID の上限 1500 bytes に接近する可能性があります。SHA-256 hex なら常に 64 char 固定で、debug 性は doc 内の `params` フィールドで担保できるため、hex を採用しました。
- **バックフィルを App 起動時に自動実行**: ユーザーが最初にアプリを開いたときに rollup が空なら自動でフルスキャン → 書き込み、というオンデマンド migration も検討しましたが、失敗時の rollback が複雑になり、バグの発見が遅れやすいため、明示的な CLI スクリプトによる one-off 実行を選びました。

## Status

承認済み

## Consequences

- **ランキング分析のリード数が O(unique combinations) に定数化**しました。現状 1128 生成に対して rollup doc は 456 個。生成数が 10 倍・100 倍になっても、rollup doc 数は「ユーザーが実際に試すレシピ組み合わせの数」でキャップされるため、Firestore の無料枠内で運用しやすくなります。
- **App 内でリアルタイムランキング表示が実現**しました。`onSnapshot` によって、他の Chrome セッションで別画像をお気に入り追加すると数秒以内に「フォームに適用」候補の順位が入れ替わります。
- **書き込み量が 2 倍**になります。各生成・お気に入り toggle・削除で generation 側の doc と rollup 側の doc の両方を書き換える必要があります。Firestore の write 単価は read の約 3 倍ですが、write は low-frequency イベントで、read は分析のたびに大量に発生する非対称性を考えると、トータルコストは大幅に減ります。
- **Firestore `writeBatch` の同一トランザクション保証**により、rollup と generation の間に部分的な失敗による不整合は発生しにくくなりました。ただし絶対安全ではなく、万一 rollup がずれた場合はバックフィルスクリプトの再実行で 0 から整合状態を再構築できます（冪等）。
- **hash 形式を SHA-256 に固定した副作用として、Firestore コンソールから rollup の中身をキーで探すのはほぼ不可能**になりました。ただし `params` フィールドを見ればどのレシピか判別できます。開発時にコンソール上でも読みたい場合は、`stripHashSuffix` 済みの model 名などで doc 内容を検索する運用になります。
- **将来 9 次元目のパラメータを追加したくなった場合**、`version: 1` フィールドを `version: 2` に上げて `backfill-ranking-rollups.ts` を再実行する形の schema migration が可能な設計にしてあります。新旧 rollup が混在すると Wilson が崩れるため、必ず全 rollup を version 2 で再構築する運用になります。
- **`ControlPanel` にタブ UI を導入した**副作用として、既存の「フォーム」表示は 1 タブ分だけ縦のスペースが削られました。実装後の UI 調整（`f7988a2` / `205eff6` / `356b6c3`）でモバイル・狭幅ビューでも実用性を保っています。将来的にタブが 3 つ以上になる場合は再度のスペース割り当ての見直しが発生します。
- **ローカルモード（サインアウト）で rollup を維持するために、`server/index.ts` にファイル I/O ヘルパーが追加**されました。metadata.json と rollupRollups.json の両方を atomic write でメンテすることになり、サーバー側の状態管理は少し複雑化しています。バックフィルスクリプトを local mode でも再実行可能な形にしたことで、ずれた場合の recovery パスは確保しています。
