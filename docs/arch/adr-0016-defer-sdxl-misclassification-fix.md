# ADR 16: リモート SD 環境での SDXL 誤判定に起因する「フォームにロード」バグの修正を当面見送る

## Context

2026-07-05 に洋一郎さんから、以下の画像で「フォームにロード」ボタンが正しく反映されないという報告がありました。

- 解像度: 1088×1408（SDXL の 9:7 L portrait プリセットに完全一致）
- モデル: `fuduki_mix_v20.safetensors [ce745cd67c]`（Illustrious XL ベースの SDXL アニメ系マージ）
- ステップ 30 / CFG 7 / Seed 3450982752 / Sampler DPM++ SDE / Scheduler Karras / LoRA siitake-eye + ClearHand-V2

`superpowers:systematic-debugging` の手順で症状を再現し、根本原因を以下の連鎖として特定しました。

1. 洋一郎さんの `server/.env` は `STABLE_DIFFUSION_URL=http://192.168.0.17:7860` を指しており、**Stable Diffusion 本体は sumica サーバーとは別マシン**（LAN の 192.168.0.17）で動作している。
2. sumica サーバーの `isSdxlCheckpoint(filename, title)`（`server/index.ts`、[[adr-0009-safetensors-header-sdxl-detection]]）は、SD が返した Windows 絶対パス `E:\stable-diffusion-webui\models\Stable-diffusion\fuduki_mix_v20.safetensors` を `toWslPath()` で `/mnt/e/...` に変換して読もうとする。しかしこのマシンには `E:` ドライブがマウントされておらず（`/mnt/c/` と `/mnt/wsl` のみ）、safetensors ヘッダ読み込みが失敗する。
3. `isSdxlCheckpoint` はキャッチしてフォールバック `title.toLowerCase().includes('xl')` に降りる（[[adr-0003-sd-sdxl-model-detection-heuristic]] の古い挙動）。`fuduki_mix_v20.safetensors` にはリテラル "xl" が含まれないため、**false（＝SD1.5）と誤判定**される。
4. `curl /api/sd-models` で実際に確認：`{"title":"fuduki_mix_v20.safetensors [ce745cd67c]","type":"sd15"}` が返る。SD1.5 と誤ってラベリングされている。
5. クライアント側 `computeLoadIntoFormState`（`client/src/components/loadIntoFormState.ts`）の `inferSdArchitectureFromTitle` はサーバーの返した `type` を信頼するため、`archToSet: 'sd15'` を返す。
6. `loadIntoForm` は `setModelTypeFilter('sd15')` を呼び、続く `[modelTypeFilter]` の `useEffect` が発火する。`findSd15Selection(1088, 1408)` は該当プリセットなしのため null を返し、**width/height が 512×512 にリセットされる**。SDXL のピッカーチップも同期されない。

再現用に実データ（`type: 'sd15'` としてのサーバー応答）を注入した TypeScript スニペットで `computeLoadIntoFormState` を呼び出したところ、以下の出力が得られて仮説を確定できました：

```
Case 1 (exact title in server-classified sd15):
  archToSet: sd15 (user expects: sdxl)
  sdxlPicker: null
  sd15Picker: null
```

つまり症状は「解像度がロード後 512×512 に戻される + アーキテクチャトグルが SD1.5 になる + それに連動して SDXL のピッカーチップが未反映」で、他フィールド（Steps / CFG / Seed / Sampler / Scheduler / LoRA）は直接 setState で伝播するので影響を受けません。

この問題は「XL が名前に入っていない SDXL チェックポイント」全般で発生します。洋一郎さんの環境では `fuduki_mix_v20`、`aiAngelMix_v30`、`omnigenxlNSFWSFW_v10` の一部など、命名規則から外れた SDXL マージが多数存在するため、影響範囲は広いと言えます。

## Decision

**当面はコード上の修正を行わず、既知の制約として本 ADR に記録するに留めます。**

議論した修正候補は以下の 3 案でしたが、いずれも見送りました：

- **案 A: 生成時に arch を metadata に永続化する** — `GenerationParams` に `modelArchitecture: 'sd15' | 'sdxl'` を追加し、クライアントが生成リクエスト送信時にトグル状態を含める。サーバー・Firestore・ローカル `metadata.json` に永続化。`loadIntoForm` は保存された値を信頼。既存レコードはヒューリスティックに fallback。
- **案 B: 寸法で override する** — `computeLoadIntoFormState` で、サーバーが sd15 と返しても寸法が SDXL のプリセットにマッチしかつ SD1.5 のどれにもマッチしない場合は sdxl に上書き。既存・新規レコード共に効く即効性のある局所修正。
- **案 C: 案 A + 案 B の両方** — 新規レコードは保存された arch を信頼、旧レコードは寸法バリデーションで救済。堅牢だが変更範囲が広く、モデルドロップダウンで `fuduki_mix` が SD1.5 側にしか表示されない別問題は依然として残る。

