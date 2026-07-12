# ADR 24: ランキングレシピをフォーム全復元可能な次元まで拡張する

## Context

[[adr-0021-favorite-recipe-rollup-ranking]] で導入したお気に入りレシピランキングは（その基盤は [[adr-0030-favorite-images-foundation]] の `isFavorite` フラグ機構）、recipe を **8 次元** (`model` / `sampler` / `scheduler` / `size` / `hires` / `LoRA-set` / `refiner` / `vae`) の組み合わせで識別してきました。SHA-256 でハッシュした値が Firestore の `users/{uid}/rankingRollups/{hash}` の doc ID になり、`writeBatch` + `increment()` で total / favs カウンタを維持します。ここまでは `docs/arch/adr-0021-favorite-recipe-rollup-ranking.md` の設計そのままです。

洋一郎さんが実運用でランキング機能を使う中で、次の 2 つの問題が浮上しました。

1. **Hires.fix を boolean 1 個で丸めている粒度が粗すぎる**。同じ「Hires.fix ON」でも `hrUpscaler`（Latent 系 vs ESRGAN 系）は出力の質感を大きく左右し、`hrScale` / `hiresSteps` / `denoisingStrength` の組み合わせでも別レシピと呼ぶべき差が出ます。boolean で丸めてしまうと「上位ランキングのレシピを再生成」しても実際には別ものになるため、ランキングの実用性が損なわれます。
2. **「フォームに適用」で復元されないパラメータがある**。 recipe key に含まれない `steps` / `cfgScale` / `refinerSwitchAt` / LoRA 各 weight は、apply 直後もフォームの前状態が残ります。ユーザーの期待は「上位ランキングのレシピをそのまま再現したい」なので、この "sticky" な残り物は挙動を予測しづらくします。

`enableHr` の boolean 化そのものは ADR 21 の当時、**サンプル数の希薄化を避けるための意図的な粗い粒度** でした（Wilson 下限は分母が大きいほど有効な下限を返す）。しかし洋一郎さんの実運用データは既に 1128 枚以上に到達しており、次元を細かくしてもサンプル数が枯渇する状況ではなくなってきています。加えて「recipe = form 全復元単位」という semantics のほうが概念上明快です。

## Decision

**recipe key の次元セットを 8 → 15 に拡張し、あわせて LoRA を `{name, weight}[]` に変える。`applyRecipe()` はプロンプトと seed を除く全フォーム値を復元する。** 追加する次元と、対応する `GenerationData` のキー、フォーム state の紐付けは次の通りです。

| 追加次元 | RawParams キー | フォーム state |
|----------|---------------|----------------|
| `steps` | `steps` | `setSteps()` |
| `cfg` | `cfgScale` | `setCfgScale()` |
| `hiresUpscaler` | `hrUpscaler` | `setSelectedUpscaler()` |
| `hiresScale` | `hrScale` | `setHiresScale()` |
| `hiresSteps` | `hrSecondPassSteps` | `setHiresSteps()` |
| `hiresDenoising` | `denoisingStrength` | `setHiresDenoising()` |
| `refinerSwitchAt` | `refinerSwitchAt` | `setRefinerSwitchAt()` |
| `loras[].weight` | `loras[].weight` | `setSelectedLoras()` (name+weight で復元) |

新しい `NormalizedParams` のキー順は固定で、`JSON.stringify` の出力が安定するようクライアント/サーバーの両実装で **完全に同一** に揃えます。

```
model, sampler, scheduler, size, steps, cfg, hires, hiresUpscaler,
hiresScale, hiresSteps, hiresDenoising, loras, refiner, refinerSwitchAt, vae
```

数値パラメータ (`cfg` / `hiresScale` / `hiresDenoising` / `refinerSwitchAt` / LoRA `weight`) は **明示的な丸めをかけません**。フォームのスライダー step が `0.5` / `0.1` / `0.01` 単位で既に量子化しているため、フォーム経由の値は float 精度で揺らぎません。過去に別経路で書き込まれた値もほぼ存在しません。追加の丸めは不要かつ情報損失の原因になります。

LoRA は `{name, weight}[]` を `name` 昇順でソートします。同じ `name` でも `weight` が違えば別レシピになります。

`applyRecipe()` は既存の architecture/dimension resolution ロジック (`computeLoadIntoFormState`) を再利用しつつ、上記 15 次元すべてを form state に書き戻します。プロンプトと seed のみ、意図的に除外します。

- **プロンプト**: recipe に含まれず、ユーザーが自分で書くもの。復元すると意図しない上書きが起きます。
- **seed**: フォームの seed ロック機構は「同一結果の再現用」の位置付けで、既存の `loadIntoForm` (履歴からのフォーム反映) も seed ロックは OFF のまま値だけ復元します。「フォームに適用」は "recipe を試したい" 意図で使うため、seed を固定するとユーザーの試行機会が奪われます。同じ設計判断を継承します。

