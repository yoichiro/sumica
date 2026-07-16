# ライトボックス・スライドショー & ランダムモード 設計書

## 背景

ライトボックス（`components/Lightbox.tsx`）は現在、以下の navigation を提供しています：

- ← / → ボタン: `onNavigate(delta: number)` 経由で `displayedHistory` を index±1 で辿る（末端で clamp、ボタンは disabled 化）
- `🔀 Shuffle` ボタン: **一発でランダムな別画像にジャンプ**（`onRandomize` 経由、現在の画像を除外）
- `R` キー: Shuffle と同等
- Fullscreen トグル、Info パネルトグル、Select、Favorite なども別軸

洋一郎さんから 2 つのリクエストがありました：

1. **スライドショー**：「ライトボックスや全画面表示をしている際に、一定時間で画像を進めていく機能」
2. **既存 Shuffle の性質変更**：「ランダムで画像表示のアイコンボタンをトグル化して、ON のときは前後のボタンでもランダムに次/前を選ぶ」

これらは独立した機能に見えて、実は共通の「ランダムモード」というスイッチで両方を統一できます。以下ではこの統一設計を仕様化します。

## スコープ

- ライトボックス内の「ランダムモード」トグル化（既存の一発 Shuffle 挙動を廃止）
- 「スライドショー」再生機能（開始/停止トグル、5 秒間隔で自動遷移）
- 上記 2 つの UI（ボタン + tooltip + キーバインド + i18n）
- 対応する pure ヘルパーとユニットテスト

**スコープ外**（別 spec とする候補）:

- 間隔をユーザーが変更できる UI
- スライドショーの一時停止（ホバー・focus 検出など）
- 進行状況のビジュアル表示（プログレスバー等）
- ライトボックス以外の場所（例：ギャラリータイル上）でのスライドショー

## ブレスト決定事項サマリ

- **トリガー**：ライトボックスのツールバーに新規ボタン（`Play` / `Pause` アイコン）を追加
- **間隔**：固定 5 秒（コード内 constant として保持、将来変更容易）
- **末尾挙動**：シーケンシャルモードでは末尾から先頭にループ
- **ランダム進行**：既存の `randomizeLightbox` と同じ算術（現画像を除外して次を選ぶ）
- **ランダムモードトグル**：既存 `Shuffle` アイコンをトグル状態のボタンに置き換え。手動 ← / → もこの状態を尊重

## 設計

### 挙動サマリ

| 状態 | 手動 ← / → | スライドショー再生中 |
|---|---|---|
| ランダム OFF（既定） | 履歴順で前/次（末端で clamp） | 履歴順で 5s 毎に次、末尾で先頭にループ |
| ランダム ON | ランダムに 1 枚（現画像除外） | ランダムに 5s 毎に選ぶ（現画像除外） |

「ランダムモード」は手動ナビゲーションとスライドショーの両方に効くグローバルなスイッチとして機能します。既存の「Shuffle = 1 クリックで一発ジャンプ」挙動は本仕様で廃止となり、代わりに「トグル ON 中に ← / → を押す」で同等の操作が可能になります。

### 状態管理

App.tsx に 2 つの useState を追加します。ライトボックス外に置く理由は、フルスクリーン切替や lightbox 再オープンをまたいで状態を保持できるようにするためです（スライドショーは lightbox 内でのみ「動く」が、フラグ自体は App レベルで管理される）。

```typescript
const [randomMode, setRandomMode] = useState(false);
const [slideshowPlaying, setSlideshowPlaying] = useState(false);
```

**手動 navigation の分岐**：

既存の `navigateLightbox(delta)` を `randomMode` で分岐させます。ランダム ON なら既存の `randomizeLightbox()` を呼び、OFF なら既存のシーケンシャル動作をそのまま実行。

```typescript
const navigateLightbox = (delta: number) => {
  if (randomMode) {
    randomizeLightbox();
    return;
  }
  // 既存のシーケンシャル navigation（末端で clamp、no-op）
  const idx = displayedHistory.findIndex(...);
  const next = idx + delta;
  if (next < 0 || next >= displayedHistory.length) return;
  ...
};
```

**手動 navigation は末尾で clamp**（既存挙動を維持）：ユーザーが明示的にクリックしているときは「これ以上進めない」ことを伝える方が意味論的に自然です。ループするのはスライドショーだけ。

### スライドショーのタイマー

App.tsx に useEffect を追加。`slideshowPlaying` と `lightboxIndex` の両方を deps に含めることで、「手動 ← / → クリック → index 変化 → effect の cleanup + 再セットアップ → タイマーが自然にリセット」という挙動を実現します（明示的なリセットコード不要）。

