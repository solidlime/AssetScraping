# Asset Scraping

Money Forward SSNB (ssnb.x.moneyforward.com) をスクレイピングし、資産ダッシュボード web アプリと stdio MCP ツール（Docker 配布）を提供するプロジェクト。機能・取得頻度は hiroppy/mf-dashboard をベースにする。

## 技術構成
- TypeScript（Node 24, ESM）+ pnpm workspace
- crawler: Playwright（chromium）+ drizzle-orm + SQLite（WAL）+ supercronic（cron 6:30/15:30 JST）+ 手動更新 HTTP API（:8766）
- web: Next.js（standalone）+ Tailwind CSS 4 + recharts（:8765、SQLite read-only）
- mcp: @modelcontextprotocol/sdk、stdio、read-only SQLite 照会（独立 Docker イメージ、`docker run -i --rm -v mfb-data:/data:ro`）

## 構成図
```
compose.yml
├─ crawler (Playwright+Chromium, cron, :8766 手動更新) — db: rw / auth: rw
├─ web     (Next.js standalone, :8765)               — db: ro
└─ mcp（compose 外・独立イメージ）: docker run -i --rm -v mfb-data:/data:ro mfb-mcp
```
- 名前付き volume `mfb-data`（external: true）に SQLite 本体 + auth-state.json（storageState）を格納。ホストに認証情報を出さない
- ssnb ログイン: `docker compose run --rm crawler npm run login` でコンテナ内対話ログイン CLI
- 取得頻度: 1日2回（cron）+ web UI からの手動更新

## セットアップ
- `pnpm install`
- `.env` に ssnb の認証情報（SSNB_LOGIN_ID / SSNB_PASSWORD）を設定
- `docker compose up -d crawler web`

## MCP 接続（Claude Desktop 等の mcpServers 設定例）
```json
{
  "mcpServers": {
    "asset-scraping": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "mfb-data:/data:ro", "mfb-mcp"]
    }
  }
}
```
