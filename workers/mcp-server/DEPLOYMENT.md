# Cloudflare MCP Server - デプロイメントガイド

このドキュメントでは、Cloudflare WorkersでRust製MCPサーバーを本番環境にデプロイするための手順を説明します。

## 目次

1. [前提条件](#前提条件)
2. [環境構築](#環境構築)
3. [Cloudflareリソースの作成](#cloudflareリソースの作成)
4. [環境変数とシークレットの設定](#環境変数とシークレットの設定)
5. [ビルドとローカルテスト](#ビルドとローカルテスト)
6. [デプロイ](#デプロイ)
7. [動作確認](#動作確認)
8. [トラブルシューティング](#トラブルシューティング)

---

## 前提条件

### 必要なツール

- **Rust**: バージョン 1.75 以上
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  rustup target add wasm32-unknown-unknown
  ```

- **Node.js**: バージョン 18 以上（Wrangler用）
  ```bash
  node --version  # v18.0.0 以上
  ```

- **Wrangler**: Cloudflare Workers CLI
  ```bash
  npm install -g wrangler
  wrangler --version
  ```

- **worker-build**: Rustビルドツール
  ```bash
  cargo install worker-build
  ```

### Cloudflareアカウント

- Cloudflareアカウント（無料プランでも可）
- Workers有料プラン（推奨）：D1とR2を制限なく使用するため
  - 無料プラン: D1（5MB）、R2（10GB/月）
  - 有料プラン: D1（500MB）、R2（無制限）

---

## 環境構築

### 1. Wranglerの認証

```bash
# Cloudflareアカウントにログイン
wrangler login

# 認証確認
wrangler whoami
```

### 2. プロジェクトディレクトリに移動

```bash
cd workers/mcp-server
```

---

## Cloudflareリソースの作成

### 1. Workers KVネームスペースの作成

```bash
# 本番環境用
wrangler kv:namespace create "DATA"
# 出力例: id = "abc123def456..."

# プレビュー環境用
wrangler kv:namespace create "DATA" --preview
# 出力例: preview_id = "xyz789uvw012..."

# 開発環境用
wrangler kv:namespace create "DATA_DEV"
```

**wrangler.tomlへの反映:**

```toml
[[kv_namespaces]]
binding = "DATA"
id = "abc123def456..."           # ← 本番環境のIDに置換
preview_id = "xyz789uvw012..."   # ← プレビュー環境のIDに置換
```

### 2. D1データベースの作成

```bash
# 本番環境用データベース
wrangler d1 create mcp-database-prod
# 出力例: database_id = "11111111-2222-3333-4444-555555555555"

# 開発環境用データベース
wrangler d1 create mcp-database-dev
# 出力例: database_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
```

**wrangler.tomlへの反映:**

```toml
[[d1_databases]]
binding = "DB"
database_name = "mcp-database-prod"
database_id = "11111111-2222-3333-4444-555555555555"  # ← 置換
```

#### D1マイグレーション（オプション）

初期スキーマを作成する場合：

```bash
# マイグレーションディレクトリ作成
mkdir -p migrations

# 初期スキーマファイル作成
cat > migrations/0001_initial_schema.sql << 'EOF'
-- ユーザーテーブル
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- データキャッシュテーブル
CREATE TABLE IF NOT EXISTS cache_entries (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cache_expires ON cache_entries(expires_at);
EOF

# マイグレーション適用（ローカル）
wrangler d1 migrations apply mcp-database-dev --local

# マイグレーション適用（本番）
wrangler d1 migrations apply mcp-database-prod --remote
```

### 3. R2バケットの作成

#### バケット名の命名規則

R2バケット名は**Cloudflareアカウント内でユニーク**である必要があります。
他のプロジェクトと衝突を避けるため、以下の命名規則を推奨します：

**推奨フォーマット:**
```
{プロジェクト名}-{用途}-{ランダムサフィックス}-{環境}
```

**例:**
- `data-eng-mcp-storage-a1b2c3-prod`
- `ta93abe-mcp-storage-x9y8z7-dev`
- `my-project-mcp-f4e5d6-preview`

#### ユニークなサフィックスの生成

```bash
# ランダムな6文字のサフィックスを生成（macOS/Linux）
SUFFIX=$(openssl rand -hex 3)
echo "Generated suffix: $SUFFIX"

# または、タイムスタンプベース
SUFFIX=$(date +%s | tail -c 7)
echo "Generated suffix: $SUFFIX"

# または、UUIDの一部を使用
SUFFIX=$(uuidgen | cut -d'-' -f1 | tr '[:upper:]' '[:lower:]')
echo "Generated suffix: $SUFFIX"
```

#### バケット作成コマンド

```bash
# サフィックスを生成（例）
SUFFIX="a1b2c3"  # 上記コマンドで生成した値を使用

# 本番環境用バケット
wrangler r2 bucket create "ta93abe-mcp-storage-${SUFFIX}-prod"

# プレビュー/開発環境用バケット
wrangler r2 bucket create "ta93abe-mcp-storage-${SUFFIX}-preview"
wrangler r2 bucket create "ta93abe-mcp-storage-${SUFFIX}-dev"

# 作成されたバケット一覧を確認
wrangler r2 bucket list
```

**wrangler.tomlへの反映:**

```toml
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "ta93abe-mcp-storage-a1b2c3-prod"         # ← 作成したバケット名
preview_bucket_name = "ta93abe-mcp-storage-a1b2c3-preview"
```

**注意事項:**
- バケット名は小文字、数字、ハイフンのみ使用可能
- 3〜63文字の長さ制限
- 先頭と末尾はハイフン不可
- アカウント内で一意である必要あり

---

## 環境変数とシークレットの設定

### 環境変数（wrangler.toml）

公開されても問題ない設定値：

```toml
[vars]
LOG_LEVEL = "info"
MAX_REQUEST_SIZE = "10485760"  # 10MB
ENABLE_CORS = "true"
```

### シークレット（暗号化保存）

機密情報は`wrangler secret put`で設定：

```bash
# API認証キー
wrangler secret put API_KEY
# プロンプトで値を入力

# データベース暗号化キー
wrangler secret put DB_ENCRYPTION_KEY

# 外部サービスAPI
wrangler secret put EXTERNAL_API_TOKEN
```

Rustコード内での使用例：

```rust
// 環境変数の取得
let log_level = ctx.var("LOG_LEVEL")?.to_string();

// シークレットの取得
let api_key = ctx.secret("API_KEY")?.to_string();
```

---

## ビルドとローカルテスト

### 1. 依存関係のインストール

```bash
# Rustクレートのダウンロード
cargo fetch

# worker-buildのインストール（初回のみ）
cargo install worker-build
```

### 2. ローカルビルド

```bash
# リリースビルド
worker-build --release

# デバッグビルド（開発時）
worker-build
```

### 3. ローカル開発サーバー起動

```bash
# 開発サーバー起動
wrangler dev

# または環境指定
wrangler dev --env development

# ポート指定
wrangler dev --port 8788
```

### 4. ローカルテスト

別のターミナルで：

```bash
# ヘルスチェック
curl http://localhost:8787/health

# MCP initialize
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }'

# ツール一覧取得
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
  }'

# KV書き込みテスト
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "kv-put",
      "arguments": {
        "key": "test_key",
        "value": "Hello from MCP!"
      }
    }
  }'

# KV読み取りテスト
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "kv-get",
      "arguments": {
        "key": "test_key"
      }
    }
  }'
```

---

## デプロイ

### 1. 設定ファイルの最終確認

wrangler.tomlの全てのプレースホルダーが実際の値に置き換わっていることを確認：

```bash
grep -n "YOUR_" wrangler.toml
# 何も出力されなければOK
```

### 2. デプロイコマンド

```bash
# デフォルト環境（development）へデプロイ
wrangler deploy

# 本番環境へデプロイ
wrangler deploy --env production

# ドライラン（デプロイせずに検証）
wrangler deploy --dry-run
```

### 3. デプロイ確認

```bash
# デプロイされたWorker一覧
wrangler deployments list

# 最新のデプロイ情報
wrangler deployments list --name mcp-server-prod
```

### 4. URLの確認

デプロイ後、以下のようなURLが発行されます：

```
https://mcp-server-prod.<YOUR_SUBDOMAIN>.workers.dev
```

---

## 動作確認

### 1. 本番環境でのヘルスチェック

```bash
curl https://mcp-server-prod.<YOUR_SUBDOMAIN>.workers.dev/health
# 期待される出力: "MCP Server is running"
```

### 2. サーバー情報の取得

```bash
curl https://mcp-server-prod.<YOUR_SUBDOMAIN>.workers.dev/info
```

### 3. MCP プロトコルテスト

```bash
# Tools一覧
curl -X POST https://mcp-server-prod.<YOUR_SUBDOMAIN>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Resources一覧
curl -X POST https://mcp-server-prod.<YOUR_SUBDOMAIN>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"resources/list"}'
```

### 4. ストレージ動作確認

```bash
# KV操作
curl -X POST https://mcp-server-prod.<YOUR_SUBDOMAIN>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "kv-put",
      "arguments": {"key": "prod_test", "value": "Production Test"}
    }
  }'

# D1クエリ
curl -X POST https://mcp-server-prod.<YOUR_SUBDOMAIN>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "d1-query",
      "arguments": {"sql": "SELECT datetime(\"now\") as current_time"}
    }
  }'
