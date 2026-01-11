# データ品質監視実装ガイド

Great ExpectationsとmarimoによるR2データのデータ品質監視システムの実装です。

## 概要

- **データ検証**: Great Expectations
- **可視化**: marimo（リアクティブPythonノートブック）
- **データアクセス**: DuckDB経由でR2上のParquetを直接クエリ
- **レポート出力**: HTML（Cloudflare Pagesにデプロイ可能）

## アーキテクチャ

```text
┌─────────────────────────────────────────────────────────┐
│                    R2 Storage                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │  data-lake-raw (Bronze Layer)                   │   │
│  │  └── Parquet files                              │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           │ DuckDB + httpfs
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Great Expectations                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Expectations (Validation Rules)                │   │
│  │  - Column nullability                          │   │
│  │  - Value ranges                                │   │
│  │  - Uniqueness                                  │   │
│  │  - Regex patterns                              │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Checkpoints (Scheduled Validations)            │   │
│  │  - Daily data quality check                    │   │
│  │  - Actions: Store results, Update docs, Notify │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           │ Validation Results
                           ▼
┌─────────────────────────────────────────────────────────┐
│              marimo Dashboard                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Interactive Visualizations                     │   │
│  │  - Quality score cards                         │   │
│  │  - Trend charts                                │   │
│  │  - Anomaly detection                           │   │
│  │  - Recommendations                             │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   Cloudflare Pages     │
              │   (Data Docs / Dashboard) │
              └────────────────────────┘
```

## 実装コード

### ディレクトリ構造

```text
great_expectations/
├── great_expectations.yml           # メイン設定ファイル
├── checkpoints/
│   └── daily_data_quality_checkpoint.yml
├── expectations/                    # Expectation Suites（要作成）
├── plugins/
│   ├── __init__.py
│   └── custom_r2_datasource.py      # R2用カスタムデータソース
├── profilers/
└── uncommitted/
    ├── config_variables.yml
    ├── data_docs/
    └── validations/

marimo/
└── notebooks/
    └── data_quality_dashboard.py    # 品質ダッシュボード
```

---

## Great Expectations

### great_expectations.yml

Great Expectationsのメイン設定ファイル。

```yaml
# Great Expectations Configuration for Cloudflare Data Platform
# See: https://docs.greatexpectations.io/docs/guides/setup/configuring_data_contexts/

config_version: 3.0

# Datasources: R2 via DuckDB
datasources:
  r2_bronze:
    class_name: Datasource
    module_name: great_expectations.datasource
    execution_engine:
      class_name: SqlAlchemyExecutionEngine
      module_name: great_expectations.execution_engine
      connection_string: duckdb:///:memory:
      # DuckDB初期化SQL（R2接続設定）
      create_temp_table: false
    data_connectors:
      r2_parquet_connector:
        class_name: InferredAssetFilesystemDataConnector
        module_name: great_expectations.datasource.data_connector
        base_directory: /tmp/gx_data/bronze/
        default_regex:
          group_names:
            - source_name
            - table_name
          pattern: (.+)/(.+)\.parquet

  r2_silver:
    class_name: Datasource
    module_name: great_expectations.datasource
    execution_engine:
      class_name: SqlAlchemyExecutionEngine
      module_name: great_expectations.execution_engine
      connection_string: duckdb:///:memory:
    data_connectors:
      r2_parquet_connector:
        class_name: InferredAssetFilesystemDataConnector
        module_name: great_expectations.datasource.data_connector
        base_directory: /tmp/gx_data/silver/
        default_regex:
          group_names:
            - table_name
          pattern: (.+)\.parquet

# Data Docs（HTMLレポート）の設定
data_docs_sites:
  local_site:
    class_name: SiteBuilder
    store_backend:
      class_name: TupleFilesystemStoreBackend
      base_directory: uncommitted/data_docs/local_site/
    site_index_builder:
      class_name: DefaultSiteIndexBuilder

  cloudflare_pages_site:
    class_name: SiteBuilder
    store_backend:
      class_name: TupleFilesystemStoreBackend
      base_directory: uncommitted/data_docs/cloudflare_pages/
    site_index_builder:
      class_name: DefaultSiteIndexBuilder
      show_cta_footer: true

# ストア設定
stores:
  expectations_store:
    class_name: ExpectationsStore
    store_backend:
      class_name: TupleFilesystemStoreBackend
      base_directory: expectations/

  validations_store:
    class_name: ValidationsStore
    store_backend:
      class_name: TupleFilesystemStoreBackend
      base_directory: uncommitted/validations/

  evaluation_parameter_store:
    class_name: EvaluationParameterStore

  checkpoint_store:
    class_name: CheckpointStore
    store_backend:
      class_name: TupleFilesystemStoreBackend
      base_directory: checkpoints/

  profiler_store:
    class_name: ProfilerStore
    store_backend:
      class_name: TupleFilesystemStoreBackend
      base_directory: profilers/

expectations_store_name: expectations_store
validations_store_name: validations_store
evaluation_parameter_store_name: evaluation_parameter_store
checkpoint_store_name: checkpoint_store

# Data Context設定
config_variables_file_path: uncommitted/config_variables.yml

# プラグイン設定
plugins_directory: plugins/

# 匿名使用統計の無効化
anonymous_usage_statistics:
  enabled: false
  data_context_id: cloudflare-data-platform
```

