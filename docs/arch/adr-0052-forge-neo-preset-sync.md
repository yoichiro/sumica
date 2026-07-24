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

非推奨 (Deprecated)。[[adr-0054-rollback-forge-neo-and-flux-to-automatic1111]] にて Forge Neo Classic 対応そのものが撤回されました。もともとは [[adr-0053-forge-neo-preset-sync-via-options-post]] にて supersede されており、その理由は Consequences の末尾に追記した「override_settings 経路の失敗」を参照してください。

## Consequences

- Sumica の arch トグルを切り替えるだけで、Forge Neo Classic の Preset も対応する状態に自動的に切り替わります。ユーザーが Forge Neo の UI で手動で Preset を切り替える必要がなくなり、UX が [[adr-0042-flux-support-3way-architecture]] の「単一情報源」設計と一致します。
- Flux 生成のたびに `/sdapi/v1/options` を fetch する追加リクエストが発生します (タイムアウト 4 秒)。SD1.5 や SDXL 生成では追加 fetch は発生しません。生成時間 (数秒〜数分) に対して数十 ms のオーバーヘッドは無視できるコストです。
- AUTOMATIC1111 バックエンドを使う場合、`forge_*` の override は unknown key として silently 無視されるため、[[adr-0042-flux-support-3way-architecture]] 以前の挙動を維持します。同じ Sumica コードが両バックエンドで動作します。ただし AUTOMATIC1111 v1.10 では Flux VAE を SD の AutoencoderKL に読み込む問題は本 ADR では解決されず、実質的には Forge Neo Classic への移行が Flux 対応の実用解になっています。
- `forge_additional_modules_flux` のパス文字列は Forge Neo が返すフルパス (例: `E:\sd-webui-forge-neo\models\VAE\ae.safetensors`) をそのまま Sumica の server が Forge に return する形になります。Sumica はこのパスを解釈せず単にリレーします。パスの正当性は Forge Neo の実体設定に完全に依存します。
- 副作用として、Sumica の server は Forge Neo の options 構造 (`forge_additional_modules_flux` というキー名) に依存するようになりました。Forge Neo が将来この options キーを rename または削除した場合、Sumica は fetch に失敗して fallback (inject スキップ) に降りるため生成が壊れることはありませんが、Flux 生成時に Preset 同期が効かなくなります。その場合は本 ADR を supersede する新 ADR で対処します。
- [[adr-0042-flux-support-3way-architecture]] の Non-Goals に記した「AUTOMATIC1111 v1.10+ 前提」は本 ADR で緩和され、Forge Neo Classic を追加でサポートする形になりました。ただし AUTOMATIC1111 の Flux 対応の根本問題 (VAE の shape mismatch) は Sumica のコード側では解決不能なため、実用上は Forge Neo Classic への移行が必要です。
- **Hires.fix 対応の追加要求**: Forge Neo Classic の Hires.fix パスは `self.hr_additional_modules` を参照しますが、この属性は fresh install の options に登録されておらず、UI で一度も Hires.fix を触っていない環境では `None` のまま残ります。txt2img 呼び出しで hires が有効な場合、Forge Neo は `processing.py:1405` で `"Use same choices" not in self.hr_additional_modules` を評価しようとして `TypeError: argument of type 'NoneType' is not iterable` を投げます。このため、Sumica の server は **`enable_hr` を送るとき、payload の直接フィールドに `hr_additional_modules: ["Use same choices"]` を明示的に含めます**。この sentinel は Forge Neo の内部で「hires 第 2 パスもメインパスと同じ VAE/text encoder を再利用する」という意味で、SD1.5 / SDXL の Hires.fix の期待挙動と一致します。なお `override_settings` 経由でこのキーを送ると `KeyError: 'hr_additional_modules'` になるため、必ず payload のトップレベルに置く必要があります (options として登録されていないため settings 更新経路が無効)。この修正は Forge Neo だけでなく AUTOMATIC1111 でも副作用がなく (unknown key は silently 無視)、両バックエンド共通で安全です。
- **Flux 時の Hires.fix 強制スキップ**: 洋一郎さんが SD1.5/SDXL の履歴レコード (Hires.fix ON) を「フォームにロード」した後で Flux トグルに切り替えると、UI 上 Hires.fix パネルは [[adr-0042-flux-support-3way-architecture]] の設計で非表示になるものの、`hiresFixEnabled` state は残り続けて次の生成リクエストで `enable_hr: true` が送信されます。Flux の hires パスは正常に動かない (Flux VAE と main pass の resolution 増加が組み合わさると同様のクラッシュ) ため、二重防御を導入しました。第一は client の `modelTypeFilter` useEffect の Flux branch で `setHiresFixEnabled(false)` を追加し、Flux 切替時に state をリセットします。第二は server の `generateImage` で `arch === 'flux'` の場合に `enable_hr` を強制的に skip します。どちらか片方が漏れても他方が守る構造です。
- **override_settings 経路の失敗と本 ADR の supersede**: 本 ADR は「`forge_preset` と `forge_additional_modules` を `override_settings` に含めれば request 単発スコープで Preset が切り替わる」という前提で書かれていましたが、実運用で **Forge Neo Classic は `override_settings` のこれら 2 キーを黙って無視する** ことが判明しました。実験手順は次の通りです: (1) `/sdapi/v1/options` を GET すると `forge_preset: 'flux'` と Flux modules が入った状態、(2) Sumica が `override_settings: { forge_preset: 'sd', forge_additional_modules: [] }` 付きで `/sdapi/v1/txt2img` を叩く、(3) Forge のログは `Model Selected: minadukiMix.safetensors, modules: []` を出す (checkpoint override は効いている)、(4) しかし直後に `Requested to load JointTextEncoder` と `Requested to load KModel` (Flux 用の text encoder + UNet) が実際にロードされる、(5) 生成完了後に再度 `/sdapi/v1/options` を GET すると `forge_preset` は **`'flux'` のまま変わっておらず**、SD checkpoint を Flux modules でハイブリッドに動かす壊れた状態で 30 steps 完走してしまいます。ハイブリッドは crash しないため一見成功していますが、生成結果は SD checkpoint の期待挙動と乖離します。`sd_model_checkpoint` と `sd_vae` は `override_settings` の request 単発スコープで正しく効くのに対し、`forge_preset` / `forge_additional_modules` は Forge Neo の内部で「永続 options を書き換えないと反映されない」実装になっているためです。本 ADR の Decision はこの挙動を捉え損ねており、`/sdapi/v1/options` を **先に POST して永続書き換えしてから** `/sdapi/v1/txt2img` を叩く 2 段階リクエスト方式が実際には必要であることが後から分かりました。この 2 段階方式は本 ADR の Decision で「代替案として却下」した設計です。[[adr-0053-forge-neo-preset-sync-via-options-post]] で 2 段階方式を採用する形で本 ADR を supersede しました。
