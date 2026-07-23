# ADR 42: Flux アーキテクチャを 3-way トグルの第 3 値として扱い、生成時に modelArchitecture を永続化する

## Context

[[adr-0009-safetensors-header-sdxl-detection]] では `conditioner.embedders.*` を陽性判定する形で「SDXL かどうか」の 2 分類を採用し、Flux 等の未知アーキテクチャは意図的に「除外しない (＝SD1.5 バケツ)」側に倒す設計にしていました。[[adr-0029-sd-sdxl-architecture-ui-handling]] でも、`type: 'unknown'` を独立 3 値目としてトグルに追加する案を「実データでは Flux モデル数がまだ少なく、UI 複雑化のコストが利得を上回る」として却下し、「将来の必要性に応じて再検討します」と Consequences に明記していました。

その後、洋一郎さんの環境で Flux [schnell] 系のチェックポイント (`2758FluxAsianUtopian_v60SchnellFp8Noclip.safetensors`) が日常生成で使われるようになりました。実際にヘッダーを検査したところ 776 個のテンソルすべてが `model.diffusion_model.double_blocks.*` / `single_blocks.*` / `img_in.weight` / `txt_in.weight` / `vector_in.*` / `time_in.*` の Flux DiT パターンで、`__metadata__` には `flux1-schnell.safetensors` の参照が含まれていました。AUTOMATIC1111 は v1.10.0 (2024-08) から Flux をネイティブサポートしており、素の AUTOMATIC1111 環境で Flux 生成が動くこと自体には矛盾はありません。

Flux は distilled model なので、SDXL/SD1.5 と同じ UX を適用すると次の落とし穴があります。

- Steps: schnell では 1–4 が推奨、dev では 20–30。Sumica のデフォルト 20 は schnell では過剰、dev では不足気味。
- CFG: schnell では 1.0 固定推奨（それ以外は無視される）、dev では 3.5 前後。Sumica のデフォルト 7 は両方で外している。
- Negative prompt: schnell では CFG=1.0 のため実質完全無視、dev でも効果は薄い。
- LLM の `(phrase:weight)` emphasis: Flux の T5 テキストエンコーダーはこの構文を解釈しないため、リテラルな文字列として扱われる。
- 解像度ピッカー: SD1.5 の 512² 中心は Flux では低解像度すぎる。

同時に、[[adr-0016-defer-sdxl-misclassification-fix]] で保留していた「非 "XL" 命名 SDXL チェックポイントの `loadIntoForm` バグ」は、案 A（生成時に `modelArchitecture` を metadata に永続化する）が推奨として書かれており、今回 Flux 対応で `GenerationMetadata` のスキーマに手を入れるので同時解消できます。

## Decision

**Flux を SD1.5 / SDXL と並ぶ第 3 のアーキテクチャとして first-class に扱い、既存の `modelTypeFilter: 'sd15' | 'sdxl'` トグルを 3-way `Architecture = 'sd15' | 'sdxl' | 'flux'` に拡張します。同時に、[[adr-0016-defer-sdxl-misclassification-fix]] の案 A（生成時に `modelArchitecture` を metadata に永続化する）を本 ADR の付随変更として実装します。** 具体的な設計は次の通りです。

- **`classifyCheckpointArch()` によるヘッダー検査の 3 分類化**: [[adr-0009-safetensors-header-sdxl-detection]] のヘッダー検査ロジックを継承しつつ、`isSdxlCheckpoint()` を廃止して `classifyCheckpointArch(filename, title): Promise<{ type: Architecture; fluxVariant?: 'schnell' | 'dev' }>` に置き換えます。検出順序は「Flux (`double_blocks.*`（bare レイアウト）または `model.diffusion_model.double_blocks.*`（ComfyUI ラップ済みレイアウト）) → SDXL (`conditioner.embedders.*`) → SD1.5」の順です。Flux が検出された場合は `__metadata__` を stringify して `/flux1?[-_]?dev/i` にマッチすれば dev、しなければ schnell と判定します。フォールバック（ヘッダー読み込み失敗）でも同じ 3 分類を名前ヒューリスティックで復元します。
- **3-way segment トグル (SD / SDXL / Flux)**: [[adr-0029-sd-sdxl-architecture-ui-handling]] の「単一情報源」設計をそのまま踏襲し、`modelTypeFilter: Architecture` として model picker / preset picker / batch scope / default 適用を制御します。
- **Flux 用の `FLUX_PRESETS`**: [[adr-0010-sdxl-ratio-orientation-size-preset]] と [[adr-0014-sd15-ratio-orientation-size-preset]] と同じ「aspect ratio × orientation × size」構造で、SDXL とほぼ同じ数値（Flux も 1MP native）にしました。ただし Flux は aspect ratio bucket 学習ではないため、`isSdxlBucket` の代わりに `isFluxNative: boolean` を採用し、M サイズのみを ⭐ として印します。
- **Flux 特有 UX**: `modelTypeFilter === 'flux'` のとき、`selectedModel.fluxVariant` に応じて steps (schnell=4 / dev=25) と CFG (schnell=1.0 / dev=3.5) と sampler (Euler + Simple scheduler) をデフォルト適用します。ユーザーが手動で触った場合は per-field override flag (`stepsUserOverride` 等) で保持。Negative prompt textarea は `disabled` にし、「Flux モデルでは negative prompt は使用しません」ノートを表示。Hires.fix / VAE / Refiner は Flux 時に非表示。
- **LLM system prompt の Flux バリアント**: `enhancePrompt(userPrompt, arch)` を拡張し、`arch === 'flux'` のとき自然言語プロンプト + 空 negative を返す system prompt に切り替えます。既存の SD system prompt (`(phrase:weight)` emphasis 変換) は `arch === 'sd15' | 'sdxl'` または省略時にそのまま使います。
- **`GenerationMetadata.modelArchitecture?: Architecture` の永続化**: client が `/api/generate` の body に `modelArchitecture: modelTypeFilter` を含めて送り、server は local metadata.json に、client は Firestore に、それぞれ保存します。`loadIntoForm` は保存された `modelArchitecture` を最優先で信頼し、なければ現行の `inferSdArchitectureFromTitle` フォールバックを維持します。既存レコード（`modelArchitecture` 無し）は現行挙動そのまま。
- **Batch generation の 3-way 化**: `BatchGenerationModal` に `buildFluxBatchJobs()` を追加し、`modelTypeFilter === 'flux'` 時は FLUX_PRESETS のクロス積でジョブを生成します。バッチのモデル切替モードは既に `sdModels.filter(m => m.type === modelTypeFilter)` で一般化されているため追加変更なし。
- **LoRA の 4 値化**: `classifyLoraArchitecture()` に `'flux'` 判定を追加し、Flux LoRA も `⚠(for Flux/SDXL/SD1.5)` バッジで不一致警告するようにします（除外はしない、[[adr-0029-sd-sdxl-architecture-ui-handling]] の「バッジのみ、選択自体は許容」方針を継承）。

