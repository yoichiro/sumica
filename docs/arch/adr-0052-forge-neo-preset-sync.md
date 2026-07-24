# ADR 52: Forge Neo Classic の Preset を Sumica の arch トグルと自動同期する

## Context

[[adr-0042-flux-support-3way-architecture]] で Sumica は SD1.5 / SDXL / Flux の 3-way `modelTypeFilter` トグルを持ちました。当初の Non-Goals として「SD.Next / reForge / ComfyUI compatibility beyond AUTOMATIC1111 v1.10+」を明記し、AUTOMATIC1111 v1.10+ を前提とする設計にしていました。

その後、洋一郎さんが Stable Diffusion バックエンドを AUTOMATIC1111 v1.10 から **Stable Diffusion WebUI Forge Neo Classic** に移行しました。移行の主因は、AUTOMATIC1111 v1.10 が Flux VAE を SD の `AutoencoderKL` に無理やり読み込もうとして `state_dict` shape mismatch でクラッシュする現象を根本的に解決できなかったことでした。Forge Neo Classic は Flux 対応が組み込み済みで、AUTOMATIC1111 とほぼ同一の HTTP API を持ちつつ、UI 上で "UI Preset" (sd / xl / flux / klein / qwen 等) を切り替える独自機構を備えています。

Forge Neo Classic の Preset は次の性質を持ちます。

- 各 Preset ごとに `forge_additional_modules_<preset>` として VAE / Text Encoder のパス配列を独立に保持する (e.g. `forge_additional_modules_flux`, `forge_additional_modules_xl`, `forge_additional_modules_sd`)。
- 現在アクティブな Preset の modules 配列が `forge_additional_modules` にコピーされ、checkpoint ロード時にこの modules が強制的に適用される。
- Preset の切り替えは基本的に UI 操作でのみ発生し、`/sdapi/v1/txt2img` の `override_settings` から一時的に指定することもできる。

Sumica はここで問題に直面しました。Sumica のトグルを「Flux」に切り替えて Forge Neo の Preset を UI で `flux` に設定した後、Sumica のトグルを「SDXL」に切り替えて SDXL checkpoint (`waiREALCN_v120.safetensors`) を生成しようとすると、Forge Neo は Preset を `flux` のままにして Flux VAE (`ae.safetensors`、16 チャンネル latent) を SDXL モデルに強制適用し、`IntegratedAutoencoderKL` の `state_dict` で `encoder.conv_out.weight` shape が `[32, 512, 3, 3]` (Flux) vs `[8, 512, 3, 3]` (SDXL) の mismatch でクラッシュしました。

## Decision

私たちは、Sumica の `/api/generate` handler で `override_settings.forge_preset` と `override_settings.forge_additional_modules` を **リクエスト単発のスコープで送信し、Forge Neo の Preset 状態を Sumica の arch トグルと自動同期する**設計を採用します。

具体的な対応は次の通りです。

- `arch === 'sd15'` のとき、`override_settings.forge_preset: 'sd'` と `override_settings.forge_additional_modules: []` を追加します。
- `arch === 'sdxl'` のとき、`override_settings.forge_preset: 'xl'` と `override_settings.forge_additional_modules: []` を追加します。
- `arch === 'flux'` のとき、Forge Neo の `/sdapi/v1/options` を先に GET して `forge_additional_modules_flux` の配列を取得し、それを `override_settings.forge_additional_modules` として送ります。合わせて `override_settings.forge_preset: 'flux'` を送ります。fetch に失敗した場合は inject をスキップし、Sumica より前の挙動と同じ payload で送信します。
- Sumica のコードで Flux 用モジュールのフルパスをハードコードしません。パスは常に Forge Neo が保持する `forge_additional_modules_flux` から取得します。

override_settings 経由の値は **generate リクエスト単発のスコープ**で適用されるだけで、Forge Neo の永続 options 自体は変更されないことを curl 検証で確認しました。したがって Sumica の /api/generate 呼び出しが Forge Neo の UI 上の Preset 選択を勝手に上書きすることはなく、副作用は最小に抑えられます。

代替案として次を検討し、いずれも却下しました。

- **クライアント側で Forge Neo の options を先に POST で書き換える 2 段階リクエスト**: options を変更してから /txt2img を叩く。しかし複数タブの同時利用や失敗時の巻き戻し処理が必要になり、状態管理の複雑度が増します。override_settings 単発の方が本質的にステートレスで安全です。
- **Sumica のサーバー起動時に options を fetch してキャッシュ、以降はそのキャッシュを使う**: Flux modules を毎回 fetch するオーバーヘッドは避けられますが、洋一郎さんが Forge Neo の UI で Preset や module 選択を変えた場合にキャッシュが古くなる問題があります。毎回 fetch する方が正確性を優先できます (数十 ms のオーバーヘッドは Flux 生成の数秒〜数分と比べて無視できるコスト)。
- **Sumica を Forge Neo 専用実装にする**: Preset 概念を持たない AUTOMATIC1111 では `forge_preset` オプションは未知の設定名で、AUTOMATIC1111 は unknown override key を silently 無視するため、同じ payload が両バックエンドで安全に動きます。分岐を持たない方が保守性が高いです。

## Status

承認済み

## Consequences

- Sumica の arch トグルを切り替えるだけで、Forge Neo Classic の Preset も対応する状態に自動的に切り替わります。ユーザーが Forge Neo の UI で手動で Preset を切り替える必要がなくなり、UX が [[adr-0042-flux-support-3way-architecture]] の「単一情報源」設計と一致します。
- Flux 生成のたびに `/sdapi/v1/options` を fetch する追加リクエストが発生します (タイムアウト 4 秒)。SD1.5 や SDXL 生成では追加 fetch は発生しません。生成時間 (数秒〜数分) に対して数十 ms のオーバーヘッドは無視できるコストです。
- AUTOMATIC1111 バックエンドを使う場合、`forge_*` の override は unknown key として silently 無視されるため、[[adr-0042-flux-support-3way-architecture]] 以前の挙動を維持します。同じ Sumica コードが両バックエンドで動作します。ただし AUTOMATIC1111 v1.10 では Flux VAE を SD の AutoencoderKL に読み込む問題は本 ADR では解決されず、実質的には Forge Neo Classic への移行が Flux 対応の実用解になっています。
- `forge_additional_modules_flux` のパス文字列は Forge Neo が返すフルパス (例: `E:\sd-webui-forge-neo\models\VAE\ae.safetensors`) をそのまま Sumica の server が Forge に return する形になります。Sumica はこのパスを解釈せず単にリレーします。パスの正当性は Forge Neo の実体設定に完全に依存します。
- 副作用として、Sumica の server は Forge Neo の options 構造 (`forge_additional_modules_flux` というキー名) に依存するようになりました。Forge Neo が将来この options キーを rename または削除した場合、Sumica は fetch に失敗して fallback (inject スキップ) に降りるため生成が壊れることはありませんが、Flux 生成時に Preset 同期が効かなくなります。その場合は本 ADR を supersede する新 ADR で対処します。
- [[adr-0042-flux-support-3way-architecture]] の Non-Goals に記した「AUTOMATIC1111 v1.10+ 前提」は本 ADR で緩和され、Forge Neo Classic を追加でサポートする形になりました。ただし AUTOMATIC1111 の Flux 対応の根本問題 (VAE の shape mismatch) は Sumica のコード側では解決不能なため、実用上は Forge Neo Classic への移行が必要です。
