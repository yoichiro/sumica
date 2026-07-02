# 設計書: 実行中の生成処理のキャンセル

日付: 2026-07-02
状態: 承認済み

## 概要

Stable Diffusion（以下SD）がまだ処理中の画像生成を、ユーザーが途中で止められる「キャンセル」機能を追加する。想定シナリオは、Hires.fixなどで想定より大幅に時間がかかっている生成を止めたい場合。クライアントは新設の軽量エンドポイント `POST /api/generate/interrupt` を呼び、これがSD自身の `/sdapi/v1/interrupt` APIを叩いて、現在レンダリング中のジョブを停止させる。サーバーはメモリ上に単一の「キャンセル要求済み」フラグを持ち、SDの中断済みレスポンスが返ってきた時点で、元から出ていた（SDの応答をawaitし続けている）`/api/generate` リクエスト側がこのフラグを検知できるようにする。検知した場合は、中途半端な画像を保存せず `{ success: false, cancelled: true }` を返す。クライアント側で`AbortController`によるfetchの中断処理は不要で、元のリクエストがただ普段より早く解決するだけで済む。この1つの仕組みで、単体生成（`handleGenerate`）とバッチ生成（`handleBatchGenerate`）の両方をカバーできる。バッチは同じ`/api/generate`呼び出しを順番に繰り返すだけの処理だからである。

## 現状の挙動（as-is）

`handleGenerate`/`handleBatchGenerate`が`POST /api/generate`を呼んだ後、サーバー側のaxiosタイムアウト（Hires.fix対応時に600秒へ延長済み）が来るまで待つか、ページをリロードするしか止める手段がない。リロードしてもSD自体の処理は止まらず裏で生成を続けるため、本当に遅いジョブが次の生成をブロックしてしまう（SDは同時に1ジョブしか処理しないため）。

## 目指す挙動（to-be）

- `genStatus === 'generating'`（進捗パネルのステップ2、唯一の長時間処理フェーズ）の間、単体生成・バッチ生成の両方で「キャンセル」ボタンを表示する。
- ボタンを押すと、サーバーがSDに現在のジョブの中断を指示する。待機中の`/api/generate`リクエストは、本来の画像の代わりに「キャンセルされた」という結果を受け取ってすぐに解決する。
- 単体生成の場合: フォームはアイドル状態に戻り（エラーパネルは出さない）、キャンセルを伝えるトーストを表示する。何も保存されない。
- バッチ生成の場合: バッチループは即座に停止し、以降のジョブは実行されない。キャンセルより前に完了済みのジョブはそのまま保存され、トーストには何枚完了した時点でキャンセルしたかを表示する。
- キャンセルボタンは、クリックからサーバーの応答が返るまで無効化され「キャンセル中...」と表示することで、二重クリックを防ぐ。

## サーバー側の変更（`server/index.ts`）

### 新しいモジュールレベルの状態

既存の`lmStudioUrl`/`stableDiffusionUrl`定数の近くに追加:

```ts
let cancelRequested = false;
```

### 新エンドポイント `POST /api/generate/interrupt`

ベストエフォート方式: SDへのinterrupt呼び出し自体が失敗しても、クライアント側で取れる対応が変わるわけではないため（SDに到達できない場合、元の生成処理もどうせ自然に失敗する）、常に`{ success: true }`を返す。

```ts
app.post('/api/generate/interrupt', async (_req: Request, res: Response) => {
  cancelRequested = true;
  try {
    await axios.post(`${stableDiffusionUrl}/sdapi/v1/interrupt`, {}, { timeout: 5000 });
  } catch (error) {
    console.error('Failed to interrupt Stable Diffusion generation:', (error as Error).message);
  }
  res.json({ success: true });
});
```

### `/api/generate` ルート

- ハンドラの先頭で、防御的に`cancelRequested = false;`とリセットする。これにより、既に終わった前回のリクエストの残留フラグが、新しいリクエストを誤ってキャンセル扱いにすることがなくなる。
- `generateImage()`が解決した後（中断された場合でもエラーにはならず、SDが持っていた中途半端な画像がそのまま返ってくる）、永続化処理の前に以下を追加:

```ts
if (cancelRequested) {
  cancelRequested = false;
  return res.json({ success: false, cancelled: true });
}
```

これは`clientPersist`分岐・ローカル保存分岐のどちらよりも前に実行されるため、キャンセルされた生成がFirebase・`server/outputs/`・`metadata.json`のいずれにも書き込まれることはない。

