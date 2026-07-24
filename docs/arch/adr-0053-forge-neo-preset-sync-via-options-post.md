# ADR 53: Forge Neo Classic の Preset を /sdapi/v1/options への直接 POST で切り替える

## Context

[[adr-0052-forge-neo-preset-sync]] は Sumica の 3-way arch トグル (SD1.5 / SDXL / Flux) と Forge Neo Classic 側の `forge_preset` を同期させるため、`/sdapi/v1/txt2img` の `override_settings` に `forge_preset` と `forge_additional_modules` を含めて送る設計を採用しました。この設計は「override_settings は generate リクエスト単発のスコープで永続 options を汚さない」というステートレスな性質を持つ点が評価されました。

しかし ADR-52 の Consequences 末尾に追記した通り、実運用でこの前提が誤っていることが判明しました。Forge Neo Classic は `override_settings.sd_model_checkpoint` と `override_settings.sd_vae` は正しく request 単発スコープで反映しますが、`override_settings.forge_preset` と `override_settings.forge_additional_modules` は **黙って無視します**。結果として、たとえば Sumica が SD1.5 生成を要求しても Forge Neo は前のロード状態 (Flux) の JointTextEncoder + KModel + Flux 用 modules を使い続け、SD1.5 checkpoint と Flux modules がハイブリッドに合成された壊れた状態で 30 steps を完走してしまいます。crash しないため一見成功しているように見えて、生成結果は SD1.5 checkpoint の期待挙動から乖離します。

洋一郎さんの環境で `curl http://localhost:7860/sdapi/v1/options` を叩いて Preset の切り替え状態を検証したところ、次の 2 点が確認されました。

- `override_settings` 経由で `forge_preset` を送っても、生成後の `/sdapi/v1/options` の `forge_preset` は変化しません。
- `POST /sdapi/v1/options` で `{"forge_preset": "sd", "forge_additional_modules": []}` を直接送信すると、options が永続的に書き換わり、以降の checkpoint ロードは新 Preset の modules で行われます。

つまり Forge Neo Classic では、Preset 切り替えは **options の永続書き換え** でしか実現できず、`override_settings` の request 単発スコープには乗りません。ADR-52 の Decision で「代替案として却下した」設計 (options を先に POST で書き換える 2 段階リクエスト) が、実際には唯一動作する方式でした。

## Decision

私たちは、Sumica の `/api/generate` handler で **`/sdapi/v1/txt2img` を叩く前に `/sdapi/v1/options` を POST して `forge_preset` と `forge_additional_modules` を永続的に書き換え、その直後に `/sdapi/v1/txt2img` を叩く 2 段階リクエスト方式** を採用します。ADR-52 が採用した `override_settings` 経路は本 ADR で撤回します。

具体的な対応は次の通りです。

- `arch === 'sd15'` のとき、`POST /sdapi/v1/options` に `{"forge_preset": "sd", "forge_additional_modules": []}` を送ります。
- `arch === 'sdxl'` のとき、`POST /sdapi/v1/options` に `{"forge_preset": "xl", "forge_additional_modules": []}` を送ります。
- `arch === 'flux'` のとき、先に `/sdapi/v1/options` を GET して `forge_additional_modules_flux` を取得し、`{"forge_preset": "flux", "forge_additional_modules": <fetched list>}` を `POST /sdapi/v1/options` に送ります。GET に失敗した場合は POST 自体をスキップし、`/sdapi/v1/txt2img` にそのまま進みます (fallback で degrade する挙動)。
- `sd_model_checkpoint` と `sd_vae` は今後も `/sdapi/v1/txt2img` の `override_settings` に含めて送ります。これらは request 単発スコープで正しく効くため、options を書き換える必要はありません (書き換えるとむしろ副作用が広がる)。
- POST /options が失敗した場合、`/sdapi/v1/txt2img` を通常通り試みます。AUTOMATIC1111 (非 Forge) バックエンドでは `forge_*` のキーが未知として silently 無視されるため、この POST は no-op で通過し、以降の /txt2img も従来通り動作します。ネットワーク障害などで /options が本当に失敗した場合は /txt2img も失敗するので、defensive rollback は導入しません。

代替案として次を比較検討し、いずれも却下しました。

