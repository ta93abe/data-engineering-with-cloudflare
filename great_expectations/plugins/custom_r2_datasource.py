"""
Custom R2 Datasource for Great Expectations

This plugin provides a custom datasource that reads Parquet files
directly from Cloudflare R2 using DuckDB.
"""

import os
from typing import Dict, Any, Optional
import duckdb
from great_expectations.datasource import Datasource
from great_expectations.execution_engine import SqlAlchemyExecutionEngine


class R2DuckDBDatasource:
    """
    Custom datasource for reading Parquet files from Cloudflare R2 using DuckDB
    """

    @staticmethod
    def get_connection(
        r2_endpoint: str,
        r2_access_key_id: str,
        r2_secret_access_key: str,
        database: str = ":memory:"
    ) -> duckdb.DuckDBPyConnection:
        """
        Create a DuckDB connection configured for R2 access

        Args:
            r2_endpoint: R2 endpoint URL
            r2_access_key_id: R2 access key ID
            r2_secret_access_key: R2 secret access key
            database: DuckDB database path (default: in-memory)

        Returns:
            DuckDB connection object
        """
        conn = duckdb.connect(database=database)

        # Install and load required extensions
        conn.execute("INSTALL httpfs;")
        conn.execute("LOAD httpfs;")
        conn.execute("INSTALL parquet;")
        conn.execute("LOAD parquet;")

        # Configure S3 (R2) settings
        conn.execute(f"SET s3_endpoint='{r2_endpoint}';")
        conn.execute(f"SET s3_access_key_id='{r2_access_key_id}';")
        conn.execute(f"SET s3_secret_access_key='{r2_secret_access_key}';")
        conn.execute("SET s3_region='auto';")

        return conn

    @staticmethod
    def read_parquet_from_r2(
        conn: duckdb.DuckDBPyConnection,
        bucket: str,
        path: str
    ) -> duckdb.DuckDBPyRelation:
        """
        Read Parquet file(s) from R2

        Args:
            conn: DuckDB connection
            bucket: R2 bucket name
            path: Path to Parquet file(s) (supports wildcards)

        Returns:
            DuckDB relation (query result)
        """
        s3_path = f"s3://{bucket}/{path}"
        return conn.execute(f"SELECT * FROM read_parquet('{s3_path}')").fetchdf()


def get_r2_datasource_config(
    datasource_name: str,
    r2_bucket: str,
    base_path: str = "",
    r2_endpoint: Optional[str] = None,
    r2_access_key_id: Optional[str] = None,
    r2_secret_access_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generate Great Expectations datasource configuration for R2

    Args:
        datasource_name: Name for the datasource
        r2_bucket: R2 bucket name
        base_path: Base path within the bucket
        r2_endpoint: R2 endpoint (defaults to env var)
        r2_access_key_id: R2 access key ID (defaults to env var)
        r2_secret_access_key: R2 secret access key (defaults to env var)

    Returns:
        Datasource configuration dictionary
    """
    r2_endpoint = r2_endpoint or os.getenv("R2_ENDPOINT")
    r2_access_key_id = r2_access_key_id or os.getenv("R2_ACCESS_KEY_ID")
    r2_secret_access_key = r2_secret_access_key or os.getenv("R2_SECRET_ACCESS_KEY")

    return {
        "name": datasource_name,
        "class_name": "Datasource",
        "execution_engine": {
            "class_name": "SqlAlchemyExecutionEngine",
            "connection_string": "duckdb:///:memory:",
        },
        "data_connectors": {
            "default_runtime_data_connector": {
                "class_name": "RuntimeDataConnector",
                "batch_identifiers": ["batch_id"],
            },
        },
    }
