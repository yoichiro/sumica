# ADR 33: ライトボックスに Eye ボタンを追加してメインプレビューへ画像を反映する

## Context

Sumica のメインプレビューエリアは元々「新規生成中・生成直後」の 1 枚を表示するパネルとして設計されていました。そこには生成の進捗インジケータ、生成完了後の画像プレビュー、詳細メタデータ、「フォームにロード」ボタン、「削除」ボタンなどが集まっています。

一方、履歴ギャラリーのタイルを **ダブルクリック**（または後の [[adr-0034-gallery-d-key-delete-shortcut]] 周辺の作業でキャプション帯クリックに移行）すると、その画像がメインプレビューエリアに送られる `openInPreview()` フローが既に存在していました。過去の画像を「新規生成したかのようにプレビューで詳細確認する」ためのフローで、実運用で普通に使われていました。

しかし **ライトボックス経由でこの操作をしたい** 場面が徐々に増えてきました。特に次のようなワークフローです。

- ライトボックスで拡大表示中に「これ気になる、詳細を見よう」と思ったら、閉じてサムネイルに戻ってダブルクリックし直さなければならなかった
- 全画面表示 ([[adr-0026-lightbox-fullscreen-overlay]]) 中は上記フローがさらに面倒（全画面を抜けて、ライトボックスを閉じて、ダブルクリック）
- [[adr-0023-lightbox-random-shuffle]] のランダムシャッフル中に「今のこの画像良い、詳細確認したい」と思ったとき、切り替え履歴を辿り直す手間があった

`openInPreview()` の実装自体は既に存在し、`setCurrentGeneration(item) + setGenStatus('success') + setLoadingStep(3) + setRightTab('preview')` の 4 つの state 変化を起こすだけでしたが、これをライトボックスから呼び出す UI 導線が無い状態でした。

同時に考慮すべきは、生成中 (`enhancing` / `generating` / `saving`) の期間には `openInPreview()` は early return するべきだ、という既存 guard の存在です。ライブの進捗表示を過去画像で上書きすると、生成状態が壊れます。UI 側でも disabled 表示にして押せないことをユーザーに伝えるべきです。

## Decision

**ライトボックス右上のツールバーに Eye アイコンボタン (`right: 436px`) を追加し、押下で `openInPreview(displayedHistory[lightboxIndex]) + closeLightbox()` を実行します。生成中は disabled にします。プレビュータブ自身から開いたライトボックス (`lightboxIndex < 0`) では非表示にします。** 具体的な設計は次の通りです。

- **ボタン UI**: `lucide-react` の `Eye` アイコンで、既存のツールバー配置ルール (`right: 20/72/124/176/228/280/332/384` の次のスロット) に従って `right: 436px` に配置します。tooltip は `t.lightbox.openInPreviewTooltip` で日「メインプレビューに反映」、英「Show in main preview」。
- **押下時の挙動**: `openInPreview(item)` と `closeLightbox()` を並列に呼びます。`closeLightbox()` は既に [[adr-0026-lightbox-fullscreen-overlay]] の全画面解除 (`await document.exitFullscreen()`) を含んでいるため、全画面中でも問題なく動作します。
- **`lightboxIndex >= 0` のガード**: プレビュータブから開かれたライトボックス（生成直後の画像を拡大表示中、`lightboxIndex === -1`）では、そもそも「メインプレビューに反映」する意味がないため、ボタン自体を描画しません。
- **`openInPreviewDisabled` prop で生成中 disable**: 親から `openInPreviewDisabled: boolean` を受け取り、`genStatus === 'enhancing' || 'generating' || 'saving'` のときは true にします。ボタンは `disabled` 属性 + 視覚的 disabled スタイル (`opacity: 0.35, cursor: 'not-allowed'`) で明示化します。既存 Prev/Next/Shuffle と同じ disable パターン。
- **キーボードショートカットは付けない**: [[adr-0027-lightbox-space-selection-toggle]] (Space) / [[adr-0023-lightbox-random-shuffle]] (R) / [[adr-0034-gallery-d-key-delete-shortcut]] (D) と衝突しない残りキーは限られており、Eye ボタンは日常的な連打対象ではないので、押しやすさよりショートカット衝突予防を優先しました。

代替案として次を比較検討し、いずれも却下しました。

- **ボタンではなくダブルクリック**: ライトボックスの `<img>` 上でダブルクリックすると `openInPreview` が発火する案です。しかしライトボックス内には既に単一クリック（背景クリックで閉じる）の挙動があり、ダブルクリックを同居させるとタイミング判定の複雑さが再導入されます（[[adr-0027-lightbox-space-selection-toggle]] の付近で議論された、ギャラリータイルのクリック分離の教訓）。明示的なボタンが最も曖昧さがありません。
- **生成中も押せて `openInPreview` 側の early return に任せる**: 押せるように見えて実は何も起きない UI は明らかに不親切です。disable 属性 + 視覚フィードバックの二段構えが正解でした。
- **押下後もライトボックスは開いたまま**: メインプレビューを見に行きたい意図がボタン押下の動機なので、開いたままだと「あれ、反映されたの？」の確認が難しく、多くの場合は結局手動で閉じることになります。自動閉じが自然です。
- **プレビュータブから開いた lightbox でも Eye ボタンを表示 + disabled**: 「無意味なボタンが disabled で見える」より、「そもそも表示しない」の方が UI がすっきりします。`lightboxIndex >= 0` のガードは Space トグル ([[adr-0027-lightbox-space-selection-toggle]]) と同じパターンです。

## Status

承認済み

## Consequences

- **ライトボックスから 1 クリックでメインプレビューに送れる**ようになりました。特に全画面表示中や、シャッフルで気に入った画像に出会ったときのフロー摩擦が消えました。
- **プレビュータブの役割が拡張**しました。これまで「新規生成専用」だったパネルが、「任意の履歴画像も詳細確認できるパネル」に semantically 拡張されました。既存の `openInPreview` の意味論をライトボックスからも呼べるようにしただけで、根本的なアーキテクチャ変更ではありません。
- **生成中 disable の二段構え** (`openInPreview` の early return + Eye ボタンの disabled 属性) により、race condition が構造的に発生しません。ユーザーは disable された時点で押せず、万一 race で `openInPreview` が呼ばれても early return で吸収されます。
- **既存の disable パターンと統一**されたので、ユーザーは Prev/Next/Shuffle と同じ「押せない状態の見た目」を Eye ボタンでも直感的に理解できます。
- **[[adr-0027-lightbox-space-selection-toggle]] と同じ `lightboxIndex >= 0` ガード**を再利用しています。プレビュータブから開かれたライトボックスは「gallery 由来のアクションが意味を持たない」文脈で、この判定パターンが定着しました。今後同種のボタンを追加する際は同じガードを使えます。
- **ライトボックスのツールバー横幅** (右端 `20px` から左に 436px + 44px = 480px) が拡大しつつあります。8 個目のボタンになりました。今後 9 個目・10 個目を追加する場合、モバイル画面幅 (320px 前後) では画面をはみ出す可能性があり、レスポンシブ調整が必要になります。現状はデスクトップ運用のみのため問題化していません。
