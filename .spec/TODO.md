# TODO - タスクリスト

## 優先度：高
- [x] T001: hiroppy/mf-dashboard の調査（技術スタック・取得データ・頻度・認証方式）
- [x] T002: ssnb.x.moneyforward.com の調査（サービス種別・API 有無・スクレイピング方式）
- [x] T003: アーキテクチャ決定（ルアン・メェイ承認済み — SPEC.md 参照）
- [x] T004: モノレポ雛形（pnpm workspace, apps/{crawler,web,mcp}, packages/{db,shared}, compose.yml, Dockerfile 群）
- [x] T005: packages/db 実装（drizzle スキーマ・リポジトリ）
- [x] T006: crawler 実装（ログイン CLI / storageState 管理 / スクレイパー / cron / :8766 手動更新 API。加えて OTP(2FA) 対応・/otp/status）
- [x] T007: web 実装（Next.js standalone, ダッシュボード画面, 手動更新ボタン。6ページ + /accounts/[mfId] 詳細 + /settings）
- [x] T008: mcp 実装（stdio に加え Streamable HTTP transport も実装し NAS に配布）
- [x] T009: 検証（ビルド・型チェック・コンテナ起動確認。NAS 実データ検証と独立監査まで完了）

## 優先度：高（F6: 配当・分配シミュレータ）
- [x] T011: crawler — `銘柄コード` をパースし `holdings.code` に格納（`resolveHoldingsColumns` + `parseHoldings`、テスト追加）　※`7ad25fc` + 東証英数字コード解決 `1f51f00`。NAS 再スクレイプで 66件中 code 充足を実測確認
- [x] T012: db — テーブル追加 `dividend_events` / `dividend_symbols` / `fx_rates` / `holding_dividend_settings`（drizzle + マイグレーション + クエリ + テスト）　※コミット `2567314`
- [x] T013: crawler — `dividends.ts`: Yahoo chart API から1株配当イベントと為替を取得し保存（直列・間隔・1日1回。テストは HTTP モック）　※`86d4f1e` + `1f51f00`。NAS から egress 成立を実測（Yahoo chart API 200・プロキシ不要）
- [x] T014: db — 推定ロジック（TTM・年間見込み・月別割付・去年/今年比較、未解決の除外）＋テスト　※`4840538`（季節性）+ `b046e33` + 当月季節性 `0f318a7`
- [x] T015: web — `/dividends` ページ（今月の見込み／12ヶ月カレンダー／去年vs今年／銘柄別内訳／未解決一覧＋手動設定）　※`9be147a` + `eaca06f`
- [x] T016: 検証 — typecheck・build・テスト・NAS 反映後の実データ確認とスクショ　※NAS 実データで判定6項目すべて合格（今月見込み 66,136円＝実績59,136+推定7,000／`563A`=26,400円・`408A`=6,600円・`314A`=0円 が「自動（Yahoo）」／四半期払いの KO/VYM/SPYD は当月不加算／react418=0）

## 優先度：高（F7: クレカ引き落とし警告）
- [x] T017: crawler — カード詳細ページから引き落とし予定額・引き落とし日を取得（`parseScheduledWithdrawal`、期日ごとグルーピングと合計突き合わせ）　※`guessCategory` に `card` を追加（bank → card → 以降据え置き）
- [x] T018: db — `accounts.scheduled_withdrawal_amount` / `scheduled_withdrawal_date` / `scheduled_withdrawal_confirmed` 列とアラート判定（`resolveWithdrawalAccount` で `set`/`single`/`ambiguous`/`none` を解決、カード行を判定口座から除外）　※`aa509ba` + `2d45e63`
- [x] T019: web — 口座カードに引き落とし予定を表示、`/settings` に判定口座と警告しきい値の入力
- [x] T020: mcp — `get_account_alerts` に `scheduled_withdrawal` kind を追加（後方互換、判定口座名は `withdrawalAccountName`）
- [x] T021: 検証 — typecheck / db 135 / crawler 111 / web 8 passed、ルアン・メェイのレビュー PASS

## 優先度：中
- [ ] T010: README・ドキュメント整備

## 優先度：低
- （なし）

## 完了済み
- [x] 初期セットアップ（make-project: 記憶タグ project:asset-scraping 登録、ファイル生成）
- [x] git 初期化 + GitHub push（origin: https://github.com/solidlime/AssetScraping）
