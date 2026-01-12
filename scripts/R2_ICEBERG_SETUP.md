# R2 Iceberg + R2 SQL セットアップガイド

R2上でIcebergテーブルを作成し、R2 SQLでクエリを実行するミニマム環境のセットアップ手順。

## 前提条件

- Cloudflareアカウント
- Node.js 16.17.0以上（Wrangler用）
- Python 3.11以上
- uv（Pythonパッケージマネージャ）

## セットアップ手順

### 1. R2バケット作成

```bash
# Wranglerにログイン
npx wrangler login

# バケット作成
npx wrangler r2 bucket create iceberg-demo
```

### 2. R2 Data Catalog有効化

```bash
npx wrangler r2 bucket catalog enable iceberg-demo
```

**重要**: このコマンドの出力に表示される `Warehouse` と `Catalog URI` をメモしてください。

### 3. APIトークン作成

1. [Cloudflareダッシュボード](https://dash.cloudflare.com/) にアクセス
2. **R2 Object Storage** → **Manage API tokens** → **Create API token**
3. **Admin Read & Write** 権限を選択
4. トークン値を安全に保存

### 4. 環境変数設定

```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export R2_BUCKET_NAME="iceberg-demo"
export CLOUDFLARE_API_TOKEN="your-api-token"
```

### 5. Python依存関係インストール

```bash
cd /path/to/data-engineering-with-cloudflare
uv sync
```

## 使用方法

### Icebergテーブル作成 & サンプルデータ投入

```bash
python scripts/r2_iceberg_demo.py create
```

出力例:
```
✓ namespace 'default' を作成しました
✓ テーブル 'default.events' を作成しました
✓ 5 件のサンプルデータを投入しました

📝 R2 SQLでクエリを実行:
   npx wrangler r2 sql query "iceberg-demo" "SELECT * FROM default.events"
```

### R2 SQLでクエリ実行

```bash
# 全件取得
npx wrangler r2 sql query "iceberg-demo" "SELECT * FROM default.events"

# 集計クエリ
npx wrangler r2 sql query "iceberg-demo" "SELECT event_type, COUNT(*) as count FROM default.events GROUP BY event_type"

# フィルタ
npx wrangler r2 sql query "iceberg-demo" "SELECT * FROM default.events WHERE event_type = 'purchase'"
```

### その他のコマンド

```bash
# データ追加
python scripts/r2_iceberg_demo.py append

# テーブル一覧
python scripts/r2_iceberg_demo.py list

# ローカルでスキャン（PyIceberg経由）
python scripts/r2_iceberg_demo.py scan
```

## テーブルスキーマ

`default.events` テーブル:

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | int64 | イベントID |
| event_type | string | イベント種別（page_view, purchase, signup等） |
| user_id | int64 | ユーザーID |
| amount | float64 | 金額（nullableの場合あり） |
| created_at | timestamp | 作成日時（UTC） |

## トラブルシューティング

### 認証エラー

```
Error: Authentication failed
```

→ `CLOUDFLARE_API_TOKEN` が正しく設定されているか確認。トークンに **Admin Read & Write** 権限があることを確認。

### バケットが見つからない

```
Error: Bucket not found
```

→ `R2_BUCKET_NAME` が正しいか確認。Data Catalogが有効化されているか確認：
```bash
npx wrangler r2 bucket catalog enable <bucket-name>
```

### R2 SQLでテーブルが見つからない

Data Catalogが有効化されてからテーブルが認識されるまで数分かかる場合があります。

## 参考リンク

- [R2 SQL Getting Started](https://developers.cloudflare.com/r2-sql/get-started/)
- [R2 Data Catalog](https://developers.cloudflare.com/r2/data-catalog/)
- [PyIceberg Documentation](https://py.iceberg.apache.org/)
