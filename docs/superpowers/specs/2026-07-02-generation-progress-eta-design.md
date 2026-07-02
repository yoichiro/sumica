# 設計書: 生成中の経過時間・残り時間の見積り表示

日付: 2026-07-02
状態: 承認済み

## 概要

画像生成中（ステップ2「画像生成」）に、生成開始からの経過時間と、Stable Diffusion（以下SD）自身が計算する残り時間の見積り・進捗率をリアルタイムに表示する。残り時間・進捗率はSDの`/sdapi/v1/progress`APIをサーバー経由でポーリングして取得する。単体生成・バッチ生成の両方に対応し、バッチの場合は各ジョブの開始ごとに経過・残り・進捗表示がリセットされる。

## 現状の挙動（as-is）

進捗パネルには「プロンプト拡張→画像生成→保存」の3ステップのチェックマーク表示があるだけで、ステップ2「画像生成」がどれくらい進んでいるか、あと何秒かかるかは一切わからない。Hires.fix有効時など生成が数分かかる場合、ユーザーは待ち時間の見通しが立たない。

## 目指す挙動（to-be）

- `genStatus === 'generating'`（ステップ2）の間、進捗パネルのステップ2の行に「経過12秒 / 残り約8秒」のようなテキストと、進捗バーを表示する。
- 経過時間はクライアント側で`Date.now()`を基準に1秒ごとに更新する（SDへの通信は不要）。
- 残り時間・進捗率はサーバー経由でSDの`/sdapi/v1/progress`を1.5秒ごとにポーリングして取得する。初回のポーリングが返るまでは経過時間だけを表示し、残り時間・バーは非表示にする。
- バッチ生成では、ループ内の各ジョブの開始時に経過・残り・進捗表示がリセットされ、ジョブごとに独立して表示される。
- ステップ1（プロンプト拡張）・ステップ3（保存）の間は何も表示しない（どちらも高速なため）。
- Hires.fixが有効な場合も、SD自身が2パス分の進捗を内部で計算して返すため、こちら側で特別な処理は不要。

## サーバー側の変更（`server/index.ts`）

### 新エンドポイント `GET /api/sd-progress`

既存の`/api/sd-upscalers`などのSDプロキシ系エンドポイントと同じ並びに配置する。`skip_current_image=true`を付けて呼ぶことで、SDが毎回巨大なプレビュー画像のbase64をレスポンスに含めるのを防ぐ（ポーリング用途では帯域の無駄になるため）。

```ts
// 7d. Poll Stable Diffusion's own progress/ETA for the currently-running job
// (used by the client to show elapsed/remaining time during step 2). Degrades
// to zeros on any failure, same as the other optional SD proxy endpoints.
app.get('/api/sd-progress', async (_req: Request, res: Response) => {
  try {
    const response = await axios.get(`${stableDiffusionUrl}/sdapi/v1/progress`, {
      params: { skip_current_image: true },
      timeout: 5000,
    });
    res.json({
      progress: typeof response.data?.progress === 'number' ? response.data.progress : 0,
      etaRelative: typeof response.data?.eta_relative === 'number' ? response.data.eta_relative : 0,
    });
  } catch (error) {
    console.error('Failed to fetch SD progress:', (error as Error).message);
    res.json({ progress: 0, etaRelative: 0 });
  }
});
```

`progress`はSDが返す0〜1の値、`etaRelative`は残り秒数の見積り（SD側のフィールド名`eta_relative`をキャメルケースに変換して返す、他のプロキシ系エンドポイントと同じ命名規則）。

## クライアント側の変更（`client/src/App.tsx`）

### 新しいstate

```ts
const [elapsedSeconds, setElapsedSeconds] = useState(0);
const [sdProgress, setSdProgress] = useState<{ progress: number; etaRelative: number } | null>(null);
```

### 新しいヘルパー `runWithProgressTracking()`

SD呼び出し（`generateImage`または`generateAndPersist`）を包み、呼び出しの開始から終了まで経過時間タイマーと進捗ポーリングを回す。単体生成・バッチ生成のどちらからも同じ形で使える:

```ts
const runWithProgressTracking = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const startTime = Date.now();
  setElapsedSeconds(0);
  setSdProgress(null);

  const elapsedTimer = setInterval(() => {
    setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
  }, 1000);

  const pollProgress = async () => {
    try {
      const res = await fetch(`${API_BASE}/sd-progress`);
      if (res.ok) {
        const data = await res.json();
        setSdProgress({
          progress: typeof data.progress === 'number' ? data.progress : 0,
          etaRelative: typeof data.etaRelative === 'number' ? data.etaRelative : 0,
        });
      }
    } catch {
      // best-effort — keep showing the last known progress rather than clearing it
    }
  };
  pollProgress(); // fire immediately so the first update doesn't wait a full interval
  const progressTimer = setInterval(pollProgress, 1500);

  try {
    return await fn();
  } finally {
    clearInterval(elapsedTimer);
    clearInterval(progressTimer);
    setElapsedSeconds(0);
    setSdProgress(null);
  }
};
```

### `handleGenerate`での使用

SD呼び出しの行を`runWithProgressTracking`で包む:

