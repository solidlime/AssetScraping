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
  - **実測結果（2026-10-24）**: ssnb の `/accounts/show/{id}`（口座詳細）に「引き落とし予定額」列が存在する。三井住友カードは `-44,200円 (2026/10/26)` の形式で**金額と期日が連結**、`引き落とし予定額合計：-75,267円` の合計行もある。PayPayカードは `引き落とし予定額：未定` で全セル `−`。`/accounts`（一覧）には予定の列は無い
  - 判定: 引き落とし予定額 > 判定口座の残高、かつ引き落とし日まで **0〜N日**（`app_settings` の `withdrawal_alert_days`、既定7・範囲1〜30にクランプ）
  - 金額は**期日ごとにグルーピングし、今日以降で最も早い期日の明細だけ**を合算する（期日が割れた明細を合算すると「その日には落ちない金額」になるため）。合計行は明細に数えない
  - ページに「引き落とし予定額合計」がある場合は明細合算と突き合わせ、**不一致なら null（無警告）**。`shortcut: 合計の文言が変わると検算されない, 文言変更を検知したら必須化`
  - 警告 kind: `AccountAlertKind` に `"scheduled_withdrawal"` を追加（既存 `"low_balance"` / `"account_status"` と同居。**既存2種の判定結果は不変**）
  - 判定口座の解決順: ① `withdrawal_account_id` の明示設定（**カード行・存在しない ID は無視**）→ ② 銀行系口座がちょうど1つならそれ（note で自動判定を明示）→ ③ 0個 or 2個以上は**警告せず**「引き落とし口座が未設定です」を UI に出す
  - カード行の判定は `scheduledWithdrawalAmount !== null || category === "card"`（`guessCategory` に `"card"` 語彙を追加済み。`ACCOUNT_CATEGORIES` には追加しない）
  - `AccountAlert.balance` は**判定に使った口座の残高**、`shortage = 予定額 - その残高`。カード自身の負残高は返さない（MCP 利用者の誤読防止）
  - 表示先は **web と MCP の両方**: web は `apps/web/src/app/accounts/page.tsx` の警告バッジ（**口座数**で数え、同一口座の二重計上をしない）＋引き落とし警告カード、MCP は `get_account_alerts` に `withdrawal_alert_days` / `withdrawal_account_id` 引数を追加（新ツールは作らない）
  - 予定額が取れないカード（PayPayカード等）は警告せず、口座カードに**「引落予定：未定」**を表示（**嘘の金額を出さない**）
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
- 他社カード（三井住友カード以外）の口座詳細ページの表構造。`parseScheduledWithdrawal` は `th` に「引き落とし予定額」を含む表を探す実装で、構造が違えば null＝無警告側に倒れる（誤警告はしない）
- 「引き落とし予定額合計」の文言・出現回数。変わると検算が黙って無効化される（フェイルオープン、`shortcut:` コメントで明示）
- 本番 DB で `assignAccountCategories`（`apps/crawler/src/scrape.ts:160`）が次回スクレイプ後に実際に `category_id` を埋めるか。それまで `accounts.category` フォールバックで動く
- `todayJst()` が `packages/db/src/repo.ts:36`（9h オフセット）と `apps/crawler/src/parse.ts:201`（`Intl` + `en-CA`）で二重実装。small-icu ビルドの Node では `en-CA` が使えない可能性（crawler イメージは full-icu 想定だが未検証）
