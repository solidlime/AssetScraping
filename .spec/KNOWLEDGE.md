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

## 技術的な知見（F6: 配当・分配シミュレータ）
- **ssnb に `/bs` ルートは存在しない（HTTP 500）**。保有資産テーブルの実体は `/accounts/show/{id}`（`apps/crawler/src/scrape.ts`）。`/bs/history` は資産推移の取得に使える別物
- **保有資産テーブルの列構成は口座種別ごとに全く違う**（株式・投信・年金で別実装が必要）。株式系: 銘柄コード/銘柄名/保有数/平均取得単価/現在値/評価額/前日比/評価損益/評価損益率。年金系: 名称/取得価額/現在価値/評価損益/評価損益率
- `平均取得単価` は**外貨建ての1株単価**（例 AMD 19.65 = USD）。評価額は `保有数 × 現在値 × 為替` で円建て。したがって `保有数 × 平均取得単価` を円として足すと桁が壊れる（過去に「取得価額合計が評価額の142倍」を観測）
- **評価損益率は ssnb 自身が正しく算出している**（AMD 3186.82% は ssnb の表示値そのもの。外貨建て取得単価と現在値の関係で正当）。再計算せず ssnb の値を使うのが正解
- **東証の英数字コード**（`563A`/`408A`/`314A`）は `^\d{3}[A-Z]$` にマッチさせる必要がある。`^\d{4}$` だけでは 4桁数字のみ拾って取りこぼす。Yahoo シンボルは `<code>.T` / 通貨 JPY
- **ssnb は配当・分配の実績を保持していない**（`/cf` の収入行は `税引前利息` のみ）→ 外部（Yahoo chart API `events=div`）が唯一の実績源
- **Yahoo `events=div` の `date` は配当落ち日（ex-date）であり入金日ではない**。日本株の支払いは権利確定後1〜2ヶ月、米国株は約2週間後。UI では「配当落ち日ベース」と明示しないと予算管理で誤読される
- **カバードコール ETF（JEPQ / GXNDXカバコ 2865 / GXナスDカバコ 563A 等）は月次で分配額が変動する**。TTM を 12 で割るだけでは当月額を当てられない → 暦月ごとの季節性（過去の同月実績の平均）で当月・将来月を推定する
- **Yahoo 上の名称は ssnb の名称と一致しないことがある**（`2866.T` は Yahoo 上 "U.S. PREF" で ssnb の「GXナスDカバコ」と食い違う）→ 名称ベースの解決は失敗しうる。`銘柄コード` を取るのが本筋
- **NAS の crawler コンテナから Yahoo への egress は成立する**（プロキシ不要）。ただしコンテナ内に `curl`/`wget`/`python3` は無く **node のみ**
- **Portainer の `stack_update`（pull_image:true）は1回で pull のみで終わり、コンテナが再作成されないことがある**。ImageID を必ず突き合わせ、変わっていなければ2回目を実行する
- 検証の罠: `cmd | tail -3; echo $?` は **`tail` の終了コード**を拾う。終了コードを見たいときはパイプを使わない
- vitest は `--no-file-parallelism` を付けると安定する（過去に並列実行でフレーク）

## 技術的な知見（F7: クレカ引き落とし警告）
- **カード口座の判定は `scheduledWithdrawalAmount !== null` が唯一の防波堤**。`accounts.category` は再スクレイプまで `"other"`/未更新のことがあり、`category === "card"` 単独では機能しない。`packages/db/src/repositories/alerts.ts` の `isCardRow` は両方の OR を保つこと
- **不変条件（未証明）**: 「引き落とし予定額を持つ行＝カード」。ssnb が予定額列をカード詳細ページにしか出さないという実測前提に依存する。銀行のローン引落に同列が出ると、その銀行が判定口座から外れ `status: "none"` の誤案内または無意味な比較警告になる（倒れる方向は無警告側）
- **引き落とし日が全明細で過去日なら最新の過去日を採用**する設計（フェイルセーフ）。`remaining >= 0` で無警告に倒れる。代償として、次月以降の明細がカードページに出るまで警告が出ない
- `Account.category`（`packages/shared`）は `StoredAccountCategory = AccountCategory | "card"`。DB の `accounts.category` は text 列で enum 制約なし、`ACCOUNT_CATEGORIES` は DB スキーマ語彙なので `"card"` は含めない
- `todayJst()` は `@asset-scraping/db` の実装を一本化して使う（crawler にローカル実装を置かない。`Intl` 依存を crawler の本経路から消すため）
