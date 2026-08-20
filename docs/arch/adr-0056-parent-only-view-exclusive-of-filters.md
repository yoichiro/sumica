# ADR 56: 「この画像の子動画のみ」フィルターを他のフィルターと排他化する

## Context

ギャラリーの動画タブには「この画像の子動画のみ」フィルター（`galleryFilters.parentId`）があり、Lightbox やプレビューの「動画を表示」ボタンから起動されて、その画像を親とする動画だけを表示するモードとして機能します。

このフィルターは以前、他のギャラリーフィルターと共存する形で実装されていましたが、複数の実害が観測されていました。日付フィルターが有効なままだと、その日以外に生成された子動画が「本人からは見えているはずなのに表示されない」状態になり、ユーザーからは「動画を表示」ボタンが壊れているように見えます。アーキテクチャ・モデル・アスペクト比などの詳細フィルターが残っていた場合も、意図しない絞り込みが起きうる状態でした。Firestore の subscription 側も `subscribeGenerations` が `filterDate` を伴って日単位で購読されているため、その日以外の子動画は subscribe そのものに含まれず、クライアント側でどう filter を書き換えても表示できないという二重の壁がありました。

ユーザーが「動画を表示」で意図するのは常に「この画像の子動画を **全部** 見たい」であり、他フィルターとの組み合わせが意味的に成立する状況は事実上ありません。

## Decision

私たちは、`galleryFilters.parentId` が非 null である間は他のすべての絞り込みを排他的に停止する、単一モードのビューとして扱います。具体的には次の五つを同時に実施します。第一に、`handleOpenChildVideos` の中で `galleryFilters` の `arch` / `model` / `sampler` / `aspectRatio` / `orientation` を null にリセットし、`favoritesOnly` を false に落とします。第二に、`filterDate` については state を残しますが、`baseScopedHistory` の計算で先頭で `if (galleryFilters.parentId) return history;` として bypass し、日付での絞り込みを適用しません。第三に、履歴 subscription の `useEffect` で `subscribeGenerations` に渡す date 引数を `galleryFilters.parentId ? null : (filterDate || null)` として、全期間を購読対象に切り替えます。第四に、`HistoryGallery` 側で `parentIdActive = !!galleryFilters.parentId` を計算し、`GalleryFilterToggleButton` / 日付 input / お気に入り toggle を disabled にしたうえで opacity 0.4 にドロップします。第五に、既にフィルターパネルが開いていた場合は useEffect でパネルを閉じ、ユーザーが disabled なトグルの背後に立ち往生した状態を残さないようにします。

代替として「state はそのまま保持し、`applyGalleryFilters` 側で parentId 優先の分岐を書く」案も検討しましたが、UI 側では disabled にしなければ結局ユーザーを混乱させる一方、state の中に生きた filter 値が残り続けるとリセット時にどこまで戻すかの規約がぶれるため、素直に state をリセットするほうが読みやすいと判断して却下しました。

## Status

Accepted

## Consequences

「動画を表示」ボタンは常に予測可能な結果、すなわち親画像の全子動画を返すようになり、日付フィルターや詳細フィルターの残留に悩まされることがなくなりました。UI 側でも「なぜ 3 つあるはずの子動画が 1 つしか表示されないのか」といった錯覚が発生しなくなっています。

一方で、Firestore subscription が parentId アクティブ中は全期間対象になるため、非常に大量の履歴を持つプロジェクトでは初回ロードのデータ量が増える可能性があります。現状の Sumica のスケール（単独ユーザーの生成物）では実害は観測されていませんが、将来ユーザーごとの履歴サイズが数万件を超えるようになった場合は、`where('parentId', '==', ...)` を持つ専用サブスクリプションに切り替えて必要最小限だけ購読する構成に置き換える余地があります。

Chip「🖼️ この画像の子動画のみ ✕」をユーザーが解除すると、リセット済みの他フィルターは復元されず default に戻ります。これは「parent-only モードから抜けたら通常の閲覧に戻る」ことを意図した挙動で、元のフィルター状態に戻したい場合はユーザーが明示的に再選択します。

関連 ADR: [[adr-0007-gallery-thumbnail-strategy]], [[adr-0018-gallery-caption-static-display]].