### カスタムR2データソース: plugins/custom_r2_datasource.py

DuckDBを使用してR2上のParquetファイルを直接読み込むカスタムデータソース。

```python
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
```

### Checkpoint設定: checkpoints/daily_data_quality_checkpoint.yml

日次データ品質チェックのCheckpoint定義。

```yaml
# Daily Data Quality Checkpoint
# This checkpoint validates all critical datasets

name: daily_data_quality_checkpoint
config_version: 1.0

class_name: Checkpoint

# Validation configurations
validations:
  - batch_request:
      datasource_name: r2_bronze
      data_connector_name: r2_parquet_connector
      data_asset_name: api_posts
    expectation_suite_name: api_posts_suite

  - batch_request:
      datasource_name: r2_bronze
      data_connector_name: r2_parquet_connector
      data_asset_name: api_users
    expectation_suite_name: api_users_suite

# Actions to take after validation
action_list:
  - name: store_validation_result
    action:
      class_name: StoreValidationResultAction

  - name: store_evaluation_params
    action:
      class_name: StoreEvaluationParametersAction

  - name: update_data_docs
    action:
      class_name: UpdateDataDocsAction
      site_names:
        - local_site
        - cloudflare_pages_site

  # Slack notification (optional)
  - name: send_slack_notification_on_validation_result
    action:
      class_name: SlackNotificationAction
      slack_webhook: ${slack_webhook_url}
      notify_on: failure
      renderer:
        module_name: great_expectations.render.renderer.slack_renderer
        class_name: SlackRenderer

# Runtime configuration
runtime_configuration:
  result_format:
    result_format: COMPLETE
    include_unexpected_rows: true
```

---

## marimo Dashboard

### data_quality_dashboard.py

marimoによるインタラクティブなデータ品質ダッシュボード。

