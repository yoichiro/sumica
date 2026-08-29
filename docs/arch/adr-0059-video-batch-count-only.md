# ADR 59: 動画のまとめて生成を count-only モード（上限 5 本）で導入する

## Context

Sumica の画像生成には [[adr-0002-batch-generation-sequential-loop]] で採用したまとめて生成機能があり、count / size / model の 3 モードのタブ切替を持つ `BatchGenerationModal` を通じて 2〜10 枚の画像をクライアント側の逐次ループで生成できます。動画生成にはこれに相当する機能がなく、動画を複数本作る場合はユーザーが「動画を生成する」を都度クリックする運用に留まっていました。

動画生成は 1 本あたりの所要時間が数分〜十数分と、画像生成に比べて 1 桁以上長く、また LTX-Video-2 のワークフローでは seed 以外のノブ（fidelity / motion / identity）を バッチ内で変化させる意味が薄い状況でした。加えて、動画の frontend フォームには画像側のようなアーキテクチャ・アスペクト比・モデル切替の複雑な軸がなく、seed だけが本ごとに変化する軸です。したがって、画像側の size / model モードをそのまま持ち込む合理的理由はありませんでした。

一方で、UX 上は 「まとめて生成」ボタンを二つのフォームで揃えたい、モーダル UI も見た目上シブリングとして読ませたい、という要求がありました。

## Decision

私たちは、動画側にも「まとめて生成 (動画)」ボタンを新設し、専用の `VideoBatchGenerationModal` を通じて **count-only モード**（2〜5 本）でバッチ生成できるようにします。

具体的な実装は以下の通りです。第一に、動画のバッチ数の上限を **5** に据え、`VIDEO_BATCH_MIN = 2` / `VIDEO_BATCH_MAX = 5` として `VideoBatchGenerationModal.tsx` の定数に固定します。画像側の 10 に合わせない理由は、動画 1 本あたりの実時間が長く、うっかりスライダーを最大にした時のコンピュート消費が 1 時間規模に膨らんでしまうことを避けるためです。第二に、モーダルの UI は画像 count タブ本体と同じレイアウト（説明段落 → 大きな数値表示 + unit label → range スライダー → 端の min/max label → 下段のキャンセル / 生成 button 2 分割）にコピーして、両者がシブリングとして読めるように統一します。第三に、`handleVideoBatchGenerate(count)` を追加し、`videoPrompt` の enhance を 1 回だけ実行してから `handleVideoGenerate` を count 回ループする形にします。`handleVideoGenerate` は overrides 引数を追加して、enhance と seed 解決を skip できるようにしました。第四に、キャンセルは [[adr-0017-batch-cancel-client-side-flag]] を踏襲する形で、動画側専用の `videoBatchCancelledRef` を新設します。`handleVideoCancel` は `batchProgress` の有無を検知して、単一 job の interrupt に加えてループ側の停止も同時に行います。第五に、`batchProgress` の state 自体は画像バッチと共通の `{ current, total }` 形にして、モードは互いに排他になるため、モードを区別するフラグは持たせません。

代替として size / model モードを空タブとして残す案も検討しましたが、意味的に成立しない軸をタブに並べるのはノイズになると判断して却下しました。動画の一本ずつ生成に留める案もありましたが、ユーザーが席を立って戻ってきたら複数本できあがっている、というワークフローを提供したいので採用しませんでした。

## Status

Accepted

## Consequences

動画側にも画像と対称なまとめて生成 UX が導入され、seed だけを振って多様性を得るオペレーションが 1 クリックでキューイングできるようになりました。モーダル UI が視覚的にシブリングとして読めるため、ユーザーの学習コストは低く抑えられています。

上限 5 本の cap は保守的ですが、洋一郎さんが実運用で「一晩に何十本も回したい」となった場合はここが最初の見直しポイントになります。定数は 1 箇所に集約されているため変更コストは低いです。

`handleVideoGenerate` に overrides 引数を持たせたことで、`onClick={handleVideoGenerate}` が React の MouseEvent を第一引数に渡してしまい、`overrides` が truthy と誤判定される bug を実装中に踏みました。関連する `if (!overrides)` 分岐が全部飛ばされ、プレビュー反映・スピナー消去・成功 toast のすべてが出なくなる症状として現れましたが、`onVideoGenerate={() => handleVideoGenerate()}` の wrap で解消しました。

関連 ADR: [[adr-0002-batch-generation-sequential-loop]], [[adr-0017-batch-cancel-client-side-flag]], [[adr-0058-video-prompt-single-input-with-lm-studio-enhance]].
