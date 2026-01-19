"""
Streamlit Dashboard for Cloudflare Data Platform

R2に保存されたデータを可視化するダッシュボード
"""

import os
from pathlib import Path

import duckdb
import pandas as pd
import streamlit as st

# ページ設定
st.set_page_config(
    page_title="Cloudflare Data Dashboard",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

# R2マウントパス（Cloudflare ContainersでFUSEマウント）
DATA_PATH = Path(os.getenv("DATA_PATH", "/data"))


@st.cache_resource
def get_duckdb_connection() -> duckdb.DuckDBPyConnection:
    """DuckDB接続を取得（キャッシュ）"""
    conn = duckdb.connect(":memory:")
    conn.execute("INSTALL httpfs; LOAD httpfs;")
    conn.execute("INSTALL parquet; LOAD parquet;")
    return conn


def load_parquet_files(path: Path, pattern: str = "*.parquet") -> pd.DataFrame | None:
    """指定パスからParquetファイルを読み込み"""
    files = list(path.glob(pattern))
    if not files:
        return None

    conn = get_duckdb_connection()
    try:
        # 複数ファイルを結合して読み込み
        file_paths = [str(f) for f in files]
        query = f"SELECT * FROM read_parquet({file_paths})"
        return conn.execute(query).fetchdf()
    except Exception as e:
        st.error(f"データ読み込みエラー: {e}")
        return None


def main():
    """メインアプリケーション"""

    # サイドバー
    st.sidebar.title("📊 Data Dashboard")
    st.sidebar.markdown("---")

    # データレイヤー選択
    layer = st.sidebar.selectbox(
        "データレイヤー",
        ["bronze", "silver", "gold"],
        help="Medallionアーキテクチャのデータレイヤーを選択",
    )

    # メインコンテンツ
    st.title("Cloudflare Data Platform Dashboard")

    # データパス
    layer_path = DATA_PATH / layer

    # データパスの存在確認
    if not layer_path.exists():
        st.warning(f"データパス {layer_path} が存在しません。")
        st.info(
            """
            **セットアップ手順**:
            1. R2バケットにデータをアップロード
            2. Cloudflare ContainersでR2をFUSEマウント
            3. データが `/data/{bronze,silver,gold}/` に配置されることを確認
            """
        )

        # デモモード
        st.markdown("---")
        st.subheader("デモモード")
        demo_data = pd.DataFrame(
            {
                "date": pd.date_range("2024-01-01", periods=30),
                "value": [100 + i * 5 + (i % 7) * 10 for i in range(30)],
                "category": ["A", "B", "C"] * 10,
            }
        )
        st.line_chart(demo_data.set_index("date")["value"])
        st.dataframe(demo_data)
        return

    # ディレクトリ内のファイル一覧
    st.sidebar.markdown("### ファイル一覧")
    parquet_files = list(layer_path.glob("**/*.parquet"))

    if not parquet_files:
        st.info(f"{layer}レイヤーにParquetファイルがありません。")
        return

    # ファイル選択
    selected_file = st.sidebar.selectbox(
        "ファイルを選択",
        parquet_files,
        format_func=lambda x: x.relative_to(layer_path),
    )

    # データ読み込み
    conn = get_duckdb_connection()

    try:
        df = conn.execute(f"SELECT * FROM read_parquet('{selected_file}')").fetchdf()
    except Exception as e:
        st.error(f"ファイル読み込みエラー: {e}")
        return

    # データ概要
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("行数", f"{len(df):,}")
    with col2:
        st.metric("列数", len(df.columns))
    with col3:
        st.metric("メモリ使用量", f"{df.memory_usage(deep=True).sum() / 1024 / 1024:.2f} MB")
    with col4:
        st.metric("ファイル", selected_file.name)

    st.markdown("---")

    # タブ表示
    tab1, tab2, tab3 = st.tabs(["📋 データプレビュー", "📊 統計情報", "🔍 SQLクエリ"])

    with tab1:
        st.subheader("データプレビュー")
        st.dataframe(df.head(100), use_container_width=True)

    with tab2:
        st.subheader("統計情報")

        # カラム情報
        st.markdown("#### カラム情報")
        col_info = pd.DataFrame(
            {
                "データ型": df.dtypes.astype(str),
                "非NULL数": df.count(),
                "NULL数": df.isnull().sum(),
                "ユニーク数": df.nunique(),
            }
        )
        st.dataframe(col_info, use_container_width=True)

        # 数値カラムの統計
        numeric_cols = df.select_dtypes(include=["number"]).columns
        if len(numeric_cols) > 0:
            st.markdown("#### 数値カラム統計")
            st.dataframe(df[numeric_cols].describe(), use_container_width=True)

    with tab3:
        st.subheader("SQLクエリ")
        st.info("DuckDBでParquetファイルに対してSQLクエリを実行できます。")

        # テーブル名として使用
        conn.execute(f"CREATE OR REPLACE VIEW data AS SELECT * FROM read_parquet('{selected_file}')")

        query = st.text_area(
            "SQLクエリ",
            value="SELECT * FROM data LIMIT 10",
            height=100,
        )

        if st.button("実行"):
            try:
                result = conn.execute(query).fetchdf()
                st.dataframe(result, use_container_width=True)
            except Exception as e:
                st.error(f"クエリエラー: {e}")


if __name__ == "__main__":
    main()