```python
import marimo

__generated_with = "0.9.14"
app = marimo.App(width="full")


@app.cell
def __():
    import marimo as mo
    import duckdb
    import pandas as pd
    import plotly.express as px
    import plotly.graph_objects as go
    from datetime import datetime, timedelta
    import os
    import sys

    # Add great_expectations to path
    sys.path.append(os.path.join(os.path.dirname(__file__), '../..'))

    return datetime, duckdb, go, mo, os, pd, px, sys, timedelta


@app.cell
def __(mo):
    mo.md(
        """
        # Data Quality Dashboard

        Real-time data quality monitoring for Cloudflare R2 data.

        This dashboard integrates:
        - Great Expectations validation results
        - Elementary monitoring data
        - Custom quality metrics
        """
    )
    return


@app.cell
def __(mo):
    mo.md("## Configuration")
    return


@app.cell
def __(datetime, mo, timedelta):
    # Time range selector
    time_ranges = {
        "Last 24 hours": timedelta(days=1),
        "Last 7 days": timedelta(days=7),
        "Last 30 days": timedelta(days=30)
    }

    time_range = mo.ui.dropdown(
        options=list(time_ranges.keys()),
        value="Last 7 days",
        label="Time Range"
    )

    # Dataset selector
    datasets = mo.ui.dropdown(
        options=["All Datasets", "api_posts", "api_users"],
        value="All Datasets",
        label="Dataset"
    )

    mo.hstack([time_range, datasets])
    return datasets, time_range, time_ranges


@app.cell
def __(mo):
    mo.md(
        """
        ## Data Quality Overview

        Key metrics across all datasets:
        """
    )
    return


@app.cell
def __(datasets, mo, pd):
    # Mock data quality metrics
    # In production, this would query Great Expectations results from R2/D1

    quality_summary = pd.DataFrame({
        'Metric': [
            'Total Validations',
            'Passed',
            'Failed',
            'Success Rate',
            'Datasets Monitored',
            'Last Check'
        ],
        'Value': [
            '245',
            '238',
            '7',
            '97.1%',
            '2' if datasets.value == "All Datasets" else '1',
            '2 hours ago'
        ]
    })

    # Display as cards
    mo.hstack([
        mo.stat(
            value="97.1%",
            label="Success Rate",
            caption="238/245 validations passed",
            bordered=True
        ),
        mo.stat(
            value="7",
            label="Failed Checks",
            caption="Requires attention",
            bordered=True
        ),
        mo.stat(
            value="2",
            label="Active Datasets",
            caption="Currently monitored",
            bordered=True
        )
    ])
    return (quality_summary,)


@app.cell
def __(mo):
    mo.md("### Validation Trend")
    return


@app.cell
def __(datetime, go, mo, pd, timedelta):
    # Mock validation trend data
    dates = pd.date_range(
        end=datetime.now(),
        periods=30,
        freq='D'
    )

    trend_data = pd.DataFrame({
        'date': dates,
        'passed': [235 + (i % 10) for i in range(30)],
        'failed': [10 - (i % 10) for i in range(30)]
    })

    fig = go.Figure()

    fig.add_trace(go.Scatter(
        x=trend_data['date'],
        y=trend_data['passed'],
        name='Passed',
        fill='tozeroy',
        line=dict(color='green')
    ))

    fig.add_trace(go.Scatter(
        x=trend_data['date'],
        y=trend_data['failed'],
        name='Failed',
        fill='tozeroy',
        line=dict(color='red')
    ))

    fig.update_layout(
        title='Validation Results Over Time',
        xaxis_title='Date',
        yaxis_title='Number of Validations',
        hovermode='x unified'
    )

    mo.ui.plotly(fig)
    return dates, fig, trend_data


@app.cell
def __(mo):
    mo.md(
        """
        ## Failed Validations

        Recent validation failures:
        """
    )
    return


@app.cell
def __(datetime, pd):
    # Mock failed validations
    failed_validations = pd.DataFrame({
        'Timestamp': [
            datetime.now() - timedelta(hours=2),
            datetime.now() - timedelta(hours=5),
            datetime.now() - timedelta(hours=8),
            datetime.now() - timedelta(days=1),
            datetime.now() - timedelta(days=1, hours=3),
            datetime.now() - timedelta(days=2),
            datetime.now() - timedelta(days=2, hours=6)
        ],
        'Dataset': ['api_posts', 'api_users', 'api_posts', 'api_users', 'api_posts', 'api_users', 'api_posts'],
        'Expectation': [
            'expect_column_values_to_not_be_null',
            'expect_column_values_to_be_unique',
            'expect_column_value_lengths_to_be_between',
            'expect_column_values_to_match_regex',
            'expect_table_row_count_to_be_between',
            'expect_column_values_to_not_be_null',
            'expect_column_values_to_be_unique'
        ],
        'Column': ['body', 'email', 'title', 'phone', None, 'username', 'post_id'],
        'Severity': ['High', 'Critical', 'Medium', 'Low', 'High', 'Critical', 'Critical']
    })

    # Format timestamp
    failed_validations['Timestamp'] = failed_validations['Timestamp'].dt.strftime('%Y-%m-%d %H:%M')

    failed_validations
    return (failed_validations,)


@app.cell
def __(mo):
    mo.md("### Failures by Dataset")
    return


@app.cell
def __(failed_validations, mo, px):
    fig = px.pie(
        failed_validations,
        names='Dataset',
        title='Failed Validations by Dataset'
    )

    mo.ui.plotly(fig)
    return (fig,)


@app.cell
def __(mo):
    mo.md(
        """
        ## Data Quality Score by Dataset

        Overall quality score (0-100):
        """
    )
    return


@app.cell
def __(go, mo, pd):
    # Mock quality scores
    quality_scores = pd.DataFrame({
        'Dataset': ['api_posts', 'api_users'],
        'Quality Score': [95, 98],
        'Completeness': [98, 99],
        'Validity': [92, 97],
        'Consistency': [95, 98],
        'Timeliness': [96, 99]
    })

    # Radar chart
    fig = go.Figure()

    for _, row in quality_scores.iterrows():
        fig.add_trace(go.Scatterpolar(
            r=[row['Completeness'], row['Validity'], row['Consistency'], row['Timeliness']],
            theta=['Completeness', 'Validity', 'Consistency', 'Timeliness'],
            fill='toself',
            name=row['Dataset']
        ))

    fig.update_layout(
        polar=dict(
            radialaxis=dict(
                visible=True,
                range=[0, 100]
            )),
        showlegend=True,
        title='Data Quality Dimensions'
    )

    mo.ui.plotly(fig)
    return fig, quality_scores


@app.cell
def __(mo, quality_scores):
    mo.md("### Quality Scores Table")
    quality_scores
    return


@app.cell
def __(mo):
    mo.md(
        """
        ## Schema Changes

        Recent schema changes detected:
        """
    )
    return


@app.cell
def __(datetime, pd, timedelta):
    # Mock schema changes
    schema_changes = pd.DataFrame({
        'Timestamp': [
            datetime.now() - timedelta(days=3),
            datetime.now() - timedelta(days=7),
            datetime.now() - timedelta(days=14)
        ],
        'Dataset': ['api_users', 'api_posts', 'api_users'],
        'Change Type': ['Column Added', 'Type Changed', 'Column Removed'],
        'Column': ['verified_at', 'user_id', 'legacy_id'],
        'Details': [
            'Added TIMESTAMP column',
            'Changed from VARCHAR to INTEGER',
            'Removed deprecated column'
        ]
    })

    schema_changes['Timestamp'] = schema_changes['Timestamp'].dt.strftime('%Y-%m-%d')
    schema_changes
    return (schema_changes,)


@app.cell
def __(mo):
    mo.md(
        """
        ## Anomaly Detection

        Statistical anomalies detected by Elementary:
        """
    )
    return


@app.cell
def __(datetime, go, mo, pd, timedelta):
    # Mock anomaly data
    dates = pd.date_range(
        end=datetime.now(),
        periods=30,
        freq='D'
    )

    # Simulated row count with anomalies
    import numpy as np
    np.random.seed(42)

    base_count = 1000
    normal_variation = np.random.normal(0, 50, 28)
    row_counts = [base_count + v for v in normal_variation]

    # Add two anomalies
    row_counts = [800, 1200] + row_counts  # First two days are anomalies

    anomaly_data = pd.DataFrame({
        'date': dates,
        'row_count': row_counts,
        'is_anomaly': [True, True] + [False] * 28
    })

    # Calculate bounds
    mean = anomaly_data[~anomaly_data['is_anomaly']]['row_count'].mean()
    std = anomaly_data[~anomaly_data['is_anomaly']]['row_count'].std()

    fig = go.Figure()

    # Add normal data
    normal_data = anomaly_data[~anomaly_data['is_anomaly']]
    fig.add_trace(go.Scatter(
        x=normal_data['date'],
        y=normal_data['row_count'],
        mode='lines+markers',
        name='Normal',
        line=dict(color='blue')
    ))

    # Add anomalies
    anomaly_points = anomaly_data[anomaly_data['is_anomaly']]
    fig.add_trace(go.Scatter(
        x=anomaly_points['date'],
        y=anomaly_points['row_count'],
        mode='markers',
        name='Anomaly',
        marker=dict(color='red', size=12, symbol='x')
    ))

    # Add bounds
    fig.add_hline(
        y=mean + 3*std,
        line_dash="dash",
        line_color="orange",
        annotation_text="Upper Bound"
    )
    fig.add_hline(
        y=mean - 3*std,
        line_dash="dash",
        line_color="orange",
        annotation_text="Lower Bound"
    )

    fig.update_layout(
        title='Row Count Anomaly Detection (api_posts)',
        xaxis_title='Date',
        yaxis_title='Row Count',
        hovermode='x unified'
    )

    mo.ui.plotly(fig)
    return (
        anomaly_data,
        anomaly_points,
        base_count,
        fig,
        mean,
        normal_data,
        normal_variation,
        np,
        row_counts,
        std,
    )


@app.cell
def __(mo):
    mo.md(
        """
        ## Recommendations

        Automated recommendations based on quality issues:
        """
    )
    return


@app.cell
def __(mo):
    recommendations = [
        ("Critical", "api_users.email", "7 duplicate emails detected", "Add unique constraint or investigate data source"),
        ("Warning", "api_posts.body", "2 NULL values found", "Update data pipeline to ensure completeness"),
        ("Info", "api_users", "Schema change detected 3 days ago", "Update documentation and downstream consumers"),
        ("Warning", "api_posts", "Row count 20% below expected", "Check data pipeline for issues")
    ]

    for severity, location, issue, recommendation in recommendations:
        mo.callout(
            mo.md(f"""
            **{severity} {location}**

            **Issue**: {issue}

            **Recommendation**: {recommendation}
            """),
            kind="warn" if "Warning" in severity else ("danger" if "Critical" in severity else "info")
        )
    return (recommendations,)


@app.cell
def __(mo):
    mo.md(
        """
        ## Export Report

        Generate and download data quality report:
        """
    )
    return


@app.cell
def __(datetime, mo):
    export_format = mo.ui.dropdown(
        options=["PDF", "HTML", "JSON"],
        value="HTML",
        label="Export Format"
    )

    export_button = mo.ui.button(label="Generate Report")

    mo.hstack([export_format, export_button])
    return export_button, export_format


@app.cell
def __(datetime, export_button, export_format, mo):
    if export_button.value:
        report_name = f"data_quality_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.{export_format.value.lower()}"

        mo.md(f"""
        **Report generated**: `{report_name}`

        In production, this would:
        1. Compile all quality metrics
        2. Generate visualizations
        3. Export to {export_format.value}
        4. Upload to R2 for archival
        5. Send notification to Slack
        """)
    return (report_name,)


@app.cell
def __(mo):
    mo.md(
        """
        ---

        ### About This Dashboard

        This marimo notebook provides real-time data quality monitoring.

        **Data Sources:**
        - Great Expectations validation results
        - Elementary anomaly detection
        - Custom quality metrics

        **Features:**
        - Interactive quality metrics
        - Automated recommendations
        - Trend analysis
        - Anomaly detection
        - Report generation

        **Updates:** Auto-refreshes every 5 minutes in production
        """
    )
    return


if __name__ == "__main__":
    app.run()
```