```typescript
const SLIDESHOW_INTERVAL_MS = 5000;

useEffect(() => {
  if (!slideshowPlaying || lightboxIndex < 0) return;
  const id = setInterval(() => {
    const nextIdx = nextSlideshowIndex(lightboxIndex, displayedHistory.length, randomMode);
    if (nextIdx === lightboxIndex) return; // no-op（1 枚以下）
    // Open the item at nextIdx (既存の openLightbox パターン)
    ...
  }, SLIDESHOW_INTERVAL_MS);
  return () => clearInterval(id);
}, [slideshowPlaying, lightboxIndex, randomMode, displayedHistory]);
```

**自動停止条件**：

- ライトボックスが閉じる（`lightboxUrl === null` → App.tsx の別の useEffect で `setSlideshowPlaying(false)`）
- ユーザーがスライドショーボタンを再クリック（トグル OFF）
- `displayedHistory` が空 or 1 件以下になった（deps 経由で effect が再走、`nextSlideshowIndex` が no-op になる）

**継続する条件**（意図的に停止しない）：

- 手動 ← / → クリック（index 変化 → タイマーだけリセット）
- ランダムモードのトグル切替（次の tick で新モードが効く）
- Fullscreen の出入り（本来の image display 領域は変わらないので）

### Pure ヘルパー: `nextSlideshowIndex`

タイマー内の index 算出ロジックを pure 関数として切り出し、ユニットテスト可能にします。

新規ファイル `client/src/components/slideshowStep.ts`：

```typescript
// Compute the next lightbox index for a slideshow tick.
// - Sequential mode: (current + 1) % total, wrapping at the end.
// - Random mode: uniformly pick from [0..total) excluding `current`.
// - When total <= 1: return current unchanged (no-op).
// `rand` is injected to make random-branch behavior deterministic in tests.
export function nextSlideshowIndex(
  currentIndex: number,
  totalCount: number,
  randomMode: boolean,
  rand: () => number = Math.random,
): number {
  if (totalCount <= 1) return currentIndex;
  if (!randomMode) return (currentIndex + 1) % totalCount;
  // Random mode: pick uniformly from totalCount-1 candidates, skipping current
  const pick = Math.floor(rand() * (totalCount - 1));
  return pick >= currentIndex ? pick + 1 : pick;
}
```

### UI

**ライトボックスのツールバー再構成**：

現在の並び: `Info / Select / Favorite / ← / → / Shuffle / Eye / Fullscreen / Close`

新しい並び: `Info / Select / Favorite / ← / → / 🔀 Random / ▶️ Slideshow / Eye / Fullscreen / Close`

- **🔀 Random トグル**：既存の Shuffle アイコン (`lucide-react` の `Shuffle`) を再利用。ON 時は塗り青（既存の Favorite / Select トグルと同じ pattern）、OFF 時は枠のみ
- **▶️ Slideshow トグル**：新規追加。停止中は `Play` アイコン、再生中は `Pause` アイコン + 塗り青
- 両ボタンとも `displayedHistory.length <= 1` で `disabled`

**i18n 追加**（ja + en）：

```typescript
// t.lightbox
randomModeToggleOn: 'ランダム表示: ON (前後ボタンとスライドショーがランダムになります)',
randomModeToggleOff: 'ランダム表示に切替',
slideshowStartTooltip: 'スライドショー開始 (5秒毎に進む)',
slideshowStopTooltip: 'スライドショー停止',
```

英語版は自然な訳を対応させる（省略）。

### キーボード

`lightboxKeyboard.ts` の pure resolver `resolveLightboxKey(...)` を更新：

- 既存: `R` → `{ type: 'shuffle' }`
- 新規: `R` → `{ type: 'toggleRandom' }`（意味変更、名前は shuffle → toggleRandom）
- 新規: `P` → `{ type: 'toggleSlideshow' }`

App.tsx のキーハンドラで新しい action type を dispatch：

```typescript
case 'toggleRandom': setRandomMode(v => !v); break;
case 'toggleSlideshow': setSlideshowPlaying(v => !v); break;
```

Escape の既存挙動（OS fullscreen 中は browser が処理、それ以外は close）は変更なし。

### App.tsx への配線

- `randomMode` state を Lightbox 経由で prop で渡し、Random トグルボタンで表示
- `slideshowPlaying` state を同様に prop で渡し、Slideshow ボタンで表示
- Lightbox の `<button>` から App の setter を呼ぶ（既存 onToggleFullscreen と同 pattern）
- 既存の `onNavigate` 実装（App 側の `navigateLightbox`）を randomMode で分岐
- Lightbox が閉じた（`lightboxUrl` が null になった）ときに slideshow を強制停止する useEffect を追加

### テスト戦略

**新規ファイル**：

- `client/src/components/slideshowStep.ts`（pure helper）
- `client/src/components/slideshowStep.test.ts`（Vitest ユニットテスト）

**`slideshowStep.test.ts` の内容**：

