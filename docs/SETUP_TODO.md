# セットアップ TODO リスト

このドキュメントでは、Terraform で自動化できない手動設定手順を説明します。

## 📋 前提条件チェックリスト

以下が揃っていることを確認してください:

- [ ] Cloudflare アカウント（無料プランでOK）
- [ ] GitHub アカウント
- [ ] Terraform がインストール済み (`terraform --version`)
- [ ] Wrangler CLI がインストール済み (`wrangler --version`)
- [ ] Git がインストール済み

## 🔐 1. Cloudflare API トークン取得

### 手順:

1. **Cloudflare ダッシュボードにログイン**
   - https://dash.cloudflare.com/

2. **API トークン作成**
   - 右上のプロフィールアイコン → **My Profile**
   - 左メニュー → **API Tokens**
   - **Create Token** をクリック

3. **カスタムトークン作成**
   - **Custom token** の **Get started** をクリック
   - Token name: `terraform-github-workers`
   - Permissions:
     - Account | Workers Scripts | Edit
     - Account | Workers KV Storage | Edit
     - Account | Workers R2 Storage | Edit
     - Account | Account Settings | Read
   - **Continue to summary** → **Create Token**

4. **トークンをコピーして保存**
   ```bash
   export CLOUDFLARE_API_TOKEN="your-api-token-here"
   ```

5. **環境変数を永続化** (オプション)
   ```bash
   # ~/.bashrc or ~/.zshrc に追加
   echo 'export CLOUDFLARE_API_TOKEN="your-api-token-here"' >> ~/.bashrc
   source ~/.bashrc
   ```

## 📊 2. Cloudflare Account ID 取得

### 手順:

1. **Cloudflare ダッシュボード** → **Workers & Pages**
2. 右サイドバーの **Account ID** をコピー
3. `terraform/terraform.tfvars` に記載:
   ```hcl
   cloudflare_account_id = "your-account-id-here"
   ```

## 🔑 3. GitHub Personal Access Token 作成

### 手順:

1. **GitHub Settings にアクセス**
   - https://github.com/settings/tokens

2. **新しいトークン作成**
   - **Generate new token** → **Generate new token (classic)**
   - Note: `Cloudflare Workers - GitHub Data Fetch`
   - Expiration: `No expiration` または `90 days`（定期更新推奨）

3. **スコープ選択**:
   - ✅ `repo` (Full control of private repositories)
   - ✅ `read:org` (Read org and team membership, read org projects)
   - ✅ `read:user` (Read ALL user profile data)
   - ✅ `user:email` (Access user email addresses)

4. **Generate token** をクリック

5. **トークンをコピーして一時保存**
   ```
   ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   ⚠️ このトークンは一度しか表示されないので、必ずコピーしてください。

## 🚀 4. Terraform セットアップ

### 手順:

```bash
# 1. プロジェクトルートに移動
cd /path/to/data-engineering-with-cloudflare

# 2. 初期セットアップ
make setup

# 3. terraform.tfvars を編集
nano terraform/terraform.tfvars

# 最低限必要な設定:
cloudflare_account_id = "your-account-id-here"
environment = "production"
r2_location = "APAC"

# 4. Terraform 初期化
make init

# 5. プラン確認
make plan

# 6. リソース作成
make apply
# "yes" と入力して実行
```

### Terraform 実行後の出力例:

```
Outputs:

kv_namespace_id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
kv_namespace_production_id = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
queue_name = "github-fetch-queue"
r2_bucket_name = "data-lake-raw"
scheduler_worker_name = "github-scheduler"
fetcher_worker_name = "github-fetcher"

manual_steps_required = <<EOT
The following manual steps are required:
...
EOT
```

**これらの ID をメモしてください！次のステップで使用します。**

## ⚙️ 5. wrangler.toml の更新

Terraform で作成されたリソース ID を wrangler.toml に反映します。

### Scheduler Worker の更新:

```bash
cd workers/github-scheduler
nano wrangler.toml
```

以下の箇所を Terraform の出力で更新:

```toml
[[kv_namespaces]]
binding = "METADATA_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # ← terraform output kv_namespace_id

[[env.production.kv_namespaces]]
binding = "METADATA_KV"
id = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"  # ← terraform output kv_namespace_production_id
```

### Fetcher Worker の更新:

```bash
cd workers/github-fetcher
nano wrangler.toml
```

R2 バケット名を確認（通常は既に正しいはず）:

```toml
[[r2_buckets]]
binding = "RAW_BUCKET"
bucket_name = "data-lake-raw"  # ← terraform output r2_bucket_name
```

## 🔐 6. Secrets の設定

GitHub トークンを各 Worker に設定します。

### Scheduler Worker:

```bash
cd workers/github-scheduler

# GITHUB_TOKEN を設定
echo "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" | wrangler secret put GITHUB_TOKEN

# 確認
wrangler secret list
```

### Fetcher Worker:

```bash
cd workers/github-fetcher

# GITHUB_TOKEN を設定
echo "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" | wrangler secret put GITHUB_TOKEN

