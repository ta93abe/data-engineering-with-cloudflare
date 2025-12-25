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
    cors_headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
    }

    # OPTIONSリクエスト（CORS preflight）への対応
    if request.method == "OPTIONS":
        return Response.new("", headers=Headers.new(cors_headers))

    try:
        # 環境変数から設定を取得
        r2_access_key = env.R2_ACCESS_KEY_ID
        r2_secret_key = env.R2_SECRET_ACCESS_KEY
        r2_account_id = env.R2_ACCOUNT_ID
        r2_bucket_name = env.R2_BUCKET_NAME

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
