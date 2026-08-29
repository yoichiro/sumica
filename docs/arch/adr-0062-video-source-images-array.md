# ADR 62: 動画生成の元画像を配列化し N×M バッチ展開に統合する

## Context

Sumica の動画生成フォームは、当初「Lightbox の🎬 動画にする」ボタンで選んだ 1 枚の画像を元画像として保持する `videoSourceImage: GenerationData | null` の単一値スタイルで設計されていました。単発生成でも [[adr-0059-video-batch-count-only]] のバッチ生成でも、参照する元画像は常にこの 1 枚だけです。

一方で動画生成は 1 本あたり数分〜十数分と長く、洋一郎さんの実運用では「席を立つ前にまとめて生成しておく」というワークフローが有効です。同じ prompt / knobs に対して元画像だけ複数枚選び、各画像から動画を作らせたい、さらにバッチと組み合わせて「各画像から M 本ずつ = 合計 N×M 本」を一気にキューイングしたい、というのが新しい要求でした。

この要求を単一値の state のまま満たすと、外側ループでどの元画像を使うかを切り替えるたびに `setVideoSourceImage` を呼んで render を待つ、といったぎこちない実装になる恐れがありました。一方で「単発生成」「バッチ生成」「動画を生成する」ボタン「まとめて生成」ボタンなど複数の入口が既に存在しており、これらを別々のコードパスで持ちながら整合を保つのは保守負荷が高い状況でした。

## Decision

私たちは、動画生成の元画像を単一値ではなく **配列 (`videoSourceImages: GenerationData[]`)** として保持し、単発生成もバッチ生成も同じ runner `handleVideoBatchGenerate(countPerImage)` を通す統合設計を採用します。

具体的な実装は次の通りです。第一に、state を `videoSourceImages: GenerationData[]` に変更し、ヘルパー `addVideoSourceImage(item)`（id によるdedup付き）と `removeVideoSourceImageAt(idx)` を追加します。Lightbox の「🎬 動画にする」からの `handleOpenVideoForm(item)` は append 動作に変更し、初回追加のときだけ画像の dimensions を継承 + video mode に突入します（既存の 1 枚選択のユーザー体験は初回のみそのまま維持されます）。第二に、`handleVideoGenerate` に optional `overrides.sourceImage` を追加し、指定された 1 枚を必ず使うようにします。指定なしのときは `videoSourceImages[0]` にフォールバックします。第三に、`handleVideoBatchGenerate(countPerImage)` を outer image ループ × inner count ループの構造にリファクタリングし、total = `videoSourceImages.length * countPerImage` としてバッチ進捗を `{current, total}` の合計形で表示します（Q4 で「シンプルに合計だけ」と決定済み）。第四に、単発の「動画を生成する」ボタンも `videoSourceImages.length > 1` のときは `handleVideoBatchGenerate(1)` を通し、1 のときのみ従来の `handleVideoGenerate()` を通す薄い分岐を entry で挟みます。実質、単発は runner のトリビアルケースで、バッチ runner が全ての入口を吸収します。第五に、ControlPanel のサムネイル表示はサムネイル横並び + flex-wrap + 各サムネイルに × ボタンとし、選択順で並びます（Q3-A）。総 total が 1 のときはバッチ成功 toast ではなく既存の単発成功 toast にフォールバックして、1 本だけ生成した時のメッセージ違和感を回避します。

代替として、単発とバッチの handler を別々のままにして単発は `videoSourceImages[0]` だけを見る案も検討しましたが、コードパスが 2 本になり N×M の意味論的統合を「単発 = 1 × 1」の trivial case で表現できなくなるため却下しました。累積式ではなく最新選択で置き換える案（Lightbox でクリックすると常に 1 枚に置き換わる）もありましたが、Q1-B で明示的に累積式を選択したため採用しませんでした。

## Status

Accepted

## Consequences

動画生成は単発・複数枚選択・バッチ・複数枚 × バッチのいずれも同じ N×M runner を通るようになり、コードパスが 1 本に集約されました。単発 (1 × 1) はバッチ runner の degenerate case として扱われ、既存の UX との連続性は「total = 1 のときだけ単発 toast にフォールバック」の 1 行で保たれています。

累積式 + dedup by id の設計により、うっかり同じ画像を Lightbox から 2 回選んでしまう操作が無害化されます。UI 上でも枚数の見た目が変わらないため、ユーザーは「押したはずなのに」と感じる場面が発生しません。

一方で、Lightbox の「🎬 動画にする」を押しても video mode 突入・dimensions 継承は初回のみ行うため、後から追加した画像の解像度が最初に選んだ画像と大きく異なる場合、フォームの width / height はユーザーが明示的に更新しない限り最初のまま残ります。これは意識的な設計判断ですが、実運用で不便が判明すれば「追加された画像に応じて自動再計算」のオプションを検討する余地があります。

サムネイル領域の flex-wrap 挙動は、フォーム幅が細いレイアウトで 3 枚目以降が改行して 2 段目に落ちる形になります。目視の枚数把握には支障ありませんが、10 枚以上を staging する場合はスクロールコンテナ化を検討する余地があります。

関連 ADR: [[adr-0058-video-prompt-single-input-with-lm-studio-enhance]], [[adr-0059-video-batch-count-only]].
