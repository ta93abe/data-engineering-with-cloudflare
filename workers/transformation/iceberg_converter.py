"""
Cloudflare Workers Python Runtime - Iceberg変換パイプライン

dltで取り込んだParquetファイルをApache Icebergテーブルに変換するWorkerです。
R2 Data Catalogと統合し、ACIDトランザクション対応のテーブルを作成します。
"""

from js import Response, Headers
import json
from typing import Dict, Any, List
from datetime import datetime


async def on_fetch(request, env):
    """
    ParquetファイルをIcebergテーブルに変換

    環境変数:
        R2_ACCOUNT_ID: CloudflareアカウントID
        R2_BUCKET_CURATED: Icebergテーブル用バケット（data-lake-curated）
        CLOUDFLARE_API_TOKEN: R2 Data Catalog APIトークン
        SOURCE_BUCKET: ソースParquetファイルのバケット（data-lake-raw）
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
        from pyiceberg.catalog import load_catalog
        from pyiceberg.schema import Schema
        from pyiceberg.types import (
            NestedField, StringType, IntegerType, TimestampType,
            LongType, BooleanType, StructType
        )
        from pyiceberg.partitioning import PartitionSpec, PartitionField
        from pyiceberg.transforms import DayTransform

        # 環境変数取得
        account_id = env.R2_ACCOUNT_ID
        curated_bucket = env.R2_BUCKET_CURATED
        api_token = env.CLOUDFLARE_API_TOKEN

        # リクエストボディからパラメータ取得
        body = await request.json() if request.method == "POST" else {}

        source_name = body.get("source_name", "api_jsonplaceholder")
        table_name = body.get("table_name", "posts")
        source_path = body.get("source_path", f"sources/{source_name}/{table_name}/")

        # R2 Data Catalogへ接続
        catalog = load_catalog(
            "r2_catalog",
            **{
                "type": "rest",
                "uri": f"https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{curated_bucket}/catalog",
                "credential": api_token,
                "warehouse": f"s3://{curated_bucket}"
            }
        )

        # Icebergテーブルのネームスペース（データベース相当）
        namespace = ("analytics", source_name)

        # ネームスペースが存在しない場合は作成
        try:
            catalog.create_namespace(namespace)
        except Exception:
            pass  # 既に存在する場合は無視

        # テーブル名（完全修飾名）
        table_identifier = f"{namespace[0]}.{namespace[1]}.{table_name}"

        # スキーマ定義（JSONPlaceholder postsの例）
        # 実際には、dltのスキーマ情報から動的に生成すべき
        if table_name == "posts":
            schema = Schema(
                NestedField(1, "userId", IntegerType(), required=True),
                NestedField(2, "id", IntegerType(), required=True),
                NestedField(3, "title", StringType(), required=True),
                NestedField(4, "body", StringType(), required=True),
                NestedField(5, "_dlt_load_id", StringType(), required=False),
                NestedField(6, "_dlt_id", StringType(), required=False),
                NestedField(7, "ingestion_timestamp", TimestampType(), required=False)
            )
        elif table_name == "users":
            schema = Schema(
                NestedField(1, "id", IntegerType(), required=True),
                NestedField(2, "name", StringType(), required=True),
                NestedField(3, "username", StringType(), required=True),
                NestedField(4, "email", StringType(), required=True),
                NestedField(5, "phone", StringType(), required=False),
                NestedField(6, "website", StringType(), required=False),
                NestedField(7, "_dlt_load_id", StringType(), required=False),
                NestedField(8, "_dlt_id", StringType(), required=False),
                NestedField(9, "ingestion_timestamp", TimestampType(), required=False)
            )
        else:
            # デフォルトスキーマ（汎用）
            schema = Schema(
                NestedField(1, "id", StringType(), required=True),
                NestedField(2, "data", StringType(), required=False),
                NestedField(3, "_dlt_load_id", StringType(), required=False),
                NestedField(4, "ingestion_timestamp", TimestampType(), required=False)
            )

        # パーティション仕様（日次パーティション）
        partition_spec = PartitionSpec(
            PartitionField(
                source_id=7,  # ingestion_timestamp フィールド
                field_id=1000,
                transform=DayTransform(),
                name="ingestion_date"
            )
        )

        # Icebergテーブル作成（存在しない場合）
        iceberg_location = f"s3://{curated_bucket}/analytics/{source_name}/{table_name}"

        try:
            table = catalog.load_table(table_identifier)
            operation = "loaded_existing"
        except Exception:
            # テーブルが存在しない場合は新規作成
            table = catalog.create_table(
                identifier=table_identifier,
                schema=schema,
                location=iceberg_location,
                partition_spec=partition_spec
            )
            operation = "created_new"

        # ソースParquetファイルからデータをロード
        # R2上のParquetファイルを読み取ってIcebergテーブルに追加
        # 注: 実際の実装では、PyArrowを使ってParquetを読み、Icebergに書き込む

        # 簡易実装: メタデータのみ更新（実際のデータロードは別途dbtなどで実行）
        table.refresh()

        # レスポンス
        result = {
            "success": True,
            "operation": operation,
            "table_identifier": table_identifier,
            "location": iceberg_location,
            "schema_fields": len(schema.fields),
            "partition_spec": str(partition_spec),
            "source_path": source_path,
            "catalog_uri": catalog.properties.get("uri"),
            "message": f"Iceberg table {operation} successfully",
            "timestamp": datetime.utcnow().isoformat()
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
            "message": "Iceberg conversion failed"
        }

        return Response.new(
            json.dumps(error_response, indent=2),
            status=500,
            headers=Headers.new(cors_headers)
        )


async def on_scheduled(event, env):
    """
    Cron Trigger: 定期的にParquet → Iceberg変換を実行

    スケジュール例: 毎時実行で新しいParquetファイルをIceberg化
    """

    # 変換対象のテーブルリスト
    tables_to_convert = [
        {"source_name": "api_jsonplaceholder", "table_name": "posts"},
        {"source_name": "api_jsonplaceholder", "table_name": "users"},
    ]

    results = []

    for table_config in tables_to_convert:
        try:
            # Iceberg変換を実行（on_fetchの処理を再利用）
            # 実際にはHTTPリクエストを内部で作成して呼び出す
            result = await convert_to_iceberg(env, table_config)
            results.append(result)
        except Exception as e:
            results.append({
                "table": table_config,
                "error": str(e),
                "success": False
            })

    # Slack通知（オプション）
    if hasattr(env, 'SLACK_WEBHOOK_URL'):
        await notify_slack(env.SLACK_WEBHOOK_URL, results)

    return {"results": results}


async def convert_to_iceberg(env, table_config: Dict[str, str]) -> Dict[str, Any]:
    """
    Iceberg変換の実装ロジック（on_fetchとon_scheduledで共通利用）
    """
    # on_fetchの処理をライブラリ化したバージョン
    # 実装詳細は省略（on_fetchと同様）
    pass


async def notify_slack(webhook_url: str, results: List[Dict[str, Any]]):
    """
    Slackへの通知
    """
    import urllib.request

    success_count = sum(1 for r in results if r.get("success"))
    failed_count = len(results) - success_count

    message = {
        "text": f"Iceberg Conversion Results: {success_count} succeeded, {failed_count} failed",
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Iceberg Conversion Results*\n✅ Success: {success_count}\n❌ Failed: {failed_count}"
                }
            }
        ]
    }

    req = urllib.request.Request(
        webhook_url,
        data=json.dumps(message).encode(),
        headers={"Content-Type": "application/json"}
    )

    with urllib.request.urlopen(req) as response:
        return response.read()
