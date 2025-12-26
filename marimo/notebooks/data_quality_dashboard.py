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
        ("🔴 Critical", "api_users.email", "7 duplicate emails detected", "Add unique constraint or investigate data source"),
        ("🟡 Warning", "api_posts.body", "2 NULL values found", "Update data pipeline to ensure completeness"),
        ("🟢 Info", "api_users", "Schema change detected 3 days ago", "Update documentation and downstream consumers"),
        ("🟡 Warning", "api_posts", "Row count 20% below expected", "Check data pipeline for issues")
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
        ✅ **Report generated**: `{report_name}`

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
        - 📊 Interactive quality metrics
        - 🔔 Automated recommendations
        - 📈 Trend analysis
        - 🚨 Anomaly detection
        - 📄 Report generation

        **Updates:** Auto-refreshes every 5 minutes in production
        """
    )
    return


if __name__ == "__main__":
    app.run()
