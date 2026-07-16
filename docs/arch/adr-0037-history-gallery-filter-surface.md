# ADR 37: 履歴ギャラリーの多軸フィルター

## Context

履歴ギャラリー（`components/HistoryGallery.tsx`）は当初、[[adr-0019-gallery-shift-click-range-selection]] 系の選択操作と、日付・お気に入り絞り込みだけを持っていました。生成枚数が数百件を超えるにつれ、洋一郎さんから「特定のモデル・SDXL/SD1.5・特定サンプラーで生成した画像だけを俯瞰したい」というリクエストが上がり、フィルタ軸を拡張する必要が出てきました。

拡張軸の候補は多く（モデル / モデル種別 / サンプラー / スケジューラ / アスペクト比 / 向き / Hires / LoRA / Refiner / VAE …）、UI をどこまで詰め込むか、選択肢をどこから引き出すか、Firestore クエリを変更するかといった論点が絡んでいました。特に「選択肢はプリセットの理論値（SDXL 純正ラチオ 7 種など）なのか、その日に実在した distinct 値なのか」で、UX の意味論が変わります。

一方で Sumica の [[adr-0001-client-side-firebase-persistence]] 系のハイブリッド保存パターン上、履歴の subscribe は日付 range クエリ（signed-in）または `/api/history` 全件取得（signed-out）で行われており、フィルタ機能をクライアント側だけで完結できるか、あるいは Firestore/サーバ側のクエリまで拡張する必要があるかも判断材料でした。

## Decision

**モデル種別 / モデル / サンプラー / アスペクト比 / 向き の 5 軸を追加し、すべて日付＋お気に入り base scope に対するクライアントサイドの後段フィルタとして実装します。** Firestore クエリと `/api/history` のリクエスト形は一切変更しません。フィルタは軸横断で AND、単一軸内は単一選択、`null` は「その軸で絞り込まない」を意味します。

設計の細部は次のとおりです。

- **選択肢はデータ駆動**：`deriveFilterOptions(archScopedHistory)` が history の distinct 値を抽出したものだけを列挙します。SDXL 純正ラチオのプリセット表などは使いません。「その日に実在するモデルだけ」を選べる方が UX として直感的で、デッドオプションが出ないためです。
- **アーキ・カスケード**：モデル種別（SDXL/SD1.5）を選ぶと、モデル・サンプラー・アスペクト比・向きの候補も自動的にそのアーキ配下の distinct 値に絞られます。実装は `archScopedHistory` メモを噛ませ、そこから `filterOptions` を派生させる二段階の useMemo です。
- **モデル名の正規化**：`stripHashSuffix` を通じてハッシュ suffix を落として distinct 抽出・比較を行います。同一チェックポイントの旧ハッシュ／新ハッシュ／ハッシュ無しが並ぶのを防ぐためで、[[adr-0016-defer-sdxl-misclassification-fix]] と同じ正規化ポリシーです。
- **アスペクト比とラベル**：ratio 値は `larger:smaller` の canonical 形（portrait/landscape の同形状は同一 key に collapse）で、ラベルには canonical `larger×smaller` ピクセル寸法を付けます（例：`4:3 (1024×768)`）。複数解像度が同 ratio 配下にある場合はピクセル数降順で ` / ` 区切り。
- **自動非表示**：各軸の候補が 1 個以下しかない場合はその軸の UI を非表示にします。「その軸で絞り込む意味がない」ケースの視覚ノイズを削るためです。モデル種別=「すべて」のときはモデル軸も非表示にします（SDXL と SD1.5 が混在した list を出しても選択判断ができないため）。1:1 のときは向き軸も非表示（正方形に向きは無意味）。
- **ステイルクリア**：軸切替（特にモデル種別）で現在の選択値が新しい候補一覧に含まれない場合、useEffect で該当フィールドを `null` にリセットします。**ただし候補一覧が空（`length === 0`）の場合はクリアしません**。空 = 「データが無い」であって「その値が無効」ではないため、ユーザー意図を保持します（データ未着や日付切替の一時状態でフィルタが silently 消える事故を防ぐガードです）。
- **選択掃除**：フィルタ変更で見えなくなった画像が `selectedIds` に残らないよう、`displayedHistory` を dep にした useEffect で不可視 id を pruning します。サイズ変化ゼロなら state を更新しない ref-equality guard 付き。
- **永続化なし**：フィルタ状態は localStorage/sessionStorage に保存しません。セッションごとに完全リセットで、date/favorites と同じ揮発性を保ちます。
- **空状態の 3 分岐**：`historyLength === 0`（履歴自体なし） / `baseScopedHistoryLength === 0`（date/favorites でヒットなし） / `filterでヒットなし` の 3 通りをそれぞれ別メッセージで表示します。App.tsx から `baseScopedHistory.length` を prop で渡すことで判定できるようにしています。

