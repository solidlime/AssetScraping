# PLAN - やりたいこと

- hiroppy/mf-dashboard をベースに、対象を https://ssnb.x.moneyforward.com/ に変えた web アプリ + MCP ツールを作る
- MCP ツールは Docker で配布する（stdio MCP + Docker コンテナ）
- ssnb へのログインは docker 側コンテナの CLI 内で完結すること（ホストに認証情報を出さない）
- 取得データの範囲・頻度は mf-dashboard と同等を満たすように決める