単一フラグの正しさについて: Node.jsのイベントループはシングルスレッドなので、この処理順序は決定的である。並行して来る`/api/generate/interrupt`リクエストがフラグを立てられるのは、実行中の`/api/generate`ハンドラの`await`ポイントの間だけであり、フラグのチェックは`generateImage()`の`await`が返った直後に必ず行われる。したがって、フラグを取りこぼす余地はない。

## クライアント側の変更（`client/src/App.tsx`）

### `GenResult`型

```ts
type GenResult = {
  success: boolean;
  cancelled?: boolean;
  image?: string;
  params?: GenerationParams;
  data?: GenerationData;
};
```

### 新しいエラー型

```ts
class GenerationCancelledError extends Error {}
```

### `generateImage()`（クライアント側ヘルパー）

JSONレスポンスをパースした後、「成否不明の失敗」として曖昧に扱うのではなく、キャンセルを明確に区別できる専用のエラー型としてthrowする:

```ts
const result = await genRes.json();
if (result.cancelled) throw new GenerationCancelledError('Generation was cancelled');
return result;
```

### 新しいstate

```ts
const [cancelling, setCancelling] = useState(false);
```

### 新しい`requestCancel()`ヘルパー

```ts
const requestCancel = async () => {
  setCancelling(true);
  try {
    await fetch(`${API_BASE}/generate/interrupt`, { method: 'POST' });
  } catch (error) {
    console.error('Failed to send cancel request:', error);
    addToast('キャンセル要求の送信に失敗しました。', 'error');
    setCancelling(false); // ユーザーが再試行できるように戻す（正常時は下記finallyブロックのクリーンアップで解除される）
  }
};
```

`cancelling`は、`handleGenerate`と`handleBatchGenerate`の既存の`finally`ブロック内でも、既存の`setLoading(false)`と並べて`false`にリセットする。

### キャンセルボタン — 進捗ステップパネル

既存の進捗パネル（`genStatus !== 'idle'`のブロック）内に、ステップ2の間だけ表示する:

```tsx
{genStatus === 'generating' && (
  <button
    onClick={requestCancel}
    disabled={cancelling}
    className="btn-secondary"
    style={{ marginTop: '8px' }}
  >
    {cancelling ? 'キャンセル中...' : 'キャンセル'}
  </button>
)}
```

### `handleGenerate` — catchブロック

既存の汎用エラー処理より前に、キャンセルのケースを判定する:

```ts
} catch (error: any) {
  if (error instanceof GenerationCancelledError) {
    setCurrentGeneration(prevGen);
    setGenStatus('idle');
    setLoadingStep(0);
    addToast('画像生成をキャンセルしました🛑', 'success');
    return;
  }
  console.error(error);
  // ...既存のエラー処理はそのまま
}
```

### `handleBatchGenerate` — ループ

```ts
let cancelledInLoop = false;
for (let i = 0; i < jobs.length; i++) {
  // ...
  try {
    const saved = await generateAndPersist(...);
    succeeded++;
    setCurrentGeneration(saved);
  } catch (genErr) {
    if (genErr instanceof GenerationCancelledError) {
      cancelledInLoop = true;
      break;
    }
    failed++;
    console.error(genErr);
  }
}

if (cancelledInLoop) {
  setGenStatus(succeeded > 0 ? 'success' : 'idle');
  if (succeeded > 0) setLoadingStep(0);
  addToast(`${succeeded}枚生成した時点でキャンセルしました🛑`, 'success');
} else if (succeeded === 0) {
  setErrorStep(2);
  setGenStatus('error');
  addToast(`${jobs.length}枚中${succeeded}枚を生成しました（${failed}枚失敗）。\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, 'error');
} else {
  setGenStatus('success');
  addToast(failed === 0
    ? `${succeeded}枚の画像を生成しました！🎨⚡️`
    : `${jobs.length}枚中${succeeded}枚を生成しました（${failed}枚失敗）。\n\nLM Studio や Stable Diffusion がローカルで正常に起動しているか確認してください。`, failed === 0 ? 'success' : 'error');
}
```

トーストの新しい種類は追加しない。キャンセルは失敗ではなく意図的な成功アクションなので、既存の`'success'`スタイル（緑色・チェックマークアイコン）のトーストを流用する。専用の`'info'`バリアントを追加すると、この機能の規模に対して過剰なトーストコンポーネント側のCSS/アイコン修正が必要になるため。

## データフロー

```
ステップ2の間にユーザーが「キャンセル」をクリック
  → requestCancel() → POST /api/generate/interrupt
  → サーバー: cancelRequested = true; axios.post(SD /sdapi/v1/interrupt)
  → SDが現在のジョブを停止し、元の/api/generateリクエスト内の
    generateImage()がawaitしていたSDのtxt2img呼び出しが
    中途半端な画像とともに解決する
  → サーバーの/api/generateハンドラがcancelRequested === trueを検知し、
    フラグをリセットして{ success: false, cancelled: true }を返す
    （永続化はスキップ）
  → クライアント側の元の/api/generate fetch（abortせず待機し続けていた）が
    このレスポンスを受け取る
  → generateImage()（クライアント側ヘルパー）がGenerationCancelledErrorをthrow
  → handleGenerate / handleBatchGenerateがそれをcatchし、
    UIとトーストをそれぞれ更新する
