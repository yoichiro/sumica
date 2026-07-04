# ADR 11: SDXLでRefinerと外部VAEを指定できるようにする

## Context

SDXLの画像生成では、Baseモデルの後段で **Refiner**（別のチェックポイント）を最終ステップに走らせたり、**外部VAE**（`sdxl_vae.safetensors`など）でデコーダを差し替えたりすることで、精度・ディテールが変わることが知られています。どちらも指定しなくても画像は生成されるため純粋にオプショナルな品質向上手段ですが、洋一郎さんから「GUIから指定できるようにしてほしい」という要望がありました。

AUTOMATIC1111/Forgeの`/sdapi/v1/txt2img`エンドポイントは、これらを次のフィールドで受けます。

- Refiner: `refiner_checkpoint`（チェックポイントのタイトル文字列）、`refiner_switch_at`（0.0〜1.0、Baseから Refiner に切り替える進捗）
- VAE: `override_settings.sd_vae`（VAEファイル名、`"Automatic"`ならSDの既存設定を保持）

利用可能なVAE一覧はSDが`/sdapi/v1/sd-vae`で提供しており、他の`sd-samplers`/`sd-schedulers`/`sd-upscalers`と同じ「サーバー側でproxyしてクライアントへ返す」パターンにそのまま乗せられる形をしていました。

UI上どこに置くかについては、[[adr-0010-sdxl-ratio-orientation-size-preset]]で確立した「SDXL選択時のみ表示される専用UI」の規約に自然に乗せられます。SD1.5は次の理由でスコープ外としました。

- SD1.5にはSDXLのようなBase/Refinerの二段構成が想定されておらず、Refiner概念自体が薄い。
- SD1.5でも外部VAEの差し替え自体は可能だが、モデルによっては壊れやすく、UIの一貫性より個別チューニング需要が優先される場面が多い。今回の主目的（SDXLの精度向上手段の露出）から外れる。
- SD1.5用UIをシンプルに保つ方針は[[adr-0010-sdxl-ratio-orientation-size-preset]]と同じ判断軸。

洋一郎さんの環境で稼働中のSDでは`/sdapi/v1/sd-vae`が2つのVAE（`clearvaeSD15_v23.safetensors`とSDXL用の`sdxl_vae.safetensors`）を返しました。アーキテクチャ別に自動フィルタする方針もありえますが、VAEはmodelspec相当のメタデータを持たないため機械的な判別が難しく、SD自体もフラットな1リストで提供している設計に合わせ、UI側もフィルタなしのフラットなセレクトにしました。

## Decision

SDXL選択時にRefinerと外部VAEを指定できるUIとサーバー拡張を追加します。SD1.5選択時は従来通り両者を意識しないパイプラインです。

- **サーバー** (`server/index.ts`):
  - `GET /api/sd-vaes`を追加。SDの`/sdapi/v1/sd-vae`をproxyし`{ vaes: string[] }`（`model_name`のみ抽出）を返す。失敗時は`{ vaes: [] }`にdegradeして、既存のオプショナルSD proxy群（`sd-schedulers`, `sd-upscalers`など）と同じ挙動。
  - `generateImage()`と`POST /api/generate`に3つのオプショナル引数を追加：`refiner`（チェックポイント名）、`refinerSwitchAt`（0.0〜1.0、デフォルト0.8）、`vae`（VAE名）。
  - `refiner`が非空のときのみpayloadに`refiner_checkpoint` + `refiner_switch_at`を含める。指定なしのリクエストは追加以前と完全に同じ形。
  - `vae`が非空かつ`"Automatic"`でないときのみ`override_settings.sd_vae`に含める。既存の`sd_model_checkpoint`と共存するため、overrideは一つのオブジェクトにまとめて条件付きで組み立てる形にリファクタ。
  - 生成メタデータ（clientPersistモードの返却`params`、ローカルモードの`metadata.json`エントリ）にも`refiner` / `refinerSwitchAt` / `vae`をoptionalで保存。値が未指定の生成には一切含めない（過去データと同じシェイプ）。