見送りの理由は複数あります：

- **根本原因は sumica コードの外にある**。sumica サーバーが動作する WSL からリモート SD マシンの安全にヘッダを読める経路が存在しないことがすべての引き金であり、コード側の緩和策はいずれも間接的な対処にしかならない。より直接的な解決策は「E: ドライブを sumica 側の WSL2 にも見せる（ネットワーク共有 + `mount -t drvfs`、あるいは SSH マウント経由の bind）」あるいは「sumica を SD と同じマシンに移す」で、これらは環境構築側の判断。
- **回避策が実用範囲で機能している**。洋一郎さんは日常運用として、SDXL 画像を扱う際は手動でトグルを SDXL に切り替え、ドロップダウンから該当モデルを選ぶワークフローが既に定着している（そもそも「XL がついていない SDXL アニメモデル」を運用してきた歴史がある）。「フォームにロード」の反映欠落は不便だが、致命的な作業阻害ではない。
- **修正コストと発生頻度の見合い**。案 A は 3 ファイル以上を触る schema 追加、案 B は挙動が「モデルの分類を寸法で覆す」というやや直感に反するロジックになり、案 C はさらに広範囲。バグ発生時は再ロードで手動修正できる範囲であり、コスト対効果として今すぐの投資に値しないと判断しました。
- **上位の解決策と混ざる恐れ**。将来 [[adr-0009-safetensors-header-sdxl-detection]] のヘッダ検査ロジックを「リモート SD 環境でも動くよう」に拡張する日が来た場合、そのタイミングで案 A/B は同時に見直したくなる可能性が高い。局所修正を先行させてしまうと、より根本的な解決策との整合を取り直す作業が発生します。

修正を将来やる場合の推奨は **案 A（生成時に arch を metadata に永続化）** です。理由は、生成トグルの状態はユーザー本人が意図した ground truth であり、モデル分類の権威として最も信頼できるためです。案 B の寸法 override は既存レコードのために温存する 2 次的なセーフティネットとして併用が理想。案 C は案 A + 案 B の集合として自然に到達します。

## Status

置き換え済み（[[adr-0042-flux-support-3way-architecture]] により置き換え）。本 ADR で保留していた「案 A: 生成時に arch を metadata に永続化」の実装が ADR-42 の Flux 対応と同時に行われました。新規生成レコードは `modelArchitecture` を保存するため本 ADR の症状は起きません。ただし ADR-42 以前に生成された既存レコードにはフィールドが無いため、そちらでは引き続き本 ADR のワークアラウンド（トグルの手動切替）が有効です。

## Consequences

- **「フォームにロード」実行後、SDXL の非"XL"命名モデル画像は arch トグルと解像度が誤って SD1.5 側に落ちる挙動が残る**。ユーザーは以下の手順で復旧できます：ロード後にトグルを手動で SDXL に切り替え → ラジオピッカーで元の寸法（例えば 9:7 L portrait）を選び直す → モデルドロップダウンから該当 SDXL モデルを選び直す。全体で 3 クリック程度で済むワークアラウンド。
- **モデルドロップダウンでは、名前に "xl" を含まない SDXL モデルは常に SD1.5 側にしか表示されない**。これは本 ADR の直接症状ではないが、同じ根本原因（サーバーの誤分類）から派生する既知の副作用です。ユーザーは「SD1.5 にラベリングされた fuduki_mix_v20 を SDXL のつもりで選ぶ」運用を明示的に受け入れています。
- **本 ADR の存在自体が知見の永続化になる**。将来同じ症状に別の作業者（あるいは未来の Claude Code セッション）が遭遇したとき、本 ADR を辿れば診断済みであることが分かり、再度深追いする必要はありません。修正を検討する際も、案 A/B/C のトレードオフがそのまま出発点になります。
- **修復のトリガーとなり得るイベント**：以下のいずれかが起きたら本 ADR の見直しを行う判断根拠になります。
  - sumica を SD と同じマシンに引っ越す（`/mnt/e/` が使えるようになる）
  - リモート SD マシンのモデルディレクトリを WSL 側で参照可能にする仕組み（SSHFS、SMB マウント等）を導入する
  - "xl" を含まない SDXL モデルが日常的に増え、ワークアラウンドが煩雑と感じるようになる
  - 生成メタデータのスキーマ変更が別件で発生し、`modelArchitecture` の追加をついでに行える機会が生まれる
- **本 ADR は Superseded に移行しやすい構造にしてある**：将来、案 A（arch 永続化）を実装する ADR を新設した場合、その新 ADR の Context で本 ADR に言及し、本 ADR の Status を「Superseded by ADR NN」に書き換えて履歴を保つ。