# 確認
wrangler secret list
```

### ⚠️ セキュリティ注意:

- シークレットは暗号化されて保存されます
- コマンド履歴に残らないよう `echo "token" | wrangler secret put` を使用
- トークンは `.env` ファイルや Git にコミットしないでください

## 🧪 7. テスト実行（オプションだが推奨）

デプロイ前にテストを実行して動作確認:

```bash
# 依存関係インストール
make install

# テスト実行
make test

# カバレッジ確認
make test-coverage
```

期待される結果:
```
✓ workers/github-scheduler/test/index.test.ts (22 tests)
✓ workers/github-fetcher/test/index.test.ts (26 tests)

Test Files  2 passed (2)
     Tests  48 passed (48)
```

## 📦 8. Workers デプロイ

**重要**: 以下の手順は本番デプロイをスキップする場合は実行不要です。

### デプロイコマンド:

```bash
# 一括デプロイ（推奨）
make deploy
```

または個別デプロイ:

```bash
# Scheduler Worker
cd workers/github-scheduler
wrangler deploy

# Fetcher Worker
cd workers/github-fetcher
wrangler deploy
```

### デプロイ成功の確認:

```
✨ Total Upload: 25.67 KiB / gzip: 6.89 KiB
✨ Uploaded github-scheduler (2.34 sec)
✨ Published github-scheduler (0.25 sec)
   https://github-scheduler.your-subdomain.workers.dev

✨ Success! Your worker is live at:
   https://github-scheduler.your-subdomain.workers.dev
```

## 📊 9. 動作確認

### Scheduler Worker の手動実行:

```bash
# Worker URL を確認
cd workers/github-scheduler
wrangler deployments list

# 手動トリガー
curl -X POST "https://github-scheduler.your-subdomain.workers.dev/trigger"
```

期待されるレスポンス:
```
Scheduler triggered successfully
```

### 実行ステータスの確認:

```bash
# ログを確認
cd workers/github-scheduler
wrangler tail

# 別ターミナルでトリガー
curl -X POST "https://github-scheduler.your-subdomain.workers.dev/trigger"
```

### R2 バケットのデータ確認:

```bash
# バケット内容を確認
wrangler r2 object list data-lake-raw --prefix sources/github/

# 特定のファイルをダウンロード
wrangler r2 object get data-lake-raw/sources/github/repositories/year=2025/month=01/day=03/xxx.json --file output.json

# 内容を確認
cat output.json | jq
```

## ✅ 10. セットアップ完了チェックリスト

すべて完了したか確認してください:

### インフラ:
- [ ] Cloudflare API トークン取得
- [ ] terraform.tfvars 作成・編集
- [ ] `make apply` 実行成功
- [ ] Terraform outputs を確認

### Workers 設定:
- [ ] wrangler.toml の KV Namespace ID 更新
- [ ] GitHub Personal Access Token 作成
- [ ] Scheduler Worker の GITHUB_TOKEN 設定
- [ ] Fetcher Worker の GITHUB_TOKEN 設定

### テスト:
- [ ] `make test` が全てパス
- [ ] テストカバレッジ 80% 以上

### デプロイ（本番の場合のみ）:
- [ ] Scheduler Worker デプロイ成功
- [ ] Fetcher Worker デプロイ成功
- [ ] 手動トリガーで動作確認
- [ ] ログで正常動作確認
- [ ] R2 にデータが保存されていることを確認

## 🔧 トラブルシューティング

### Terraform エラー

**エラー**: `Error: Invalid account ID`
```bash
# Account ID を再確認
# Cloudflare Dashboard → Workers & Pages → Account ID (右サイドバー)
```

**エラー**: `Error: Unauthorized`
```bash
# API Token を確認
echo $CLOUDFLARE_API_TOKEN
# 空の場合は再設定
export CLOUDFLARE_API_TOKEN="your-token"
```

### Wrangler エラー

**エラー**: `Not logged in`
```bash
wrangler login
# ブラウザで認証
```

**エラー**: `Error: Unknown namespace`
```bash
# KV Namespace ID を再確認
cd terraform
terraform output kv_namespace_id
# wrangler.toml を更新
```

### GitHub API エラー

**エラー**: `Bad credentials`
```bash
# トークンを確認
wrangler secret list
# 再設定
wrangler secret put GITHUB_TOKEN
```

**エラー**: `API rate limit exceeded`
```bash
# Personal Access Token を使用していることを確認
# 認証なしのレート制限: 60 requests/hour
# 認証ありのレート制限: 5,000 requests/hour
```

## 📚 次のステップ

セットアップ完了後:

1. **監視設定**: [github-workers-setup.md](./github-workers-setup.md#-監視) を参照
2. **dbt セットアップ**: [github-dbt-design.md](./github-dbt-design.md) を参照
3. **Evidence.dev セットアップ**: [github-evidence-design.md](./github-evidence-design.md) を参照

## 🆘 サポート

問題が解決しない場合:

1. [トラブルシューティングガイド](./github-workers-setup.md#-トラブルシューティング) を確認
2. [GitHub Issues](https://github.com/your-repo/issues) で質問
3. [Cloudflare Community](https://community.cloudflare.com/) で質問

---

最終更新: 2025-01-03