```

---

## トラブルシューティング

### ビルドエラー

**エラー: `wasm32-unknown-unknown` ターゲットがない**

```bash
rustup target add wasm32-unknown-unknown
```

**エラー: `worker-build` コマンドが見つからない**

```bash
cargo install worker-build --force
```

### デプロイエラー

**エラー: KV namespace not found**

- wrangler.tomlのKV namespace IDが正しいか確認
- `wrangler kv:namespace list` で存在確認

**エラー: D1 database not found**

- `wrangler d1 list` でデータベース一覧を確認
- database_idが正しいか確認

**エラー: R2 bucket not found**

- `wrangler r2 bucket list` でバケット一覧を確認
- bucket_nameが正しいか確認

### ランタイムエラー

**エラー: `Error: Missing KV binding "DATA"`**

環境変数バインディングの確認：

```bash
# ローカル開発時
wrangler dev --local

# バインディング一覧表示
wrangler deployments view <deployment-id>
```

**パフォーマンス問題: CPU時間超過**

- Workers有料プラン（CPU 30秒）へのアップグレード
- 処理の非同期化・分割
- Queuesの活用

### ログ確認

```bash
# リアルタイムログ
wrangler tail

# 環境指定
wrangler tail --env production

# フィルタリング
wrangler tail --status error
```

---

## カスタムドメイン設定（オプション）

### 1. Cloudflare Dashboardでドメイン追加

1. Cloudflare Dashboardにログイン
2. Workers & Pages → mcp-server-prod → Settings → Domains
3. "Add Custom Domain"をクリック
4. ドメイン名を入力（例: `mcp-api.yourdomain.com`）

### 2. wrangler.tomlに反映

```toml
[env.production]
name = "mcp-server-prod"
routes = [
  { pattern = "mcp-api.yourdomain.com/*", custom_domain = true }
]
```

### 3. 再デプロイ

```bash
wrangler deploy --env production
```

---

## セキュリティ設定（推奨）

### 1. API認証の実装

Rustコード（src/lib.rs）に認証ミドルウェアを追加：

```rust
async fn authenticate(req: &Request, ctx: &RouteContext<()>) -> Result<bool> {
    let auth_header = req.headers().get("Authorization")?;

    if let Some(token) = auth_header {
        let expected = ctx.secret("API_KEY")?.to_string();
        return Ok(token == format!("Bearer {}", expected));
    }

    Ok(false)
}
```

### 2. CORS設定

```rust
fn add_cors_headers(response: Response) -> Response {
    let mut headers = Headers::new();
    headers.set("Access-Control-Allow-Origin", "*")?;
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")?;
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")?;

    response.with_headers(headers)
}
```

### 3. レート制限

Cloudflare Dashboard → Workers → Settings → Rate Limiting で設定

---

## モニタリング

### Cloudflare Analytics

- Workers Analytics: リクエスト数、エラー率、レイテンシ
- ダッシュボード: https://dash.cloudflare.com

### カスタムメトリクス

Analytics Engineを使用：

```bash
# wrangler.tomlに追加
[[analytics_engine_datasets]]
binding = "ANALYTICS"
```

Rustコード：

```rust
ctx.env.analytics_engine("ANALYTICS")?.write_data_point(DataPoint {
    blobs: vec!["mcp_request".to_string()],
    doubles: vec![response_time],
    indexes: vec!["timestamp".to_string()],
})?;
```

---

## CI/CD（GitHub Actions）

`.github/workflows/deploy-mcp-server.yml`:

```yaml
name: Deploy MCP Server

