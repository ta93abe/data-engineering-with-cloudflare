#!/usr/bin/env python3
"""
R2 Iceberg + R2 SQL ミニマムデモ

R2 Data Catalog上にIcebergテーブルを作成し、サンプルデータを投入するスクリプト。
R2 SQLでクエリを実行するための最小限の環境を構築します。

環境変数:
    CLOUDFLARE_ACCOUNT_ID: CloudflareアカウントID
    R2_BUCKET_NAME: R2バケット名（Data Catalog有効化済み）
    CLOUDFLARE_API_TOKEN: R2 Admin Read & Write権限を持つAPIトークン

使用方法:
    # テーブル作成 & サンプルデータ投入
    python scripts/r2_iceberg_demo.py create

    # データ追加
    python scripts/r2_iceberg_demo.py append

    # テーブル一覧表示
    python scripts/r2_iceberg_demo.py list

    # テーブル内容をローカルで確認
    python scripts/r2_iceberg_demo.py scan

R2 SQLでのクエリ:
    npx wrangler r2 sql query "<WAREHOUSE>" "SELECT * FROM default.events"
"""

import argparse
import os
import sys
from datetime import datetime, timezone

import pyarrow as pa
from pyiceberg.catalog import load_catalog


def get_env_or_exit(name: str) -> str:
    """環境変数を取得、未設定の場合は終了"""
    value = os.environ.get(name)
    if not value:
        print(f"Error: 環境変数 {name} が設定されていません")
        sys.exit(1)
    return value


def get_catalog():
    """R2 Data Catalogに接続"""
    account_id = get_env_or_exit("CLOUDFLARE_ACCOUNT_ID")
    bucket = get_env_or_exit("R2_BUCKET_NAME")
    token = get_env_or_exit("CLOUDFLARE_API_TOKEN")

    # R2 Data Catalog REST endpoint
    catalog_uri = f"https://{account_id}.r2.cloudflarestorage.com/{bucket}/catalog"

    catalog = load_catalog(
        "r2_catalog",
        **{
            "type": "rest",
            "uri": catalog_uri,
            "warehouse": bucket,
            "token": token,
        }
    )
    return catalog


def create_table():
    """eventsテーブルを作成し、サンプルデータを投入"""
    catalog = get_catalog()

    # namespaceを作成（存在しない場合）
    try:
        catalog.create_namespace("default")
        print("✓ namespace 'default' を作成しました")
    except Exception:
        print("- namespace 'default' は既に存在します")

    # PyArrowスキーマ定義
    schema = pa.schema([
        pa.field("id", pa.int64(), nullable=False),
        pa.field("event_type", pa.string(), nullable=False),
        pa.field("user_id", pa.int64(), nullable=False),
        pa.field("amount", pa.float64(), nullable=True),
        pa.field("created_at", pa.timestamp("us", tz="UTC"), nullable=False),
    ])

    table_id = ("default", "events")

    # テーブル作成
    try:
        table = catalog.create_table(
            identifier=table_id,
            schema=schema,
        )
        print(f"✓ テーブル 'default.events' を作成しました")
    except Exception as e:
        if "already exists" in str(e).lower():
            table = catalog.load_table(table_id)
            print("- テーブル 'default.events' は既に存在します")
        else:
            raise

    # サンプルデータ
    now = datetime.now(timezone.utc)
    sample_data = pa.Table.from_pylist(
        [
            {"id": 1, "event_type": "page_view", "user_id": 101, "amount": None, "created_at": now},
            {"id": 2, "event_type": "purchase", "user_id": 102, "amount": 29.99, "created_at": now},
            {"id": 3, "event_type": "signup", "user_id": 103, "amount": None, "created_at": now},
            {"id": 4, "event_type": "purchase", "user_id": 101, "amount": 59.99, "created_at": now},
            {"id": 5, "event_type": "page_view", "user_id": 104, "amount": None, "created_at": now},
        ],
        schema=table.schema().as_arrow(),
    )

    # データ投入
    table.append(sample_data)
    print(f"✓ {len(sample_data)} 件のサンプルデータを投入しました")

    # R2 SQL クエリのヒント
    bucket = os.environ.get("R2_BUCKET_NAME", "<BUCKET>")
    print(f"\n📝 R2 SQLでクエリを実行:")
    print(f'   npx wrangler r2 sql query "{bucket}" "SELECT * FROM default.events"')


def append_data():
    """追加のサンプルデータを投入"""
    catalog = get_catalog()
    table = catalog.load_table(("default", "events"))

    now = datetime.now(timezone.utc)
    new_data = pa.Table.from_pylist(
        [
            {"id": 100, "event_type": "login", "user_id": 105, "amount": None, "created_at": now},
            {"id": 101, "event_type": "purchase", "user_id": 105, "amount": 149.99, "created_at": now},
        ],
        schema=table.schema().as_arrow(),
    )

    table.append(new_data)
    print(f"✓ {len(new_data)} 件のデータを追加しました")


def list_tables():
    """テーブル一覧を表示"""
    catalog = get_catalog()

    print("=== Namespaces ===")
    namespaces = catalog.list_namespaces()
    for ns in namespaces:
        print(f"  - {'.'.join(ns)}")

    print("\n=== Tables ===")
    for ns in namespaces:
        tables = catalog.list_tables(ns)
        for tbl in tables:
            print(f"  - {'.'.join(tbl)}")


def scan_table():
    """テーブル内容をローカルでスキャン"""
    catalog = get_catalog()
    table = catalog.load_table(("default", "events"))

    print("=== Table Schema ===")
    print(table.schema())

    print("\n=== Table Data ===")
    df = table.scan().to_pandas()
    print(df.to_string())

    print(f"\n合計: {len(df)} 件")


def main():
    parser = argparse.ArgumentParser(
        description="R2 Iceberg + R2 SQL ミニマムデモ",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用例:
  python scripts/r2_iceberg_demo.py create   # テーブル作成 & サンプルデータ投入
  python scripts/r2_iceberg_demo.py append   # データ追加
  python scripts/r2_iceberg_demo.py list     # テーブル一覧
  python scripts/r2_iceberg_demo.py scan     # テーブル内容確認

環境変数:
  CLOUDFLARE_ACCOUNT_ID   CloudflareアカウントID
  R2_BUCKET_NAME          R2バケット名
  CLOUDFLARE_API_TOKEN    APIトークン（Admin Read & Write権限）
        """
    )
    parser.add_argument(
        "command",
        choices=["create", "append", "list", "scan"],
        help="実行するコマンド"
    )
    args = parser.parse_args()

    if args.command == "create":
        create_table()
    elif args.command == "append":
        append_data()
    elif args.command == "list":
        list_tables()
    elif args.command == "scan":
        scan_table()


if __name__ == "__main__":
    main()
