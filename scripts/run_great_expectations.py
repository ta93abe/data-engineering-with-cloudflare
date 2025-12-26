#!/usr/bin/env python3
"""
Great Expectations Runner for Cloudflare Data Platform

This script runs Great Expectations validations on data stored in R2.
It uses DuckDB to read Parquet files directly from R2.
"""

import os
import sys
from pathlib import Path
import duckdb
import great_expectations as gx
from great_expectations.core.batch import RuntimeBatchRequest
from great_expectations.checkpoint import Checkpoint


def setup_r2_connection() -> duckdb.DuckDBPyConnection:
    """Setup DuckDB connection with R2 credentials"""
    r2_endpoint = os.getenv("R2_ENDPOINT")
    r2_access_key_id = os.getenv("R2_ACCESS_KEY_ID")
    r2_secret_access_key = os.getenv("R2_SECRET_ACCESS_KEY")

    if not all([r2_endpoint, r2_access_key_id, r2_secret_access_key]):
        raise ValueError("Missing required R2 environment variables")

    conn = duckdb.connect(database=":memory:")

    # Install and load extensions
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


def validate_dataset(
    context: gx.DataContext,
    datasource_name: str,
    data_asset_name: str,
    expectation_suite_name: str,
    batch_data: str
) -> gx.ValidationResultIdentifier:
    """
    Validate a dataset using Great Expectations

    Args:
        context: Great Expectations context
        datasource_name: Name of the datasource
        data_asset_name: Name of the data asset
        expectation_suite_name: Name of the expectation suite
        batch_data: Path to the data file in R2

    Returns:
        Validation result identifier
    """
    # Create runtime batch request
    batch_request = RuntimeBatchRequest(
        datasource_name=datasource_name,
        data_connector_name="default_runtime_data_connector",
        data_asset_name=data_asset_name,
        runtime_parameters={"query": f"SELECT * FROM read_parquet('{batch_data}')"},
        batch_identifiers={"batch_id": data_asset_name},
    )

    # Get validator
    validator = context.get_validator(
        batch_request=batch_request,
        expectation_suite_name=expectation_suite_name,
    )

    # Run validation
    results = validator.validate()

    return results


def run_checkpoint(context: gx.DataContext, checkpoint_name: str) -> dict:
    """
    Run a Great Expectations checkpoint

    Args:
        context: Great Expectations context
        checkpoint_name: Name of the checkpoint to run

    Returns:
        Checkpoint run results
    """
    checkpoint = context.get_checkpoint(checkpoint_name)
    results = checkpoint.run()

    return results


def generate_data_docs(context: gx.DataContext):
    """Generate Data Docs (HTML reports)"""
    context.build_data_docs()
    print("✅ Data Docs generated successfully")


def main():
    """Main execution function"""
    print("🚀 Starting Great Expectations validation...")

    # Get Great Expectations context
    gx_dir = Path(__file__).parent.parent / "great_expectations"
    context = gx.get_context(context_root_dir=str(gx_dir))

    print(f"📁 Great Expectations directory: {gx_dir}")
    print(f"📊 Available datasources: {list(context.list_datasources())}")

    # Setup R2 connection
    print("🔗 Setting up R2 connection...")
    conn = setup_r2_connection()
    print("✅ R2 connection established")

    # Example: Validate posts data
    r2_bucket = os.getenv("R2_BUCKET_NAME", "data-lake-raw")
    posts_path = f"s3://{r2_bucket}/sources/api_jsonplaceholder/posts/**/*.parquet"

    print(f"🔍 Validating posts data from: {posts_path}")

    try:
        # Run checkpoint
        checkpoint_name = "daily_data_quality_checkpoint"
        print(f"📋 Running checkpoint: {checkpoint_name}")

        results = run_checkpoint(context, checkpoint_name)

        # Check results
        if results["success"]:
            print("✅ All validations passed!")
        else:
            print("❌ Some validations failed!")
            print(f"   Results: {results}")
            sys.exit(1)

        # Generate Data Docs
        print("📚 Generating Data Docs...")
        generate_data_docs(context)

        # Print Data Docs location
        data_docs_path = gx_dir / "uncommitted" / "data_docs" / "local_site" / "index.html"
        print(f"📄 Data Docs available at: {data_docs_path}")

    except Exception as e:
        print(f"❌ Error during validation: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    finally:
        conn.close()

    print("🎉 Great Expectations validation completed!")


if __name__ == "__main__":
    main()
