# ADR 32: 生成完了通知をブラウザ Notification API + localStorage オプトインで実装する

## Context

Stable Diffusion の画像生成は 1 枚あたり十数秒〜1 分弱かかることがあり、特に Hires.fix ([[adr-0005-hires-fix-support]]) やバッチ生成 ([[adr-0002-batch-generation-sequential-loop]]) の場合はさらに長くなります。生成中にユーザーが Sumica のタブから離れて他の作業をしていると、完了に気づけず、次の一手 (プロンプト微調整、確認、次の generate ボタン) の判断が遅れる、という体験上の課題がありました。

生成完了をユーザーに伝える手段としては次の選択肢がありました。

- **音**: 単純ですが、他アプリの音を聞いているユーザーには迷惑、ミュート運用のユーザーには届かない。
- **Web Push (server → client push subscription)**: 設定が重く、サーバー側の VAPID 鍵管理などが必要。Sumica はサーバー Firebase 非依存 ([[adr-0001-client-side-firebase-persistence]]) を保っており、Push 用のサーバー機能を追加するのはリーンさに反します。
- **ブラウザ Notification API**: サーバー不要、ブラウザネイティブ。ユーザーの許可があれば OS の通知センターに通知が出せる。バックグラウンドタブでも動作。
- **Toast だけで済ませる**: 既存の Toast 通知は Sumica のタブが前面にないと見えない。バックグラウンドタブでの体験改善にはならない。

Notification API はブラウザネイティブで最も適していますが、ユーザーの通知許可 (permission) の扱いに 3 段階の状態 (`default` / `granted` / `denied`) があり、それぞれで挙動を決める必要があります。加えて、通知を「そもそも欲しくない」ユーザーの意思を尊重する opt-in の仕組みが必要です。

## Decision

**`client/src/utils/notifications.ts` の薄いモジュールとして、Notification API 呼び出しを純関数群 (`getNotificationSupport` / `requestNotificationPermission` / `loadNotificationPreference` / `saveNotificationPreference` / `sendNotification`) に切り出し、ユーザー設定は `sumica:notifications-enabled` の localStorage キーで永続化します。Notification API 非対応環境や許可未取得時は静かに no-op します。** 具体的な設計は次の通りです。

- **UI**: `AppHeader` 右端に `Bell` / `BellOff` トグルを常設します。トグル ON にすると notification enabled、OFF にすると disabled。
- **オプトインフロー**: トグル ON にした時点で `Notification.permission` を確認し、`default` なら `requestNotificationPermission()` を呼んでブラウザの許可ダイアログを出します。`granted` になれば以降通知を発火、`denied` になれば「ブラウザ設定で許可してください」の Toast を表示してユーザーに次のアクションを案内。
- **状態の永続化**: `saveNotificationPreference(true|false)` で `localStorage['sumica:notifications-enabled']` に書き込みます。次回起動時に `loadNotificationPreference()` で読み込んで初期 state に反映。
- **段階的デグレード**: `getNotificationSupport()` で `'Notification' in window` を確認し、非対応環境ではトグル自体を非表示にします。`permission === 'granted'` 未取得の場合、`sendNotification()` は静かに何もしません。エラー Toast は出しません（過剰な通知になるため）。
- **呼び出しポイント**: 単一画像生成完了 (`handleGenerate`) / バッチ全完了 (`handleBatchGenerate`) / 生成失敗の 3 種類で `notify()` 経由で発火。バッチ中の 1 枚ごとには発火しない（連続通知の氾濫防止）。
- **通知メッセージ**: `t.notification.generateSuccess` などの i18n key を用意し、[[adr-0020-i18n-jp-en-support]] の翻訳スキームに乗せます。日本語ユーザーには「画像を生成しました 🎨」、英語には "Image generated 🎨"。
- **Fire-and-forget**: `notify()` の呼び出しは await せず、生成完了フロー本体をブロックしません。通知が飛ばなくても生成結果自体は反映されるようにします。

代替案として次を比較検討し、いずれも却下しました。

- **音による通知**: 前述の通り、環境依存が大きすぎます。ユーザーが好みで自作したい場合は、ブラウザ拡張やタブ音声の枠を利用できます。
- **Web Push**: サーバー側 Push インフラを持ち込むリーンでない選択です。Sumica のサーバーは意図的に薄く保っています ([[adr-0001-client-side-firebase-persistence]] / [[adr-0031-env-only-config-no-runtime-mutation]])。
- **Toast だけ**: バックグラウンドタブで体験しづらい問題が解決しません。
- **Notification API を常時 ON (opt-in なし)**: 通知を欲しくないユーザーに強制することになり、UX として押し付けがましいです。localStorage 保存の opt-in が最も丁寧です。
- **Server-Sent Events で状態変化を push**: サーバーインフラが重くなり、上記 Web Push と同種の問題です。生成完了は同一ブラウザ内 event なので、Notification API で十分。

## Status

承認済み

## Consequences

- **バックグラウンドタブでも生成完了に気づける**ようになりました。ユーザーが別タブで作業していても、OS 通知センターに通知が飛ぶため、Sumica のタブに戻るタイミングを判断できます。
- **サーバーインフラを何一つ足していません**。Notification API はブラウザ完結で、[[adr-0001-client-side-firebase-persistence]] のサーバー Firebase 非依存原則と [[adr-0031-env-only-config-no-runtime-mutation]] の設定リーン原則に完全に沿っています。
- **`client/src/utils/notifications.ts` は純関数群**として切り出され、UI コンポーネントに依存しません。将来通知トリガーを増やす場合（例：エラー時の詳細通知、バッチ半分完了時など）も、同じ `notify()` 関数を呼び出すだけで済みます。
- **`denied` 状態からの復帰**は Sumica だけでは解決できません。ユーザーがブラウザの site settings で許可を revoke している場合、Sumica 側からは再要求できず、ユーザー自身がブラウザ設定を開いて許可し直す必要があります。Toast でこの旨を伝える設計にしていますが、UX 上の摩擦は残ります。
- **[[adr-0020-i18n-jp-en-support]] との統合**により、通知メッセージも日英切り替えの範疇に入りました。将来他の言語を追加するときは、既存パターンに合わせて `notification.generateSuccess` などのキーを追加するだけです。
- **通知権限を持たない環境 (プライバシー志向のブラウザ・iOS Safari の一部設定など)** ではトグル自体が非表示になり、機能が優雅に degrade します。Sumica の core 機能は影響を受けません。
- **`sumica:` の localStorage 名前空間プレフィックス**を初めて導入した ADR です。将来 localStorage キーを追加する場合、同じプレフィックス（`sumica:...`）で衝突を回避する運用が推奨されます。
