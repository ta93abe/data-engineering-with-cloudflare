import marimo

__generated_with = "0.9.14"
app = marimo.App(width="medium")


@app.cell
def __():
    import marimo as mo
    import duckdb
    import pandas as pd
    import plotly.express as px
    import os
    return duckdb, mo, os, pd, px


@app.cell
def __(mo):
    mo.md(
        """
        # R2 Data Exploration Dashboard

        This notebook explores data stored in Cloudflare R2 using DuckDB.

        ## Configuration
        """
    )
    return


@app.cell
def __(mo):
    # Interactive configuration
    r2_bucket = mo.ui.text(
        label="R2 Bucket Name",
        value=os.getenv("R2_BUCKET_NAME", "data-lake-raw")
    )

    data_path = mo.ui.text(
        label="Data Path (Parquet)",
        value="sources/api_jsonplaceholder/posts/**/*.parquet"
    )

    mo.hstack([r2_bucket, data_path])
    return data_path, r2_bucket


@app.cell
def __(duckdb, os):
    # Setup DuckDB connection with R2
    def setup_duckdb_r2():
        conn = duckdb.connect(":memory:")

        # Install extensions
        conn.execute("INSTALL httpfs;")
        conn.execute("LOAD httpfs;")
        conn.execute("INSTALL parquet;")
        conn.execute("LOAD parquet;")

        # Configure R2 credentials
        r2_endpoint = os.getenv("R2_ENDPOINT")
        r2_access_key = os.getenv("R2_ACCESS_KEY_ID")
        r2_secret_key = os.getenv("R2_SECRET_ACCESS_KEY")

        if all([r2_endpoint, r2_access_key, r2_secret_key]):
            conn.execute(f"SET s3_endpoint='{r2_endpoint}';")
            conn.execute(f"SET s3_access_key_id='{r2_access_key}';")
            conn.execute(f"SET s3_secret_access_key='{r2_secret_key}';")
            conn.execute("SET s3_region='auto';")
            return conn, True
        else:
            return conn, False

    conn, r2_configured = setup_duckdb_r2()
    return conn, r2_configured, setup_duckdb_r2


@app.cell
def __(mo, r2_configured):
    if r2_configured:
        mo.md("✅ **R2 Connection**: Configured")
    else:
        mo.callout(
            mo.md("⚠️ **R2 Connection**: Not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY environment variables."),
            kind="warn"
        )
    return


@app.cell
def __(mo):
    mo.md(
        """
        ## Data Loading

        Load data from R2 using DuckDB:
        """
    )
    return


@app.cell
def __(conn, data_path, r2_bucket):
    # Load data from R2
    s3_path = f"s3://{r2_bucket.value}/{data_path.value}"

    try:
        query = f"SELECT * FROM read_parquet('{s3_path}')"
        df = conn.execute(query).fetchdf()
        load_status = "success"
        error_msg = None
    except Exception as e:
        df = None
        load_status = "error"
        error_msg = str(e)

    return df, error_msg, load_status, query, s3_path


@app.cell
def __(df, error_msg, load_status, mo, s3_path):
    if load_status == "success":
        mo.md(f"""
        ✅ **Data loaded successfully** from `{s3_path}`

        **Rows**: {len(df):,} | **Columns**: {len(df.columns)}
        """)
    else:
        mo.callout(
            mo.md(f"❌ **Error loading data**: {error_msg}"),
            kind="danger"
        )
    return


@app.cell
def __(df, mo):
    if df is not None:
        mo.md(
            """
            ## Data Overview

            ### Sample Data
            """
        )
    return


@app.cell
def __(df):
    if df is not None:
        # Display first 10 rows
        df.head(10)
    return


@app.cell
def __(df, mo):
    if df is not None:
        mo.md("### Data Types")
    return


@app.cell
def __(df, pd):
    if df is not None:
        # Data types summary
        dtypes_df = pd.DataFrame({
            'Column': df.columns,
            'Type': df.dtypes.values,
            'Non-Null Count': df.count().values,
            'Null Count': df.isnull().sum().values
        })
        dtypes_df
    return (dtypes_df,)


@app.cell
def __(df, mo):
    if df is not None:
        mo.md("### Summary Statistics")
    return


@app.cell
def __(df):
    if df is not None:
        # Summary statistics
        df.describe()
    return


@app.cell
def __(df, mo):
    if df is not None:
        mo.md(
            """
            ## Data Quality Checks

            Basic data quality checks:
            """
        )
    return