- **クライアント型** (`client/src/firebase.ts`): `GenerationParams`に3つのフィールドをoptionalで追加。`GenerationRecord`は継承のみ。
- **クライアントUI** (`client/src/App.tsx`):
  - state追加：`sdVaes` / `selectedRefiner` / `refinerSwitchAt`（デフォルト0.8）/ `selectedVae`。
  - `fetchSdVaes()`を`/api/sd-vaes`へのfetchとして追加し、他の`fetchSd*`と同じライフサイクル（起動時とSD接続復帰時）で呼ぶ。
  - **UI: SDXL選択時のみ、LoRAとSeedの間に2フィールドを描画**：
    - Refinerセレクト（`（使わない）`＋SDXLタイプのチェックポイント一覧）。Refinerが設定されているときのみ、その直下に切替タイミングスライダー（0.0〜1.0、0.05刻み）とパーセント表示を出す。
    - VAEセレクト（`Automatic（自動）`＋fetchしたVAE一覧）。
  - 生成POST bodyに、`modelTypeFilter === 'sdxl'`かつ値が設定されているときのみ`refiner`/`refinerSwitchAt`/`vae`を追加。SD1.5からのリクエストには一切乗らないため、アーキテクチャ切替の際にstateが残っていても影響しない。
  - `modelTypeFilter`切替useEffectのSD1.5分岐で`selectedRefiner`/`selectedVae`をクリア。SDXL→SD1.5→SDXLの往復でstale状態が残るのを防ぐ。
  - `loadIntoForm()`で`item.refiner`/`item.refinerSwitchAt`/`item.vae`を復元。過去のRefiner/VAEなしの履歴データからロードした場合は3つとも`""`/`0.8`にリセット。
  - プレビュー詳細（右パネル）に、`refiner`が設定されていればsuffixとして`(switch at N.NN)`込みで表示、`vae`があれば同様に一行追加。
- **Refinerを`selectedModel`と同じチェックポイントに指定することは意図的に禁止しない**。通常はしないが、SDが受け付けてどう振る舞うかはSD側に委ねる。
- **VAEはSD1.5用のものもリストに混ざる**。判別できないためフィルタしないが、SDXL選択時はSDXL用VAEを選ぶのがユーザーの責任。

## Status

承認済み

## Consequences

- SDXLの画質チューニング手段（Refinerと外部VAE）がGUIから指定できるようになりました。実測でjuggernautXL v6 + `sd_xl_refiner_1.0` (switch at 0.8) + `sdxl_vae` の組み合わせを1枚生成し、ポートレートのディテール（肌質・光の乗り）が明らかに向上することを確認しました。
- 追加した3フィールドはすべてoptionalかつ「指定なしなら以前と完全同一のpayload/メタデータ」の設計のため、既存の生成履歴・SDXL preset picker（[[adr-0010-sdxl-ratio-orientation-size-preset]]）・バッチ生成（[[adr-0002-batch-generation-sequential-loop]]）・Hires.fix（[[adr-0005-hires-fix-support]]）と競合なく共存します。
- SDXL選択時のみUIが2〜3フィールド伸びます。advanced領域は元々スクロール対応済みなのでレイアウト崩れなし。
- SDXL⇄SD1.5切替時にRefiner/VAE stateをクリアする設計により、SD1.5リクエストにSDXL用の設定が漏れるリスクを排除。この明示クリアは`loadIntoForm`のarch同期修正と同じ「stateはアーキテクチャに従う」設計原則の一部です。
- VAEリストは`/sdapi/v1/sd-vae`のフラット構造をそのまま踏襲したため、SD1.5用VAEがSDXLセレクトに表示されます。将来アーキテクチャ別フィルタが必要になったら、SDXL判定と同じくヘッダー解析（[[adr-0009-safetensors-header-sdxl-detection]]）でVAEも判別する方向で拡張可能ですが、現時点では過剰実装と判断しました。
- Refinerを`selectedModel`と同一に指定することも許容しました。誤操作リスクはあるものの、拒否ロジックを入れるより「SDの挙動に委ねる」方が単純で、将来SDが新しい用法をサポートしても壊れません。
- SD1.5側はRefiner/VAE未対応です。将来SD1.5でも外部VAEの需要が明確になれば、SD1.5専用のシンプルなVAEセレクトを解像度picker近くに追加できます（データモデルは既にoptional対応済み）。
