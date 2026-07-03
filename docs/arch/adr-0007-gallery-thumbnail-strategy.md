# ADR 7: ギャラリー表示高速化のためサムネイル戦略を採用する

## Context

ギャラリーのグリッド表示で、130px程度のタイルに対して512〜1024pxのフルサイズPNG（500KB〜2MB）をそのまま読み込んでおり、帯域とロード時間の無駄が大きいという問題がありました。対策として次の3案をインパクト順に比較しました。

1. サムネイル画像の生成（帯域を10〜50倍程度削減できる本命）
2. `decoding="async"`や`fetchpriority="low"`といった軽量なHTML属性の追加（既存の`loading="lazy"`に加える）
3. 仮想スクロールの導入

## Decision

まず最も安価な案2のHTML属性追加をその場で適用し、案3の仮想スクロールは不要な依存関係の増加とみなして見送りました。

本命である案1のサムネイル生成は、認証状態ごとに実装を分けることで既存のインフラ構成を変えずに済む形にしました。

- サインイン時（クラウド）：クライアントのCanvas APIで256px WebP（品質80）を生成し、Firebase Storageの`users/{uid}/thumbs/<id>.webp`にアップロードし、Firestoreのドキュメントに`thumbnailUrl`を保存します。
- サインアウト時（ローカル）：サーバー側で`sharp`を使い`server/outputs/<id>_thumb.webp`を生成します。

ギャラリー表示は`thumbnailUrl ?? imageUrl`を使い、サムネイルを持たない既存レコードはフルサイズ画像に自然にフォールバックします。ライトボックスは常にフルサイズの`imageUrl`を使います。

既存83件の画像に対しては「何もしない」「一括バックフィル」「遅延バックフィル」の3案を検討しましたが、いずれも採用せず、専用のバックフィルスクリプトを都度実行する方式を選びました。ローカル分は`sharp`を使う`server/scripts/backfill-thumbnails.ts`、クラウド分は`firebase-admin`とダウンロードした`server/firebase-key.json`を使い`collectionGroup('generations')`を辿る`server/scripts/backfill-firebase-thumbnails.ts`として、ランタイムサーバーがFirebase非依存であるという既存の境界線（[[adr-0001-client-side-firebase-persistence]]）を壊さないよう、別スクリプトに分離しました。

## Status

承認済み

## Consequences

- ギャラリーの表示速度が大きく改善しましたが、サムネイル生成・アップロードという新たな非同期処理が生成フローに加わりました。
- サムネイルの有無に関わらず表示が壊れないフォールバック設計により、後方互換性が保たれています。
- バックフィルスクリプトは`firebase-admin`を使うためdevDependencyとしてのみ存在し、ランタイムには一切ロードされません。これによりサーバーのFirebase非依存という原則を保ったまま、過去データの移行が可能になっています。
- バックフィルは冪等（既に`thumbnailUrl`を持つレコードはスキップ）で`THUMB_DRY_RUN=1`にも対応しており、安全に再実行できます。
