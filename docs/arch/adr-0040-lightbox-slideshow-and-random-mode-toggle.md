# ADR 40: ライトボックスにスライドショー機能とランダムモードトグルを追加する

## Context

ライトボックス（`client/src/components/Lightbox.tsx`）は [[adr-0023-lightbox-random-shuffle]] の時点で、ツールバーに Shuffle アイコンと `R` キーバインドを持ち、押下のたびに `displayedHistory` から現在画像を除外した 1 枚を index-shift 方式でランダムに引き当てて表示する、という 1-shot 動作をしていました。同じライトボックスには前後ナビゲーション（`← / →` ボタンと矢印キー）もあり、こちらは `displayedHistory` を線形順に辿ります。両者は独立した機能で、ボタンとキーバインドがそれぞれ 1 つずつ割り当てられていました。

洋一郎さんから、大量の画像を「ぱらぱら眺める」ためのより発見的な閲覧手段として、次の 2 つのリクエストが上がりました。

- **スライドショー**: ライトボックスや全画面表示中に、一定時間で自動的に画像を進めていく機能。
- **既存 Shuffle 挙動の再定義**: 「ランダム表示のアイコンボタンをトグル化し、ON のときは前後ボタン押下でランダムに次/前を選ぶようにしたい。スライドショーも、このトグルの ON/OFF に応じて次の画像をランダムに選ぶかどうかを決める」

この 2 つを愚直にそのまま実装すると、ボタンが「Shuffle（1-shot）+ Slideshow（play/pause）+ Random-in-slideshow（別トグル）」の 3 つに膨らみ、ライトボックス上部の絶対配置ツールバーの残りスロットを圧迫します。また、「手動ナビゲーションが順送りなのに、スライドショーだけランダム」あるいはその逆、という組み合わせは、ユーザーからの明確な要望はなく、意味論的にも噛み合いが悪いという判断が洋一郎さんから示されました。

一方で、既存の Shuffle ボタンを廃止する形になるので、[[adr-0023-lightbox-random-shuffle]] の Decision を上書きすることになります。ADR の履歴を尊重するため、旧 ADR の本文は保持しつつ Status で置き換え済みであることを明示する必要があります。

キーボード処理は [[adr-0015-ui-component-split-with-hybrid-state]] のテスト方針を継承した純粋関数 `resolveLightboxKey`（`client/src/components/lightboxKeyboard.ts`）に集約されており、そこに action 種別を追加/リネームするのが自然な拡張路線です。既存の `R` キーは `{ type: 'randomize' }` を返していましたが、今回の再定義でボタン挙動が「一発ランダムジャンプ」ではなく「モードのトグル」に変わるため、action 名も `toggleRandom` に改めるのが意味論として正確です。同じく `P` キー（Play/Pause の mnemonic）を追加してスライドショーのトグルに割り当てます。既存の Esc / ←→ / Space / F / R と衝突せず、Space（選択）や F（お気に入り）と同じ「ゲート付き（`lightboxIndex >= 0` のときだけ発火）」パターンを再利用できます。

スライドショーのタイマーは React 側の `setInterval` 一択で、間隔・状態・タイマー全部を App.tsx の state に持たせるか、Lightbox コンポーネントの内部 state に閉じ込めるかで判断が分かれます。ライトボックスは開閉と再表示を頻繁に繰り返す UI で、閉じるたびに Lightbox がアンマウントされるため、Lightbox 側に state を持たせるとランダムモードもスライドショー状態も毎回リセットされてしまい、ユーザー体験として不自然です。App.tsx 側に state を持たせれば、閉じても Random モードの選択は残せます（スライドショーは意図的に閉じる時点で pause します）。

## Decision

**私たちは、既存の 1-shot Shuffle ボタンと `R` キー動作を廃止し、ライトボックスに次の 2 つの独立したトグルを追加します。**

1. **ランダムモードトグル**: 既存の Shuffle アイコンボタンを流用し、`aria-pressed` の状態を持つトグルに昇格します。ON のとき、手動 ← / → ボタン押下と後述のスライドショー自動送りの両方が「現画像を除外してランダムに 1 枚を選ぶ」に切り替わります。OFF のときは従来通りの線形順ナビゲーションです。キーバインドは `R`（`resolveLightboxKey` の action 名は `randomize` → `toggleRandom` にリネーム）で、押すたびにトグル状態が反転します。
2. **スライドショートグル**: 新しく `Play` / `Pause` アイコンのボタンをツールバーに追加し、押すごとに再生/停止をトグルします。再生中は 5 秒ごとに `setInterval` が発火し、次の画像に進みます。次画像の選び方はランダムモードトグルの状態に従います。キーバインドは `P` を追加します。

