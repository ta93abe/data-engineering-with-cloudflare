# Task Completion Checklist

タスク完了時に実行すべき項目のチェックリストです。

## Python コード変更時

- [ ] `ruff check .` - リントエラーがないこと
- [ ] `ruff check . --fix` - 自動修正可能な問題を修正
- [ ] `black .` - コードフォーマット
- [ ] `mypy src/` - 型エラーがないこと
- [ ] `pytest` - テストが通ること

## SQL/dbt 変更時

- [ ] `sqlfluff lint dbt/models/` - SQLリント
- [ ] `sqlfluff fix dbt/models/` - 自動修正
- [ ] `cd dbt && dbt run` - モデルが正常に実行されること
- [ ] `cd dbt && dbt test` - テストが通ること

## Cloudflare Workers 変更時 (TypeScript/JavaScript)

- [ ] `wrangler dev` - ローカルで動作確認
- [ ] `/health` エンドポイント確認
- [ ] エラーハンドリングの確認

## Rust MCP Server 変更時

- [ ] `worker-build --release` - ビルドが通ること
- [ ] `wrangler dev` - ローカルで動作確認
- [ ] MCP プロトコルの動作確認

## ドキュメント変更時

- [ ] Markdownのリンク切れ確認
- [ ] コード例の動作確認
- [ ] 日本語の誤字脱字チェック

## Git コミット前

- [ ] 上記の該当項目をすべて実行
- [ ] `git status` で変更ファイル確認
- [ ] 不要なファイルが含まれていないか確認
- [ ] `.env`, credentials, secrets が含まれていないか確認
- [ ] Conventional Commits形式でコミットメッセージ作成

## PR作成時

- [ ] PRタイトルは変更内容を簡潔に表現
- [ ] PR本文に変更概要を記載
- [ ] テストプランを記載
- [ ] 関連するIssueをリンク（あれば）

## デプロイ前 (本番)

- [ ] 開発環境でのテスト完了
- [ ] wrangler.toml の設定確認
- [ ] シークレット/環境変数の設定確認
- [ ] バケット名などリソース名の確認
