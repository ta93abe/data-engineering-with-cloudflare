# Session Context

## User Prompts

### Prompt 1

Implement the following plan:

# Snowflake Git Integration を Pulumi で管理する

## Context

`snowflake/*.sql` を Snowflake から直接参照・実行できるようにしたい。Snowflake の Git Integration 機能を使い、GitHub リポジトリを Snowflake 内のリポジトリステージとして登録する。リポジトリは public なので認証（Secret）は不要。

Pulumi Snowflake Provider v2.12.0 の制約:
- `snowflake.GitRepository` → ネイティブリソース...

### Prompt 2

pulumi ってファイルは何？

### Prompt 3

そうして。

### Prompt 4

https://registry.terraform.io/providers/snowflakedb/snowflake/latest/docs/resources/api_integration

### Prompt 5

-- GitHubのアクセストークンを格納
CREATE OR REPLACE SECRET my_github_token
    TYPE = PASSWORD
    USERNAME = 'my_github_username'
    PASSWORD = 'ghp_xxxxxxxxxxxxxxxxx'; -- ここにPATを入れる

### Prompt 6

コミットして PR 作って

