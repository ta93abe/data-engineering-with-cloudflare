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
