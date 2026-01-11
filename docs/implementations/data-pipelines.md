# dlt データパイプライン実装ガイド

Cloudflare Workers Python Runtime上でdltを使用したデータパイプラインの実装です。

## 概要

- **ツール**: dlt（data load tool）
- **実行環境**: Cloudflare Workers（Python Runtime）
- **ストレージ**: Cloudflare R2（S3互換）
- **データフォーマット**: Parquet
- **オプション**: Apache Iceberg（PyIceberg連携）

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│                   External APIs                         │
│            (JSONPlaceholder, Custom APIs)               │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              dlt Pipeline (Workers Python)              │
│  ┌─────────────────────────────────────────────────┐   │
│  │         dlt Resources (Extractors)              │   │
│  │    - get_posts()                                │   │
│  │    - get_users()                                │   │
│  │    - get_custom_api_data()                      │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │       dlt.destinations.filesystem               │   │
│  │    - S3 Protocol (R2 compatible)                │   │
│  │    - Hive Partitioning                         │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                 Cloudflare R2                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │  data-lake-raw (Bronze Layer)                   │   │
│  │  └── sources/                                   │   │
│  │      └── api_jsonplaceholder/                   │   │
│  │          ├── posts/year=YYYY/month=MM/day=DD/  │   │
│  │          └── users/year=YYYY/month=MM/day=DD/  │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│                    (Optional)                           │
│                          ▼                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │  data-lake-curated (Gold Layer)                 │   │
│  │  └── analytics/                                 │   │
│  │      └── api_jsonplaceholder/                   │   │
│  │          ├── posts/ (Iceberg)                   │   │
│  │          └── users/ (Iceberg)                   │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## 実装コード

### ディレクトリ構造

```
workers/ingestion/
├── dlt_pipeline.py           # 基本dltパイプライン
├── dlt_iceberg_pipeline.py   # Iceberg統合パイプライン
└── wrangler.toml             # Workers設定（要作成）
```

### 基本パイプライン: dlt_pipeline.py

外部APIからデータを抽出してR2にParquetとして保存する基本実装です。