```ts
const result = await runWithProgressTracking(() =>
  generateImage(positive, negative, prompt, seedLocked ? seedValue : -1, width, height)
);
```

### `handleBatchGenerate`のループでの使用

ループ内の各ジョブ呼び出しを個別に包む。これにより、ジョブが切り替わるたびに`runWithProgressTracking`が新しく呼ばれ、経過・残り・進捗が自動的にリセットされる:

```ts
const saved = await runWithProgressTracking(() =>
  generateAndPersist(positive, negative, prompt, seed, job.width, job.height, job.model)
);
```

### 表示用のフォーマット関数

60秒以上は分秒表記にする（Hires.fixで数分かかることがあるため）:

```ts
const formatDuration = (totalSeconds: number): string => {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}分${rem}秒`;
};
```

### 進捗パネルへの表示

ステップ2の行（`画像生成{batchProgress ? ...}`のspan）の下に、`genStatus === 'generating'`の間だけ表示する:

```tsx
{genStatus === 'generating' && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
    <span>
      経過{formatDuration(elapsedSeconds)}
      {sdProgress && sdProgress.etaRelative > 0 ? ` / 残り約${formatDuration(sdProgress.etaRelative)}` : ''}
    </span>
    {sdProgress && (
      <div style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'var(--panel-border)', overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, sdProgress.progress * 100))}%`,
          height: '100%',
          background: 'var(--pop-blue)',
          transition: 'width 0.3s ease',
        }} />
      </div>
    )}
  </div>
)}
```

初回ポーリングが返る前（`sdProgress === null`）は経過時間だけが表示され、残り時間の文字列とバーは出ない。

## データフロー

```
ステップ2開始（handleGenerate / handleBatchGenerateのループ内で
  runWithProgressTracking(fn) が呼ばれる）
  → 経過時間タイマー開始（Date.now()基準、1秒ごと、SD通信なし）
  → 進捗ポーリング開始（GET /api/sd-progress、1.5秒ごと）
       → サーバー: axios.get(SD /sdapi/v1/progress?skip_current_image=true)
       → { progress, etaRelative } をクライアントに返す
  → fn()（実際のSD呼び出し）が完了・失敗・キャンセルのいずれかで終わる
  → finally で両方のタイマーを停止し、経過時間・進捗表示をリセット
```

## エッジケース

| ケース | 対応 |
|---|---|
| `/api/sd-progress`が失敗する（SD未接続等） | `sdProgress`は`null`または直前の値のまま。経過時間だけ表示を続け、残り時間・バーは非表示のまま、追加のエラートーストは出さない |
| ステップ2開始直後、初回ポーリングが返る前 | 経過時間のみ表示。残り時間・バーは`sdProgress`が入るまで非表示 |
| Hires.fixの2パス生成 | SD自身が全体の進捗・ETAを内部計算して返すため、1パス目・2パス目を区別する特別処理は不要 |
| バッチ生成中 | `runWithProgressTracking`をジョブごとに呼ぶため、ジョブが切り替わるたびに経過・残り・バーが自動的にリセットされる |
| 別途進行中のキャンセル機能との相互作用 | `runWithProgressTracking`の`finally`はキャンセルによる中断でも通常通り実行されるため、追加のケアは不要。ただし両機能とも進捗パネルのJSXを触るため、マージ時に通常のコンフリクト解消が必要になる見込み |
| 非常に古いSDビルドで`/sdapi/v1/progress`が存在しない場合 | SD未接続時と同じ劣化パス（`{ progress: 0, etaRelative: 0 }`） |

## テスト・検証方針

このリポジトリに自動テストは存在しない。型チェック後、以下を手動で確認する:

1. Hires.fixなしの通常生成 → 経過時間が1秒ずつ増え、バーが埋まっていき、残り時間が0に近づきながら完了することを確認する。
2. Hires.fixありの遅い生成 → 1パス目から2パス目に切り替わる際に進捗表示が不自然にリセットされたり乱れたりしないことを確認する。
3. 「まとめて生成」でバッチ3枚 → 各ジョブの開始時に経過・残り・バーが0/非表示にリセットされることを確認する。
4. 生成中にStable Diffusionのプロセスを止める（疎通不可を再現）→ 経過時間は動き続け、残り時間・バーだけが静かに非表示になり、クラッシュや連続トーストが出ないことを確認する。
5. ステップ1（プロンプト拡張）・ステップ3（保存）の間は経過時間・残り時間・バーのいずれも表示されないことを確認する。

以下も実行する:
- `npm run typecheck --prefix server` → エラー0件
- `cd client && npx tsc -b` → エラー0件
- `npm run lint --prefix client` → 新規エラーなし

## 対象外（Out of scope）

- ステップ1・ステップ3の経過時間表示 — どちらも高速であり、今回の課題の対象ではない。
- 過去の生成時間の履歴に基づく見積り（SDの`/sdapi/v1/progress`を使わない方式） — SD自身の見積りの方が正確なため不採用。
- SDの`current_image`（生成途中のプレビュー画像）の表示 — 今回はテキストと進捗バーのみが対象で、ライブプレビューは対象外。
- 別機能（生成キャンセル）との統合実装 — 両者は別のブランチ/worktreeで並行開発されており、コード上のマージは別途行う。