---

## コード解説

### Great Expectations

#### データソース接続

DuckDBを使用してR2上のParquetを直接読み込み:

```python
conn = duckdb.connect(database=":memory:")
conn.execute("INSTALL httpfs; LOAD httpfs;")
conn.execute(f"SET s3_endpoint='{r2_endpoint}';")
conn.execute(f"SET s3_access_key_id='{access_key}';")
conn.execute(f"SET s3_secret_access_key='{secret_key}';")
```

#### Expectation例

```python
# カラムがNULLでないことを検証
expect_column_values_to_not_be_null(column="id")

# 値が一意であることを検証
expect_column_values_to_be_unique(column="email")

# 値が範囲内であることを検証
expect_column_value_lengths_to_be_between(column="title", min_value=1, max_value=255)
```

#### Checkpoint実行

```bash
great_expectations checkpoint run daily_data_quality_checkpoint
```

### marimo

#### リアクティブセル

marimoのセルは自動的にリアクティブで、依存関係を追跡:

```python
@app.cell
def __(datasets):  # datasetsの変更に反応
    # このセルはdatasetsが変わると自動再実行
    ...
```

#### インタラクティブUI

```python
# ドロップダウン
time_range = mo.ui.dropdown(
    options=["Last 24 hours", "Last 7 days"],
    value="Last 7 days",
    label="Time Range"
)

# 統計カード
mo.stat(
    value="97.1%",
    label="Success Rate",
    bordered=True
)
```

