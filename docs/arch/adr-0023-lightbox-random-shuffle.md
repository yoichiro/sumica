# ADR 23: ライトボックスに「ランダム画像」ボタンと R キーを追加する

## Context

洋一郎さんはこれまでに Firestore 側だけで 1128 枚を超える画像を蓄積してきており、履歴ギャラリーには「日付フィルタで絞ったその日の生成群」または「お気に入りのみ」の 2 種類の絞り込み表示があります。ライトボックスは開いた時点の `displayedHistory` 配列（現在のフィルタ結果）に紐づいて動作し、既存のキーボードショートカット（`←` / `→` / Space / F / Esc）はすべてそのリストを前提としています。

大量の画像を眺めるユースケースにおいて、`←` / `→` の線形順ナビゲーションだけだと「次はどれ？」という発見的な閲覧体験が薄い、という要望が洋一郎さんから出ました。**「現在表示中の集合の中から 1 枚をランダムに選んで表示する」機能** があれば、お気に入り 200 枚以上をぱらぱら眺めるような場面で楽しさが増します。

一方で、ランダム選択の "選び方" には設計判断のブレがあります。素朴に `displayedHistory` 全体から uniform 抽選すると、確率 1/n で **現在表示中の画像自身** が引き当てられます。この場合クリック / R キー押下に対して画面が視覚的に何も変化せず、ユーザーには「押したのに壊れてる？」という UX の穴が生じます。回避には 2 系統のアプローチがあります。

- **常に "他の 1 枚" を uniform 抽選する** — 画面は必ず切り替わる。ただし displayedHistory の要素数が 1 のときはボタンを disabled にする必要が出る。
- **全 n 枚から uniform 抽選する** — 実装は最短。ただし「たまに何も起きない」UX の穴を許容する必要がある。

洋一郎さんはこの分岐で前者を明確に選ばれました。

キーボードショートカットについては、[[adr-0018-gallery-caption-static-display]] 以降に育ってきたライトボックス向けのショートカット群（Escape / ←→ / Space / F）と衝突しない R キーを、"Random" のニーモニックとして自然に採用可能です。S キーはかつて F キーの alias として追加され直後に revert された経緯 (`df771f0` → `7374c74`) があるため、既存の未使用キーの中で最も候補として素直な R を選びました。

キーボード処理のマッピングは [[adr-0015-ui-component-split-with-hybrid-state]] のテスト方針を継承した `client/src/components/lightboxKeyboard.ts` の純粋関数 `resolveLightboxKey` に集約されており、そこに新しい action type を追加するのが自然な拡張路線でした。

## Decision

**ライトボックスのツールバーに Shuffle アイコンボタン、キーボードに R/r ショートカットを追加し、押下時は `displayedHistory` から現在表示中の画像を除いた要素の中から uniform 選択で 1 枚に切り替えます。**

具体的な設計は次の通りです。

- **キーボード解決**: `lightboxKeyboard.ts` の `LightboxKeyAction` に `{ type: 'randomize' }` を追加し、`R` / `r` に対して `lightboxIndex >= 0` のときに限り返します。プレビュータブのライトボックス（`lightboxIndex === -1`）はギャラリー集合を持たないので shuffle 対象外です。
- **ランダム選択アルゴリズム**: `client/src/App.tsx` の `randomizeLightbox()` は、`displayedHistory.length - 1` 個の "other" 要素から uniform 抽選する形で実装します:

  ```ts
  let next = Math.floor(Math.random() * (displayedHistory.length - 1));
  if (next >= idx) next += 1;
  ```

  `[0, n-2]` から一様抽選した後、値が現在 index 以上なら +1 する index-shift 方式です。**rejection loop（再抽選ループ）を使わず**、必ず 1 回の抽選で "現在以外の n-1 個から uniform 選択" を達成します。