```python
"""
Cloudflare Workers Python Runtime での dlt パイプライン実装

このWorkerは、外部APIからデータを抽出してCloudflare R2にロードするdltパイプラインを実行します。
"""

from js import Response, Headers
import dlt
import json
from typing import Iterator, Dict, Any


# サンプルデータソース: JSONPlaceholder API
@dlt.resource(name="posts", write_disposition="replace")
def get_posts() -> Iterator[Dict[str, Any]]:
    """
    JSONPlaceholder APIから投稿データを取得
    """
    import urllib.request

    url = "https://jsonplaceholder.typicode.com/posts"

    with urllib.request.urlopen(url) as response:
        data = json.loads(response.read().decode())
        for item in data:
            yield item


@dlt.resource(name="users", write_disposition="replace")
def get_users() -> Iterator[Dict[str, Any]]:
    """
    JSONPlaceholder APIからユーザーデータを取得
    """
    import urllib.request

    url = "https://jsonplaceholder.typicode.com/users"

    with urllib.request.urlopen(url) as response:
        data = json.loads(response.read().decode())
        for item in data:
            yield item


# カスタムAPIソースの例（環境変数でAPIキーを受け取る）
@dlt.resource(name="custom_api_data")
def get_custom_api_data(api_key: str, endpoint: str) -> Iterator[Dict[str, Any]]:
    """
    カスタムAPIからデータを取得

    Args:
        api_key: API認証キー
        endpoint: APIエンドポイントURL
    """
    import urllib.request

    req = urllib.request.Request(
        endpoint,
        headers={"Authorization": f"Bearer {api_key}"}
    )

    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())

        # APIレスポンス構造に応じて調整
        if isinstance(data, list):
            for item in data:
                yield item
        else:
            yield data


async def on_fetch(request, env):
    """
    Cloudflare Workers のエントリーポイント

    HTTPリクエストを受けてdltパイプラインを実行します。

    環境変数:
        R2_ACCESS_KEY_ID: R2アクセスキーID
        R2_SECRET_ACCESS_KEY: R2シークレットアクセスキー
        R2_ACCOUNT_ID: CloudflareアカウントID
        R2_BUCKET_NAME: R2バケット名
        API_KEY: カスタムAPI用の認証キー（オプション）
    """

    # CORSヘッダー設定
    # 環境変数 ACCESS_CONTROL_ALLOW_ORIGIN で許可するオリジンを設定可能にする
    allowed_origin = env.get("ACCESS_CONTROL_ALLOW_ORIGIN", "*")

    cors_headers = {
        "Access-Control-Allow-Origin": allowed_origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
    }

    # OPTIONSリクエスト（CORS preflight）への対応
    if request.method == "OPTIONS":
        return Response.new("", headers=Headers.new(cors_headers))

    try:
        # 環境変数から設定を取得
        required_env_vars = [
            "R2_ACCESS_KEY_ID",
            "R2_SECRET_ACCESS_KEY",
            "R2_ACCOUNT_ID",
            "R2_BUCKET_NAME",
        ]

        missing_vars = [name for name in required_env_vars if not hasattr(env, name)]
        if missing_vars:
            # 不足している環境変数がある場合は、わかりやすいエラーを発生させる
            raise ValueError(
                "Missing required environment variables: " + ", ".join(missing_vars)
            )

        r2_access_key = getattr(env, "R2_ACCESS_KEY_ID")
        r2_secret_key = getattr(env, "R2_SECRET_ACCESS_KEY")
        r2_account_id = getattr(env, "R2_ACCOUNT_ID")
        r2_bucket_name = getattr(env, "R2_BUCKET_NAME")
        # タイムスタンプ取得
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)

        # dltパイプラインの設定（R2 Bronze Layer: data-lake-raw）
        # フォルダ構造: sources/{source_name}/{table}/year={YYYY}/month={MM}/day={DD}/
        pipeline = dlt.pipeline(
            pipeline_name="workers_etl_pipeline",
            destination=dlt.destinations.filesystem(
                bucket_url=f"s3://{r2_bucket_name}",
                credentials={
                    "aws_access_key_id": r2_access_key,
                    "aws_secret_access_key": r2_secret_key,
                    "endpoint_url": f"https://{r2_account_id}.r2.cloudflarestorage.com",
                    "region_name": "auto"
                },
                # Hive形式のパーティション構造
                layout="{table_name}/year={year}/month={month}/day={day}/{load_id}.{file_id}.{ext}"
            ),
            dataset_name=f"sources/api_jsonplaceholder"  # ソース別のフォルダ
        )

        # リクエストパラメータでパイプラインソースを選択
        url = request.url
        url_obj = url.split("?")
        params = {}
        if len(url_obj) > 1:
            for param in url_obj[1].split("&"):
                key_value = param.split("=")
                if len(key_value) == 2:
                    params[key_value[0]] = key_value[1]

        source_type = params.get("source", "posts")

        # ソース選択
        if source_type == "posts":
            info = pipeline.run(get_posts())
        elif source_type == "users":
            info = pipeline.run(get_users())
        elif source_type == "custom" and hasattr(env, "API_KEY"):
            # カスタムAPIの例
            api_endpoint = params.get("endpoint", "")
            if not api_endpoint:
                raise ValueError("endpoint parameter is required for custom source")

            info = pipeline.run(
                get_custom_api_data(
                    api_key=env.API_KEY,
                    endpoint=api_endpoint
                )
            )
        else:
            raise ValueError(f"Unknown source type: {source_type}")

        # 実行結果を返す
        result = {
            "success": True,
            "pipeline_name": info.pipeline.pipeline_name,
            "dataset_name": info.pipeline.dataset_name,
            "destination": str(info.pipeline.destination),
            "bucket": r2_bucket_name,
            "path_structure": f"s3://{r2_bucket_name}/sources/api_jsonplaceholder/{source_type}/year={now.year}/month={now.month:02d}/day={now.day:02d}/",
            "loads": [
                {
                    "load_id": load.load_id,
                    "package_info": {
                        "state": load.package_info.state if hasattr(load, 'package_info') else "unknown"
                    }
                }
                for load in (info.loads if hasattr(info, 'loads') else [])
            ],
            "message": f"Successfully loaded data from {source_type} to Bronze Layer (data-lake-raw)",
            "timestamp": str(dlt.common.time.timestamp())
        }

        return Response.new(
            json.dumps(result, indent=2),
            headers=Headers.new(cors_headers)
        )

    except Exception as e:
        # エラーハンドリング
        error_response = {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__,
            "message": "Pipeline execution failed"
        }

        return Response.new(
            json.dumps(error_response, indent=2),
            status=500,
            headers=Headers.new(cors_headers)
        )
```

