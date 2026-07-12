# ADR 25: ライトボックスのサムネ⇄拡大遷移に View Transitions API のモーフを採用する

## Context

履歴ギャラリーのサムネイルをクリックするとライトボックスで拡大表示する UI は、Sumica の初期から存在しました。当初は開閉が瞬間切り替えで、「どの画像を拡大したのか」の対応関係が視覚的に伝わりにくく、特に数十枚並んだ日付分のギャラリーから 1 枚を選んで拡大したときに、開いた瞬間の視点移動が急で酔いやすいという体験上の課題がありました。

同時期、モダンブラウザで [View Transitions API](https://developer.chrome.com/docs/web-platform/view-transitions/) が Baseline 2025-10 に到達し、`document.startViewTransition` と `view-transition-name` の shared-element 遷移で「同じ視覚要素が別の位置・サイズに滑らかに移動する」演出が、DOM 側のスナップショット・補間・レイアウト計算をブラウザ実装に任せられる状態になっていました。従来手段（CSS の `transform` トランジション、React 側でのアニメーションフレーム制御、`framer-motion` などのライブラリ導入）と比べて、実装は極端に短くなりますが、非対応ブラウザや `prefers-reduced-motion: reduce` 設定ユーザーへのフォールバックを別途書く必要があります。

Sumica の設計原則としてクライアントスタックは意図的に薄く保っており ([[adr-0015-ui-component-split-with-hybrid-state]] 参照)、`framer-motion` などのアニメーションライブラリ導入は差止め対象になっていました。しかし演出を諦めるかどうかは別問題で、「ブラウザネイティブ API で書ける範囲でリッチにする」という方向はむしろこの原則と両立します。

閉じるときの挙動には固有の落とし穴が 2 つありました。1 つ目は、ライトボックス背景をクリックしても閉じる仕様なので、閉じる遷移中にもう一度クリックが飛んで二重発火し得ること。2 つ目は、後に [[adr-0026-lightbox-fullscreen-overlay]] で追加した OS 全画面表示中に閉じると、View Transition が「まだ全画面のままの DOM」をスナップショットしてしまい、Chrome が全画面を実際に離れる 1 秒程度の間、画像が最大化されたまま固まって見える問題でした。

## Decision

**サムネイル ⇄ ライトボックス拡大の遷移を `document.startViewTransition` の shared-element 遷移で実装します。** 具体的な設計は次の通りです。

- **`view-transition-name` の張り替え**: 拡大対象のサムネイルには `viewTransitionName: 'lightbox-morph'` を付け、ライトボックスの `<img>` 側にも同名を付けます。開くとき・閉じるときのどちらも、`flushSync(() => setLightboxUrl(...))` で React の DOM 反映を確定させたうえで `startViewTransition` の callback 内に閉じ込め、開閉前後のスナップショットを取ります。同じ名前が同時に複数要素に付いていると View Transitions は fail するため、`morphSourceKey` state でどのサムネイルに name を付けているかを管理し、遷移完了 (`transition.finished.finally`) で name を外す運用にします。
- **非対応環境フォールバック**: `(document as DocumentWithViewTransition).startViewTransition` が存在しない場合は、そのまま `setLightboxUrl(null)` / setState を実行して即時切替に degrade します。ライブラリ側のポリフィルは入れません。
- **`prefers-reduced-motion` オーバーライド**: CSS 側で `@media (prefers-reduced-motion: reduce)` を宣言し、`::view-transition-group(lightbox-morph)` の `animation-duration: 0` などで演出を抑制します。JS 側の制御ロジックは変えません。
- **クリック二重発火の吸収**: `transition.ready.catch(() => {})` を書いて、rapid toggle でスキップされた遷移が Promise rejection として例外扱いされないようにします。
- **閉じるときの全画面解除**: [[adr-0026-lightbox-fullscreen-overlay]] で有効化する OS 全画面表示中に `closeLightbox()` が呼ばれた場合、まず `await document.exitFullscreen()` して DOM が全画面から離れるのを待ってから `startViewTransition` を起動します。exit を await せずに transition を始めると、スナップショットが全画面状態のまま撮られてしまい、閉じる演出が破綻するためです。

代替案として次を比較検討し、いずれも却下しました。

- **CSS Transition + `transform` の自作モーフ**: 実装量が大幅に増え、サムネイルとライトボックスが別コンポーネントで React tree 上も離れているため、開閉前後の位置とサイズを両方の側で計測して補間する必要があります。View Transitions API はこの補間をブラウザに任せられるので、コード量は圧倒的に少なくなります。
- **`framer-motion` の `layoutId`**: 同種の shared-element 遷移をきれいに提供しますが、Sumica のクライアントスタックに追加依存を持ち込むほどのメリットではありません（[[adr-0015-ui-component-split-with-hybrid-state]] の「薄く保つ」原則と衝突）。
- **演出なし・即時切替**: 元の状態です。実装は最小ですが、拡大対象の視認性が悪く、体験の質が明らかに劣後します。

## Status

承認済み

## Consequences

- **開閉の視覚的な連続性が生まれ、拡大対象のサムネがはっきり分かる**ようになりました。実装追加コストは `startViewTransition` 呼び出しと `viewTransitionName` プロパティを追加するだけで、コード量は極めて小さく収まっています。
- **View Transitions API 非対応の古いブラウザ環境では、演出だけが degrade し、機能は無傷**です。開閉自体は動作するため、Sumica の core 機能は影響を受けません。
- **`prefers-reduced-motion: reduce` を尊重**しているため、モーション過敏なユーザーが OS 設定を変えていれば、Sumica はそれに従います。ライブラリを入れなかったことで、この配慮も自前で管理する必要がありますが、CSS 側のオーバーライドだけで済んでいるため保守コストは低いです。
- **同名の `view-transition-name` が同時に存在するとブラウザが遷移をスキップ**するため、`morphSourceKey` の張り替えロジックには特有の慎重さが必要です。遷移が予告なくスキップされたときは `transition.ready.catch(() => {})` で吸収しますが、開発時にモーフが「動いたり動かなかったり」する場合はこの重複が第一の疑い箇所になります。
- **[[adr-0026-lightbox-fullscreen-overlay]] の全画面解除との連携**が必要になりました。`await document.exitFullscreen()` を挟まないと閉じる演出が壊れることは、実装後にはっきり見えた振る舞いで、`closeLightbox` を書き換える人はこの順序制約を意識する必要があります。
- **ライトボックスのランダム画像切替 ([[adr-0023-lightbox-random-shuffle]])** や ←→キーの連続送り時は、View Transition をあえて通さずに即時差替えする判断を後の実装で入れています。連続操作にモーフを挟むと視覚的な疲労が増え、逆効果になるためです。この使い分けは実装コメント側で明示しています。
