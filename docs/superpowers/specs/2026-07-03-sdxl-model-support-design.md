# 設計書: SDXLモデルのUI対応

日付: 2026-07-03
ステータス: 承認済み

## 概要

SDXLチェックポイントを一覧から除外するのをやめ、ユーザーが実際に生成に使えるようにします。核となるアイデアは、新設する**「SD / SDXL」種別トグル**です。これがフォーム全体を常にひとつのアーキテクチャだけに絞り込みます。具体的には、モデルピッカーに表示されるチェックポイントを絞り込み、どの解像度選択肢を提示するかを決め、「まとめて生成」の「モデル切替」モードで対象となるモデルの範囲も決めます。このトグルによってフォームがアーキテクチャを混在させることが構造上あり得なくなるため、モデルごと・バッチジョブごとの解像度上書きロジックは一切不要になります。今選ばれている単一の幅/高さは、常にその時点で表示されているものすべてに対して適切な値であり続けます。

LoRAの互換性については、可視化はしますが強制はしません。LoRA追加プルダウンでは、アーキテクチャが確実に判明していて、かつ現在のトグルと異なるものにだけ「⚠」バッジを表示します。それ以外（アーキテクチャのメタデータが一切無いLoRA — 今回調査したこの環境では全体の約4割に相当）は、今まで通り何も手を加えずそのまま選択可能にしておきます。

この設計は[[adr-0009-safetensors-header-sdxl-detection]]で実装したチェックポイント単位のSDXL判定をそのまま土台にしています。

## 現状の挙動（as-is）

- `/api/sd-models`は、`.safetensors`ヘッダーにSDXL特有の`conditioner.embedders.*`というキーが存在するチェックポイントを除外して返しています（ADR-9）。返却されるのはフラットな`models: string[]`で、SDXLチェックポイントはクライアントのどこにも一切現れません。
- モデルピッカー（`client/src/App.tsx`）は`sdModels`に対する単純なフラットな`<select>`一つです。
- 幅/高さは独立した2つの`<select>`で、どちらもハードコードされた同一の選択肢`[512, 768, 1024]`（`SIZE_OPTIONS`というモジュール定数）を共有しています。この定数はメインフォームだけでなく、「まとめて生成」の「サイズの組み合わせ」モードでも使われています。
- 「まとめて生成」には3つのモードがあります：枚数（count）、サイズの組み合わせ（size combinations、`SIZE_OPTIONS`の各軸の掛け合わせ）、モデル切替（model cycling、選択したチェックポイントごとに1枚ずつ、すべてのジョブがメインフォームの現在の幅/高さをそのまま使用）。
- `/api/sd-loras`はフラットな`loras: string[]`（名前のみ）を返しています。SD自体の`/sdapi/v1/loras`のレスポンスには実際には学習時の情報を含む`metadata`オブジェクトがLoRAごとに含まれていますが、サーバーは`name`以外をすべて捨てています。LoRAピッカーには互換性に関する情報が一切ありません。

## あるべき挙動（to-be）

- すべてのチェックポイントをサーバーが返すようになり、それぞれにアーキテクチャの`type`というタグが付きます。
- モデルピッカーの近くに新しいセグメント型トグル（「SD」/「SDXL」）を設けます。見た目は既存のバッチモードタブと統一します。初期値はSDで実際に現在ロードされているチェックポイントのアーキテクチャに合わせます。
- モデルの`<select>`は、アクティブなトグルの値に一致するチェックポイントだけを一覧表示します。
- 幅/高さの`<select>`は、トグルに応じて異なる選択肢を提供します：「SD」なら`[512, 768, 1024]`、「SDXL」なら`[1024, 1152, 1280]`。トグルを切り替えたとき、現在の幅/高さが新しい選択肢の中にまだ存在すればそのまま維持し、存在しなければそのアーキテクチャの既定値（SDは512、SDXLは1024）にリセットします。
- 「サイズの組み合わせ」バッチモードの候補サイズも、同じトグル連動の選択肢に従います。
- 「モデル切替」バッチモードは、アクティブなトグルに一致するチェックポイントだけを対象に切り替えます。これにより、そのバッチの全ジョブが同一アーキテクチャに揃うため、フォームの単一の幅/高さが常に全ジョブに対して有効になり、ジョブごとの解像度ロジックは不要になります。
- 「＋LoRAを追加」プルダウンでは、検出されたアーキテクチャが確実に判明していて、かつアクティブなトグルと一致しないLoRAに「⚠」マークを付記します。アーキテクチャが判定不能なLoRAは、今まで通り何もマークを付けずに表示します。

## サーバー側の変更（`server/index.ts`）

