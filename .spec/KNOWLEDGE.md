# KNOWLEDGE - ドメイン知識・調査結果

## 業務・ドメイン知識
- （調査後に追記）

## 調査・リサーチ結果
- ベースリポジトリ: https://github.com/hiroppy/mf-dashboard（調査中）
- 対象サイト: https://ssnb.x.moneyforward.com/（調査中）

## 技術的な知見
- （調査後に追記）

## 決定事項と理由
- MCP 配布形態: stdio MCP + Docker（要ログイン SPA のためヘッドレスブラウザ同梱が必要なため）
- ログイン: docker 側コンテナの CLI 内で完結（ホストに認証情報を出さないため）
