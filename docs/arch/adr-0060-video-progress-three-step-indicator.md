# ADR 60: 動画生成の進捗表示を画像と同じ 3-step インジケーターに統一する

## Context

Sumica のプレビュー領域は画像生成の進行状況を「①プロンプト拡張 → ②画像生成 → ③保存」の 3 円 step インジケーターで示しており、各 step の色遷移とバッチカウンタ（`(current/total)`）が画像パイプラインの状態を分かりやすく伝えていました。動画生成側は独自の実装になっており、ComfyUI の SSE で流れてくる `stage` label と全体進捗バー（時間ベースの推定 %）を単独で表示するだけで、画像側のような明確な step 分解は持っていませんでした。

この非対称は 2 つの実害を生んでいました。第一に、画像と動画で同じ 3-step パイプラインを本質的に走っているにもかかわらず、UI 上は完全に別物として描かれていて、ユーザーがモード切替のたびに視覚言語を学び直す必要がありました。第二に、動画バッチ機能を [[adr-0059-video-batch-count-only]] で導入したことで、動画側にも「何本目を生成中か」を明示する必要が生じたのですが、そのカウンタを既存の画像バッチカウンタと同じ場所に載せる自然な枠が動画側には無く、単独で急ごしらえの表示を作らざるを得ませんでした。

さらに、動画生成では ComfyUI 実行が数分〜十数分と長く、3 円だけでは「今どこ？」の粒度が粗すぎるという固有の事情もありました。ステージ label や全体進捗バーを完全に捨てる案は、実用性の観点で受け入れられませんでした。

## Decision

私たちは、動画生成の進捗表示を画像と同じ 3-step インジケーターに統一しつつ、動画特有の詳細補助行を 3-step の直下に置く二層構造を採用します。

具体的には次の通りです。第一に、`PreviewPanel.tsx` の video 分岐を廃し、`currentMediaType === 'video'` のときも同じ 3 円 step インジケーターを描画します。step 2 の label だけ mediaType で切り替え、動画時は「動画生成」（`stepVideoGenerateLabel`）、画像時は「画像生成」（`stepGenerateLabel`）とします。`batchCounter` は現在の `(current/total)` 形式のまま画像・動画で共有し、動画専用のカウンタ i18n key は導入しません。第二に、動画時のみ、3-step の直下に副次的な情報行を追加し、そこに現在のステージ label（`videoStageLabel`）と全体進捗バー（`computeOverallProgress` 由来の %）と（あれば）Node 番号・step カウンタを載せます。第三に、`App.tsx` 側で `handleVideoGenerate` と `handleVideoBatchGenerate` に `setLoadingStep(1/2/3)` を接続し、画像パイプラインと同じ規則（LM Studio を呼ぶときだけ 1 を光らせ、enhance が終わったら 2、SSE の saving stage で 3）で状態遷移させます。overrides ありのバッチ内部呼び出しでは step 1 を飛ばして 2 から始めるため、外側のバッチループが enhance 済みを 1 回だけ光らせる設計になります。

代替として、動画は動画で独立した 2-step（生成 → 保存）にする案も検討しましたが、画像とのシンボル的な対称性が崩れて mediaType が混在する gallery で読みにくくなるため却下しました。ステージ label と進捗バーを 3-step のうちの step 2 の中に埋め込む案もありましたが、円の中の情報密度が高くなりすぎるため補助行として下段に分離しました。

## Status

Accepted

## Consequences

画像と動画の 2 モードが 3-step インジケーターの共通言語で読めるようになり、モード切替のたびの視覚的な学び直しが不要になりました。動画バッチのカウンタも画像と同じ `(i/N)` 表現で自然に載ります。

副次的に、動画時の詳細補助行が 3-step の直下に生えるレイアウトになったため、プレビュー領域の縦方向のスペースを動画時のみ少し多く使う形になっています。マルチモニタや大画面環境では気になりませんが、狭い画面では今後もし窮屈になるようであればアコーディオン化を検討する余地があります。

`loadingStep` を video flow にも接続するにあたり、`handleVideoGenerate` の overrides 引数の判定を全ての `if (!overrides)` 分岐で使うようになり、この分岐の見落としが直接不具合の原因になる状況が広がりました。実装時にも実際にこの罠を踏んで、button の `onClick` binding で MouseEvent が overrides と誤認される bug が発生しています。今後この function を触る際は overrides の伝播に神経を使う必要があります。

関連 ADR: [[adr-0058-video-prompt-single-input-with-lm-studio-enhance]], [[adr-0059-video-batch-count-only]].
