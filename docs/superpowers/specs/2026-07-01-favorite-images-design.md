# お気に入り画像機能 — 設計書

- **日付:** 2026-07-01
- **ステータス:** 設計承認済み
- **トピック:** 履歴ギャラリーの各画像にお気に入りマークを付けられるようにし、日付フィルターと独立した「お気に入りのみ」表示モードを提供する。

## ゴール

履歴ギャラリーの各画像タイルに、お気に入り切替用の Star ボタンを追加する。
配置はタイル右下、既存の `ZoomButton` の **真上に縦スタック**。同じ Star
ボタンをライトボックスとプレビュータブにも置き、3 箇所で同じ操作ができる
一貫した UI にする。

履歴ギャラリーのツールバーには新しく「⭐ お気に入りのみ」トグルを追加する。
ON のとき、日付フィルターは無効化（グレーアウト）され、ユーザーの全期間の
お気に入り画像が一覧表示される。OFF のときは現状の挙動どおり（日付フィルター
適用、お気に入りは特別扱いされない）。並び順は生成日時の降順で、既存の履歴
表示と同じ。

サインイン状態に関わらず動作する：

- **サインイン中（Firebase）:** `users/{uid}/generations/{id}` の各ドキュメント
  に `isFavorite` ブールフィールドを追加する。トグル操作は `updateDoc` を呼ぶ。
  「お気に入りのみ」モードは
  `where('isFavorite','==',true) + orderBy('timestamp','desc')` の専用ライブ
  購読でバックアップされる（**複合インデックスが必要**）。
- **未サインイン（サーバローカル）:** `server/outputs/metadata.json` の各エントリ
  に `isFavorite` ブールフィールドを追加する。トグル操作は新規エンドポイント
  `POST /api/generations/favorite` を呼ぶ。「お気に入りのみ」モードは既存の
  `/api/history` の全件レスポンスをクライアント側でフィルタする。

## 決定事項（議論の収束ポイント）

1. **「お気に入りのみ」はタブではなく履歴ツールバーのサブフィルター。**
   ブレストで「3 タブ並列」案が再フレーミングされ、日付入力の隣にトグル
   ボタンを置く形に落ち着いた。
2. **お気に入りのみ ON 中、日付フィルターは無効化される。** 元要件「お気に
   入りは日付でフィルタリングされない」を文字どおり実装する。`<input
   type="date">` を `disabled` + 半透明にし、購読クエリも日付条件を完全に
   外す。日付との AND 結合案は却下。
3. **並び順は生成日時の降順。** 既存履歴と同じ。`favoritedAt` などの別タイム
   スタンプは保持しない。データ形は単純な boolean のみ — 並び順は既存の
   `timestamp` フィールドを使って維持される。
4. **アイコンは Star（ハートでもブックマークでもない）。** lucide-react の
   `Star` を使用。OFF で輪郭、ON で黄色塗りつぶし (`#ffd43b`)。
5. **タイル上での配置は ZoomButton の真上（縦スタック）。** 同じ円形ピル
   スタイル。両ボタンを同じコーナーに寄せることで、ズームとお気に入りの
   間でのマウス／指の移動距離が最小になる。
6. **同じ Star ボタンを 3 箇所（タイル・ライトボックス・プレビュー）に
   置く。** 画像がどこに表示されていても同じアフォーダンスでお気に入り
   操作ができる。
7. **ローカルモードもサポートする。** サーバは `metadata.json` に
   `isFavorite` を保持し、`POST /api/generations/favorite` を 1 つ追加する。
   実装コストは小さく、サインインモードとの動作の対称性が保たれる。
8. **案 B：Firestore 専用クエリ + 複合インデックス。** 却下：`dateYMD=null`
   で全件購読してクライアント側でフィルタする案 A。案 B はインデックス
   管理コストと引き換えに、コレクション増大時のドキュメント読み取り量を
   下げる。

### 却下された代替案

- **3 タブ並列「プレビュー／履歴ギャラリー／お気に入り」。** 履歴ツール
  バー内のサブフィルターで足りる、と再フレーミングされた。