代替案として次を比較検討し、いずれも却下しました。

- **数値パラメータを丸める（例: cfg は 0.5 単位、denoising は 0.01 単位で `Math.round()`）**: float 精度事故への保険にはなりますが、フォーム値がスライダー step で既に量子化されているため実用上は不要です。過剰な予防コードは複雑化するだけと判断しました。
- **LoRA weight を除外して name のみ**: サンプル数を稼ぐには良いですが、「フォームに完全復元」の目的に反します。洋一郎さんの明確な要求どおり `{name, weight}[]` にします。
- **ADR 21 を Superseded にする**: 8 次元 → 15 次元は次元セットの拡張ですが、rollup collection の存在・`writeBatch` + `increment()` のアトミック更新・Wilson 下限で順位づけする分析ロジック・`ControlPanel` の 2 タブ構成といった仕組みは ADR 21 のまま生きています。Superseded だと「仕組み全体が置き換わった」印象になり誤解を招くため、ADR 21 の Status セクションに Amended リンクを追記し、この ADR は "拡張" として位置付けます。
- **既存 rollup のスキーマ migration を on-the-fly で実行**: 旧 shape の Firestore doc を読んだ時に不足フィールドを 0 埋めで補う read-side migration も考えました。しかし新 hash と旧 hash が同一レシピを別 doc として扱うため Wilson が壊れます。既存 backfill スクリプト (`backfill-ranking-rollups-cloud.ts` / `backfill-ranking-rollups-local.ts`) は既存 doc を全削除してから再構築する冪等な設計になっているので、その 1 回きり実行で一気に整合状態に持っていくのが最もクリーンです。

## Status

承認済み

## Consequences

- **「フォームに適用」でプロンプトと seed 以外の全フォーム値が復元される**ようになり、上位ランキングのレシピを 1 クリックで再現できる semantics が完成しました。特に Hires.fix 系の 4 パラメータが復元されるため、「同じ Latent 2.0x で作りたかったのに ESRGAN になっていた」といった食い違いが起きなくなります。
- **recipe 粒度が細かくなった副作用として、同じ recipe に該当する generation の数が減少**します。Wilson 下限の分母が小さくなるため、`minSample >= 3` の閾値でランキング上位に浮上するレシピが減る可能性があります。洋一郎さんは 1128 枚以上の実データを持っており当面問題にはならない想定ですが、将来 recipe 粒度をさらに細かくする（例: LoRA weight を 0.01 単位で丸めない代わりに 0.1 単位で丸める）といった調整余地は残しています。
- **既存の Firestore/ローカル rollup ドキュメントは、hash が全て旧 shape で計算されているため事実上無効化されました**。`server/scripts/backfill-ranking-rollups-cloud.ts` および `server/scripts/backfill-ranking-rollups-local.ts` を **1 回ずつ実行** して既存 rollup を削除→新 shape で再構築する必要があります。両スクリプトは冪等で、既存の `--dry-run` フラグに従います。実行完了までの間、ランキングタブは旧 shape の rollup で表示され続けますが、`applyRecipe()` で復元される値のうち新規追加フィールドは `undefined` になり、フォームに反映すると入力欄が空/初期値化する可能性があります。洋一郎さんは backfill 実行後にランキング表示が正しく更新されることを目視確認する運用になります。
- **ADR 21 の "将来 9 次元目を追加したくなった場合、version: 1 → version: 2 に上げて backfill を再実行する" 仕組みは実施しないまま次元セットを差し替え**ました。version フィールドは残していますが、混在チェックはロジック上行っておらず、backfill の冪等性のみに依存する運用です。この方針は洋一郎さんが単一ユーザー運用であることを前提としており、複数ユーザー環境では過渡期の混在が問題になる可能性があります。
- **`RankingPanel.tsx` の表示情報が増えました**。meta line に `Steps N · CFG N` が追加、Hires 行は詳細付き (`Latent · 2x · 15 steps · denoise 0.5`)、LoRA 行は weight 付き (`alpha (0.7), zeta (0.8)`)、Refiner 行は switch-at 付き (`Refiner: xxx @0.8`) を出します。ユーザーがランキング上位のレシピを「どんな設定か」を一目で把握できるようになりました。
- **client と server の `rankingRollup.ts` の pinned hash テスト値が更新**されました (`d8217d823537a550fae6ea4cd21c5796a444ca19282ba06b8b2cf1703b67771c` → `a1c12356a84a8c60b8868ec0d1c8f07d484188ec0888298dc6d3ccf88a7be6bb`)。この pinned test は今後もクライアント/サーバーの hash 互換性を担保するリファレンスとして機能します。
- **`client/src/utils/rankingAnalysis.test.ts` と `client/src/components/RankingPanel.test.tsx` の base テストデータも新 shape に更新**されました。これらは今後 rank 分析ロジック / 表示ロジックを修正する際の regression 保護になっています。
