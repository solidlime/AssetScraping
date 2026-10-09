# Asset Scraping

Money Forward SSNB (ssnb.x.moneyforward.com) を Playwright でスクレイピングし、資産ダッシュボード web アプリと stdio MCP ツール（Docker 配布）を提供するプロジェクト。機能・取得頻度は hiroppy/mf-dashboard をベースにする。

## 技術構成
- TypeScript
- Playwright（ヘッドレスブラウザスクレイピング）
- MCP SDK（stdio MCP ツール）
- Docker（MCP 配布・ログインはコンテナ内 CLI で完結）