- **ボタン配置**: `client/src/components/Lightbox.tsx` のツールバーに `lucide-react` の `Shuffle` アイコンを配置します。既存の絶対配置レイアウト（`right: 20px, 72px, 124px, 176px, 228px, 280px, 332px`）の次のスロット `right: 384px` に追加します。ボタンは `lightboxIndex < 0` または `displayedHistory.length < 2` のとき disabled にします（"other" が 1 個未満なら shuffle 不能）。
- **国際化**: `client/src/i18n/ja.ts` に `randomTooltip: 'ランダムな画像に切り替え (R)'`、`en.ts` に `Jump to a random image (R)` を追加します。
- **単体テスト**: `lightboxKeyboard.test.ts` に R/r → `{ type: 'randomize' }`、preview モード時 `null` の 3 ケースを追加します（合計 16 tests）。

代替案として次を比較検討し、いずれも却下しました。

- **現在画像を含めた uniform 抽選**（"クリックしても稀に何も起きない" バリアント）: 実装は最短ですが、「押したのに何も起きなかった」体感が明らかに UX の穴です。特にキーボードショートカット R を連打しているときは 1/n の確率で「無反応」が発生し、ユーザーが困惑します。
- **rejection loop で現在画像を除外**（現在 index が抽選されたら再抽選する）: 動作は正しくなりますが、確率的に無限ループの理論的リスクが残り、実装が index-shift 方式より複雑になります。index-shift は 1 発で正解にたどり着き、確率分布も証明可能に uniform になるため、より綺麗な選択です。
- **キーボードショートカット無しでボタンのみ提供**: 実装はわずかに簡単ですが、既存の F/Space パターンとの一貫性が損なわれます。Random は "R" の mnemonic が自然で、既存の未使用キーと衝突しないので追加コストは無視できるレベルです。
- **プレビュータブのライトボックスでも shuffle 可能にする**: そもそもプレビュータブは "今生成中/最後に生成された 1 枚" しか表示しないので shuffle 対象がありません。`lightboxIndex >= 0` ガードで無効化するのが素直です。

## Status

承認済み

## Consequences

- **ライトボックスを "ぱらぱら眺める" 用途の楽しさが向上**しました。特に日付フィルタで数十枚に絞った状態や、⭐ お気に入りのみ 200 枚超の集合を眺めるときに、"次は何？" という発見的な閲覧が可能になっています。
- **既存の `lightboxKeyboard.ts` 純粋関数パターンを再利用**したことで、実装は 4 ファイル・73 行の追加に収まりました。resolver に action type を 1 個増やし、App.tsx の switch に case を 1 個増やし、Lightbox.tsx にボタンを 1 個追加、i18n に key を 1 個追加、という綺麗な拡張になっています。
- **index-shift 方式のランダム選択が、`randomizeLightbox()` の他のパスで再利用可能な形になっています**。将来もし「お気に入りのみからランダム」や「今日以外の日付からランダム」など類似ロジックが出てきた場合、同じ 3 行の pattern を持ち込めば無限ループのリスクなしに実装できます。
- **`displayedHistory.length === 1` の場合はボタン disabled**、`lightboxIndex === -1`（プレビュータブ）でも disabled、という 2 段の防御によって、対象がないときは UI 上明示的に押せないことがユーザーに伝わります。この disabled 判定は Lightbox.tsx で `opacity: 0.35` + `cursor: not-allowed` として視覚化されます。
- **キーボードショートカットの一覧が拡張**（Esc / ←→ / Space / F / R）されたため、[[adr-0013-lightbox-info-panel]] で言及されていた「既存の Esc / ←→ / Space / F と衝突しない」というキー衝突チェックのリストが 1 個増えました。将来新しいショートカットを足す場合は R を含めた 5 個との衝突を確認する必要があります。
- **`R` キーは大文字/小文字を区別せず両方を bind** しているため、Shift + R でも動作します。IME 有効時に日本語入力へフォールバックする可能性はあり、その場合はキーボードイベントが React に届かないので shuffle は発火しません（IME で「r」を入力しても意図しません）。実運用上は問題になっていません。
- **rollup ランキング機能（[[adr-0021-favorite-recipe-rollup-ranking]]）との組み合わせ**が生まれました。「上位ランキングのレシピで作った画像だけを日付フィルタなしで眺めながらランダムに閲覧」といった使い方が可能になり、生成体験のフィードバックループがより発見的になっています。
