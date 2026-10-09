# KNOWLEDGE - ドメイン知識・調査結果

## 業務・ドメイン知識
- ssnb.x.moneyforward.com = 「マネーフォワード for ドコモＳＭＴＢネット銀行」（feeder 型 MF ME カスタマイズ版、運営: Money Forward X, Inc.）。マネーフォワード ME とは別サービスでアカウント分離・データ移行不可
- ログイン: Rails 製 /users/sign_in。二段階認証は設定可能・**メール確認型**（異常アクセス時のみ確認メール送信）。OTP/TOTP 自動化は不可
- 公式 API: 個人向けには無し（developers.biz.moneyforward.com はクラウド事業者向け）。→ スクレイピング一択
- ページ種別: **SSR（Rails）**。原理上ヘッドレスブラウザ不要、認証済み Cookie での HTTP GET + HTML パースの可能性が高い（要実測）
- MF ME 利用規約 13条(41)(43): 過剰リロード・非正規操作方法の禁止 → 低頻度アクセス（1日2回程度）が事実上必須
- MF 本体のデータ保存は直近24ヶ月のみ → 長期履歴は自前 DB で永続化する設計が必須

## 調査・リサーチ結果
### hiroppy/mf-dashboard（実コード確認済み）
- 構成: pnpm+Turborepo monorepo / TS ESM / Node 24 / crawler(Playwright chromium + drizzle-orm + SQLite WAL) / web(Next.js 16 + React 19 + Tailwind 4 + recharts, :8765) / mcp(@modelcontextprotocol/sdk, stdio, read-only SQLite 照会, readOnlyHint) / crawler が :8766 で手動更新 HTTP API 兼務
- cron: supercronic で 6:30 / 15:30 JST（docker/crawler/crontab）
- 認証: Playwright で MFID ログイン → storageState(Cookie) を auth-state.json に保存・再利用、失効時のみフルログイン。OTP は 1Password SDK で自動入力
- 取得データ: 口座一覧・残高/保有資産(銘柄・数量・評価額・平均単価・含み損益)/資産推移(日次+カテゴリ別)/取引履歴(月次, 通常直近2ヶ月, SCRAPE_MODE=history で遡行)/予算/月次サマリー/予定引落
- スキーマ: accounts / account_statuses / holdings / holding_values / daily_snapshots / transactions / cash_flow_periods / asset_history / spending_targets / groups / group_accounts / institution_categories 等
- MCP: サーバー名 moneyforward-dashboard, read-only で口座・残高/取引/保有/月次収支/カテゴリ集計/資産推移/財務メトリクス/支出比較/ポートフォリオリスク/貯蓄推移等を公開

## 技術的な知見
- （決定後に追記）

## 技術的な知見（ルアン・メェイ承認済み決定）
- pnpm workspace 採用・Turborepo 不使用: 依存ツリー分離が Docker イメージサイズに直結。Turborepo はビルド遅くなってから足す
- DB 共有: 外部名前付き volume mfb-data に SQLite 1 ファイル。crawler のみ書き込み、web/MCP は read-only（?mode=ro）。volume を external: true 固定名にするのは、stdio MCP が compose 外から docker run で起動されるため
- スクレイパーは Playwright 採用（SSR でも fetch+cheerio は未実測の賭け。mf-dashboard のログイン実装が移植可能資産）。fetchPage 抽象化で出口だけ残す
- MCP を read-only に保ち、更新トリガーは web UI に一元化（単発 docker run を crawler ネットワークに参加させるのは脆い）
- 2FA 失効時は「明示エラーで停止」。IMAP 自動読み取りは失効頻度を測定するまで実装しない
- web は Next.js standalone 維持（mf-dashboard 移植性最優先）。外すもの: Cloudflare Access / cloudflared / Storybook / E2E / AI チャット（フェーズ1の機能ではない）
- better-sqlite3 のため Debian bookworm-slim ベース（Alpine の native ビルド問題回避）

## 決定事項と理由
- MCP 配布形態: stdio MCP + Docker（ユーザー確定事項）
- ログイン: docker 側コンテナの CLI 内で完結（ユーザー確定事項。ホストに認証情報を出さない）
- 取得頻度: mf-dashboard 同等の 1日2回（6:30/15:30）+ web からの手動更新 API
- ⚠️未確認: ssnb 独自規約のスクレイピング条項 / feeder 版での MFID 可否 / 取得件数上限の明示値
