# ADR 54: Forge Neo Classic 対応と Flux 対応を撤回して AUTOMATIC1111 v1.10 + SD1.5/SDXL 2-way に戻る

## Context

[[adr-0042-flux-support-3way-architecture]] で Sumica は SD1.5 / SDXL / Flux の 3-way arch トグルを導入し、Flux 用の `FLUX_PRESETS` / schnell/dev 用の defaults / Flux 用 LLM system prompt などを first-class 機能として実装しました。ADR-42 の Consequences で明記した通り、AUTOMATIC1111 v1.10 は Flux VAE を SD の `AutoencoderKL` に読み込もうとして `state_dict` shape mismatch でクラッシュする問題があり、実運用では Stable Diffusion WebUI Forge Neo Classic への移行が必要でした。この移行は [[adr-0052-forge-neo-preset-sync]] と [[adr-0053-forge-neo-preset-sync-via-options-post]] で扱われ、ADR-53 では `/sdapi/v1/options` を先に POST してから `/sdapi/v1/txt2img` を叩く 2 段階リクエスト方式で 3 arch (SD1.5 / SDXL / Flux) すべての生成に成功することを curl で検証しました。

しかし洋一郎さんの実運用で、Forge Neo Classic は継続的に安定して動かないことが判明しました。ADR-52 → ADR-53 の間に発覚した「override_settings.forge_preset が黙って無視される」問題、Hires.fix パスの `hr_additional_modules: None` TypeError、および Preset 切り替えが options の永続書き換えでしか実現できないという Forge Neo 固有の設計は、Sumica のような外部クライアントから見て予測しづらい振る舞いを積み重ねました。ADR-52 / ADR-53 の対応で個別のバグは治まりましたが、根本的に「Forge Neo Classic の内部挙動が Sumica の期待から乖離している」状態は変わらず、洋一郎さんは AUTOMATIC1111 v1.10 に戻す決断をしました。

AUTOMATIC1111 v1.10 に戻ることで、[[adr-0042-flux-support-3way-architecture]] の Flux 対応は再び実質的に動作しない状態になります (VAE の state_dict shape mismatch が再発)。したがって Flux 対応を UI 上に残しても実行不可能な機能を露出することになるため、ADR-42 の Flux 対応も同時に撤回します。撤回により、Sumica の arch トグルは [[adr-0029-sd-sdxl-architecture-ui-handling]] 時代の 2-way (`sd15` | `sdxl`) に戻ります。

## Decision

私たちは、**Sumica から Forge Neo Classic 対応コードと Flux 対応コードをすべて撤去し、AUTOMATIC1111 v1.10 + SD1.5 / SDXL の 2-way arch トグルの状態に戻します**。具体的な撤去範囲は次の通りです。

- **Server (`server/index.ts`)**:
  - `Architecture` 型を `'sd15' | 'sdxl' | 'flux'` から `'sd15' | 'sdxl'` に戻し、`FluxVariant` 型は削除します。
  - `FLUX_SYSTEM_PROMPT` 定数を削除し、`enhancePrompt` の `arch` 引数と Flux 分岐を撤去して SD 用 system prompt 単一に戻します。
  - `generateImage` から Flux 用の `negative_prompt` 分岐、`arch === 'flux'` の `enable_hr` 強制 skip、[[adr-0053-forge-neo-preset-sync-via-options-post]] で導入した `/sdapi/v1/options` への 2 段階 POST、および `hr_additional_modules: ['Use same choices']` payload 送信を撤去します。
  - `classifyCheckpointArch` から Flux 検出 (`double_blocks.*` / `model.diffusion_model.double_blocks.*`) を撤去し、SDXL (`conditioner.embedders.*`) → fallback sd15 の 2 分類に戻します。名前ヒューリスティックの `lower.includes('flux')` 分岐も削除します。
  - `classifyLoraArchitecture` から Flux 判定を撤去します。
  - `/api/enhance` / `/api/generate` の req.body から `arch` の抽出コードを撤去します (`modelArchitecture` フィールドは持続化用途で残します — [[adr-0016-defer-sdxl-misclassification-fix]] の非 "XL" 命名 SDXL チェックポイント判定に使うため)。