- **複合フィルター「お気に入り AND 日付」。** 「お気に入りは日付で
  フィルタリングされない」という要件と矛盾する。トグル ON 中は日付入力を
  `disabled` で封じる。
- **`favoritedAt: number | null` の保持 + 「最近スターした順」ソート。**
  今回の要望のスコープ外。単純な boolean に絞り、既存 `timestamp` を流用。
- **クライアント側で全件フィルタする案 A。** インデックス不要で実装は軽い
  が、購読のたびに全ドキュメントを読む。クエリ効率を取って案 B を採用。
- **Heart アイコン。** SNS の「いいね」連想が強く、画像作品ギャラリーには
  Star のほうが意味的に合う。

## アーキテクチャ

変更は以下の 3 ファイルにまたがる：

- `client/src/firebase.ts` — `GenerationRecord` を拡張、`updateFavorite` と
  `subscribeFavorites` を追加、`updateDoc` を import に追加。
- `client/src/App.tsx` — `GenerationData` を拡張、`favoritesOnly` state を
  追加、`toggleFavorite` を追加、`FavoriteButton` コンポーネントを追加、
  ツールバートグルを追加、`favoritesOnly` に応じて購読を切替、
  `filteredHistory` を読んでいたギャラリー／ライトボックス／Space キー
  ハンドラを `displayedHistory` に置換、ライトボックス内 `F` キー
  ショートカットを追加。
- `server/index.ts` — `GenerationMetadata` を拡張、
  `POST /api/generations/favorite` を追加。

加えて、リポジトリ直下に新規ファイル 1 つ：

- `firestore.indexes.json` — お気に入りクエリ用の複合インデックスを宣言。

## データ層

### スキーマ追加（3 つの型を同期）

```ts
// client/src/firebase.ts → GenerationRecord
isFavorite?: boolean;

// client/src/App.tsx → GenerationData
isFavorite?: boolean;

// server/index.ts → GenerationMetadata
isFavorite?: boolean;
```

3 箇所すべてオプショナルにする。既存の Firestore ドキュメントや既存の
`metadata.json` エントリに後付けでフィールドを持たせる必要がなくなる。
読み取り側はすべて `!!record.isFavorite` で判定し、`undefined` と `false`
を同一視する。

### Firestore 複合インデックス

`where('isFavorite','==',true) + orderBy('timestamp','desc')` は where と
orderBy のフィールドが異なるため、複合インデックスが必須。なければクエリは
`failed-precondition` で失敗する。リポジトリ直下に新規追加：