具体的な設計は次の通りです。

- **状態管理**: `randomMode: boolean` と `slideshowPlaying: boolean` は `App.tsx` に置きます。閉じても Random モードの選択は保持され、次回ライトボックスを開いた時にそのまま引き継がれます。スライドショーは閉じる時点で自動的に停止（`slideshowPlaying = false`）します。
- **手動ナビゲーション**: `navigateLightbox(delta)` を `randomMode` で分岐し、ON のときは既存の `randomizeLightbox()`（[[adr-0023-lightbox-random-shuffle]] の index-shift 方式抽選）を呼び出します。OFF のときは従来通り `displayedHistory[index + delta]` を選び、末端で clamp（← / → ボタンを disabled 化）します。ランダムモードの末端 clamp は不要で、常に「別の 1 枚」に切り替わります。
- **スライドショータイマー**: `useEffect` が `slideshowPlaying === true` かつ `lightboxIndex >= 0` かつ `displayedHistory.length >= 2` の条件で `setInterval(..., SLIDESHOW_INTERVAL_MS)` を張り、コールバック内で「ランダムモードなら `randomizeLightbox()` 相当のロジック、そうでなければ `(index + 1) % length` の順送り＋ラップ」を実行します。deps 配列は `[slideshowPlaying, lightboxIndex, randomMode, displayedHistory]` として、モード切替や手動ナビゲーションによる `lightboxIndex` の変化のたびにタイマーが張り直されて残り時間がリセットされます。
- **次画像選択の純粋関数化**: `client/src/components/slideshowStep.ts` に `nextSlideshowIndex(currentIndex, totalCount, randomMode, rand = Math.random)` を新設し、ユニットテスト（境界 / 衝突 / ラップ / 統計的 fuzz）を書きます。これによりタイマー本体は React 側に薄く保ち、選択ロジックは jsdom 依存なしで検証できます。ランダム抽選は既存の `randomizeLightbox` と同じ index-shift 方式で、`rand` を注入可能にすることで決定的テストを可能にします。
- **キーボード**: `resolveLightboxKey` の `LightboxKeyAction` に `{ type: 'toggleRandom' }` と `{ type: 'toggleSlideshow' }` を追加し、`R` / `r` と `P` / `p` にマップします（`lightboxIndex >= 0` のときのみ発火、プレビュータブの単発ライトボックスでは無効）。既存の `{ type: 'randomize' }` は削除します。
- **ボタン配置**: Shuffle トグルは既存の `right: 384px` を維持、新規 Slideshow トグルは `right: 436px` に置きます。既存の Open-in-preview（Eye）ボタンは `right: 436px` から `right: 488px` に 1 スロット退避させます。両ボタンとも `lightboxIndex < 0 || displayedHistory.length < 2` で disabled にします（お気に入り 1 件だけのフィルタなど）。
- **i18n**: `t.lightbox.randomTooltip` を削除し、`randomModeToggleOnTooltip` / `randomModeToggleOffTooltip` / `slideshowStartTooltip(seconds)` / `slideshowStopTooltip` を ja / en 両方に追加します。tooltip の秒数部分は関数化して、後続 ADR（[[adr-0041-slideshow-interval-selection-and-countdown-ring]]）での可変間隔対応に備えます。
- **キーハンドラの deps**: ライトボックスキーハンドラの `useEffect` deps に `randomMode` を含めます。この漏れがあると、キーボード `R` でモードを切り替えた直後の `←` / `→` 押下が古いクロージャの `navigateLightbox` を掴んでしまい、モード切替が 1 サイクル遅れて反映される問題が起きるためです。

代替案として次を比較検討し、いずれも却下しました。

