# Cloudflare Workers での dlt パイプライン実装ガイド

本ドキュメントでは、Cloudflare Workers Python Runtime上でdlt（data load tool）を動かす実装について解説します。

## 概要

Cloudflare Workers Python RuntimeでdltパイプラインをHTTPトリガーで実行することで、以下のメリットがあります:

- **エッジでの実行**: グローバルに分散されたエッジでデータ処理
- **低レイテンシ**: データソースに近いエッジでの処理
- **スケーラビリティ**: 自動スケーリング、トラフィック増加に自動対応
- **コスト効率**: サーバーレス、使った分だけ課金
- **HTTPトリガー**: APIエンドポイント経由でパイプライン実行

## アーキテクチャ

```
[外部API]
    ↓
[HTTP Request] → [Cloudflare Worker (Python)]
                        ↓
                   [dlt Pipeline]
                        ↓
                   [Cloudflare R2]
                        ↓
                 [dbt / DuckDB処理]
                        ↓
                   [分析・可視化]
```

## プロジェクト構造

```
data-engineering-with-cloudflare/
├── workers/
│   └── ingestion/
│       ├── dlt_pipeline.py      # Python Worker実装
│       └── requirements.txt     # Python依存関係
├── wrangler.toml                # Wrangler設定
└── docs/
    └── dlt-workers-implementation.md  # このドキュメント
```

## セットアップ

### 1. 前提条件

- Node.js 18以上
- Wrangler CLI（Cloudflare Workers開発ツール）
- Cloudflareアカウント
- R2バケット

### 2. Wranglerのインストール

```bash
npm install -g wrangler
```

### 3. Cloudflareへのログイン

```bash
wrangler login
```

### 4. wrangler.tomlの設定

`wrangler.toml`ファイルを編集し、アカウントIDとバケット名を設定:

```toml
# アカウントID（コメントを外して実際のIDを入力）
account_id = "your-account-id-here"

[workers.vars]
R2_ACCOUNT_ID = "your-account-id"
R2_BUCKET_NAME = "data-lake-raw"
```

アカウントIDの確認方法:
```bash
wrangler whoami
```

### 5. R2バケットの作成

```bash
wrangler r2 bucket create data-lake-raw
```

### 6. Secretsの設定

R2アクセスキーを作成してSecretsに設定:

```bash
# R2 APIトークンを作成（Cloudflare Dashboard > R2 > Manage R2 API Tokens）
# 作成したアクセスキーIDとシークレットアクセスキーを設定

wrangler secret put R2_ACCESS_KEY_ID --name dlt-pipeline
# プロンプトでアクセスキーIDを入力

wrangler secret put R2_SECRET_ACCESS_KEY --name dlt-pipeline
# プロンプトでシークレットアクセスキーを入力
```

カスタムAPI用の認証キー（オプション）:
```bash
wrangler secret put API_KEY --name dlt-pipeline
```

## ローカル開発

### 開発サーバーの起動

```bash
wrangler dev workers/ingestion/dlt_pipeline.py
```

デフォルトでは `http://localhost:8787` でアクセス可能。

### 動作確認

**デフォルト（postsデータ）:**
```bash
curl http://localhost:8787
```

**usersデータ:**
```bash
curl "http://localhost:8787?source=users"
```

**カスタムAPI:**
```bash
curl "http://localhost:8787?source=custom&endpoint=https://api.example.com/data"
```

## デプロイ

### プロダクション環境へのデプロイ

```bash
wrangler deploy workers/ingestion/dlt_pipeline.py --name dlt-pipeline
```

デプロイ後、Workers URLが表示されます:
```
https://dlt-pipeline.your-subdomain.workers.dev
```

### デプロイ確認

```bash
curl "https://dlt-pipeline.your-subdomain.workers.dev?source=posts"
```

## 実装詳細

### workers/ingestion/dlt_pipeline.py

主要な機能:

1. **データソース定義**: `@dlt.resource` デコレータでデータソースを定義
2. **パイプライン設定**: R2への接続設定（S3互換）
3. **HTTPハンドラ**: `on_fetch` 関数でHTTPリクエストを処理
4. **エラーハンドリング**: 詳細なエラーメッセージを返却

#### サポートされているデータソース

- **posts**: JSONPlaceholder APIから投稿データ
- **users**: JSONPlaceholder APIからユーザーデータ
- **custom**: カスタムAPIエンドポイント（API_KEY環境変数必要）

#### 環境変数

| 変数名 | 説明 | 必須 |
|-------|------|------|
| `R2_ACCESS_KEY_ID` | R2アクセスキーID | ✅ |
| `R2_SECRET_ACCESS_KEY` | R2シークレットアクセスキー | ✅ |
| `R2_ACCOUNT_ID` | CloudflareアカウントID | ✅ |
| `R2_BUCKET_NAME` | R2バケット名 | ✅ |
| `API_KEY` | カスタムAPI認証キー | ❌ |

### レスポンス形式

**成功時:**
```json
{
  "success": true,
  "pipeline_name": "workers_etl_pipeline",
  "dataset_name": "raw_data",
  "destination": "filesystem",
  "loads": [
    {
      "load_id": "1234567890",
      "package_info": {
        "state": "completed"
      }
    }
  ],
  "message": "Successfully loaded data from posts",
  "timestamp": "2024-12-25T12:00:00"
}
```

**エラー時:**
```json
{
  "success": false,
  "error": "endpoint parameter is required for custom source",
  "error_type": "ValueError",
  "message": "Pipeline execution failed"
}
```