- **ADR-52 の `override_settings` 経路を維持する**: 実運用で Forge Neo Classic が `forge_preset` / `forge_additional_modules` を無視することが確認されているため、この経路では Preset は切り替わりません。維持は選択肢になりません。
- **UI で手動 Preset 切替を要求する**: Sumica の arch トグルが「単一情報源」で model / preset / batch を制御する [[adr-0029-sd-sdxl-architecture-ui-handling]] / [[adr-0042-flux-support-3way-architecture]] の設計思想と反します。手動操作を挟むと UX が明確に劣化します。
- **Sumica を Forge Neo 専用にする**: `forge_*` の POST は AUTOMATIC1111 では unknown key として silently 無視されるため、同じサーバーコードで両バックエンドが動きます。分岐を持たない方が保守性は高いです。

## Status

非推奨 (Deprecated)。[[adr-0054-rollback-forge-neo-and-flux-to-automatic1111]] にて Forge Neo Classic 対応そのものが撤回されました。本 ADR で実装した `/sdapi/v1/options` への 2 段階書き換え経路は現行コードから削除されています。

## Consequences

- Sumica の arch トグルを切り替えるだけで、Forge Neo Classic の Preset が対応する状態に自動的に切り替わります。SD1.5 checkpoint に Flux modules が付いたままロードされる ADR-52 時代のハイブリッド状態のバグは解消されます。実測で SD1.5 (mengxMixReal + Hires.fix) が 4 秒、SDXL (waiREALCN) が 22 秒、Flux (2758FluxAsian) が 125 秒 (モデルロード込み) で 3 種類とも正常に生成完走することを curl で確認済みです。
- 1 回の生成につき **`/sdapi/v1/options` への POST が 1 回追加**されます (Flux 生成では options GET も追加で 1 回)。実測で数百 ms のオーバーヘッドで、生成時間 (数秒〜数分) と比較すれば無視できるコストです。
- **副作用として Forge Neo Classic の永続 options が Sumica によって書き換えられる**ようになりました。ADR-52 の「ステートレスで副作用が最小」という利点は失われます。ただし洋一郎さんは Sumica を経由して生成する運用なので、Forge Neo の UI 上の Preset 選択と Sumica の arch トグルは実質的にリンクさせておく方が期待動作に近く、Sumica 側から永続書き換えが起きても混乱は生じません。他の Forge Neo クライアント (直接 UI 操作、別スクリプト等) と併用する場合、Sumica の生成後は Preset が最後に使われた arch に固定されている点を承知しておく必要があります。
- Forge Neo Classic が将来 `override_settings` 経路で `forge_preset` を受け付けるようアップデートされた場合でも、本 ADR の 2 段階方式は引き続き動作します (options POST は Forge Neo 側でも冪等です)。逆方向、つまり /options POST を非推奨化して override_settings 経由のみサポートするような変更が入った場合は、本 ADR を supersede する新 ADR で対応します。
- AUTOMATIC1111 バックエンドで動かす場合、`forge_preset` と `forge_additional_modules` は **未知の options キー**として silently 無視されます。AUTOMATIC1111 の `/sdapi/v1/options` は未知のキーを含む POST を受け付けてエラーを返さない (無視するだけ) ことを確認済みです。ADR-52 と同様、同じサーバーコードが両バックエンドで安全に動作します。
- ADR-52 が採用した `override_settings.forge_preset` は本 ADR で使わなくなるため、`generateImage` の `overrides` 構築ロジックから該当のキー挿入コードを削除しました。ADR-52 の Consequences で「override_settings 単発スコープで安全」と書かれていた記述は、事実として不正確でしたが、本 ADR では ADR-52 の Status を「置き換え済み (Superseded by ADR 53)」に変更するだけで本文は書き換えていません (履歴を辿れる状態を優先)。
- Hires.fix 対応 ([[adr-0052-forge-neo-preset-sync]] の Consequences で追加した `hr_additional_modules: ["Use same choices"]` を payload トップレベルで送る対応) と、Flux 時の Hires.fix 強制スキップの二重防御はそのまま本 ADR に引き継がれます。これらは Preset 同期経路とは独立した対応で、`override_settings` 経路の変更に影響されません。
