# marimo Notebooks - Cloudflare Data Platform

marimoを使用したインタラクティブなデータ探索とダッシュボード。

## 概要

marimoは、Jupyter Notebookの代替となるリアクティブPythonノートブックです。

### marimoの特徴

1. **リアクティブ**: セル間の依存関係を自動追跡し、変更時に自動更新
2. **Git-friendly**: .py形式で保存され、差分が見やすい
3. **再現性**: セルの実行順序に依存しない
4. **Webアプリ化**: ノートブックをそのままWebアプリとしてデプロイ可能
5. **インタラクティブUI**: スライダー、ドロップダウン、ボタンなど豊富なUI要素

## ディレクトリ構造

```
marimo/
├── notebooks/                   # marimoノートブック
│   ├── r2_data_exploration.py  # R2データ探索
│   └── data_quality_dashboard.py # データ品質ダッシュボード
├── assets/                      # 画像などのアセット
├── outputs/                     # 生成されたHTML（Git管理外）
├── requirements.txt             # Python依存関係
├── .gitignore
└── README.md                    # このファイル
```

## セットアップ

### 1. 依存関係のインストール

```bash
pip install -r marimo/requirements.txt
```

### 2. 環境変数の設定

```bash
export R2_ENDPOINT="your-account-id.r2.cloudflarestorage.com"
export R2_ACCESS_KEY_ID="your-access-key-id"
export R2_SECRET_ACCESS_KEY="your-secret-access-key"
export R2_BUCKET_NAME="data-lake-raw"
```

## ノートブックの使用方法

### ローカルで実行

```bash
# R2データ探索ノートブック
marimo edit marimo/notebooks/r2_data_exploration.py

# データ品質ダッシュボード
marimo edit marimo/notebooks/data_quality_dashboard.py
```

ブラウザが自動的に開き、インタラクティブなノートブックが表示されます。

### Webアプリとして実行

```bash
# 読み取り専用モードで実行（ダッシュボード向け）
marimo run marimo/notebooks/data_quality_dashboard.py --host 0.0.0.0 --port 8080
```

http://localhost:8080 にアクセス

### HTMLにエクスポート

```bash
# 静的HTMLとしてエクスポート
marimo export html marimo/notebooks/r2_data_exploration.py -o outputs/r2_exploration.html

# すべてのノートブックをエクスポート
for notebook in marimo/notebooks/*.py; do
  filename=$(basename "$notebook" .py)
  marimo export html "$notebook" -o "marimo/outputs/${filename}.html"
done
```

### スクリプトとして実行

```bash
# ノートブックをPythonスクリプトとして実行
python marimo/notebooks/r2_data_exploration.py
```

## ノートブック一覧

### 1. R2 Data Exploration (`r2_data_exploration.py`)

R2上のデータをインタラクティブに探索するノートブック。

**機能:**
- 🔗 DuckDB経由でR2データを直接読み込み
- 📊 インタラクティブな可視化（Plotly）
- 🔍 データ品質チェック
- 💾 カスタムSQLクエリ実行
- ⚡ リアクティブなデータ更新

**使用例:**
```bash
marimo edit marimo/notebooks/r2_data_exploration.py
```

### 2. Data Quality Dashboard (`data_quality_dashboard.py`)

データ品質を監視するダッシュボード。

**機能:**
- 📈 品質メトリクスのトレンド分析
- 🚨 検証失敗の詳細表示
- 🔔 自動推奨事項
- 📊 品質スコアの可視化
- 📄 レポート生成機能

**データソース:**
- Great Expectations検証結果
- Elementary異常検知データ
- カスタム品質メトリクス

## 新しいノートブックの作成

### marimoエディタで作成

```bash
marimo edit marimo/notebooks/new_notebook.py
```

### テンプレートから作成

```python
import marimo

__generated_with = "0.9.14"
app = marimo.App(width="medium")


@app.cell
def __():
    import marimo as mo
    import duckdb
    import pandas as pd
    import plotly.express as px
    return duckdb, mo, pd, px


@app.cell
def __(mo):
    mo.md(
        """
        # My Notebook Title

        Description of the notebook.
        """
    )
    return


@app.cell
def __(mo, pd):
    # Your code here
    data = pd.DataFrame({'x': [1, 2, 3], 'y': [4, 5, 6]})
    data
    return (data,)


if __name__ == "__main__":
    app.run()
```

## ベストプラクティス

### 1. セルの命名規則

```python
# ✅ Good: 明示的な変数返却
@app.cell
def __(mo, pd):
    df = pd.DataFrame(...)
    return (df,)  # Explicitly return df

# ❌ Bad: 暗黙的なグローバル変数
@app.cell
def __():
    df = pd.DataFrame(...)  # df is global
```

### 2. インタラクティブUI要素

```python
@app.cell
def __(mo):
    # スライダー
    threshold = mo.ui.slider(0, 100, value=50, label="Threshold")

    # ドロップダウン
    dataset = mo.ui.dropdown(
        options=["dataset1", "dataset2"],
        value="dataset1",
        label="Select Dataset"
    )

    # テキスト入力
    query = mo.ui.text_area(
        label="SQL Query",
        value="SELECT * FROM table LIMIT 10"
    )

    # ボタン
    run_button = mo.ui.button(label="Run")

    mo.hstack([threshold, dataset])
    return dataset, query, run_button, threshold
```