### Iceberg統合パイプライン: dlt_iceberg_pipeline.py

dltでParquetを保存後、PyIcebergでIcebergテーブルを作成する2段階パイプライン。

```python
"""
Cloudflare Workers Python Runtime - dlt → Iceberg 統合パイプライン

dltでデータを取り込み、直接Icebergテーブルとして保存するWorkerです。
2ステップアプローチ:
1. dltでParquetをRaw Layerに保存
2. PyIcebergでCurated LayerにIcebergテーブル化
"""

from js import Response, Headers
import dlt
import json
from typing import Iterator, Dict, Any
from datetime import datetime


# データソース定義（dlt_pipeline.pyと同じ）
@dlt.resource(name="posts", write_disposition="append")
def get_posts() -> Iterator[Dict[str, Any]]:
    """JSONPlaceholder APIから投稿データを取得"""
    import urllib.request

    url = "https://jsonplaceholder.typicode.com/posts"

    with urllib.request.urlopen(url) as response:
        data = json.loads(response.read().decode())
        # メタデータ追加
        for item in data:
            item["ingestion_timestamp"] = datetime.utcnow().isoformat()
            yield item


@dlt.resource(name="users", write_disposition="append")
def get_users() -> Iterator[Dict[str, Any]]:
    """JSONPlaceholder APIからユーザーデータを取得"""
    import urllib.request

    url = "https://jsonplaceholder.typicode.com/users"

    with urllib.request.urlopen(url) as response:
        data = json.loads(response.read().decode())
        for item in data:
            item["ingestion_timestamp"] = datetime.utcnow().isoformat()
            yield item


async def create_iceberg_table(env, source_name: str, table_name: str, schema_fields: list):
    """
    PyIcebergでIcebergテーブルを作成または更新
    """
    from pyiceberg.catalog import load_catalog
    from pyiceberg.schema import Schema
    from pyiceberg.types import NestedField, StringType, IntegerType, TimestampType
    from pyiceberg.partitioning import PartitionSpec, PartitionField
    from pyiceberg.transforms import DayTransform

    account_id = env.R2_ACCOUNT_ID
    curated_bucket = env.R2_BUCKET_CURATED  # data-lake-curated
    api_token = env.CLOUDFLARE_API_TOKEN

    # R2 Data Catalog接続
    catalog = load_catalog(
        "r2_catalog",
        **{
            "type": "rest",
            "uri": f"https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{curated_bucket}/catalog",
            "credential": api_token,
            "warehouse": f"s3://{curated_bucket}"
        }
    )

    # ネームスペース作成
    namespace = ("analytics", source_name)
    try:
        catalog.create_namespace(namespace)
    except Exception:
        pass

    # スキーマ定義（動的に構築）
    iceberg_fields = []
    field_id = 1

    for field in schema_fields:
        field_type = field.get("type", "string")

        if field_type == "integer":
            iceberg_type = IntegerType()
        elif field_type == "timestamp":
            iceberg_type = TimestampType()
        else:
            iceberg_type = StringType()

        iceberg_fields.append(
            NestedField(
                field_id=field_id,
                name=field["name"],
                field_type=iceberg_type,
                required=field.get("required", False)
            )
        )
        field_id += 1

    schema = Schema(*iceberg_fields)

    # パーティション仕様
    partition_spec = PartitionSpec(
        PartitionField(
            source_id=field_id - 1,  # ingestion_timestamp
            field_id=1000,
            transform=DayTransform(),
            name="ingestion_date"
        )
    )

    # テーブル作成
    table_identifier = f"analytics.{source_name}.{table_name}"
    iceberg_location = f"s3://{curated_bucket}/analytics/{source_name}/{table_name}"

    try:
        table = catalog.load_table(table_identifier)
    except Exception:
        table = catalog.create_table(
            identifier=table_identifier,
            schema=schema,
            location=iceberg_location,
            partition_spec=partition_spec
        )

    return table


async def on_fetch(request, env):
    """
    dlt → Iceberg 統合パイプライン

    環境変数:
        R2_ACCESS_KEY_ID: R2アクセスキーID
        R2_SECRET_ACCESS_KEY: R2シークレットアクセスキー
        R2_ACCOUNT_ID: CloudflareアカウントID
        R2_BUCKET_RAW: Rawバケット名（data-lake-raw）
        R2_BUCKET_CURATED: Curatedバケット名（data-lake-curated）
        CLOUDFLARE_API_TOKEN: R2 Data Catalog APIトークン
    """

    cors_headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
    }

    if request.method == "OPTIONS":
        return Response.new("", headers=Headers.new(cors_headers))

    try:
        # 環境変数取得
        r2_access_key = env.R2_ACCESS_KEY_ID
        r2_secret_key = env.R2_SECRET_ACCESS_KEY
        r2_account_id = env.R2_ACCOUNT_ID
        r2_bucket_raw = env.R2_BUCKET_RAW  # data-lake-raw
        r2_bucket_curated = env.R2_BUCKET_CURATED  # data-lake-curated

        now = datetime.utcnow()

        # ステップ1: dltでRaw Layerに保存
        pipeline = dlt.pipeline(
            pipeline_name="dlt_iceberg_pipeline",
            destination=dlt.destinations.filesystem(
                bucket_url=f"s3://{r2_bucket_raw}",
                credentials={
                    "aws_access_key_id": r2_access_key,
                    "aws_secret_access_key": r2_secret_key,
                    "endpoint_url": f"https://{r2_account_id}.r2.cloudflarestorage.com",
                    "region_name": "auto"
                },
                layout="{table_name}/year={year}/month={month}/day={day}/{load_id}.{file_id}.{ext}"
            ),
            dataset_name="sources/api_jsonplaceholder"
        )

        # パラメータ取得
        url = request.url
        params = {}
        if "?" in url:
            query_string = url.split("?")[1]
            for param in query_string.split("&"):
                if "=" in param:
                    key, value = param.split("=", 1)
                    params[key] = value

        source_type = params.get("source", "posts")

        # データ取得＆Rawレイヤーへ保存
        if source_type == "posts":
            info = pipeline.run(get_posts())
            schema_fields = [
                {"name": "userId", "type": "integer", "required": True},
                {"name": "id", "type": "integer", "required": True},
                {"name": "title", "type": "string", "required": True},
                {"name": "body", "type": "string", "required": True},
                {"name": "_dlt_load_id", "type": "string", "required": False},
                {"name": "_dlt_id", "type": "string", "required": False},
                {"name": "ingestion_timestamp", "type": "timestamp", "required": False}
            ]
        elif source_type == "users":
            info = pipeline.run(get_users())
            schema_fields = [
                {"name": "id", "type": "integer", "required": True},
                {"name": "name", "type": "string", "required": True},
                {"name": "username", "type": "string", "required": True},
                {"name": "email", "type": "string", "required": True},
                {"name": "phone", "type": "string", "required": False},
                {"name": "website", "type": "string", "required": False},
                {"name": "_dlt_load_id", "type": "string", "required": False},
                {"name": "_dlt_id", "type": "string", "required": False},
                {"name": "ingestion_timestamp", "type": "timestamp", "required": False}
            ]
        else:
            raise ValueError(f"Unknown source type: {source_type}")

        # ステップ2: IcebergテーブルをCurated Layerに作成
        iceberg_table = await create_iceberg_table(
            env,
            source_name="api_jsonplaceholder",
            table_name=source_type,
            schema_fields=schema_fields
        )

        # レスポンス
        result = {
            "success": True,
            "pipeline_name": info.pipeline.pipeline_name,
            "raw_layer": {
                "bucket": r2_bucket_raw,
                "path": f"s3://{r2_bucket_raw}/sources/api_jsonplaceholder/{source_type}/year={now.year}/month={now.month:02d}/day={now.day:02d}/",
                "format": "parquet"
            },
            "curated_layer": {
                "bucket": r2_bucket_curated,
                "table": f"analytics.api_jsonplaceholder.{source_type}",
                "format": "iceberg",
                "location": str(iceberg_table.location())
            },
            "message": f"Data loaded to Bronze (Parquet) and Gold (Iceberg) layers",
            "timestamp": now.isoformat()
        }

        return Response.new(
            json.dumps(result, indent=2),
            headers=Headers.new(cors_headers)
        )

    except Exception as e:
        error_response = {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__,
            "message": "Pipeline execution failed"
        }

        return Response.new(
            json.dumps(error_response, indent=2),
            status=500,
            headers=Headers.new(cors_headers)
        )
```

