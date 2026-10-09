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

## 優先度：中
- [ ] T010: README・ドキュメント整備

## 優先度：低
- （なし）

## 完了済み
- [x] 初期セットアップ（make-project: 記憶タグ project:asset-scraping 登録、ファイル生成）
- [x] git 初期化 + GitHub push（origin: https://github.com/solidlime/AssetScraping）