### `/api/sd-models`

除外フィルタを完全に撤廃します。既存の`isSdxlCheckpoint()`ヘルパー（ADR-9）をそのまま再利用し、チェックポイントを除外する代わりにタグ付けします。SDXLでないもの（`isSdxlCheckpoint()`がすでに`false`を返すFluxのような真に不明なアーキテクチャも含む）は`'sd15'`とタグ付けします。これは、不明なアーキテクチャのチェックポイントは除外の観点ではSD1.5と同等に扱うという先の決定と一致しており、このレイヤーでは3つ目の区分は不要です。

```ts
app.get('/api/sd-models', async (_req: Request, res: Response) => {
  try {
    const [listRes, optionsRes] = await Promise.all([
      axios.get(`${stableDiffusionUrl}/sdapi/v1/sd-models`, { timeout: 5000 }),
      axios.get(`${stableDiffusionUrl}/sdapi/v1/options`, { timeout: 5000 }),
    ]);
    const rawModels: Array<{ title?: string; filename?: string }> = Array.isArray(listRes.data) ? listRes.data : [];
    const models = await Promise.all(
      rawModels
        .filter((m): m is { title: string; filename?: string } => Boolean(m.title))
        .map(async (m) => ({
          title: m.title,
          type: (await isSdxlCheckpoint(m.filename, m.title)) ? 'sdxl' as const : 'sd15' as const,
        }))
    );
    const activeCheckpoint = optionsRes.data?.sd_model_checkpoint ?? null;
    const current = activeCheckpoint && models.some((m) => m.title === activeCheckpoint)
      ? activeCheckpoint
      : models[0]?.title ?? null;
    res.json({ models, current });
  } catch (error) {
    console.error('Failed to fetch SD models:', (error as Error).message);
    res.json({ models: [], current: null });
  }
});
```

レスポンスの形は`{ models: string[], current }`から`{ models: { title: string; type: 'sd15' | 'sdxl' }[], current }`に変わります。

### `/api/sd-loras`

`isSdxlCheckpoint()`の近くに新しいヘルパーを置きます。

```ts
// AUTOMATIC1111/ForgeがすでにパースしてくれているLoRAの学習メタデータ
// （/sdapi/v1/lorasのレスポンス）から、LoRAのベースアーキテクチャを分類する。
// modelspec.sai_model_spec規約に沿った `modelspec.architecture` フィールドを
// 優先し、古いトレーナーが代わりに書く、より緩い `ss_base_model_version`
// フィールドにフォールバックする。どちらも無い場合は 'unknown' を返す
// — 実際にはLoRAの約4割がこれに該当する（modelspec規約に対応していない
// 古いトレーナーで作られたものなど）ため、呼び出し側は 'unknown' を
// 「非互換」として扱ってはならない。
function classifyLoraArchitecture(metadata: Record<string, unknown> | undefined): 'sd15' | 'sdxl' | 'unknown' {
  const arch = String(metadata?.['modelspec.architecture'] ?? metadata?.['ss_base_model_version'] ?? '').toLowerCase();
  if (arch.includes('xl')) return 'sdxl';
  if (arch.includes('stable-diffusion-v1') || arch.startsWith('sd_v1') || arch.startsWith('sd_1')) return 'sd15';
  return 'unknown';
}
```

ルート側の更新：

```ts
app.get('/api/sd-loras', async (_req: Request, res: Response) => {
  try {
    const listRes = await axios.get(`${stableDiffusionUrl}/sdapi/v1/loras`, { timeout: 5000 });
    const loras = Array.isArray(listRes.data)
      ? listRes.data
          .filter((l: { name?: string }): l is { name: string; metadata?: Record<string, unknown> } => Boolean(l.name))
          .map((l) => ({ name: l.name, type: classifyLoraArchitecture(l.metadata) }))
      : [];
    res.json({ loras });
  } catch (error) {
    console.error('Failed to fetch SD LoRAs:', (error as Error).message);
    res.json({ loras: [] });
  }
});
```

レスポンスの形は`{ loras: string[] }`から`{ loras: { name: string; type: 'sd15' | 'sdxl' | 'unknown' }[] }`に変わります。

## クライアント側の変更（`client/src/App.tsx`）

### 型

```ts
type SdModel = { title: string; type: 'sd15' | 'sdxl' };
type SdLora = { name: string; type: 'sd15' | 'sdxl' | 'unknown' };
```

### 定数

単一の`SIZE_OPTIONS`定数を、両アーキテクチャをカバーするルックアップに置き換えます。