- **既存 Shuffle ボタンを残したまま、別ボタンで「常時ランダム再生」モードを追加する**: ツールバーが 3 ボタン増えてしまい、UI が過密になります。また、手動ナビゲーションが順送りなのに再生だけランダム、という組み合わせは意味論的に噛み合わず、洋一郎さんからも 1 つのトグルで統一する明確な指示がありました。
- **スライドショーの state を `Lightbox` コンポーネントの内部に持たせる**: ライトボックスの閉じ/開き直しでランダムモードもリセットされる UX になり、閲覧セッションを跨いだ「気に入ったモードで続きを見る」使い方が難しくなります。App.tsx に上げる方が閉じても状態が生きるので採用しました。
- **タイマー内で直接 setState を呼ばず、`requestAnimationFrame` ベースで実装する**: 5 秒間隔の粗い刻みには過剰で、React 18 の automatic batching と `setInterval` の組み合わせで十分安定しています。RAF は次項 ADR のカウントダウンリング可視化のみに使う判断です。
- **`R` キーの action 名を `randomize` のまま残す**: 挙動が「1 発ジャンプ」から「モードのトグル」に完全に変わったのに古い名前を残すと、`resolveLightboxKey` のテストと switch 分岐の意味論が乖離します。名前をリネームするコストは小さく、意図の一致を優先しました。

## Status

承認済み（Supersedes [[adr-0023-lightbox-random-shuffle]]）

## Consequences

- **ライトボックス上での連続閲覧体験が大きく拡張されました**。数百枚のお気に入り集合や、日付フィルタで数十枚に絞った集合を、手動でめくるだけでなく「ランダムに勝手に進む」で発見的に眺められるようになり、体感が変わったと洋一郎さんからのフィードバックがありました。
- **[[adr-0023-lightbox-random-shuffle]] の 1-shot Shuffle は完全に廃止**されました。旧 ADR は本文をそのままにしつつ Status を Superseded に変え、変更経緯が追跡可能な形で保存されています。既存の `randomizeLightbox()` 関数（index-shift 抽選）と、`lightboxIndex < 0` / `displayedHistory.length < 2` で disabled にする 2 段防御は、そのまま新設計の中で再利用されています。
- **キーハンドラの `useEffect` deps に `randomMode` を含めなかった初版で、キーボード `R` → `→` の連打で 1 サイクル遅れる stale closure が発生**しました。ブラウザ検証で捕捉して 1 語追加で直しました。この経験は「App.tsx のキーハンドラ deps は、そこから呼ばれる関数がクロージャで掴んでいる state をすべて含める必要がある」という運用ルールとして、後続の類似機能追加で意識する必要があります。
- **`slideshowStep.ts` の純粋関数化により、選択ロジックが jsdom 依存なしでユニットテスト可能**になりました。既存の `lightboxKeyboard.ts` と同じパターンで、`App.tsx` に薄い接続だけを残すという [[adr-0015-ui-component-split-with-hybrid-state]] の方針が広がりました。ランダム抽選の `rand` 注入は、決定的テストを可能にしただけでなく、将来 seeded PRNG を使いたくなった場合にもそのまま拡張可能です。
- **ライトボックスの絶対配置ツールバーが 1 スロット埋まりました**（Eye ボタンが `436px` → `488px`）。将来さらにボタンを増やす場合、`right: 540px` から先の空きスロットを使うか、既存機能を統合する必要があります。ツールバーがそろそろ手狭になってきているのは事実で、次に大きな UI 追加を考えるときは配置の全面見直しが視野に入る可能性があります。
- **ライトボックスを閉じるとスライドショーは自動停止**しますが、Random モードは保持されます。この非対称は「Random モードは閲覧スタイルの選好で、Slideshow は今この瞬間の再生状態」という意味論の違いを反映したもので、意図的です。ドキュメント（i18n の tooltip 文言）で明示していないため、初見のユーザーには自明ではないかもしれません。
- **`P` / `R` キーはブラウザやライトボックス配下では他ショートカットと衝突しません**が、IME 有効時に日本語入力に流れる可能性は [[adr-0023-lightbox-random-shuffle]] 時点と同じく残っています。実運用上は問題になっていません。
- **スライドショーの間隔は 5 秒固定**として実装されましたが、この判断はブレスト時点で「シンプルな実装優先、必要になったら定数を変えるだけ」と割り切ったものでした。実際に触ってみた結果、洋一郎さんから「やはり選択できるようにしたい」というリクエストが数時間後に上がり、[[adr-0041-slideshow-interval-selection-and-countdown-ring]] で可変化されることになりました。ブレスト時に out-of-scope としても、触った瞬間に必要性が顕在化するタイプの UX 判断は事前予測が難しいという学びが得られています。
