# Terraform Infrastructure as Code

このディレクトリには、Cloudflareデータ基盤のインフラストラクチャをTerraformで管理するための設定ファイルが含まれています。

## 📁 ファイル構成

```
terraform/
├── main.tf                    # Provider設定とバックエンド
├── variables.tf               # 変数定義
├── outputs.tf                 # 出力定義
├── storage.tf                 # R2、D1、KVリソース
├── queues.tf                  # Cloudflare Queues
├── workers.tf                 # Workers設定（オプション）
├── terraform.tfvars.example   # 設定例
├── .gitignore                 # Git除外設定
└── README.md                  # このファイル
```

## 🚀 クイックスタート

### 1. 前提条件

- [Terraform](https://www.terraform.io/downloads) >= 1.5.0
- Cloudflare アカウント
- Cloudflare API Token

### 2. Cloudflare API Tokenの作成

1. [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens) にアクセス
2. "Create Token" をクリック
3. "Custom token" を選択
4. 以下の権限を付与：
   - **Account Resources**:
     - Cloudflare Workers Scripts: Edit
     - Workers R2 Storage: Edit
     - Workers KV Storage: Edit
     - D1: Edit
     - Workers Queues: Edit
   - **Zone Resources** (Workers Routesを使う場合):
     - Workers Routes: Edit
5. "Continue to summary" → "Create Token"
6. トークンをコピーして安全に保存

### 3. 設定ファイルの準備

```bash
# terraform.tfvars.exampleをコピー
cd terraform
cp terraform.tfvars.example terraform.tfvars

# terraform.tfvarsを編集
# - cloudflare_api_token
# - cloudflare_account_id
# を設定
```

**Account IDの確認方法**:

```bash
# Wranglerがインストールされている場合
wrangler whoami

# または Cloudflare Dashboard で確認
# https://dash.cloudflare.com/ の URL に含まれています
```

### 4. Terraformの初期化

```bash
terraform init
```

### 5. プランの確認

```bash
terraform plan
```

### 6. インフラのデプロイ

```bash
terraform apply
```

確認プロンプトで `yes` と入力してリソースを作成します。

## 📦 管理されるリソース

### R2 Buckets (Object Storage)

| Bucket名 | 用途 |
|---------|------|
| `data-lake-raw` | 生データ保存 |
| `data-lake-curated` | 加工済みデータ |
| `data-lake-bronze` | Bronzeレイヤー（生データ） |
| `data-lake-silver` | Silverレイヤー（クリーンデータ） |
| `data-lake-gold` | Goldレイヤー（集計データ） |
| `terraform-state` | Terraformステート保存用 |

### D1 Databases (SQLite)

| Database名 | 用途 |
|-----------|------|
| `pipeline-metadata` | パイプラインメタデータ |
| `data-quality` | データ品質情報 |
| `user-profiles` | ユーザープロファイル |

### KV Namespaces (Key-Value Store)

| Namespace名 | 用途 |
|-----------|------|
| `pipeline-state` | パイプライン状態管理 |
| `session-store` | セッション保存 |
| `config-cache` | 設定キャッシュ |

### Cloudflare Queues

| Queue名 | 用途 |
|--------|------|
| `data-processing` | データ処理タスク |
| `pipeline-tasks` | パイプラインタスク |

## 🔧 Workersのデプロイ方法

Workersのデプロイには **2つのアプローチ** があります：

### アプローチ1: Wrangler + Terraform（推奨）

**Terraform**: インフラリソース（R2、D1、KV、Queues）のみ管理
**Wrangler**: Workersスクリプトのデプロイ

```bash
# 1. Terraformでインフラをプロビジョニング
cd terraform
terraform apply

# 2. リソースIDを確認
terraform output kv_namespace_ids
terraform output d1_database_ids
terraform output r2_bucket_names

# 3. wrangler.toml にリソースIDを設定
cd ..
vim wrangler.toml  # リソースIDを更新

# 4. Wranglerでデプロイ
wrangler deploy
```

**メリット**:
- Workersの開発・デプロイサイクルが高速
- `wrangler dev` でローカル開発が容易
- インフラとアプリケーションの責任分離

### アプローチ2: 完全Terraform管理

Terraform で Workers スクリプトも管理する場合、`workers.tf` のコメントを解除します。

```bash
# workers.tf の resource "cloudflare_workers_script" セクションをコメント解除
vim terraform/workers.tf

# 再度 apply
terraform apply
```

**メリット**:
- すべてのリソースが一元管理
- GitOps フレンドリー

**デメリット**:
- Workersスクリプトの変更ごとに `terraform apply` が必要
- ローカル開発が煩雑

## 🌍 環境別デプロイ

### 開発環境 (dev)

```bash
terraform workspace new dev
terraform workspace select dev
terraform apply -var="environment=dev"
```

### ステージング環境 (staging)

```bash
terraform workspace new staging
terraform workspace select staging
terraform apply -var="environment=staging"
```

### 本番環境 (prod)

```bash
terraform workspace new prod
terraform workspace select prod
terraform apply -var="environment=prod"
```

## 💾 Terraformステートの管理

### ローカルステート（デフォルト）

デフォルトでは、Terraformステートはローカルの `terraform.tfstate` に保存されます。

### R2リモートステート（推奨）

本番環境では、R2にステートを保存することを推奨します。

1. **R2バケットを手動で作成**（初回のみ）:

```bash
# まず、ローカルステートでterraform-stateバケットを作成
terraform apply

# または wrangler で作成
wrangler r2 bucket create data-engineering-terraform-state-prod
```

2. **main.tf のバックエンド設定をコメント解除**:

```hcl
backend "s3" {
  bucket                      = "data-engineering-terraform-state-prod"
  key                         = "cloudflare-data-platform/terraform.tfstate"
  region                      = "auto"
  endpoint                    = "https://<YOUR_ACCOUNT_ID>.r2.cloudflarestorage.com"
  skip_credentials_validation = true
  skip_region_validation      = true
  skip_metadata_api_check     = true
}
```

3. **R2 APIトークンを環境変数に設定**:

```bash
export AWS_ACCESS_KEY_ID="your-r2-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-r2-secret-access-key"
```

4. **ステートを移行**:

```bash
terraform init -migrate-state
```

## 📤 出力の確認

Terraformが作成したリソースのIDや名前を確認：

```bash
# すべての出力を表示
terraform output

# 特定の出力のみ表示
terraform output r2_bucket_names
terraform output kv_namespace_ids

# JSON形式で出力
terraform output -json
```

## 🔄 リソースの更新・削除

### リソースの更新

```bash
# variables.tf や *.tf ファイルを編集後
terraform plan   # 変更内容を確認
terraform apply  # 変更を適用
```

### 特定リソースの削除

```bash
# 例: data-lake-bronze バケットを削除
terraform destroy -target=cloudflare_r2_bucket.buckets[\"data-lake-bronze\"]
```

### すべてのリソースを削除

```bash
terraform destroy
```

⚠️ **警告**: `terraform destroy` はすべてのリソースを削除します。データが失われる可能性があるため、本番環境では慎重に実行してください。

## 🛠️ トラブルシューティング

### API Token権限エラー

```
Error: failed to create ... : Unauthorized (10000)
```

**解決策**: API Tokenの権限を確認し、必要な権限が付与されているか確認してください。

### Account ID が見つからない

```
Error: account_id is required
```

**解決策**: `terraform.tfvars` に `cloudflare_account_id` が正しく設定されているか確認してください。

```bash
wrangler whoami
```

### ステートロック

```
Error: Error acquiring the state lock
```

**解決策**: 他のTerraformプロセスが実行中の場合は終了してください。ロックが残っている場合：

```bash
terraform force-unlock <LOCK_ID>
```

### リソース名の競合

```
Error: bucket already exists
```

**解決策**: R2バケット名はグローバルで一意である必要があります。`terraform.tfvars` の `project_name` や `environment` を変更してください。

## 📚 参考リソース

### Terraform公式ドキュメント

- [Terraform CLI Documentation](https://www.terraform.io/docs/cli)
- [Terraform Language](https://www.terraform.io/docs/language)

### Cloudflare Terraform Provider

- [Cloudflare Provider Documentation](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs)
- [cloudflare_workers_script](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/workers_script)
- [cloudflare_r2_bucket](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/r2_bucket)
- [cloudflare_d1_database](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/d1_database)
- [cloudflare_workers_kv_namespace](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/workers_kv_namespace)
- [cloudflare_queue](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/queue)

### Cloudflare公式ドキュメント

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [R2 Storage](https://developers.cloudflare.com/r2/)
- [D1 Database](https://developers.cloudflare.com/d1/)
- [Workers KV](https://developers.cloudflare.com/kv/)
- [Queues](https://developers.cloudflare.com/queues/)

## 🤝 ベストプラクティス

### 1. 環境変数でシークレットを管理

```bash
# terraform.tfvars にシークレットを書かない
export TF_VAR_cloudflare_api_token="your-token"
terraform apply
```

### 2. Terraform Workspaceで環境を分離

```bash
terraform workspace new dev
terraform workspace new staging
terraform workspace new prod
```

### 3. モジュール化

複数プロジェクトで共通のインフラがある場合、モジュール化を検討：

```hcl
module "data_platform" {
  source = "./modules/data-platform"

  environment  = "prod"
  project_name = "my-project"
}
```

### 4. tfstate を .gitignore に追加

```bash
# 既に .gitignore に含まれています
*.tfstate
*.tfstate.*
*.tfvars
```

### 5. Plan → Review → Apply

```bash
terraform plan -out=tfplan
# レビュー
terraform apply tfplan
```

---

最終更新: 2025-12-27