代替案として次を比較検討し、いずれも却下しました。

- **検出だけ・UX 変更なし (Flux モデルを SD1.5 バケツに残す)**: 実装コスト最小ですが、SD1.5 の 512² デフォルトや CFG=7 デフォルトを Flux モデルで使うと画質が明確に劣化し、ユーザーが原因を追いにくくなります。「Fluxモデルで動く」ことが目的ではなく「Fluxモデルで最良の結果を得る」ことが目的なので却下。
- **schnell/dev を区別せず一括 `'flux'`**: UI 単純ですが、schnell/dev で steps・CFG の推奨値が桁違い（4 vs 25、1.0 vs 3.5）なので、片方向のデフォルトが常に不適切になります。`__metadata__` からの判別コストは低いので区別する方針にしました。
- **ADR-16 と分けて別 PR で対応**: `GenerationMetadata` のスキーマ変更が両 ADR で必要なので、同時実装のほうが自然。Flux 対応の副産物として ADR-16 も解消するのが本 ADR の付加価値。

## Status

承認済み

## Consequences

- **Flux モデルが専用 UX で使えるようになる**: 3-way トグルで Flux を選ぶと、preset / steps / CFG / sampler / negative disabled / Hires.fix 非表示すべてが Flux 向けに切り替わります。schnell/dev の variant 判別で defaults も自動的に適切な値が入るので、初回ユーザーでも失敗しにくくなります。
- **[[adr-0016-defer-sdxl-misclassification-fix]] のバグが解消される**: 新規生成レコードには `modelArchitecture` が保存され、`loadIntoForm` はそれを最優先で信頼します。非 "XL" 命名 SDXL チェックポイントで生成した画像を「フォームにロード」しても、arch トグルが自動的に正しく SDXL に切り替わり、解像度も保たれます。ただし本 ADR より前に生成された既存レコードには `modelArchitecture` が無いので、既存レコード側では引き続き ADR-16 のワークアラウンド（手動でトグル切替）が必要です。ADR-16 の Status は本 ADR で「置き換え済み」に更新します。
- **単一情報源の設計が保たれる**: [[adr-0029-sd-sdxl-architecture-ui-handling]] の「トグル 1 つが model / preset / batch を制御する」設計は 3-way 化しても崩れず、むしろ将来 SD3 / Sana など 4 値目・5 値目が必要になったときの拡張パターンが確立します。
- **LLM system prompt が 2 バリアント持ちになる**: Flux 用と SD 用の system prompt を並置する形で保守負荷が微増しますが、両者は完全に独立した文書なので、片方の変更が他方に影響しない構造です。
- **Hires.fix / Refiner / VAE の Flux 対応は保留**: Flux は SD のこれらのアップスケール・VAE フローと非互換なので、本 ADR では Flux 時に非表示にするだけで、Flux 向けの upscale パスは将来課題として残します。
- **schnell vs dev の判別は heuristic**: safetensors の `__metadata__` に `flux1-dev` の文字列が入っていなければ schnell と判定します。誤判定 (dev モデルが schnell 扱いになる) 場合、ユーザーは steps / CFG を手動で override すればよいので実害は小さいですが、`__metadata__` を持たない Flux checkpoint が増えた場合は判定精度が下がります。
- **Flux LoRA の一部誤判定リスク**: `classifyLoraArchitecture()` の Flux 判定は `modelspec.architecture` / `ss_base_model_version` の substring 検査に依存するため、Flux 用にトレーニングされた LoRA でメタデータが欠落しているものは `'unknown'` 扱いになります。[[adr-0029-sd-sdxl-architecture-ui-handling]] の「バッジのみ」方針により誤判定の影響は限定的で、ユーザー側で手動で使うことに変わりありません。