```ts
const SIZE_OPTIONS_BY_TYPE: Record<'sd15' | 'sdxl', number[]> = {
  sd15: [512, 768, 1024],
  sdxl: [1024, 1152, 1280],
};
```

`SIZE_OPTIONS`（旧来のフラットな定数）は削除し、これまでの利用箇所はすべて`SIZE_OPTIONS_BY_TYPE[modelTypeFilter]`に切り替えます。

### state の変更

```ts
const [sdModels, setSdModels] = useState<SdModel[]>([]);       // 旧: string[]
const [sdLoras, setSdLoras] = useState<SdLora[]>([]);          // 旧: string[]
const [modelTypeFilter, setModelTypeFilter] = useState<'sd15' | 'sdxl'>('sd15');
const modelTypeInitialized = useRef(false); // 最初の実際の/api/sd-modelsレスポンス後にtrueにする
```

`selectedLoras`（`{ name, weight }[]`）は変更しません — これはLoRAの選択状態を保持するものであり、アーキテクチャ情報ではないため、描画時に`sdLoras`から都度参照します。`addLora`/`removeLora`/`setLoraWeight`は`name: string`だけをキーにしており、変更不要です。`fetchSdLoras()`自体もコード変更は不要です — すでに`setSdLoras(Array.isArray(data.loras) ? data.loras : [])`という実装になっており、新しい`{ name, type }[]`という形をそのまま素通しできます。変わるのは`sdLoras`のstateの型注釈だけです。

### `fetchSdModels()`

```ts
const fetchSdModels = async () => {
  try {
    const res = await fetch(`${API_BASE}/sd-models`);
    if (res.ok) {
      const data = await res.json();
      const models: SdModel[] = Array.isArray(data.models) ? data.models : [];
      setSdModels(models);
      setSelectedModel((prev) => prev || data.current || '');
      if (!modelTypeInitialized.current && data.current) {
        const currentType = models.find((m) => m.title === data.current)?.type;
        if (currentType) {
          setModelTypeFilter(currentType);
          modelTypeInitialized.current = true;
        }
      }
    }
  } catch (error) {
    console.error('Failed to fetch SD models:', error);
  }
};
```

`modelTypeInitialized`というrefにより、トグルはSDの実際のアクティブチェックポイントから一度だけ自動的に初期値を決めます。ユーザーがすでに手動でトグルを変更していた場合に、その後の再取得（例えば`health.stableDiffusion.connected`のeffectによる再接続時の再取得）で上書きしてしまうことはありません。

### モデルピッカー＋トグル

```tsx
<div style={{ display: 'flex', gap: '8px', ... }}>
  {(['sd15', 'sdxl'] as const).map((t) => (
    <button
      key={t}
      type="button"
      onClick={() => setModelTypeFilter(t)}
      disabled={loading}
      style={{ /* batchModeタブと同じセグメント型の見た目 */
        background: modelTypeFilter === t ? 'var(--pop-blue)' : 'transparent',
        color: modelTypeFilter === t ? '#fff' : 'var(--text-secondary)',
      }}
    >
      {t === 'sd15' ? 'SD' : 'SDXL'}
    </button>
  ))}
</div>
```

```tsx
const modelsInScope = sdModels.filter((m) => m.type === modelTypeFilter);
...
{modelsInScope.length > 0 ? (
  <select className="input-field" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} disabled={loading}>
    {modelsInScope.map((m) => (
      <option key={m.title} value={m.title}>{m.title}</option>
    ))}
  </select>
) : (
  <select className="input-field" disabled>
    <option>{modelTypeFilter === 'sdxl' ? 'SDXLモデルが見つかりません' : 'SD1.5モデルが見つかりません'}</option>
  </select>
)}
```

### 解像度＋トグルのリセットeffect

`modelTypeFilter`の変化に反応するeffectをひとつ用意し、それに依存するすべての値 — `selectedModel`、メインフォームの`width`/`height`、バッチモーダルの`selectedWidths`/`selectedHeights` — を再検証します。

```ts
// トグルが切り替わるたびに、アクティブなアーキテクチャに依存する値をすべて
// 再検証する。sdModelsは意図的に依存配列に含めていない — このeffectは
// 明示的なトグルの切り替え時にだけ実行されるべきで、同じトグル値のまま
// モデル一覧がたまたま再取得された場合には実行されてほしくないため。
useEffect(() => {
  const options = SIZE_OPTIONS_BY_TYPE[modelTypeFilter];
  const fallback = modelTypeFilter === 'sdxl' ? 1024 : 512;

  setSelectedModel((prev) => (sdModels.some((m) => m.type === modelTypeFilter && m.title === prev) ? prev : (sdModels.find((m) => m.type === modelTypeFilter)?.title ?? '')));
  setWidth((prev) => (options.includes(prev) ? prev : fallback));
  setHeight((prev) => (options.includes(prev) ? prev : fallback));
  setSelectedWidths((prev) => { const kept = prev.filter((w) => options.includes(w)); return kept.length ? kept : [...options]; });
  setSelectedHeights((prev) => { const kept = prev.filter((h) => options.includes(h)); return kept.length ? kept : [...options]; });
}, [modelTypeFilter]);
```

