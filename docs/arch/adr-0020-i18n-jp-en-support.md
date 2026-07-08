# ADR 20: UI 国際化（JP/EN）を独自軽量モジュールで実装する

## Context

Sumica AI Studio の UI は当初すべて日本語で書かれており、約 176 個の日本語文字列が 13 ファイルに散在していました。日本語話者以外は使えない状態で、洋一郎さんから英語 UI を追加してほしいというリクエストがありました。要件は次の 3 点です。

- 表示言語は **日本語（`ja`）と英語（`en`）の 2 種類**をサポート。
- **URL クエリパラメータ**による強制指定（`?hl=ja` / `?hl=en`）を最優先とする。
- クエリパラメータがない場合は **`navigator.language` が `ja` で始まれば日本語**、それ以外は**英語にフォールバック**。

一方で、Sumica はローカル・シングルユーザー向けの小規模ツールであり、複数言語のプルーラルルール、日付ローカライズ、通貨表現などの複雑な i18n 機能は不要です。react-i18next / react-intl / FormatJS のような本格的 i18n ライブラリを採用すると、`50〜100KB` の追加バンドルと学習コスト、そして API の複雑さがオーバーヘッドになります。加えて、実行時の locale 切替 UI（ヘッダのドロップダウン等）はユーザー要件に含まれず、ロード時に一度決定できれば十分です。

サーバー側（`server/*.ts`）が返すエラーメッセージは英語で短く、ユーザーが直接目にする機会も少なく、i18n の責務を Accept-Language ヘッダ経由でサーバーまで持ち込むと変更範囲が広がりすぎる懸念がありました。

## Decision

**外部ライブラリを採用せず、カスタム軽量モジュール `client/src/i18n/` を独自に実装します。**

構成は次の通りです。

- **`client/src/i18n/index.ts`**（〜30 行）: `resolveLocale()` 関数、`locale` 定数、`t` 定数を named export。モジュールロード時に一度 `resolveLocale()` を評価し、以降は不変です。副作用として `document.documentElement.lang` を設定します。
- **`client/src/i18n/ja.ts`**: 機能領域ごとにネストしたオブジェクトを `export const ja` として default 以外で export。12 個のトップレベルセクション（`header`, `controlPanel`, `preview`, `gallery`, `lightbox`, `batchModal`, `deleteConfirm`, `toastContainer`, `caption`, `notification`, `toast`, `tabs`）に約 176 個のキーを分類。
- **`client/src/i18n/en.ts`**: `import type { ja } from './ja'` を使い、`export const en: typeof ja = { ... }` の形式で英語辞書を宣言。TypeScript が `en` の構造を `ja` と厳密に一致させることを強制するため、翻訳漏れや余分なキーはコンパイルエラーで即座に検出されます。
- **`client/src/i18n/index.test.ts`**: `resolveLocale()` の分岐を 8 個の Vitest ケースでカバー。

locale 決定の優先順位は次の順で評価します。

1. `URLSearchParams(window.location.search).get('hl') === 'ja'` → `'ja'`
2. `URLSearchParams(window.location.search).get('hl') === 'en'` → `'en'`
3. `navigator.language.toLowerCase().startsWith('ja')` → `'ja'`
4. それ以外 → `'en'` フォールバック

`hl` が `ja` / `en` 以外（例 `?hl=fr`）の場合はエラーを投げず、静かに 3〜4 の経路に落とします。ユーザーが URL を手入力してタイポしても壊れないためです。

補間が必要な文字列は**関数**（`(msg: string) => \`サインインに失敗しました: ${msg}\``）、要らないものは**プレーン文字列**として定義します。呼び出し側は `t.header.title`（文字列）または `t.toast.batchAllSuccess(10)`（関数呼び出し）と自然に使い分けます。

サーバーからのエラーメッセージ（例 `res.status(500).json({ error: 'Prompt is required' })`）は、そのまま `details` 引数としてクライアントの i18n ラップメッセージに埋め込みます：

```ts
addToast(t.toast.generateFailed(errData.error), 'error');
// 日本語 UI: 画像生成に失敗しました。詳細: Prompt is required
// 英語 UI: Image generation failed. Details: Prompt is required
```

