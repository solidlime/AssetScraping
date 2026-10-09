# Asset Scraping

Money Forward SSNB (ssnb.x.moneyforward.com) をスクレイピングし、資産ダッシュボード web アプリと MCP ツール（Docker 配布）を提供するプロジェクト。機能・取得頻度は hiroppy/mf-dashboard をベースにする。

## 技術構成
- TypeScript（Node 24, ESM）+ pnpm workspace
- crawler: Playwright（chromium）+ drizzle-orm + SQLite（WAL）+ supercronic（cron 6:30/15:30 JST）+ 手動更新 HTTP API（:8766）
- web: Next.js（standalone）+ Tailwind CSS 4 + recharts（:8765、SQLite read-only）
- mcp: @modelcontextprotocol/sdk、stdio / Streamable HTTP、read-only SQLite 照会（Docker イメージ、compose では `mcp` サービスとして `:26280` で常駐）

## 構成図
```
compose.yml
├─ crawler (Playwright+Chromium, cron, :8766 手動更新) — db: rw / auth: rw
├─ web     (Next.js standalone, :8765)               — db: ro
└─ mcp     (Streamable HTTP, :26280)                  — db: ro
```
- 名前付き volume `mfb-data`（external: true）に SQLite 本体 + auth-state.json（storageState）を格納。ホストに認証情報を出さない
- ssnb ログイン: `docker compose run --rm crawler npm run login` でコンテナ内対話ログイン CLI
- 取得頻度: 1日2回（cron）+ web UI からの手動更新

## セットアップ
- `pnpm install`
- `.env` に ssnb の認証情報（SSNB_LOGIN_ID / SSNB_PASSWORD）を設定
- `docker compose up -d crawler web mcp`

## mcp-hub / Claude Desktop 登録

MCP サーバーは `asset-scraping-mcp` イメージで提供する。compose を使う場合は `docker compose up -d mcp` で常駐（`docker build` 不要）。

stdio 接続（単発実行。まずイメージをビルド）:

```sh
docker build -f apps/mcp/Dockerfile -t asset-scraping-mcp .
```

Claude Desktop（claude_desktop_config.json）や mcp-hub の mcpServers 設定例:

```json
{
  "mcpServers": {
    "asset-scraping": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "mfb-data:/data:ro", "asset-scraping-mcp"]
    }
  }
}
```

HTTP 接続（compose の `mcp` サービスが常駐している場合。URL のホストは環境に合わせる）:

```json
{
  "mcpServers": {
    "asset-scraping": { "url": "http://nas.local:26280/mcp" }
  }
}
```

ツール: `get_accounts` / `get_transactions` / `get_holdings` / `get_asset_history` / `get_monthly_summary`（すべて read-only）
