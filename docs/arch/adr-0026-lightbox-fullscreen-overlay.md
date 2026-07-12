# ADR 26: ライトボックスから OS 全画面へは Fullscreen API でオーバーレイごと昇格する

## Context

ライトボックス ([[adr-0013-lightbox-info-panel]] / [[adr-0025-lightbox-view-transitions]]) で拡大表示している画像を、ブラウザのウィンドウ枠すら消してさらに大きく見たい場面が実運用で頻繁に出てきました。ノートPC の画面が小さい、SDXL のフル解像度 1024 以上の画像を細部まで確認したい、といった動機です。

ブラウザには Fullscreen API (`element.requestFullscreen()` / `document.exitFullscreen()`) があり、任意の DOM 要素を OS 全画面に昇格できます。ただし何を全画面に昇格させるかで、UX が大きく変わります。

- **`<img>` だけを昇格**: 画像は最大化されますが、閉じるボタン・全画面解除ボタン・ナビゲーション ←→・情報パネル・選択トグル・シャッフル・お気に入り・Eye ボタンといった **ライトボックスのツールバーが全部消えます**。全画面を抜けるには Esc キーを覚えている必要があり、閉じる ✕ ボタンも見えないため、初回利用者には迷宮になります。
- **ライトボックスの `<div>` オーバーレイごと昇格**: ツールバー・情報パネル・ナビゲーションボタンがそのまま OS 全画面内に残ります。全画面中でもすべての操作を継続でき、しかも Esc の挙動を全画面解除に振り分ければ「Esc = 全画面解除 → もう一度 Esc = ライトボックス閉じる」の 2 段階終了になり、ユーザーが誤って全部閉じてしまう事故が減ります。

Esc キーの解釈は [[adr-0025-lightbox-view-transitions]] の `closeLightbox()` 内でも扱っており、`document.fullscreenElement` があれば `await document.exitFullscreen()` してから View Transition を走らせる、というシーケンスに組み込む必要があります。

## Decision

**Fullscreen API の対象は `<img>` 要素ではなく、ライトボックスのオーバーレイ全体を指す `lightboxRef.current` にします。** 具体的な設計は次の通りです。

- **`toggleFullscreen()`**: `document.fullscreenElement` があれば `document.exitFullscreen()`、なければ `lightboxRef.current.requestFullscreen()` を呼ぶトグル関数を、ライトボックスの ⛶ / ▭ ボタンにバインドします。
- **状態追従**: React 側の `isFullscreen` state は、`document` の `fullscreenchange` イベントで `!!document.fullscreenElement` を反映します。トグル関数側で直接 state を設定しないのは、OS 側から全画面を抜けられた場合（Esc、F11、ジェスチャ等）にも state を追従させるためです。
- **Esc キーの優先順位**: ライトボックスのキーボード解決器 `resolveLightboxKey` は、`document.fullscreenElement` が真のときは Esc に対して `null`（何もしない）を返し、ブラウザ標準の「Esc で全画面解除」だけを効かせます。全画面でないときの Esc は `closeLightbox()` を返します。つまり **Esc は「まず全画面を抜け、次にライトボックスを閉じる」の 2 段** です。
- **`closeLightbox()` の順序制約**: [[adr-0025-lightbox-view-transitions]] の View Transition と組み合わせるため、`closeLightbox()` は `if (document.fullscreenElement) await document.exitFullscreen()` を先に置いてから `startViewTransition` を起動します。exit を待たないと、View Transition のスナップショットが全画面状態のまま撮られて、閉じる演出が破綻します。
- **全画面時の内部レイアウト**: OS 全画面と CSS の `position: fixed; inset: 0` は 100% viewport に一致するため、ライトボックス側で全画面用の追加 CSS は書きません。ツールバーの絶対配置（`right: 20px, 72px, ...`）はそのまま活きます。

代替案として次を比較検討し、いずれも却下しました。

- **`<img>` だけを全画面化してツールバーを別レイヤーで overlay**: Fullscreen API は 1 要素しか昇格できないため、別の HTML 要素を全画面中の上に重ねるのは不可能です（ブラウザは全画面要素の外を描画しません）。無理に実現するには CSS の擬似全画面 (`position: fixed; z-index: 999999`) にする必要があり、そもそも本物の OS 全画面ではなくなります。
- **CSS 擬似全画面**: OS 全画面には勝てません。ブラウザのタブバー・アドレスバーが残るため、画面サイズを最大限使い切ることができません。
- **全画面ボタンを Esc/ボタン以外にも省略**: 全画面自体を廃止する選択もありましたが、大画面で細部を見たい需要は実運用で明確にあり、廃止は現実的ではありませんでした。

## Status

承認済み

## Consequences

- **全画面中でも全ツールバー操作が継続できます**。ユーザーは全画面のまま次の画像へ ←→ で送ったり、⭐ お気に入りに追加したり、Info パネルを開いたり、Eye ボタン ([[adr-0033-lightbox-eye-button-open-in-preview]]) でメインプレビューに反映したりできます。「操作したら全画面が抜けてしまう」体験ロスが発生しません。
- **Esc の 2 段階解釈により、意図しない完全クローズを避けられます**。「全画面を抜けたかっただけなのに、そのままライトボックス自体まで閉じてしまった」という誤操作が起きなくなりました。
- **[[adr-0025-lightbox-view-transitions]] の閉じる遷移との順序結合**が発生しています。全画面解除を await せずに View Transition を起動するとスナップショットが壊れるため、`closeLightbox()` を編集する際には順序制約を意識する必要があります。実装コメントで明示しています。
- **モバイル/タブレットブラウザでは Fullscreen API のサポート状況にばらつき**があり、iOS Safari は `<video>` 以外の要素で `requestFullscreen()` を呼ぶと拒否される制約があります。Sumica はデスクトップ運用が想定なので現状問題になっていませんが、モバイル対応が視野に入ったら再検討が必要になります。
- **`fullscreenchange` イベント経由の state 追従は、OS 全画面が外部起因（F11 やジェスチャ）で切り替わっても正しく効きます**。ただし React の state 更新は非同期のため、event 発火直後に `isFullscreen` を参照するコードは 1 tick 分の遅延を意識する必要があります。実運用では影響は出ていません。