## 開発方針

### 品質ディメンション

| ディメンション | 説明 | 検証例 |
|--------------|------|--------|
| **Completeness** | データの完全性 | NULL値チェック |
| **Validity** | データの妥当性 | 正規表現マッチ |
| **Consistency** | データの整合性 | 参照整合性 |
| **Timeliness** | データの鮮度 | 更新タイムスタンプ |

### アラート閾値

- **Critical**: 成功率 < 90% または重複キー検出
- **Warning**: 成功率 90-95% またはNULL値増加
- **Info**: スキーマ変更検出

### 環境変数

| 変数名 | 説明 |
|--------|------|
| `R2_ENDPOINT` | R2エンドポイントURL |
| `R2_ACCESS_KEY_ID` | R2アクセスキーID |
| `R2_SECRET_ACCESS_KEY` | R2シークレットキー |
| `slack_webhook_url` | Slack通知用Webhook URL |

## 実行方法

### Great Expectations

```bash
# データコンテキスト初期化
cd great_expectations
great_expectations init

# Checkpoint実行
great_expectations checkpoint run daily_data_quality_checkpoint

# Data Docsビルド
great_expectations docs build
```

### marimo Dashboard

```bash
# 開発サーバー起動
marimo edit marimo/notebooks/data_quality_dashboard.py

# 本番実行
marimo run marimo/notebooks/data_quality_dashboard.py
```

## 依存関係

```text
great_expectations>=0.18.0
duckdb>=1.0.0
marimo>=0.9.0
pandas>=2.0.0
plotly>=5.0.0
numpy>=1.24.0
```

---

最終更新: 2026-01-11
