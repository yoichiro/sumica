# ADR 5: 既存のSDプロキシ互換パターンを踏襲してHires.fixに対応する

## Context

生成画像の解像度を引き上げるため、Stable DiffusionのHires.fix（アップスケーリングのsecond pass）に対応する必要がありました。サンプラー・スケジューラー・LoRAで既に確立していた「SDのAPIをプロキシし、対応していない場合は空配列に縮退する」パターン（[[adr-0004-sd-optional-feature-graceful-degradation]]）があったため、新しい仕組みを発明するのではなくこれを踏襲する方針としました。

## Decision

新しい`GET /api/sd-upscalers`エンドポイントで、SDの`/sdapi/v1/upscalers`と`/sdapi/v1/latent-upscale-modes`をマージしたフラットな名前一覧を返します。取得に失敗した場合は既存パターンと同様に空配列に縮退します。

`generateImage()`に`enableHr` / `hrScale` / `hrUpscaler` / `hrSecondPassSteps` / `denoisingStrength`を追加し、`enable_hr`が真の場合のみtxt2imgペイロードに含めます。選択内容は生成メタデータにも保存します。

サンプラーには`'Euler a'`というハードコードされたデフォルトがありますが、アップスケーラーには意図的にハードコードされたデフォルトを設定していません。SDのAPIには「現在有効なアップスケーラー」という概念が存在しないため、未指定時はSD側のデフォルト（`upscaler_for_hires_fix`）に委ねます。

UIはLoRAセクションの上に配置し、デフォルト値はスケール2.0倍、Hires用ステップ数0（＝通常のStepsと同じ）、Denoising Strength 0.7としました。実装は設計書と計画をあらかじめ書いたうえでgit worktree内で行い、mainにマージしました。

## Status

承認済み

## Consequences

- 既存のSDプロキシ・段階的デグレードのパターンを再利用したことで、実装・レビューのコストを抑えられました。
- txt2imgのタイムアウトがHires.fixのsecond passにより旧来の180秒を超えるケースが判明し、600秒に引き上げる対応（[[adr-0006-generation-cancel-interrupt]]と同じセッションで発見）が必要になりました。