1. Sequential mode: `nextSlideshowIndex(0, 5, false)` === 1
2. Sequential mode wrap: `nextSlideshowIndex(4, 5, false)` === 0
3. Random mode excludes current: `nextSlideshowIndex(2, 5, true, () => 0.5)` !== 2 — 決定論的なパターンで verify
4. Random mode boundary: `nextSlideshowIndex(2, 5, true, () => 0.0)` === 0（rand=0 → pick=0、current=2 なので pick=0 が返る）
5. Random mode boundary: `nextSlideshowIndex(2, 5, true, () => 0.99)` === 4（rand=0.99 → pick=3、current=2 なので pick+1=4）
6. 1 枚以下: `nextSlideshowIndex(0, 1, false)` === 0（no-op）
7. 空: `nextSlideshowIndex(0, 0, false)` === 0（no-op）

**既存 `lightboxKeyboard.test.ts` の更新**：

- `R` の期待値を `{ type: 'shuffle' }` から `{ type: 'toggleRandom' }` に変更
- `P` → `{ type: 'toggleSlideshow' }` の新規ケースを追加
- OS fullscreen 中でも `R` / `P` は有効（Escape の gate と対比）

**手動検証手順**（実装完了後）：

1. ライトボックスを開く → ランダムトグル OFF、スライドショー停止（初期状態）
2. ← / → クリック → 履歴順で移動
3. ランダムトグルを ON → ← / → クリック → 現画像除外のランダムジャンプ
4. スライドショーボタンを ON（ランダム OFF） → 5s ごとに順送り、末尾で先頭にループ
5. スライドショー再生中に ← / → クリック → その画像に移動、次の tick は 5s 後にリセット
6. ランダムトグルを ON にしたままスライドショー再生 → 5s ごとにランダムジャンプ
7. Lightbox を閉じる → スライドショー自動停止
8. 履歴が 1 枚しかない状態 → 両トグルとも disabled
9. `R` キー → ランダムモード ON/OFF 切替
10. `P` キー → スライドショー再生/停止

## 影響を受けるファイル一覧

**新規作成**:

- `client/src/components/slideshowStep.ts`
- `client/src/components/slideshowStep.test.ts`

**編集**:

- `client/src/App.tsx` — `randomMode` / `slideshowPlaying` state 追加、`navigateLightbox` の分岐、slideshow useEffect、close→pause useEffect、Lightbox への prop 追加、キーハンドラの新 action 対応
- `client/src/components/Lightbox.tsx` — Random トグル UI 変更、新規 Slideshow ボタン、両者の disabled 制御、新 prop 受け取り
- `client/src/components/lightboxKeyboard.ts` — `R` → `toggleRandom`、`P` → `toggleSlideshow` を追加
- `client/src/components/lightboxKeyboard.test.ts` — 上記 pure resolver 更新に対応
- `client/src/i18n/ja.ts` / `client/src/i18n/en.ts` — 4 つの新 key + 既存 shuffleTooltip の廃止/リネーム

## 想定される Consequences

- **モード管理の統一**：Shuffle が 1 発ジャンプではなくモードトグルになることで、「今のライトボックスはランダムモードなのかどうか」が視覚的に常に見える状態になります。ユーザーはランダム閲覧を「モードとして」体験できます。
- **既存の Shuffle 挙動廃止の影響**：これまで `R` キーや Shuffle ボタンで「一発でランダムジャンプ」していたユーザーは、新仕様では「ランダムモードを ON にして → キーを 1 回押す」の 2 段階になります。ただし ← / → クリックもランダムになるので、実質的な操作コストは同等以下。
- **スライドショーの自動停止条件を絞ったこと**：ホバー、focus 、info パネル操作などでは停止しません。この仕様では「スライドショーは能動的にトグルするもの」として扱う設計。もしユーザーが「ホバー時は止まって欲しい」と感じるようになれば、後続 spec で追加可能。
- **末尾ループの片側実装**：手動 ← / → は末端で clamp、スライドショーだけがループする、という一貫性のなさは残ります。理由：手動時は「進めない」フィードバックがユーザーの現在位置認知に有用、自動時は流れを止めない方が有用、という UX 判断。将来「手動もループしてほしい」というリクエストが来たら再検討。
- **5 秒固定間隔**：4K の詳細な画像や動画的なアニメを表示するには短すぎる、あるいは snapshot 的な閲覧には長すぎる、という声が出る可能性はあります。SLIDESHOW_INTERVAL_MS を constant として切り出しておくことで、将来的な UI 化（select で選ぶなど）へのマイグレーションは 1 箇所の変更で済みます。
- **`nextSlideshowIndex` の rand 注入設計**：Math.random を引数として注入可能にすることで、pure テストで決定論を担保できるようになりました。将来別のランダム化アルゴリズム（例：weighted による偏った選択）を実験する場合も、この pattern が土台になります。
- **[[adr-0025-lightbox-view-transitions]] との整合**：スライドショーからの programmatic な navigate も既存の View Transition パスを通るため、5s ごとにモーフィングが走ります。1 秒未満の View Transition 完了時間に対して 5 秒間隔は十分な余裕があり、アニメーションが tick に間に合わないケースは発生しません。
