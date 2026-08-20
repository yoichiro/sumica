# ADR 58: 動画プロンプトを単一の日本語入力にして LM Studio で positive / negative に enhance する

## Context

Sumica の動画生成は ComfyUI + LTX-Video-2（LTXV-2）ワークフローに `positive` / `negative` の 2 つのプロンプトを渡します。従来はこの 2 つがそのままコントロールフォームの UI に露出しており、動画フォームには「動画プロンプト（英語推奨、動きの記述）」と「❌ 動画ネガティブプロンプト」の 2 つの textarea がありました。それぞれには次のハードコード初期値が事前入力されていました。positive 側は `"Use the provided start image exactly as the first frame."`、negative 側は `"still image, watermark, subtitles, text, 3D, VR"` で、この 2 行は LTX-Video-2 が「動画が静止画のまま出てくる」失敗や「テキスト / ウォーターマークが焼き込まれる」失敗を回避するための実質的な必須プレフィックスでした。

画像生成側は既に「日本語でプロンプトを書く → LM Studio が SD 向けの `<prompts><positive>/<negative></prompts>` に翻訳・拡張する」という「1 入力 → 2 出力」の設計 ([[adr-0001-client-side-firebase-persistence]] とは独立の会話設計) を採用しており、日本語話者の体験がここに寄せて統一されていました。動画側だけ英語直書きの 2 field のままなのは対称性が崩れており、また「動画では突然英語で motion tag を書け」という要求が日本語話者には重い状況でした。

一方で、LTX-Video-2 のプレフィックスを LLM の指示遵守能力に賭けて含めさせると、モデル次第では省略される / 少しずつ変形するリスクがあり、これは動画生成の初期化条件そのものを揺らがせるため許容できません。

## Decision

私たちは、動画フォームの入力を **1 つの日本語 textarea** (`videoPrompt`) に統一し、LTX-Video-2 の固定プレフィックスは Client 側で必ず prepend するという二層構造にします。

具体的なフローは次の通りです。まず、モジュールレベルに `VIDEO_POSITIVE_PREFIX` と `VIDEO_NEGATIVE_PREFIX` の 2 つの const を定義し、上記の固定文字列をこの 1 箇所に集約します。動画生成 (`handleGenerateVideo`) の最初で、`videoPrompt.trim() === ''` であれば LM Studio を呼ばずに、この 2 つの prefix だけを `effectivePositive` / `effectiveNegative` として ComfyUI に渡します。これは「動きは LTX に任せる」安全最小構成として機能します。`videoPrompt` が非空の場合は、新設した `POST /api/video/enhance` に日本語文を投げ、Server 側の `enhanceVideoPrompt` が `VIDEO_SYSTEM_PROMPT` を使って LM Studio に「LTX-Video-2 向けに motion / camera / atmosphere に寄せた追加 positive タグと、動画特有の artifact（jitter / morphing / flicker / warping）に寄せた追加 negative タグ」を出力させます。返ってきた positive / negative の**冒頭**に、Client 側で fixed prefix を必ず prepend し、それを ComfyUI に渡します。

責務分離のポイントとして、`VIDEO_SYSTEM_PROMPT` は LLM に対して「これらの固定プレフィックスは caller が prepend するので、あなた自身の出力には含めないこと」と明示的に伝えます。これによって「LLM が prefix を含めるかどうか」に生成結果の一貫性を賭けずに済み、また prefix が二重化する事故も確実に避けられます。

元の日本語プロンプトは `ltxParams.videoPrompt` として optional field で record に保存し、「動画設定に戻す」（`handleReloadVideoRun`）でそのまま復元できるようにします。過去のレコード（この field を持たないレガシー）は空文字で reload する仕様とし、enhanced 済みの positive / negative を日本語に逆翻訳する試みは行いません。

代替として「positive / negative の 2 field は残したまま、enhance ボタンでオートフィルする」案も検討しましたが、UI 対称性のメリットが薄まり、また「英語 field を編集した後に enhance を再実行するとどちらが優先か」というフローの複雑化を招くため却下しました。もうひとつ「LLM に fixed prefix も含めさせて Client 側 prepend を廃止する」案は、上記の指示遵守リスクを避けるため却下しました。

## Status

Accepted

## Consequences

画像生成と動画生成が「日本語一本で書ける」体験で対称化されました。動画側でも自然言語だけで motion / camera / atmosphere の意図を伝えられるようになり、日本語話者の学習コストが下がっています。

LM Studio への依存が動画にも延びましたが、画像側で既に必須依存だったので、Sumica 全体としての依存関係は変わっていません。fixed prefix はコード上の 2 つの module-level 定数として管理されるため、将来 LTX-Video のバージョンアップで初期化条件が変わった際は、この 1 箇所だけ修正すれば全ルートに反映されます。

`ltxParams.videoPrompt` を optional にしたおかげでレガシーレコードのマイグレーションは不要ですが、レガシー動画レコードを「動画設定に戻す」で読み込むと `videoPrompt` は空になり、元の日本語意図はコード上から失われた状態になります。これは意識的な設計判断で、enhanced 済みの positive / negative を逆翻訳するのは事実上不可能なため、レガシーは空、これから作られる record からは round-trip 可能、と割り切りました。

CLAUDE.md の動画パイプラインのセクションもこの新設計に合わせて更新済みで、以降の実装者が「なぜ 2 field ではなく 1 field なのか」「なぜ prefix を Client 側で prepend しているのか」を辿れるようになっています。

関連 ADR: [[adr-0001-client-side-firebase-persistence]] (ltxParams round-trip の永続化), [[adr-0050-main-preview-toolbar-and-load-into-form]] (「フォームにロード」フローの一部).