代替案として次を比較検討し、いずれも却下しました。

- **プリセット表からの選択肢**：SDXL/SD1.5 の純正ラチオ表を選択肢にする方法も考えましたが、「その日には実在しないラチオを選べる」ケースが混乱の元になるためデータ駆動を採用しました。
- **Firestore クエリの拡張**：モデルフィルタなどを Firestore の複合クエリに乗せることで、大量履歴を扱う際のパフォーマンスは上がりますが、[[adr-0021-favorite-recipe-rollup-ranking]] の rollup とは違い、フィルタは日次スコープ（数百件）で十分に速く、複合インデックスの追加コストに見合いません。
- **フィルタ状態の永続化**：localStorage に保存すれば「前回の続きから」の体験ができますが、日付を切り替えた際に古い選択値が残ることによる混乱の方が大きく、また「試行錯誤の UI」（[[adr-0038-inline-filter-panel-for-exploration]] 参照）としては新セッションで白紙が望ましいと判断しました。

## Status

承認済み

## Consequences

- **軸拡張が非破壊**：フィルタが 5 軸に増えても Firestore 側の変更ゼロで済み、既存の subscribe パスと [[adr-0021-favorite-recipe-rollup-ranking]] の rollup も無関係のままです。「クライアント側フィルタは日次スコープで十分」という仮説がそのまま維持されました。
- **UI の自動可変性**：`.length > 1` の auto-hide ルールにより、その日のデータの多様性に応じてフィルタパネルが自然に伸縮します。1 モデルしか使ってない日はモデル select が消え、混在してる日は自動で現れます。ユーザーが「なぜこの select があるのか／ないのか」を意識せずに済む挙動になりました。
- **モデル名のハッシュ揺れが吸収**：records の `.model` に `[hash]` が付いてる／付いてないの揺れは、`stripHashSuffix` 経由で 1 エントリに畳み込まれます。同モデルが 2 エントリに割れる事故は起きません。
- **stale-clear の empty ガードは他の状況でも効く**：日付を「その日はデータなし」の日に切り替えたときに、フィルタ値が silently 消える現象がなくなりました。ユーザーの意図を保持したまま「0件」を表示するようになり、date を戻せば元の絞り込みが復活します。副次的な UX 改善です。
- **フィルタ変更で選択が壊れない**：Range-select（[[adr-0019-gallery-shift-click-range-selection]]）や単一クリック選択で貯めた `selectedIds` は、フィルタで hidden になった時点で自動的に pruning されます。誤って invisible な画像を削除してしまう事故を防止しています。
- **選択肢が 1 個の軸を隠す挙動が「その値でしか絞り込めない」ことを暗黙的に示唆**：モデルが 1 種類しかない日は「モデル」select が消えます。これは「モデル絞り込みの余地がない」ことをユーザーに視覚的に伝える意味も持ちますが、逆に「フィルタが利かない」と誤解される余地もあります。今後この暗黙のコミュニケーションが問題になれば、明示的な「その日は 1 モデルのみ」表示に切替える判断が必要になるかもしれません。
- **軸追加のコスト**：将来 Scheduler / Hires / Refiner / LoRA / VAE を追加する場合、`GalleryFilters` 型に 1 フィールド、`applyGalleryFilters` に 1 ガード、`deriveFilterOptions` に 1 distinct set、popover に 1 select（または radio）、stale-clear useEffect を 1 個ずつ足すだけで拡張できます。今回の 5 軸実装はこの拡張パターンが機能することを実証しました。
- **フィルタは date + favorites の後段のため、「全期間から特定条件で探す」ができない**：フィルタは常に「その日の中で」あるいは「全 favorites の中で」絞り込みます。「全期間から SDXL の 4:3 を全部見たい」は favorites-only を ON にする迂回でしか実現できません。ランキングからの導線（[[adr-0039-ranking-to-gallery-filter-shortcut]]）はこの制約を利用して favoritesOnly=true を強制することで、実質的な全期間検索を提供しています。
