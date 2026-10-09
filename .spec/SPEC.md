# SPEC - 技術仕様・要件定義

## 機能要件
- [x] F1: ssnb.x.moneyforward.com へのログイン（`docker compose run --rm crawler npm run login` でコンテナ内対話ログイン CLI。storageState は名前付き volume `mfb-data` 内 auth-state.json に永続化し、ホストに認証情報を出さない）
- [x] F2: スクレイピング（Playwright。mf-dashboard 同等: 口座一覧・残高 / 保有資産（銘柄・数量・評価額・含み損益） / 資産推移（日次+カテゴリ別） / 取引履歴（月次, 通常直近2ヶ月 + history モード遡行） / 予算 / 月次サマリー）
- [x] F3: データ保存: SQLite（WAL, drizzle-orm）+ 名前付き volume `mfb-data`（external: true）。crawler のみ書き込み、web/MCP は read-only
- [x] F4: ダッシュボード web アプリ: Next.js standalone + Tailwind 4 + recharts（:8765）。サーバーコンポーネントから drizzle で直接読む。web UI に手動更新ボタン（crawler :8766 へ HTTP POST）
- [x] F5: stdio MCP ツール: @modelcontextprotocol/sdk、read-only、`docker run -i --rm -v mfb-data:/data:ro mfb-mcp` で Claude Desktop 等から起動

## 非機能要件
- パフォーマンス: cron 1日2回（6:30/15:30 JST, TZ=Asia/Tokyo）+ 手動更新。ページ取得間にスリープ（規約 13条(41)(43) 対策）
- セキュリティ: 認証情報は .env / compose env_file でコンテナへ注入。storageState も volume 内に封入。MCP は read-only ヒント付き
- 制約条件: better-sqlite3 のため Debian bookworm-slim ベース。crawler イメージに Playwright+Chromium、mcp イメージは Chromium 不要で軽量

## 技術構成
- 言語・フレームワーク: TypeScript (Node 24, ESM), pnpm workspace（apps/crawler, apps/web, apps/mcp, packages/db, packages/shared）, Turborepo は使わない
- インフラ・環境: Docker compose（crawler + web）、mcp は独立イメージ
- 外部サービス・API: Money Forward SSNB（スクレイピング。公式 API 個人向け無し）

## データ構造・インターフェース
- スキーマ（packages/db, drizzle）: accounts / account_statuses / holdings / holding_values / daily_snapshots / transactions / asset_history / spending_targets（mf-dashboard 踏襲、ssnb 実測後に調整）
- 手動更新 API: crawler :8766（POST /update）
- MCP ツール: 口座・残高 / 取引履歴 / 保有資産 / 月次収支 / カテゴリ集計 / 資産推移（read-only）

## 未実測リスク（最初のスパイクで確認）
- ssnb ログインフロー（CAPTCHA 有無、2FA 発火条件、MFID との関係）
- SSR 画面の HTML 構造とセレクタ
