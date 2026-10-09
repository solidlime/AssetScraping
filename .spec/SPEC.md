# SPEC - 技術仕様・要件定義

## 機能要件
- [ ] F1: ssnb.x.moneyforward.com へのログイン（コンテナ内 Playwright CLI で完結、認証情報は環境変数/マウント渡し）
- [ ] F2: スクレイピング（mf-dashboard 同等のデータ範囲: 口座残高・取引履歴等。詳細は調査後に確定）
- [ ] F3: データ保存（DB・スキーマは mf-dashboard を踏襲。詳細は調査後に確定）
- [ ] F4: ダッシュボード web アプリ（mf-dashboard 同等の画面構成）
- [ ] F5: stdio MCP ツール（Docker イメージで配布。docker run で起動し MCP クライアントから接続）

## 非機能要件
- パフォーマンス: スクレイピング頻度は mf-dashboard ベースで決定
- セキュリティ: 認証情報はコンテナ内でのみ使用。ホスト側に平文で残さない
- 制約条件: ヘッドレスブラウザ必須（要ログイン SPA の見込み）。Docker イメージに Chromium 同梱

## 技術構成
- 言語・フレームワーク: TypeScript（詳細は調査後に確定）
- インフラ・環境: Docker（MCP 配布）
- 外部サービス・API: Money Forward SSNB（スクレイピング。公式 API の有無は調査中）

## データ構造・インターフェース
- 主要なデータ定義: 調査後に確定