on:
  push:
    branches:
      - main
    paths:
      - 'workers/mcp-server/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Rust
        uses: actions-rust-lang/setup-rust-toolchain@v1
        with:
          toolchain: stable
          target: wasm32-unknown-unknown

      - name: Install worker-build
        run: cargo install worker-build

      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: workers/mcp-server
          command: deploy --env production
```

必要なシークレット：

- `CLOUDFLARE_API_TOKEN`: Cloudflare API Token
  - Workers Scripts: Edit権限
  - Account Settings: Read権限

---

## コスト見積もり

### 無料プラン

- Workers: 100,000 リクエスト/日
- KV: 100,000 読み取り/日、1,000 書き込み/日
- D1: 5MB ストレージ、500万行読み取り/日
- R2: 10GB ストレージ/月、100万クラスB操作/月

### 有料プラン（$5/月〜）

- Workers: 無制限リクエスト（$0.50/100万リクエスト）
- KV: 無制限（読み取り$0.50/1000万、書き込み$5.00/100万）
- D1: 500MB ストレージ、250億行読み取り/月
- R2: $0.015/GB/月、エグレス無料

---

## まとめ

このガイドに従うことで、Rust製MCPサーバーをCloudflare Workersに安全にデプロイできます。

**次のステップ:**
1. ローカルでテストを実行
2. 開発環境にデプロイ
3. 動作確認後、本番環境へデプロイ
4. モニタリングとログ確認
5. 必要に応じてスケーリング

質問や問題がある場合は、[Cloudflare Community](https://community.cloudflare.com/)または[GitHub Issues](https://github.com/ta93abe/data-engineering-with-cloudflare/issues)で質問してください。
