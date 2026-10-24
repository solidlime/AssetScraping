# SPEC - 技術仕様・要件定義

## 機能要件
- [x] F1: ssnb.x.moneyforward.com へのログイン（`docker compose run --rm crawler npm run login` でコンテナ内対話ログイン CLI。storageState は名前付き volume `mfb-data` 内 auth-state.json に永続化し、ホストに認証情報を出さない）
- [x] F2: スクレイピング（Playwright。mf-dashboard 同等: 口座一覧・残高 / 保有資産（銘柄・数量・評価額・含み損益） / 資産推移（日次+カテゴリ別） / 取引履歴（月次, 通常直近2ヶ月 + history モード遡行） / 予算 / 月次サマリー）
- [x] F3: データ保存: SQLite（WAL, drizzle-orm）+ 名前付き volume `mfb-data`（external: true）。crawler のみ書き込み、web/MCP は read-only
- [x] F4: ダッシュボード web アプリ: Next.js standalone + Tailwind 4 + recharts（:8765）。サーバーコンポーネントから drizzle で直接読む。web UI に手動更新ボタン（crawler :8766 へ HTTP POST）
- [x] F5: stdio MCP ツール: @modelcontextprotocol/sdk、read-only、`docker run -i --rm -v mfb-data:/data:ro mfb-mcp` で Claude Desktop 等から起動

## 機能要件（追加: 配当・分配シミュレータ）
- [ ] F6: `/dividends` 配当・分配シミュレータ。「今月いくら入る見込みか」「去年はいくらだったか」「今年はいくらになる見込みか」を提示し、予算計画に使えるようにする。**推定値**であることを明示し、実績ではない
  - データ源は **MCP hub に依存しない自前 HTTP**。Yahoo Finance chart API（`query1.finance.yahoo.com/v8/finance/chart/{symbol}?events=div&range=3y&interval=1d`）で1株配当イベント（ex-date・金額）、`JPY=X` で為替を取得。API キー不要
  - 実測済み: KO 8件(USD) / 9432.T 6件(JPY) / 8306.T 4件(JPY) / 4755.T 0件（楽天は無配＝正しい値）／為替 158.183／**NAS コンテナからの egress は HTTP 200 で確認済**
  - ssnb に配当・分配の実績は無い前提（調査済: ナビ7本に配当画面なし、保有テーブルに配当列なし、証券口座の取引は未収集）。**実績ではなく推定のみ**
  - 銘柄の特定: 株式は ssnb の `銘柄コード` 列 → `holdings.code`（4桁数字→`{code}.T`、英字→米国ティッカーそのまま）。投信・年金はコードが無いため `dividend_symbols` で手動解決し、**未解決銘柄は合計に算入せず「—」＋一覧で明示**（嘘の数字を出さない）
  - 推定式: 株式 = 数量 × 直近12ヶ月の1株配当合計 × 為替。投信 = 1万口あたり分配金 ÷ 10000 × 口数（データ源が無いため手動設定・既定0）。年金 = 0（既定、手動上書き可）
  - 月別割付は過去イベントの ex-date の月から支払月を推定。過去年は「現在の保有数」で近似する（**保有数の履歴が無い**ため。UI に明示）

## 機能要件（追加: F7 クレカ引き落とし警告）
- [ ] F7: クレカ（クレジットカード）の引き落としで口座残高が不足する事故を、事前に警告する
  - 判定: クレカ口座の**引き落とし予定額 > 引き落とし口座の残高** かつ 引き落とし日まで **N日以内**（`app_settings` の設定キー、既定 N=7日）
  - 警告 kind: `AccountAlertKind` に `"scheduled_withdrawal"` を追加（既存 `"low_balance"` / `"account_status"` と同居）
  - 表示先は **web と MCP の両方**: web は `apps/web/src/app/accounts/page.tsx` の警告バッジ＋アラート一覧、MCP は `get_account_alerts` がそのまま新 kind を返す
  - データ源: **ssnb の実測で確定**。クレカ口座のページに引き落とし予定額／引き落とし日が存在すればそれを使う（既存の死に列 `account_statuses.scheduled_withdrawal_amount` / `scheduled_withdrawal_confirmed` を生産者ごと埋める）
  - 実測で取れない場合のフォールバック順: ① 取引履歴の `カード引落` 実績から直近の引き落とし額を推定 ② それも無ければ警告を出さず「データ無し」を明示（**嘘の金額を出さない**）
  - 引き落とし口座の紐付け: ssnb が提示するなら使い、無ければ銀行口座のうち残高で判定可能なものへ既定設定で紐付ける（`app_settings`）
  - 誤警告より無警告を選ぶ: 金額・期日のどちらかが欠けたら警告しない

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

## 未実測リスク（F7）
- ssnb の `/accounts` または `/accounts/show/{id}` にクレカの**引き落とし予定額・引き落とし日**の列が存在するか（無ければ取引履歴推定にフォールバック）
- クレカ口座が `institution_categories.name="カード"` で正しく分類されているか（`guessInstitutionCategory` は金融機関名の文字列マッチのみ）