@app.cell
def __(df, pd):
    if df is not None:
        # Data quality metrics
        quality_metrics = pd.DataFrame({
            'Metric': [
                'Total Rows',
                'Total Columns',
                'Duplicate Rows',
                'Total Missing Values',
                'Columns with Missing Values'
            ],
            'Value': [
                len(df),
                len(df.columns),
                df.duplicated().sum(),
                df.isnull().sum().sum(),
                (df.isnull().sum() > 0).sum()
            ]
        })
        quality_metrics
    return (quality_metrics,)


@app.cell
def __(df, mo, px):
    if df is not None and df.isnull().sum().sum() > 0:
        mo.md("### Missing Values by Column")

        # Missing values visualization
        missing_df = df.isnull().sum().reset_index()
        missing_df.columns = ['Column', 'Missing Count']
        missing_df = missing_df[missing_df['Missing Count'] > 0]

        fig = px.bar(
            missing_df,
            x='Column',
            y='Missing Count',
            title='Missing Values by Column'
        )
        mo.ui.plotly(fig)
    return fig, missing_df


@app.cell
def __(df, mo):
    if df is not None:
        mo.md(
            """
            ## Interactive Exploration

            Select a column to explore:
            """
        )
    return


@app.cell
def __(df, mo):
    if df is not None:
        column_selector = mo.ui.dropdown(
            options=list(df.columns),
            value=df.columns[0] if len(df.columns) > 0 else None,
            label="Select Column"
        )
        column_selector
    return (column_selector,)


@app.cell
def __(column_selector, df, mo, pd, px):
    if df is not None and column_selector.value:
        selected_col = column_selector.value

        mo.md(f"### Analysis of `{selected_col}`")

        # Column statistics
        col_data = df[selected_col]

        stats = pd.DataFrame({
            'Statistic': ['Count', 'Unique Values', 'Missing', 'Data Type'],
            'Value': [
                col_data.count(),
                col_data.nunique(),
                col_data.isnull().sum(),
                str(col_data.dtype)
            ]
        })

        mo.vstack([
            mo.md("**Column Statistics:**"),
            stats,
            mo.md("**Value Distribution:**")
        ])
    return col_data, selected_col, stats


@app.cell
def __(col_data, df, mo, px, selected_col):
    if df is not None and selected_col:
        # Visualization based on data type
        if pd.api.types.is_numeric_dtype(col_data):
            # Histogram for numeric columns
            fig = px.histogram(
                df,
                x=selected_col,
                title=f'Distribution of {selected_col}'
            )
            mo.ui.plotly(fig)
        elif col_data.nunique() < 50:
            # Bar chart for categorical with few unique values
            value_counts = col_data.value_counts().reset_index()
            value_counts.columns = [selected_col, 'Count']

            fig = px.bar(
                value_counts.head(20),
                x=selected_col,
                y='Count',
                title=f'Top 20 Values of {selected_col}'
            )
            mo.ui.plotly(fig)
    return fig, value_counts


@app.cell
def __(mo):
    mo.md(
        """
        ## SQL Query Interface

        Run custom SQL queries on the loaded data:
        """
    )
    return


@app.cell
def __(mo):
    sql_query = mo.ui.text_area(
        label="SQL Query",
        value="SELECT * FROM df LIMIT 10",
        rows=5
    )

    run_button = mo.ui.button(label="Run Query")

    mo.vstack([sql_query, run_button])
    return run_button, sql_query


@app.cell
def __(conn, df, mo, run_button, sql_query):
    if df is not None and run_button.value:
        try:
            # Register dataframe as table
            conn.register('df', df)
            result = conn.execute(sql_query.value).fetchdf()

            mo.vstack([
                mo.md(f"✅ **Query executed successfully**"),
                mo.md(f"**Rows returned**: {len(result):,}"),
                result
            ])
        except Exception as e:
            mo.callout(
                mo.md(f"❌ **Query error**: {str(e)}"),
                kind="danger"
            )
    return (result,)


@app.cell
def __(mo):
    mo.md(
        """
        ---

        ### About This Dashboard

        This marimo notebook provides interactive data exploration for data stored in Cloudflare R2.

        **Features:**
        - 🔗 Direct R2 connection via DuckDB
        - 📊 Interactive visualizations with Plotly
        - 🔍 Data quality checks
        - 💾 SQL query interface
        - ⚡ Reactive updates

        **Tech Stack:**
        - [marimo](https://marimo.io) - Reactive Python notebooks
        - [DuckDB](https://duckdb.org) - In-process analytical database
        - [Plotly](https://plotly.com) - Interactive visualizations
        """
    )
    return


if __name__ == "__main__":
    app.run()
