# ADR 43: サーバーは TypeScript ソースを tsx で直接実行し、ビルド成果物を持たない

## Context

Sumica のサーバー (`server/index.ts`) は当初 JavaScript (`server/index.js`) として実装されていましたが、型安全性を高めるために TypeScript へ移行することにしました。この移行にあたって、実行方式には次の 2 つの選択肢がありました。

- (A) `tsc` で `dist/` にビルドし、`node dist/index.js` を実行する従来的な方式
- (B) `tsx` (esbuild ベースの Node.js 用 TypeScript 実行ランタイム) で `server/index.ts` を直接実行し、ビルドステップを持たない方式

Sumica は単一ローカルユーザー向けの開発ツールで、本番デプロイを想定していません。開発体験としては tsx の `watch` モードが変更検知＋再起動を担い、`nodemon` + `tsc --watch` の 2 プロセス構成より扱いが軽量です。

## Decision

私たちは (B) を採用します。`server/index.ts` を `tsx` で直接実行し、`dist/` ディレクトリを一切持ちません。

- `npm run dev:server` は `tsx watch server/index.ts` を実行します。
- 型チェックは独立したコマンド `npm run typecheck --prefix server` (`tsc --noEmit`) に限定し、ビルド成果物を生成しません。
- サーバーの依存 (`tsx`, `@types/*`) は `server/package.json` で管理し、クライアントの依存とは分離します。

(A) を却下した主な理由は次の通りです。第一に、ビルドステップの追加はローカル開発の起動フローを重くし、CI にも `tsc` ビルド確認を追加する必要が生じます。第二に、Sumica は単一開発者ローカル運用のためデプロイ最適化 (バンドルサイズ削減や事前コンパイル) の恩恵が小さいです。第三に、`tsx watch` はコード変更に対するリロード開発体験を単一プロセスで提供でき、開発ループが単純になります。

## Status

承認済み

## Consequences

- CLAUDE.md にも「server runs `.ts` directly via tsx — there is no build step and no `dist/`; `tsc` is type-checking only」と現行事実として明記され、後続のセッションでも常に前提となっています。
- 副作用として、`tsx` の起動オーバーヘッド (数百 ms 程度) が毎回のサーバー起動時に発生します。ローカル開発では体感差はほぼありませんが、将来 CI 経由でサーバーを起動して統合テストを走らせるような運用が生まれた場合、この起動時間が積み上がる可能性があります。
- 型チェックは `tsc --noEmit` に限定されるため、`tsc -b` (build) は使用しません。この非対称性は `client/` (Vite でバンドル + `tsc -b` で型チェック) と対比になっており、モノレポ全体で見ると混乱要因になり得ますが、CLAUDE.md での明記でカバーしています。
- サーバー側の単体テストは今のところ存在せず、動作検証は手動 (curl) と、クライアント経由の統合検証に依存しています。テスト追加時には `vitest` を `tsx` と同じ ESM で動かせるため、追加コスト自体は低い状態を維持しています。
