# TODO - タスクリスト

## 優先度：高
- [x] T001: hiroppy/mf-dashboard の調査（技術スタック・取得データ・頻度・認証方式）
- [x] T002: ssnb.x.moneyforward.com の調査（サービス種別・API 有無・スクレイピング方式）
- [x] T003: アーキテクチャ決定（ルアン・メェイ承認済み — SPEC.md 参照）
- [ ] T004: モノレポ雛形（pnpm workspace, apps/{crawler,web,mcp}, packages/{db,shared}, compose.yml, Dockerfile 群）
- [ ] T005: packages/db 実装（drizzle スキーマ・リポジトリ）
- [ ] T006: crawler 実装（ログイン CLI / storageState 管理 / スクレイパー / cron / :8766 手動更新 API）
- [ ] T007: web 実装（Next.js standalone, ダッシュボード画面, 手動更新ボタン）
- [ ] T008: mcp 実装（stdio, read-only ツール群）
- [ ] T009: 検証（ビルド・型チェック・コンテナ起動確認）

## 優先度：高（F6: 配当・分配シミュレータ）
- [ ] T011: crawler — `銘柄コード` をパースし `holdings.code` に格納（`resolveHoldingsColumns` + `parseHoldings`、テスト追加）
- [ ] T012: db — テーブル追加 `dividend_events` / `dividend_symbols` / `fx_rates`（drizzle + マイグレーション + クエリ + テスト）
- [ ] T013: crawler — `dividends.ts`: Yahoo chart API から1株配当イベントと為替を取得し保存（直列・間隔・1日1回。テストは HTTP モック）
- [ ] T014: db — 推定ロジック（TTM・年間見込み・月別割付・去年/今年比較、未解決の除外）＋テスト
- [x] T015: web — `/dividends` ページ（今月の見込み／12ヶ月カレンダー／去年vs今年／銘柄別内訳／未解決一覧＋手動設定）
- [ ] T016: 検証 — typecheck・build・テスト・NAS 反映後の実データ確認とスクショ

## 優先度：中
- [ ] T010: README・ドキュメント整備

## 優先度：低
- （なし）

## 完了済み
- [x] 初期セットアップ（make-project: 記憶タグ project:asset-scraping 登録、ファイル生成）
- [x] git 初期化 + GitHub push（origin: https://github.com/solidlime/AssetScraping）