## コード解説

### 1. dlt Resource（データ抽出）

`@dlt.resource`デコレータでデータソースを定義:

```python
@dlt.resource(name="posts", write_disposition="replace")
def get_posts() -> Iterator[Dict[str, Any]]:
    # yield でストリーミング的にデータを返す
    for item in data:
        yield item
```

**write_disposition オプション:**
- `replace`: テーブル全体を置換
- `append`: 既存データに追加
- `merge`: マージ（主キー指定時）

### 2. dlt Pipeline（データロード）

```python
pipeline = dlt.pipeline(
    pipeline_name="workers_etl_pipeline",
    destination=dlt.destinations.filesystem(
        bucket_url=f"s3://{r2_bucket_name}",
        credentials={...},
        layout="{table_name}/year={year}/month={month}/day={day}/{load_id}.{file_id}.{ext}"
    ),
    dataset_name="sources/api_jsonplaceholder"
)
```

### 3. Hiveパーティション構造

```
s3://{bucket}/sources/{source_name}/{table_name}/
  └── year=2026/
      └── month=01/
          └── day=11/
              └── {load_id}.{file_id}.parquet
```

### 4. R2接続設定

R2はS3互換なので、dltのfilesystemデスティネーションを使用:

```python
credentials={
    "aws_access_key_id": r2_access_key,
    "aws_secret_access_key": r2_secret_key,
    "endpoint_url": f"https://{account_id}.r2.cloudflarestorage.com",
    "region_name": "auto"
}
```