## カスタマイズ

### 新しいデータソースの追加

`dlt_pipeline.py` に新しいリソースを追加:

```python
@dlt.resource(name="my_custom_source", write_disposition="merge")
def get_my_data() -> Iterator[Dict[str, Any]]:
    """
    カスタムデータソース
    """
    import urllib.request

    url = "https://api.myservice.com/data"

    with urllib.request.urlopen(url) as response:
        data = json.loads(response.read().decode())
        for item in data:
            yield item
```

そして `on_fetch` 関数に追加:

```python
elif source_type == "my_custom_source":
    info = pipeline.run(get_my_data())
```

### スケジュール実行との連携

Workersをスケジュール実行する場合、Cron Triggersを使用:

#### 1. wrangler.tomlにCron設定を追加

```toml
[[workers]]
name = "dlt-pipeline-scheduled"
main = "workers/ingestion/dlt_pipeline_scheduled.py"

[workers.triggers]
crons = ["0 */6 * * *"]  # 6時間ごと
```

#### 2. Scheduled Event用のWorkerを作成

```python
# workers/ingestion/dlt_pipeline_scheduled.py

async def on_scheduled(event, env):
    """
    Cron Trigger用のハンドラ
    """
    # dltパイプライン実行
    pipeline = dlt.pipeline(...)
    info = pipeline.run(get_posts())

    # Slackへ通知（オプション）
    if hasattr(env, 'SLACK_WEBHOOK_URL'):
        await notify_slack(env.SLACK_WEBHOOK_URL, info)
```

### R2へのデータ保存形式

dltはデフォルトでParquet形式でR2に保存します:

```
s3://data-lake-raw/
├── raw_data/
│   ├── posts/
│   │   ├── load_id_1234567890/
│   │   │   └── posts.parquet
│   │   └── _dlt_loads/
│   │       └── load_id_1234567890.jsonl
│   └── users/
│       ├── load_id_1234567891/
│       │   └── users.parquet
│       └── _dlt_loads/
│           └── load_id_1234567891.jsonl
```

この構造は、後続のdbt + DuckDBでの処理に最適です。

## 運用ガイド

### モニタリング

Cloudflare Dashboardで以下を確認:

1. **Workers Analytics**: リクエスト数、エラー率、レスポンス時間
2. **R2 Analytics**: ストレージ使用量、リクエスト数
3. **Logs**: `wrangler tail` でリアルタイムログ確認

```bash
wrangler tail dlt-pipeline
```

### デバッグ

ローカルで詳細ログを確認:

```python
# dlt_pipeline.py にログ追加
import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

logger.debug(f"Pipeline config: {pipeline.config}")
```

### パフォーマンス最適化

1. **バッチサイズ調整**: 大量データの場合、バッチで処理
2. **圧縮有効化**: Parquetの圧縮設定（デフォルトで有効）
3. **インクリメンタルロード**: `write_disposition="append"` で増分追加

```python
@dlt.resource(
    name="incremental_data",
    write_disposition="append",
    primary_key="id"
)
def get_incremental_data(last_value=dlt.sources.incremental("updated_at")):
    # 最終更新日時以降のデータのみ取得
    pass
```

## トラブルシューティング

### 問題1: Workers CPU時間超過

**エラー:** `CPU time limit exceeded`

**解決策:**
- データを小分けにして複数回実行
- Queueを使った非同期処理に切り替え
- Workflowsで長時間実行パイプラインを実装

### 問題2: R2接続エラー

**エラー:** `S3 connection failed`

**確認項目:**
1. R2アクセスキーが正しく設定されているか
2. アカウントIDが正しいか
3. バケット名が存在するか

```bash
# シークレット確認
wrangler secret list --name dlt-pipeline

# R2バケット一覧
wrangler r2 bucket list
```

### 問題3: dlt依存関係エラー

**エラー:** `ModuleNotFoundError: No module named 'dlt'`

**解決策:**
- `requirements.txt` が正しい場所にあるか確認
- wrangler.tomlで `requirements` パスが正しいか確認
- `wrangler deploy` を再実行

## CI/CD統合

GitHub Actionsでの自動デプロイ:

```yaml
# .github/workflows/deploy-workers.yml
name: Deploy dlt Worker

on:
  push:
    branches: [main]
    paths:
      - 'workers/ingestion/**'
      - 'wrangler.toml'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy workers/ingestion/dlt_pipeline.py --name dlt-pipeline

      - name: Notify Slack
        if: always()
        uses: slackapi/slack-github-action@v1
        with:
          webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
          payload: |
            {
              "text": "dlt Worker deployment ${{ job.status }}"
            }
```

## 次のステップ

1. **dbt統合**: R2に保存されたデータをdbtで変換
2. **Workflows連携**: 長時間パイプラインをWorkflowsで実装
3. **監視強化**: Analytics Engineでメトリクス記録
4. **Evidenceダッシュボード**: 可視化レイヤーの構築

詳細は以下のドキュメントを参照:
- [external-services.md](./external-services.md) - 外部サービス統合全体像
- [architecture-diagrams.md](./architecture-diagrams.md) - アーキテクチャ図

## 参考リンク

- [Cloudflare Workers Python Runtime](https://developers.cloudflare.com/workers/languages/python/)
- [dlt Documentation](https://dlthub.com/docs/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [R2 Documentation](https://developers.cloudflare.com/r2/)

---

最終更新: 2025年12月25日
