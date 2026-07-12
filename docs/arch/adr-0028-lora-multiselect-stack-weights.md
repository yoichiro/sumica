# ADR 28: LoRA をマルチセレクト・スタック + 個別重みスライダーで扱う

## Context

Stable Diffusion で LoRA (Low-Rank Adaptation) は、ベースモデルに追加の学習された小さなアダプタを重ねてスタイルや被写体を差し込むための仕組みです。SD の Web UI (`/sdapi/v1/txt2img`) では、prompt に `<lora:name:weight>` の書式で LoRA を組み込みます。同じ生成に複数の LoRA を重ねることは日常的で、たとえば「顔の LoRA + 服装の LoRA + 手のリファインメント LoRA」を weight 0.7 / 0.5 / 1.0 でスタックする、といったユースケースが実運用で発生します。

Sumica はこれまで LoRA を「未対応」として form 上に露出させておらず、ユーザーが `<lora:...>` を prompt に手書きするしかない状態でした。しかし LM Studio のプロンプト拡張 ([[adr-0001-client-side-firebase-persistence]] の生成パイプライン参照) は自然言語で書かれた prompt を SD 用に展開する役割を担っており、そこに `<lora:...>` の生 syntax を混ぜて渡す運用は概念的に不自然です。LoRA を form の別項目として設定できるようにすべきという要求が明確でした。

form UI 上での LoRA の扱いには複数の設計選択がありました。

- **単一選択 + 固定重み 1.0**: 実装は最小ですが、SD ユーザーの実運用と乖離が大きく、複数 LoRA をスタックする一般的なワークフローが不可能になります。
- **単一選択 + 重みスライダー**: 少しマシですが、複数スタックはまだできません。
- **マルチセレクト + 個別重みスライダー**: SD の実運用に一致します。実装は最も重いですが、価値の差が大きい。

保存側の考慮も必要でした。生成メタデータに LoRA 情報を残さないと、「フォームにロード」で復元できず、[[adr-0021-favorite-recipe-rollup-ranking]] のレシピキーにも取り込めません。

## Decision

**LoRA はマルチセレクト・スタック方式にし、各 LoRA に 0〜1.5 の個別重みスライダーを付けます。適用は拡張後の positive prompt 末尾に `<lora:name:weight>` を `, ` (カンマ + スペース) で連結して差し込みます。** 具体的な設計は次の通りです。

- **フォーム UI**: 追加 LoRA は「+ Add LoRA…」のオプション付きセレクトから選び、`selectedLoras: {name: string; weight: number}[]` として state に積みます。各行に「× 削除」ボタンと 0〜1.5 の 0.05 刻みスライダーを持たせ、初期重みは 1.0 とします。
- **サーバー側 API**: `GET /api/sd-loras` を追加し、SD の `/sdapi/v1/loras` レスポンスをそのまま proxy します。SD のバージョン差異に対する degradation は既存 [[adr-0004-sd-optional-feature-graceful-degradation]] のパターンに準拠します。
- **プロンプトへの連結**: `<lora:foo:0.7>, <lora:bar:0.5>` のようにカンマ + スペースで連結し、拡張済み positive prompt の末尾に付けます。スペース区切りではなくカンマ区切りにするのは、SD のトークン区切り規約に合わせているためです。SD 側は同じトークン扱いになりますが、prompt を目視デバッグしたとき区切りが明確です。
- **メタデータ保存**: `GenerationParams` に `loras: {name: string; weight: number}[]` フィールドを追加し、生成時にそのまま Firestore / `metadata.json` に書き込みます。「フォームにロード」時は `setSelectedLoras(item.loras || [])` で復元します。
- **レシピキーへの反映**: [[adr-0021-favorite-recipe-rollup-ranking]] の当初は LoRA を name の sort 済み配列で扱っていましたが、[[adr-0024-ranking-recipe-full-form-restore]] で `{name, weight}[]` に拡張しました。

代替案として次を比較検討し、いずれも却下しました。

- **単一選択 + 固定重み**: 実装は圧倒的に短く済みますが、複数 LoRA スタックが SD 実運用で日常的な以上、「Sumica は SD のフル機能を使えないミニマルクライアント」という印象を与える機能不足になります。ミニマリズムを追求する場所ではありません。
- **prompt に生 syntax を書かせる**: LM Studio 拡張 pipeline に `<lora:...>` を通すのが概念的に不自然です。ユーザーが「自然言語のプロンプトで書き、LoRA は別項目で選択」できるほうが、Sumica の設計哲学（自然言語ファーストの image lab）と一致します。
- **重みスライダーを 0〜1.0 に限定**: SD の LoRA weight は 1.0 を超えても意味を持ちます（強調）。上限を 1.0 に切ってしまうと SD ユーザーの表現力を奪います。0〜1.5 が実運用の必要十分域と判断しました。
- **スペース区切りで連結**: 見た目は良いですが、prompt に既にカンマが多用されている中で LoRA だけスペースになると、区切り位置の可読性が落ちます。SD の区切り規約に合わせるのが正解でした。

## Status

承認済み

## Consequences

- **SD 実運用に対応する LoRA スタック機能**が Sumica に載りました。「顔 LoRA + 服 LoRA + 手 LoRA」を weight 個別調整で組み合わせるといった、SD ヘビーユーザーが日常的にやっているワークフローが自然言語 prompt との併用で可能になっています。
- **`GenerationParams.loras` メタデータフィールド**が追加されたことで、[[adr-0021-favorite-recipe-rollup-ranking]] / [[adr-0024-ranking-recipe-full-form-restore]] のレシピキーに LoRA name/weight を含める道が開けました。実際 ADR 24 でこの拡張を全次元化しています。
- **「フォームにロード」で LoRA も完全復元**されます。過去の generation を掘り起こして「あのときの LoRA スタックをまた試したい」というワークフローが 1 クリックで実現します。
- **`GET /api/sd-loras` の呼び出しコスト**が生成のたびに発生します（画像リストとは別に、モデル/sampler/scheduler/LoRA/upscaler/VAE の 5〜6 系統の proxy が並列で走る）。実測ではローカル SD なら数十 ms 程度で無視できます。リモート SD の場合は多少感知できますが、まだ許容範囲です。
- **LoRA name には `.safetensors` 拡張子が含まれることが多い**ため、`<lora:foo.safetensors:0.7>` の形になります。SD の `/sdapi/v1/loras` は name フィールドを拡張子付きで返しますが、SD 内部の LoRA 参照は拡張子なしでも通ります。実装では受け取った name をそのまま連結する pass-through 方針にしています。
- **後の [[adr-0029-sd-sdxl-architecture-ui-handling]] で SD/SDXL のアーキテクチャ判別**が LoRA にも拡張されました。LoRA metadata から `type: 'sd15'|'sdxl'|'unknown'` を判定し、モデルアーキテクチャと不一致のときは ⚠ バッジで警告する運用に発展しています。