- **Client (`client/src/App.tsx` + `client/src/components/` + `client/src/i18n/`)**:
  - `Architecture` 型を 2-way に戻し、`SdModel.fluxVariant` プロパティを削除します。
  - `FLUX_PRESETS` / `FLUX_SIZES` / `resolveFluxDimensions` / `findFluxSelection` / `FluxRatio` / `FluxSize` / `FluxPreset` / `FluxSizeSpec` を `presets.ts` から削除します。
  - `computeFluxDefaults` ヘルパー (`fluxDefaults.ts`) と単体テスト (`fluxDefaults.test.ts`) をファイルごと削除します。
  - `App.tsx` から Flux picker state (`selectedFluxRatio` 等)、Flux batch state (`selectedFluxBatchRatios` 等)、Flux picker → width/height projection useEffect、schnell/dev variant 用の Flux defaults useEffect、`stepsUserOverride` / `cfgUserOverride` / `samplerUserOverride` / `schedulerUserOverride` の per-field override flag と `setStepsFromUser` 系 wrapper を撤去し、`ControlPanel` へは raw setter を渡します。
  - `modelTypeFilter` useEffect の Flux branch と、SDXL/SD1.5 branch にあった「Flux 値を SD defaults にリセット」ロジックを削除します。arch トグルが 2-way に戻ることで、cross-arch 切り替え時の value reset は不要になります (SD1.5 / SDXL 共通の SD default で問題なし)。
  - `ControlPanel.tsx` から Flux 用の 3-way segmented button (`sd15 | sdxl | flux` → `sd15 | sdxl`)、Flux picker UI、Flux モデル名の schnell/dev バッジ、Flux 時の negative prompt disabled 表示、Flux 時の Hires.fix パネル非表示を撤去します。
  - `BatchGenerationModal.tsx` から `buildFluxBatchJobs` と Flux 用 UI ブロックを撤去し、size モードの job builder 分岐を SDXL / SD1.5 の 2 択に戻します。
  - `loadIntoFormState.ts` から `fluxPicker` フィールドと Flux 用分岐、`findFluxSelection` の import を撤去します。
  - `RankingPanel.tsx` の arch chip 背景色判定から `arch === 'flux'` を削除、`GalleryFiltersPopover.tsx` の filter dropdown から Flux オプションを削除します。
  - `i18n/ja.ts` / `i18n/en.ts` から `archFluxLabel`, `noFluxModelsFound`, `fluxNegativeDisabledNote`, `fluxVariantSchnellBadge`, `fluxVariantDevBadge`, `sizeFluxDescription` を削除します。
  - `getArchLabel(arch)` は Flux 分岐が消えるので、`t.controlPanel.archFluxLabel` に依存しない SDXL/SD1.5 単純判定に戻します。
- **Test**:
  - `presets.test.ts` から Flux presets test 一式 (round-trip / `findFluxSelection` null cases / `isFluxNative` marker / 1:1 M dimensions) を削除します。
  - `galleryFilters.test.ts` から `filters by arch=flux` テストを削除、`prefers persisted modelArchitecture` テストを Flux → SDXL に書き換えます。
  - `loadIntoFormState.test.ts` から Flux records の 3 テストと、`resolveSelectedModel` の Flux 分岐テストを削除、Flux 依存テストは SDXL に書き換えます。KNOWN 定数から Flux モデルエントリを削除します。
- **ADR**:
  - [[adr-0042-flux-support-3way-architecture]] の Status を「非推奨 (Deprecated)」に変更、本 ADR へのポインタを追加します。本文は履歴として保持します。
  - [[adr-0052-forge-neo-preset-sync]] の Status を「非推奨 (Deprecated)」に変更、本 ADR へのポインタを追加します (もともと ADR-53 で supersede されていた点も併記)。
  - [[adr-0053-forge-neo-preset-sync-via-options-post]] の Status を「非推奨 (Deprecated)」に変更、本 ADR へのポインタを追加します。

代替案として次を比較検討し、いずれも却下しました。

- **Flux 対応 (ADR-42) は保守して、Forge Neo Classic 対応 (ADR-52 / ADR-53) だけ撤回する**: AUTOMATIC1111 v1.10 は Flux VAE の state_dict shape mismatch でクラッシュするため、Flux 対応の UI を残しても実行できない機能を露出することになります。ユーザーが Flux トグルを選ぶと生成失敗するだけで、混乱を招きます。トグルから Flux が消える方が UX として整合的です。
- **Forge Neo Classic の別バージョンや別 fork へ再挑戦する**: 洋一郎さんの環境で Forge Neo Classic の挙動が予測不能な問題を繰り返した経緯があり、fork の切り替えで問題が根本解決するかは未知数です。まずは安定して動く AUTOMATIC1111 に戻し、必要になった時点で別の Flux 対応バックエンドを検討する方が段階的です。
- **ADR-42 / ADR-52 / ADR-53 のコードを残したまま UI を条件付き非表示にする**: 死んだコードが増え、将来の保守負荷になります。撤去する方が保守性が高いです。