### バッチモーダル

- `openBatchModal()`：`selectedBatchModels`の初期値を、`sdModels`全体ではなく絞り込み後の一覧から作るようにします。
  ```ts
  const openBatchModal = () => {
    setSelectedBatchModels(new Set(sdModels.filter((m) => m.type === modelTypeFilter).map((m) => m.title)));
    setShowBatchModal(true);
  };
  ```
- 「サイズの組み合わせ」モードのサイズ切替ボタンは、旧`SIZE_OPTIONS`定数ではなく`SIZE_OPTIONS_BY_TYPE[modelTypeFilter]`を反復するようにします。
- 「モデル切替」モードの候補一覧（チェックボックス一覧、「全選択」/「全解除」ボタン、送信時のジョブ生成処理の`.filter(...).map(...)`）はすべて、`sdModels`全体ではなく`sdModels.filter((m) => m.type === modelTypeFilter)`に対して操作するようにします。
- 送信時のジョブ生成処理自体はそれ以外変更ありません — 選択されたチェックポイントごとに`{ width, height, model: m.title }`を生成する処理は変わらず、`width`/`height`はどちらも上記のeffectによって`modelTypeFilter`に対してすでに妥当な値であることが保証されています。

### LoRAピッカーのバッジ

```tsx
{sdLoras.filter((l) => !selectedLoras.some((sl) => sl.name === l.name)).map((l) => {
  const mismatched = l.type !== 'unknown' && l.type !== modelTypeFilter;
  return (
    <option key={l.name} value={l.name}>
      {l.name}{mismatched ? ` ⚠${l.type === 'sdxl' ? 'SDXL' : 'SD1.5'}用` : ''}
    </option>
  );
})}
```

それ以外のLoRAの挙動 — 選択、weight、生成時の`<lora:name:weight>`プロンプト付記 — には一切手を加えません。

## データフロー

```
ページ読み込み → fetchSdModels() → /api/sd-modelsがタグ付き済みモデル + currentを返す
  → modelTypeFilterがcurrentのtypeで初期化される（一度だけ）
  → モデル<select>と幅/高さの<option>がmodelTypeFilterに絞り込まれる

ユーザーが「SD / SDXL」トグルを切り替える
  → effectがselectedModel / width / height / selectedWidths / selectedHeightsを再検証
  → モデル<select>の選択肢が別アーキテクチャのチェックポイントに切り替わる

ユーザーが「まとめて生成」→モデル切替を開く
  → 候補一覧 = すでにmodelTypeFilterで絞り込み済みのsdModels
  → 全ジョブが単一アーキテクチャに揃うので、フォームの幅/高さがすべてのジョブに対して有効なまま適用される
  → handleBatchGenerateは変更なしで動作する

ユーザーがLoRAプルダウンを開く
  → fetchSdLoras()の分類結果（サーバー側で判定済み）とmodelTypeFilterを突き合わせて「⚠」バッジを出す
```

## エッジケース

| ケース | 扱い |
|---|---|
| SDにSDXLチェックポイントが1件も無い | 「SDXL」に切り替えると「SDXLモデルが見つかりません」という無効化された選択肢が表示される。「SD」に戻すことは引き続き可能 |
| 初期トグルのアーキテクチャに該当するチェックポイントがSDに1件も無い（例えば、アクティブなチェックポイントが後で削除された等、稀なケース） | `data.current`のtypeから`modelTypeInitialized`は設定される。仮にそのモデルが後の再取得で一覧から消えても、クラッシュはせず空状態のプレースホルダーが表示される |
| 「まとめて生成」モーダルを開いた状態でトグルを切り替える | `selectedBatchModels`/`selectedWidths`/`selectedHeights`は**モーダルを開いた時点**のトグル値から初期化されている。モーダルを開いたままトグルを切り替えるケースは特別扱いしない — モーダル内のローカルな選択状態は最後に初期化された値のまま維持される。これはモーダルのローカルな選択がバックグラウンドの状態変化に反応しない、という既存のパターンと一致する |
| LoRAにアーキテクチャのメタデータが無い（`unknown`） | 今まで通り、常にマーク無しで表示される — `modelTypeFilter`に関わらず、隠されることもバッジが付くこともない |
| LoRAの`type`が`modelTypeFilter`と一致する | マーク無しで表示される |
| この機能以前に生成された履歴項目を「♻️ フォームにロード」で読み込む | `loadIntoForm()`は保存されたレコードから直接`width`/`height`/`model`を設定する（既存のコードパスのまま）。保存されていたモデルのアーキテクチャが現在の`modelTypeFilter`と異なっていても、トグルは自動的には切り替わらない — スコープ外とする（下記参照） |
| `/api/sd-models`または`/api/sd-loras`に接続できない | 今まで通り：空配列、無効化されたプレースホルダー。`modelTypeFilter`は最後の値のまま（一度も初期化されていなければ既定の`'sd15'`） |

