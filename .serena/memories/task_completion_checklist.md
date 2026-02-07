# Task Completion Checklist (2026-02更新)

## ingestion Worker (TypeScript) 変更時

- [ ] `cd ingestion && pnpm check` - Biome lint + format チェック
- [ ] `pnpm check:fix` - 自動修正
- [ ] `pnpm typecheck` - TypeScript型チェック
- [ ] `pnpm test:run` - Vitestテスト実行
- [ ] `pnpm dev` - ローカルで動作確認

## transform/core (dbt) 変更時

- [ ] `cd transform/core && uv run sqruff lint models/` - SQLリント
- [ ] `uv run sqruff fix models/` - 自動修正
- [ ] `uv run dbt run` - モデルが正常に実行されること
- [ ] `uv run dbt test` - テストが通ること

## infrastructure 変更時

### Pulumi
- [ ] `cd infrastructure/pulumi && pulumi preview` - 変更プレビュー
- [ ] 意図しないリソース変更がないか確認

### D1マイグレーション
- [ ] `wrangler d1 migrations apply raw --local --config infrastructure/d1/wrangler.toml` - ローカル確認

## ドキュメント変更時

- [ ] Markdownのリンク切れ確認
- [ ] 日本語の誤字脱字チェック

## Git コミット前

- [ ] 上記の該当チェック項目をすべて実行
- [ ] `git status` で変更ファイル確認
- [ ] `.env`, credentials, secrets が含まれていないか確認
- [ ] Conventional Commits形式でコミットメッセージ作成

## PR作成時

- [ ] PRタイトルは変更内容を簡潔に表現
- [ ] PR本文に変更概要を記載
- [ ] テストプランを記載
- [ ] 関連するLinear Issueをリンク（あれば）
- [ ] Graphiteで `gt submit --no-interactive`

## CI確認

| CI | 確認内容 |
|---|---|
| Pulumi Preview | インフラ変更プレビュー |
| claude-code-review | AIコードレビュー |
| biome-check | Biome lint/format |
| GitGuardian | シークレット漏洩検知 |