サーバーコード（`server/*.ts`）には 1 行も変更を加えません。

代替案として次を比較検討し、いずれも却下しました。

- **react-i18next / react-intl / FormatJS**: 実績豊富なライブラリですが、Sumica はプルーラル・日付ローカライズ・通貨などの複雑機能を要さず、`50〜100KB` のバンドルサイズ増と学習コストは過剰。将来的に必要になれば移行可能な構造にしてあります。
- **ヘッダに言語切替 UI を追加**: URL / ブラウザ設定 / ユーザー選択の 3 層優先順位ロジックを持ち込むことになり、localStorage 永続化とルール決めが必要。今回のロード時決定で十分。
- **サーバーサイド i18n（Accept-Language 経由）**: サーバーコードの変更範囲が広がる。現在のサーバーエラー文字列は短く、ユーザーが直接目にする機会も少ないため、クライアント側のラップメッセージで十分。
- **文字列を機能領域ごとに別ファイルに分割**（`i18n/header.ts`, `i18n/toast.ts` 等）: 176 文字列は 1 ファイルに収まるサイズで、複数ファイルにすると import が増え、キーの探しやすさが下がる。1 ファイル per locale が素直。

## Status

承認済み

## Consequences

- **依存ゼロの i18n が実現**しました。バンドルサイズ増は `ja.ts` + `en.ts` の実データのみ（数 KB）で、react-i18next などを入れる場合と比べて桁違いに軽量です。
- **翻訳漏れは TypeScript が自動検出**します。`en.ts` に `typeof ja` の型注釈を付けているため、`ja.ts` にキーを追加して `en.ts` に対応を追加し忘れると `tsc` がコンパイルエラーを出します。専用のテストは不要。
- **サーバーコードには一切影響なし**です。i18n はクライアント側のみで完結し、[[adr-0001-client-side-firebase-persistence]] の「サーバーは Firebase 非依存」原則と同様に、責務の境界がクリーンに保たれます。
- **locale の実行時切替は不可**です。今後もしヘッダに言語切替 UI を追加したくなった場合は、`t` を `useState` ベースの hook に置き換える必要があります。ただしその場合も辞書 (`ja.ts` / `en.ts`) の構造は変えなくて済み、拡張余地は大きいです。
- **サーバーからのエラーメッセージは英語のまま**、クライアントの i18n ラップメッセージに埋め込まれます。ユーザーには「画像生成に失敗しました。詳細: Prompt is required」のように、外殻がローカライズされて中身は元の英語という表示になります。実運用上、サーバーエラーは頻繁には見えず、開発者向けの技術情報として英語のままの方が寧ろ役に立つケースが多いと判断しました。
- **文字列は機能領域ごとにネスト**（`t.header.*`, `t.controlPanel.*`, `t.toast.*` 等）されているため、UI 修正時に該当キーを探しやすく、既存キーの再利用（例: `t.header.cloudSaving` を PreviewPanel でも参照）で重複を避けられます。
- **英語版のレイアウト崩れは基本的に発生しませんでした**が、`Sign in with Google`（英）が `Googleでログイン`（日）より長いなど、微細な差はあります。既存の `text-overflow: ellipsis` と `max-width` 制限が吸収してくれる範囲で、必要に応じて英語版だけスタイル調整可能です。
- **ADR / 設計仕様書 / 実装計画などのドキュメント（`docs/`）と `CLAUDE.md` は日本語のまま**残しました。これらは開発者向けドキュメントで UI ではないため。将来的に英語話者の共同開発者が参加する場合は、その時点で翻訳の是非を判断すればよく、YAGNI です。
- **`prefers-color-scheme` と同様に、`navigator.language` の変化を実行時に追わない**設計になっています。ブラウザ言語設定を変更してもリロードするまで UI は切り替わりません。要件どおりの load-time 決定であり、実運用上の実害はありません。
- **HTML の `<html lang="...">` 属性が正しく設定**されるため、ブラウザのスペルチェック、スクリーンリーダー、CSS `:lang()` セレクタが実際の locale と一致します。