### 3. データ読み込みのキャッシュ

```python
@app.cell
def __(duckdb, mo):
    # データ読み込みは高コストなので、セルを分離
    @mo.cache
    def load_data(path):
        conn = duckdb.connect(":memory:")
        return conn.execute(f"SELECT * FROM read_parquet('{path}')").fetchdf()

    return (load_data,)
```

### 4. エラーハンドリング

```python
@app.cell
def __(mo, load_data, data_path):
    try:
        df = load_data(data_path.value)
        mo.md(f"✅ Data loaded: {len(df):,} rows")
    except Exception as e:
        df = None
        mo.callout(
            mo.md(f"❌ Error: {str(e)}"),
            kind="danger"
        )
    return (df,)
```

## GitHub Actions統合

`.github/workflows/marimo-notebooks.yml` が以下を自動実行：

1. **週次実行**: 毎週日曜日にノートブックを実行
2. **HTMLエクスポート**: 静的HTMLとして出力
3. **Cloudflare Pages デプロイ**: 自動デプロイ
4. **Slack通知**: 完了通知
5. **Lintチェック**: ノートブックの構文チェック

## Cloudflare Pagesへのデプロイ

### 手動デプロイ

```bash
# ノートブックをHTMLにエクスポート
marimo export html marimo/notebooks/data_quality_dashboard.py -o marimo/outputs/index.html

# Cloudflare Pagesにデプロイ
wrangler pages deploy marimo/outputs --project-name=marimo-notebooks --branch=main
```

### 自動デプロイ

GitHub Actionsで自動的にデプロイされます：
- URL: https://marimo-notebooks.pages.dev

## JupyterからMarimoへの移行

### Jupyterノートブックを変換

```bash
# .ipynb → .py変換（手動調整が必要）
jupyter nbconvert --to python notebook.ipynb

# marimoフォーマットに手動で調整
marimo edit converted_notebook.py
```

### 主な違い

| 機能 | Jupyter | marimo |
|-----|---------|--------|
| **ファイル形式** | .ipynb (JSON) | .py (Python) |
| **実行モデル** | 順次実行 | リアクティブ実行 |
| **Git** | 差分が見にくい | 差分が見やすい |
| **再現性** | セル順序に依存 | 依存関係を自動追跡 |
| **UI要素** | ipywidgets | marimo.ui |
| **デプロイ** | Voilà等が必要 | ネイティブサポート |

## トラブルシューティング

### 1. R2接続エラー

```bash
# 環境変数を確認
env | grep R2_

# DuckDBで直接テスト
python -c "
import duckdb
conn = duckdb.connect(':memory:')
conn.execute('INSTALL httpfs; LOAD httpfs;')
conn.execute(\"SET s3_endpoint='$R2_ENDPOINT';\")
conn.execute(\"SET s3_access_key_id='$R2_ACCESS_KEY_ID';\")
conn.execute(\"SET s3_secret_access_key='$R2_SECRET_ACCESS_KEY';\")
print(conn.execute(\"SELECT * FROM read_parquet('s3://$R2_BUCKET_NAME/**/*.parquet') LIMIT 5\").fetchdf())
"
```

### 2. marimoが起動しない

```bash
# marimoのバージョン確認
marimo --version

# 再インストール
pip install --upgrade marimo

# キャッシュをクリア
rm -rf ~/.marimo
```

### 3. セルの依存関係エラー

```python
# ❌ Bad: 循環依存
@app.cell
def __(b):
    a = b + 1
    return (a,)

@app.cell
def __(a):
    b = a + 1
    return (b,)

# ✅ Good: 明確な依存関係
@app.cell
def __():
    a = 1
    return (a,)

@app.cell
def __(a):
    b = a + 1
    return (b,)
```

## 参考リンク

- [marimo公式サイト](https://marimo.io)
- [marimoドキュメント](https://docs.marimo.io)
- [marimo GitHub](https://github.com/marimo-team/marimo)
- [marimoギャラリー](https://marimo.io/gallery)
- [DuckDB + marimo](https://docs.marimo.io/guides/working_with_data/sql.html)

## Tips

### VS Codeでの編集

```bash
# VS Code拡張機能をインストール
code --install-extension marimo-team.vscode-marimo

# VS Codeで開く
code marimo/notebooks/r2_data_exploration.py
```

### パフォーマンス最適化

```python
# 大きなデータセットの場合、サンプリング
@app.cell
def __(df, mo):
    sample_size = mo.ui.slider(1000, len(df), value=10000, label="Sample Size")
    sample_size
    return (sample_size,)

@app.cell
def __(df, sample_size):
    df_sample = df.sample(n=sample_size.value)
    return (df_sample,)
```

### カスタムスタイル

```python
@app.cell
def __(mo):
    mo.md(
        """
        <style>
        .custom-card {
            border: 2px solid #0066cc;
            border-radius: 8px;
            padding: 20px;
            margin: 10px 0;
        }
        </style>

        <div class="custom-card">
        Custom styled content
        </div>
        """
    )
    return
```

---

最終更新: 2025-12-26