```json
{
  "indexes": [
    {
      "collectionGroup": "generations",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isFavorite", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

デプロイは手動運用（既存の `firestore.rules` と同じ。リポジトリにルール
はあるが `firebase.json` / `.firebaserc` は無い）。次のいずれかで適用：

- ローカルに `firebase.json` をセットアップして
  `firebase deploy --only firestore:indexes`。
- 初回クエリ実行時に Firebase が出力する「Create index」自動生成リンクを
  クリックして手動作成、そのあと `firestore.indexes.json` をコミットして
  再現性を確保。

### セキュリティルール

`firestore.rules` は変更不要。既存の `allow read, write` が `update` を
含むため、`isFavorite` フィールドの書き換えはルール変更なしで通る。

## UI

### `FavoriteButton` コンポーネント（新規）

既存 `ZoomButton` の兄弟ポジション。同じ円形ピルスタイル（半透明黒背景、
白アイコン、`scale-hover` クラス、`boxShadow`）。`position: absolute` で
`bottom: 8 + zoomButtonSize + 8` の位置に配置 → ZoomButton の真上に 8px の
ギャップを空けて積まれる。

```tsx
function FavoriteButton({
  isFavorite, onClick, size = 30, stackedAbove = 30,
}: {
  isFavorite: boolean;
  onClick: (e: React.MouseEvent) => void;
  size?: number;
  stackedAbove?: number;  // size of the ZoomButton below it
}) { ... }
```

アイコンの切替：

- OFF → `<Star size={Math.round(size * 0.5)} />`（lucide-react デフォルト
  ストローク）。
- ON  → `<Star size={Math.round(size * 0.5)} fill="#ffd43b" stroke="#ffd43b" />`。

サイズは既存 `ZoomButton` の各呼び出し位置と揃える：ギャラリータイル時 26、
プレビュータブの画像時 34。ライトボックス内のみ別の位置・サイズで配置する
（後述の「3 箇所の配置」を参照）。

### 3 箇所の配置

1. **ギャラリータイル**（`App.tsx` 1782 行付近）。`ZoomButton` と同じ
   `position:relative` ラッパー内に追加。クリックハンドラ：
   `onClick={(e) => { e.stopPropagation(); toggleFavorite(item); }}`。
   伝搬を止めないとタイル自身の `onClick`（選択トグル）と
   `onDoubleClick`（プレビューへ呼び戻し）が発火してしまう。
2. **ライトボックス**（`App.tsx` 1892 行付近）。`lightboxIndex >= 0` の
   ときのみ描画する。既存の選択チェックボタン（右上 `top: 20px, right:
   228px`、サイズ 44px、`CheckCircle2`/`Circle` アイコン、半透明背景）と
   **見た目を揃える**：サイズ 44px の円形ボタン、選択チェックの右側に
   水平に並べる（位置例：`top: 20px, right: 280px`、ギャップ込みの値は
   実装時に微調整）。アイコンは Star を 22px で描画。クリックハンドラ：
   `toggleFavorite(displayedHistory[lightboxIndex])`。既存の `onKey`
   エフェクトに `F` キーショートカットを追加し、ボタンクリックと等価の
   動作にする。ライトボックス内ではタイル用の `FavoriteButton` の
   スタイルは使わず、選択チェックと同じ造形に揃えるのがポイント
   （ライトボックスのコントロールはすべてこの 44px ファミリーで統一されて
   いるため）。
3. **プレビュータブ**（`App.tsx` 1393 行付近）。メインプレビュー `<img>`
   のオーバーレイ内、既存 `ZoomButton` の隣に追加。クリックハンドラ：
   `toggleFavorite(currentGeneration)`。`currentGeneration.id` が未設定
   の場合（生成完了直後・保存中の過渡状態）はクリックを no-op にする —
   `toggleFavorite` 内で `id` 欠如時に早期 return する。

### ツールバートグル「⭐ お気に入りのみ」

既存の履歴ツールバー（`App.tsx` 1706〜1717 行付近）の、日付入力の隣に配置：

```
📅 [2026-07-01]   [⭐ お気に入りのみ]   N件
```

state: `const [favoritesOnly, setFavoritesOnly] = useState(false)`。

`favoritesOnly` が `true` のとき：

- `<input type="date">` を `disabled` にし、`opacity: 0.4` でグレーアウト。
  値そのものは保持する（OFF に戻したら前回の日付に復帰）。
- トグルボタンは ON 表示：背景 `var(--pop-blue)`、白文字、Star は塗り
  つぶし。

`favoritesOnly` が `false` のとき：

- トグルボタンは OFF 表示：透明背景、副次テキスト色、Star は輪郭。
- 日付入力は通常どおり操作可能。

「N件」のカウントは `displayedHistory.length` を表示する。

## 永続化フロー

### `toggleFavorite(item: GenerationData)`（App.tsx、新規）

タイル・ライトボックス・プレビューの 3 ボタンが共有する単一エントリポイント。

```ts
const toggleFavorite = async (item: GenerationData) => {
  const id = item.id;
  if (!id) return;                                   // guard: id not yet assigned
  const next = !item.isFavorite;
  try {
    if (user) {
      await updateFavorite(user.uid, id, next);
      // onSnapshot reflects the change; no local-state update needed.
    } else {
      // Optimistic update for local mode (no live subscription to pull from).
      setHistory((prev) =>
        prev.map((h) => (h.id === id ? { ...h, isFavorite: next } : h)),
      );
      const res = await fetch(`${API_BASE}/generations/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isFavorite: next }),
      });
      if (!res.ok) {
        // Rollback the optimistic update before throwing.
        setHistory((prev) =>
          prev.map((h) => (h.id === id ? { ...h, isFavorite: !next } : h)),
        );
        throw new Error(`Server returned ${res.status}`);
      }
    }
  } catch (e: any) {
    addToast(`お気に入りの更新に失敗しました: ${e.message}`, 'error');
  }
};
```

### `firebase.ts` の追加

```ts
import { updateDoc } from 'firebase/firestore';  // add to existing import

export async function updateFavorite(
  uid: string,
  id: string,
  isFavorite: boolean,
): Promise<void> {
  if (!dbInstance) throw new Error('Firebase is not configured');
  await updateDoc(
    doc(dbInstance, 'users', uid, 'generations', id),
    { isFavorite },
  );
}

export function subscribeFavorites(
  uid: string,
  cb: (records: GenerationRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  if (!dbInstance) {
    cb([]);
    return () => {};
  }
  const q = query(
    collection(dbInstance, 'users', uid, 'generations'),
    where('isFavorite', '==', true),
    orderBy('timestamp', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => {
      const records: GenerationRecord[] = [];
      snap.forEach((d) =>
        records.push({ id: d.id, ...(d.data() as Omit<GenerationRecord, 'id'>) }),
      );
      cb(records);
    },
    (err) => {
      console.error('Firestore favorites subscription failed:', err);
      cb([]);
      onError?.(err);
    },
  );
}
```

### `server/index.ts` の追加

既存 `/api/generations/delete` と同じ形のルートを 1 つ追加：

```ts
// 9. Toggle favorite flag (local mode only).
app.post('/api/generations/favorite', (req: Request, res: Response) => {
  const { id, isFavorite } = req.body;
  if (typeof id !== 'string' || typeof isFavorite !== 'boolean') {
    return res.status(400).json({
      error: 'id (string) and isFavorite (boolean) are required',
    });
  }
  const history = getLocalHistory();
  const target = history.find((it) => it.id === id);
  if (!target) return res.status(404).json({ error: 'Generation not found' });
  target.isFavorite = isFavorite;
  saveLocalHistory(history);
  res.json({ success: true });
});
```

### 購読切替（App.tsx の履歴 useEffect）

既存のエフェクト（App.tsx 443〜462 行付近）の依存配列に `favoritesOnly`
を追加し、`favoritesOnly` に応じて 2 種類の Firestore 購読を切り替える：

```ts
useEffect(() => {
  if (user) {
    setHistory([]);
    const unsub = favoritesOnly
      ? subscribeFavorites(
          user.uid,
          (records) => setHistory(records as unknown as GenerationData[]),
          (err) => { /* same error toast as before, mentioning index hint */ },
        )
      : subscribeGenerations(
          user.uid,
          filterDate || null,
          (records) => setHistory(records as unknown as GenerationData[]),
          (err) => { /* existing handler */ },
        );
    return unsub;
  }
  fetchHistory();
  return undefined;
}, [user, filterDate, favoritesOnly]);
```

`favoritesOnly` を ON にすると日付スコープの購読が破棄され、お気に入り
購読が開かれる。OFF に戻すと日付スコープの購読が復活する。`favoritesOnly`
ON 中に `filterDate` が変わった場合、deps の変化で同じお気に入り購読が
再生成される（無駄な再構築だが、頻度が低いので許容）。

`subscribeFavorites` のエラートーストには、初回失敗時にユーザーが取るべき
アクションのヒントを足す（`failed-precondition` がもっとも起こりうる失敗
モードのため）：
「Firestore のインデックス (isFavorite + timestamp) がデプロイされている
か確認してください」。

## 表示配列とライトボックスへの影響

現状、ギャラリー・ライトボックスのナビゲーション・Space キー選択は
すべて `filteredHistory` を読んでいる。この 1 変数を `displayedHistory`
に置き換え、`favoritesOnly` を織り込む：

```ts
const displayedHistory = useMemo(() => {
  if (favoritesOnly) {
    // Signed in: subscribeFavorites already returns only favorited records.
    // Signed out: full /api/history payload → filter client-side.
    return user ? history : history.filter((h) => h.isFavorite);
  }
  return filterDate
    ? history.filter((h) => localYMD(h.timestamp) === filterDate)
    : history;
}, [history, favoritesOnly, filterDate, user]);
```

`filteredHistory` は削除し、以下の呼び出し箇所を `displayedHistory` に
移行する：

| 呼び出し箇所                                         | App.tsx 行（概算） |
| ---------------------------------------------------- | ------------------ |
| ギャラリーグリッドの `.map()`                        | 1767               |
| ツールバーの件数表示「N件」                          | 1717               |
| `navigateLightbox`（`findIndex` + 境界判定）         | 300–308            |
| `lightboxIndex` の計算（`findIndex`）                | 320–322            |
| ライトボックス内 Space キー選択                      | 407–409            |
| ライトボックス内 選択チェックボタンの表示判定        | 1892               |

これにより、ライトボックスの prev/next 送りは「現在ユーザーが見ている
集合」を辿るようになる — お気に入りモード中はお気に入り集合、それ以外は
その日の履歴。

## エッジケース

| ケース                                                            | 挙動                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isFavorite` フィールドのない既存 Firestore ドキュメント          | `!!record.isFavorite` → `false`。読み込みは普通に動く。バックフィル不要。                                                                         |
| `isFavorite` フィールドのない既存 `metadata.json` エントリ        | 同じく `!!record.isFavorite` → `false`。マイグレーション不要。                                                                                    |
| 複合インデックス未デプロイ                                        | `subscribeFavorites` の `onError` が `failed-precondition` で発火。トーストにエラーコード／メッセージとインデックスデプロイのヒントを併記する。 |
| `favoritesOnly` ON 中に新規画像が生成された                       | 新規画像は `isFavorite` 未設定で保存される → お気に入り一覧には現れない。既存の `setRightTab('preview')`（App.tsx:702）が生成開始時に発火するため、ユーザーが空のギャラリーを眺める事態にはならない。 |
| お気に入り画像が削除された                                        | 既存の削除フローで Firestore ドキュメントまたは `metadata.json` エントリが消える。お気に入りビューはライブ購読／次の `fetchHistory` で自動的に最新化される。専用クリーンアップ不要。 |
| 保存完了前の `currentGeneration` で Star がクリックされた         | `toggleFavorite` 内で `id` 欠如時に早期 return。クリックは no-op、トーストは出さない。                                                            |
| ローカルモードで Star を連打                                      | Node のシングルスレッド要求処理と同期書き込みの `saveLocalHistory` により競合は起こらない。既存 `/api/generations/delete` と同じモデル。          |
| お気に入り画像をフォームに再ロードして再生成                      | `loadIntoForm` は `isFavorite` をコピーしない。再生成された画像は新規レコードとして `isFavorite` 未設定で生まれる。元レコードのお気に入りは残る。 |
| バッチ生成                                                        | 変更なし。バッチループも同じ `generateAndPersist` を呼ぶため、新規レコードは未お気に入りで生まれる。                                              |

## スコープ外（YAGNI）

- 「最近スターした順」ソートや `favoritedAt` の保持はしない。
- `/api/history?favoritesOnly=true` のサーバサイドフィルタは追加しない —
  ローカルモードはクライアントフィルタで足りる（`metadata.json` は十分
  小さい）。
- 選択ツールバーへの「選択した画像をまとめてお気に入り／解除」アクション
  は追加しない。選択ワークフローは削除に絞ったまま。
- Star トグルの CSS アニメーション（フィルインや爆ぜる演出）は入れない。
  既存の `scale-hover` で十分。将来的な改善余地。
- ツールバートグルへのお気に入り件数バッジ「⭐ お気に入りのみ (8)」は
  入れない。隣の「N件」がすでに現在ビューを反映している。
- `favoritesOnly` 自体を反転するキーボードショートカットは入れない。
  ライトボックス内の画像お気に入りトグルにのみ `F` キーを割り当てる。
- 既存ドキュメントへ `isFavorite: false` をバックフィルするスクリプトは
  作らない。`!!record.isFavorite` の読み取りパターンで吸収する。