## Status

承認済み

## Consequences

- Sumica のバックエンドは AUTOMATIC1111 v1.10 に固定され、Forge Neo Classic 特有の挙動 (`forge_preset` の永続書き換え要求、`hr_additional_modules` の未初期化 `None`) を Sumica 側で防御する必要がなくなります。コード量は削減され、[[adr-0029-sd-sdxl-architecture-ui-handling]] 時代の 2-way arch トグルの単純な構造に戻ります。
- **Flux モデルは Sumica から使えなくなります**。洋一郎さんが所有する `2758FluxAsianUtopian_v60SchnellFp8Noclip.safetensors` などの Flux checkpoint は AUTOMATIC1111 の model dropdown に表示されるものの、Sumica のトグルが 2-way になったことで sd15 / sdxl のどちらでもない (`classifyCheckpointArch` で sd15 に fallback される) 扱いになります。ユーザーが Flux checkpoint を選択すると、AUTOMATIC1111 v1.10 の Flux VAE state_dict shape mismatch でクラッシュします。運用としては Flux checkpoint を使わないことが前提となります。
- **既存の Flux 生成履歴 (Firestore / local metadata) は影響を受けません**。Firestore / local metadata に保存された `modelArchitecture: 'flux'` のレコードは、gallery やギャラリーフィルタから見ると `Architecture` 型に該当しない unknown 扱いになります。`galleryFilters.test.ts` の legacy record fallback は依然として動作し、これらのレコードは gallery に表示されますが、「Flux でフィルタ」する UI が消えるので明示的に絞り込むことはできなくなります。「フォームにロード」も arch が 'flux' の記録に対しては fallback (title 名の `xl` 判定) に降りるため、SDXL または SD1.5 のどちらかとして解釈されます。過去の Flux 生成の履歴閲覧は残る一方、再生成には別途 Flux バックエンドの復活が必要です。
- **AUTOMATIC1111 v1.10 は継続的に動作する既知のバックエンド**なので、Sumica の CI / dev の再現性は安定します。[[adr-0009-safetensors-header-sdxl-detection]] / [[adr-0016-defer-sdxl-misclassification-fix]] / [[adr-0029-sd-sdxl-architecture-ui-handling]] で構築した SD1.5 / SDXL の判定・UX 分岐は変更なく引き続き機能します。
- **将来 Flux 対応を復活させる場合**、本 ADR とその前身群 (ADR-42 / ADR-52 / ADR-53) は履歴に保持されているので、当時の設計判断と落とし穴が参照可能です。ADR-42 の 3-way トグル / FLUX_PRESETS / schnell/dev variant 検出のロジック、ADR-52 で試した override_settings 経路の落とし穴、ADR-53 の POST /options 経路の実装、Hires.fix の `hr_additional_modules` sentinel — これらすべてが後日の再検討で使えます。復活時には ADR-42 の実装をゼロから書き直すのではなく、ADR-42 の commit 履歴 (git log で `feat: add Flux` などのメッセージを持つ commit 群) を参考に段階的に復元できます。
- **`GenerationMetadata.modelArchitecture` フィールドは server / client の型定義から削除しません**。このフィールドは [[adr-0016-defer-sdxl-misclassification-fix]] の「非 "XL" 命名 SDXL チェックポイントの loadIntoForm バグ」対策として活用されており、SDXL の識別に引き続き必要です。値の domain は `'sd15' | 'sdxl'` に戻りますが、既存 Firestore / local metadata に残る `'flux'` 値は「未知の architecture」として無視され、fallback ヒューリスティック (title の `xl` 判定) が動きます。
- **oxlint / vitest / tsc すべて撤去後も 0 error / 0 new warning** で通ることを確認しました。vitest は 179 → 167 tests に減少 (Flux 関連の 12 テストが削除された結果)。撤去範囲は既存の SD1.5 / SDXL テストを一切変更していないため、SD 系挙動の回帰リスクは最小です。