## テスト・検証

このプロジェクトに自動テストは無し。型チェック・lintの後、手動で以下を確認する。

1. SD接続済みの状態でページを読み込む → トグルが実際にロードされているチェックポイントのアーキテクチャに一致した初期値になる
2. 「SDXL」に切り替える → モデル一覧がSDXLチェックポイントのみになる。幅/高さの選択肢が`1024/1152/1280`になる。それまでの幅/高さ（例：512）がその選択肢に無ければ1024にリセットされる
3. 「SD」に戻す → 逆方向で同様に確認、既定値は512
4. SDXLチェックポイントを選択した状態で単体生成する → 成功し、1024×1024で正しい見た目の画像になる（これまでは一覧から完全に除外されていた）
5. トグルを「SDXL」にした状態で「まとめて生成」→モデル切替 → チェックボックス一覧にSDXLチェックポイントだけが表示される。チェックした各モデルにつき1枚、すべて同じ（妥当な）解像度でバッチが完了する
6. トグルを「SDXL」にした状態で「まとめて生成」→サイズの組み合わせ → サイズボタンが`1024/1152/1280`になる
7. トグルが「SD」の状態でSDXL専用と分かっているLoRAを追加する → プルダウンの項目に「⚠SDXL用」マークが表示される。「SDXL」に切り替えると、そのLoRAのマークは消え、代わりにSD1.5と判明しているLoRAにマークが付く
8. アーキテクチャのメタデータが無いLoRAを追加する → どちらのトグル状態でもマークは一切付かない
9. SDに接続できない → 両方のピッカーで既存の無効化プレースホルダーの挙動になる。新しいトグルのロジックに起因するクラッシュは無い

加えて以下も実行する：
- `npm run typecheck --prefix server` → エラー0件
- `cd client && npx tsc -b` → エラー0件
- `npm run lint --prefix client` → 新規エラー無し

## スコープ外

- 「♻️ フォームにロード」で、保存されているモデルが現在のトグルと異なるアーキテクチャに属する過去の生成を読み込んだ場合の、`modelTypeFilter`の自動切り替え。読み込まれたモデル・幅/高さ自体は正しく表示されるが、トグルともう一方の幅/高さの選択肢が、ユーザーがトグルを操作するまで見た目上ちぐはぐになり得る。実運用で分かりにくいと判明したら別途対応する
- 真のSD1.5と、たまたまインストールされている他の不明アーキテクチャ（Flux、HunyuanVideoなど）を分ける3値トグル。これらは引き続き「SD」側にまとめられる
- アーキテクチャの不一致に基づくLoRAの重みの自動調整や、選択のブロック・絞り込みといった強制。バッジはあくまで情報提供のみ
- SDXL向けのHires.fixパラメータのチューニング（例えばdenoising strengthの既定値を変えるなど）。既存のスライダーをそのまま流用する
- トグルの選択状態をページリロードをまたいで保持すること（サンプラー/スケジューラー/LoRAの選択状態が今もそうであるように、localStorageは使わない）
- SDXLのRefiner対応（base モデルと refiner モデルを組み合わせた二段階生成パイプライン、SDの`refiner_checkpoint`/`refiner_switch_at`パラメータ）。今回の設計では、単体のチェックポイントをこれまで通り単一の`model`として扱うだけで、base/refinerを別々に選んで組み合わせる仕組みは追加しない。ADR-9の判定ロジック上はrefinerチェックポイントも`sdxl`として一覧に現れ、通常のチェックポイントとして単独選択・単独生成はできるが、それ以上の専用対応はスコープ外とする
- VAEの選択・切り替え。Sumicaには現状VAEを指定するUI・APIが一切無く、今回のSDXL対応でも新設しない。SDXLでは推奨されるfp16-fixed VAE等があるが、その選択は範囲外とし、SD側の現在のVAE設定（`override_settings`未指定時の既定挙動）に委ねる