```

## エッジケース

| ケース | 対応 |
|---|---|
| キャンセルを連打した場合 | 1回目のクリック後、`cancelling`がボタンを無効化する |
| すでに生成が終わった後にキャンセルを押した場合 | `/api/generate/interrupt`はSD側では何もしないno-opになる。次の`/api/generate`呼び出しの先頭でフラグがリセットされるため、古いフラグが残ることはない |
| `/api/generate/interrupt`自体がサーバーに届かない場合（サーバー/ネットワーク障害） | `requestCancel()`のcatchでトーストを表示し、ボタンを再度押せる状態に戻す。元のリクエストは既存の600秒タイムアウトでいずれ解決する |
| `/sdapi/v1/interrupt`に対応していない古いSDビルド（404になる） | SDに到達できない他のケースと同様、サーバー側でinterrupt呼び出しが静かに失敗する（ログのみ）。キャンセルは効かず、元のリクエストは通常のタイムアウトを待つことになる。これ以上の防御はせず、`/api/sd-schedulers`が古いビルドで劣化する既存の扱いと一貫させる。このケースを個別に検知・報告することは対象外とする |
| バッチ生成中のキャンセル | 現在処理中のジョブの後、ループは即座に停止する。バッチ内で既に完了したジョブはそのまま保存され、以降のジョブは開始されない |
| ステップ1（プロンプト拡張）やステップ3（保存）の間にキャンセルを押そうとした場合 | 不可能 — ボタンは`genStatus === 'generating'`（ステップ2）の間だけレンダリングされる |

## テスト・検証方針

このリポジトリに自動テストは存在しない。型チェック後、以下を手動で確認する:

1. Hires.fixを有効にして時間のかかるアップスケール設定で単体生成を開始し、レンダリング中にキャンセルをクリック → SD自身のUI/コンソール上でジョブが停止することを確認。クライアントはキャンセルのトーストとともにアイドル状態に戻り、履歴・ギャラリーに新しいものが増えないことを確認する。
2. 「まとめて生成」でcountモード3枚のバッチを開始し、2枚目のレンダリング中にキャンセルをクリック → 1枚目は保存され、2枚目は破棄され、3枚目は開始されないこと、トーストが「1枚生成した時点でキャンセルしました」になることを確認する。
3. ステップ1・ステップ3の間はキャンセルボタンが表示されず、ステップ2の間だけ表示されることを確認する。
4. キャンセルを素早く2回クリック → 重複したリクエストが実害を及ぼさず、クラッシュせず、ボタンが「キャンセル中...」になった後に正常に戻ることを確認する。
5. SDのプロセスを止めた状態で、SDに到達できず失敗するリクエストに対してキャンセルをクリック → 送信失敗のトーストが表示され、UIが「キャンセル中...」のまま固まらないことを確認する。

以下も実行する:
- `npm run typecheck --prefix server` → エラー0件
- `cd client && npx tsc -b` → エラー0件
- `npm run lint --prefix client` → 新規エラーなし

## 対象外（Out of scope）

- ステップ1（LM Studioによるプロンプト拡張）中のキャンセル — このフェーズは高速であり、今回報告された課題の対象ではない。
- ジョブIDごとのキャンセル・同時実行ジョブの管理 — このツールはローカル1ユーザー向けであり、SDは同時に1ジョブしか処理しないため、単一のモジュールレベルフラグで十分。ジョブレジストリを持つ必要はない。
- 専用の`'info'`トーストスタイル — キャンセル時も既存の`'success'`トーストのスタイルを流用する。
- 古いSDビルドがinterruptに対応していないことを個別に検知・報告する仕組み — このコードベースの他の任意SD API呼び出しと同じ劣化の仕方に倣う。
