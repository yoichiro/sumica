# ADR 57: プレビュー起点の Lightbox を displayedHistory の fallback から切り離す

## Context

Sumica の Lightbox は 2 種類の起点から開きます。ひとつはギャラリーカードのクリックで、この場合は displayedHistory の中の該当 item を軸に、前後キーで隣の item に advance できるビューになります。もうひとつはメインプレビューに表示中の画像 / 動画のクリックで、この場合は displayedHistory とは独立に、currentGeneration そのものを拡大表示することを意図しています。両者は `morphSourceKey` で区別され、プレビュー起点は `'__preview__'` という特別値を持ちます。

App.tsx にはもともと、Lightbox で表示中の item が何らかの理由（お気に入り解除、日付変更、削除など）で displayedHistory から消えたときに、`prevLightboxIndexRef.current` に近い隣接 item に自動 advance する fallback effect が存在していました。この effect は Lightbox が「常に displayedHistory の中の何かを指している」と前提していました。

プレビュー起点の Lightbox が導入された後、この前提が破綻するケースが実運用で観測されました。具体的には次の 4 ステップで再現します。第一に動画を Lightbox で表示、第二に「メインプレビューに反映」で動画をプレビューに送り、第三に「元画像を表示」で親画像をプレビューに置き換え、第四にプレビュー画像をクリックして Lightbox を再度開こうとする、という手順です。この時点でギャラリータブは動画一覧のまま、`displayedHistory` は動画レコードのみを含み、開こうとしている親画像は displayedHistory の中に居ません。プレビュー起点の openLightbox が正しく `lightboxUrl` と `morphSourceKey` を設定した直後に、この fallback effect が「displayedHistory に居ない = 隣に advance すべき」と誤判定し、`prevLightboxIndexRef` の隣接動画を選んで `setLightboxUrl` / `setMorphSourceKey` を上書きしてしまいます。結果として、期待は「親画像の image を Lightbox で表示」でしたが、実際は「隣接する動画が Lightbox で再生される」という予測不可能な挙動になっていました。

## Decision

私たちは、プレビュー起点の Lightbox は displayedHistory から意図的に分離するという事実をコード上で明示します。`useEffect` の fallback で、`morphSourceKey === '__preview__'` の場合は他の条件を評価する前に即座に return し、prevLightboxIndex による自動 advance を発動させません。deps 配列にも `morphSourceKey` を加え、プレビュー判定の変化に対して effect が再評価されるようにします。

併せて、`openInPreview`（Lightbox 内「メインプレビューに反映」ボタン、および `handleOpenParentImage` から呼ばれるプレビュー切替）の末尾で `setLightboxUrl(null)` と `setMorphSourceKey(null)` を明示的に呼び、プレビューに切り替わる際に Lightbox を確実にクリアしておきます。これによって、次回 preview 起点で開かれる Lightbox は、前回の gallery 起点の state を残留させることなく clean な initial state から起動します。

代替として、当初は「preload の onerror が遅延して古い state を書き込むレース」を疑って世代カウンタ（openLightboxSeqRef）を導入する案を試しました。しかし console.log で trace した結果、書き込み源は preload callback ではなく fallback effect であることが判明したため、この case では過剰設計とみなして revert しました。もうひとつ「fallback effect のロジック全体を Lightbox 内部に閉じて displayedHistory を渡さない」案もありましたが、gallery 起点の advance 機能を残したいため却下しています。

## Status

Accepted

## Consequences

プレビューから開いた Lightbox は、ギャラリータブの mediaType や日付フィルターの状態と完全に独立して表示されるようになりました。動画タブに滞在中でもプレビューの親画像は image として正しく Lightbox に出ます。ギャラリー起点の Lightbox が displayedHistory に依存する挙動（前後キーによる advance、fallback による自動退避）はそのまま維持されます。

トレードオフとして、プレビュー起点の Lightbox は隣接 item への advance ができません。これは元々「プレビューは currentGeneration ひとつだけを扱う」設計だったので、意図した挙動として許容しました。

副産物として `openInPreview` から明示的に Lightbox をクリアするようになったため、「メインプレビューに反映」ボタンで Lightbox が閉じるという副次的な UX 改善も得られています。以前は closeLightbox が別途呼ばれない限り Lightbox が居座り続けるケースがありましたが、新しいフローでは openInPreview 一発でプレビュー切替と Lightbox 閉じが同時に完了します。

関連 ADR: [[adr-0048-lightbox-overlay-foundation]], [[adr-0050-main-preview-toolbar-and-load-into-form]], [[adr-0051-image-click-opens-lightbox]].