### 5. PyIceberg連携

R2 Data Catalogを使用したIcebergテーブル作成:

```python
catalog = load_catalog(
    "r2_catalog",
    type="rest",
    uri=f"https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{bucket}/catalog",
    credential=api_token,
    warehouse=f"s3://{bucket}"
)
```

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `R2_ACCESS_KEY_ID` | Yes | R2 APIトークンのアクセスキーID |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 APIトークンのシークレットキー |
| `R2_ACCOUNT_ID` | Yes | CloudflareアカウントID |
| `R2_BUCKET_NAME` | Yes | R2バケット名（基本パイプライン） |
| `R2_BUCKET_RAW` | Yes* | Raw Layerバケット名（Iceberg統合） |
| `R2_BUCKET_CURATED` | Yes* | Curated Layerバケット名（Iceberg統合） |
| `CLOUDFLARE_API_TOKEN` | Yes* | R2 Data Catalog APIトークン（Iceberg統合） |
| `API_KEY` | No | カスタムAPI認証キー |
| `ACCESS_CONTROL_ALLOW_ORIGIN` | No | CORSオリジン（デフォルト: `*`） |

## 開発方針

### データレイヤー設計

```
Bronze Layer (data-lake-raw)
    - 生データをそのまま保存
    - Parquet形式
    - Hiveパーティション

Silver Layer (data-lake-staging)
    - クレンジング・型変換済みデータ
    - dbt変換後

Gold Layer (data-lake-curated)
    - ビジネスロジック適用済み
    - Icebergテーブル形式
    - ACIDトランザクション対応
```

### エラーハンドリング

1. **環境変数チェック**: 必須変数の存在確認
2. **API呼び出し**: try/except でエラーキャッチ
3. **レスポンス**: 成功/失敗を明確なJSON形式で返却

### Workers制約への対応

1. **CPU時間**: 大量データは分割処理を検討
2. **メモリ**: ストリーミング（`yield`）で省メモリ化
3. **タイムアウト**: 長時間処理はQueuesに委譲

## 使用方法

### HTTPリクエスト

```bash
# postsデータを取得・保存
curl https://your-worker.workers.dev/

# usersデータを取得・保存
curl https://your-worker.workers.dev/?source=users

# カスタムAPIソース
curl "https://your-worker.workers.dev/?source=custom&endpoint=https://api.example.com/data"
```

### レスポンス例

```json
{
  "success": true,
  "pipeline_name": "workers_etl_pipeline",
  "dataset_name": "sources/api_jsonplaceholder",
  "bucket": "data-lake-raw",
  "path_structure": "s3://data-lake-raw/sources/api_jsonplaceholder/posts/year=2026/month=01/day=11/",
  "message": "Successfully loaded data from posts to Bronze Layer (data-lake-raw)",
  "timestamp": "1736582400.0"
}
```

## 依存関係

```
dlt[parquet,filesystem]>=0.5.0
pyiceberg>=0.7.0  # Iceberg統合の場合
```

---

最終更新: 2026-01-11
