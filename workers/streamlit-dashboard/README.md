# Streamlit Dashboard on Cloudflare Containers

Cloudflare Containersを使用してStreamlitダッシュボードをデプロイするための実装。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Platform                          │
│                                                                 │
│  ┌──────────────┐    ┌──────────────────────────────────────┐  │
│  │   Workers    │    │     Cloudflare Containers            │  │
│  │  (プロキシ)   │───▶│  ┌────────────────────────────────┐ │  │
│  │              │    │  │  Streamlit Container           │ │  │
│  │              │    │  │  ┌─────────┐   ┌────────────┐  │ │  │
│  │              │    │  │  │Streamlit│──▶│  DuckDB    │  │ │  │
│  └──────────────┘    │  │  └─────────┘   └────────────┘  │ │  │
│         │            │  │       │              │         │ │  │
│         │            │  └───────┼──────────────┼─────────┘ │  │
│  Cloudflare Access   └──────────┼──────────────┼───────────┘  │
│  (認証・認可)                    │              │               │
│                      ┌──────────▼──────────────▼───────────┐  │
│                      │              R2 Storage              │  │
│                      │  ┌─────────┐  ┌─────────────────┐   │  │
│                      │  │ bronze/ │  │ silver/         │   │  │
│                      │  │ (生データ)│  │ (クレンジング済み) │   │  │
│                      │  └─────────┘  └─────────────────┘   │  │
│                      │  ┌─────────────────────────────┐    │  │
│                      │  │ gold/ (集計済み)             │    │  │
│                      │  └─────────────────────────────┘    │  │
│                      └─────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## ディレクトリ構成

```
workers/streamlit-dashboard/
├── Dockerfile              # コンテナイメージ定義
├── wrangler.toml           # Cloudflare Workers設定
├── package.json            # Node.js依存関係
├── tsconfig.json           # TypeScript設定
├── src/
│   └── index.ts            # Workerコード（プロキシ）
└── container/
    ├── requirements.txt    # Python依存関係
    └── app/
        └── main.py         # Streamlitアプリケーション
```

## 前提条件

- Cloudflareアカウント（Paid Plan推奨）
- Wrangler CLI（v3.57以上）
- Node.js 18以上
- Docker（ローカルテスト用）

## セットアップ

### 1. 依存関係のインストール

```bash
cd workers/streamlit-dashboard
npm install
```

### 2. R2バケットの作成

```bash
# データレイクバケット
wrangler r2 bucket create data-lake

# staging用バケット（オプション）
wrangler r2 bucket create data-lake-staging
```

### 3. シークレットの設定（オプション）

```bash
# API認証を使用する場合
wrangler secret put API_KEY_SECRET
```

### 4. ローカル開発

```bash
# Workerのローカル実行
npm run dev
```

### 5. デプロイ

```bash
# 本番環境
npm run deploy

# staging環境
npm run deploy:staging
```

## 機能

### データ可視化

- **Medallionアーキテクチャ対応**: bronze/silver/goldレイヤーのデータを表示
- **Parquetファイル対応**: DuckDBでParquetファイルを直接クエリ
- **SQLクエリ**: インタラクティブなSQLクエリ実行
- **統計情報**: データプロファイリング、カラム情報表示

### セキュリティ

- **Cloudflare Access統合**: Zero Trustアクセス制御
- **API認証**: X-API-KEYヘッダーによる認証（オプション）
- **非rootユーザー実行**: コンテナは非rootユーザーで実行

### 監視

- **Analytics Engine**: リクエストメトリクスを記録
- **構造化ログ**: JSON形式のログ出力
- **ヘルスチェック**: `/health`エンドポイント

## 設定オプション

### wrangler.toml

| 設定 | 説明 | デフォルト |
|-----|------|-----------|
| `instance_type` | コンテナインスタンスタイプ | `standard-2` |
| `max_instances` | 最大インスタンス数 | `1` |
| `sleepAfter` | アイドル停止時間 | `15m` |

### 環境変数

| 変数 | 説明 | 必須 |
|-----|------|------|
| `STREAMLIT_ENV` | 環境名（production/staging） | Yes |
| `API_KEY_SECRET` | API認証キー | No |

## コスト試算

### Cloudflare Containers（standard-2インスタンス）

| 項目 | 単価 | 想定使用量 | 月額コスト |
|------|------|-----------|-----------|
| vCPU（アクティブ） | $0.02/vCPU-hr | 60時間/月 | $1.20 |
| メモリ | $0.002/GiB-hr | 360 GiB-hr/月 | $0.72 |
| ディスク | $0.0002/GB-hr | 720 GB-hr/月 | $0.14 |
| **合計** | | | **~$2/月** |

※ 1日2時間アクティブ使用の場合

### R2 Storage

- ストレージ: $0.015/GB/月
- エグレス: **無料**

## Cloudflare Access設定（推奨）

ダッシュボードへのアクセスをCloudflare Accessで保護することを推奨します。

### 1. アプリケーション作成

Cloudflare Dashboardで:
1. Zero Trust → Access → Applications
2. 「Add an application」→「Self-hosted」
3. アプリケーション名: `Streamlit Dashboard`
4. ドメイン: `streamlit-dashboard.<your-subdomain>.workers.dev`

### 2. ポリシー設定

```
Policy name: Allowed Users
Action: Allow
Include:
  - Emails ending in: @your-company.com
  または
  - GitHub Organization: your-org
```

## トラブルシューティング

### コンテナが起動しない

```bash
# コンテナログを確認
wrangler containers logs streamlit-dashboard
```

### R2マウントエラー

- R2バケットが存在することを確認
- バケット名がwrangler.tomlと一致していることを確認

### メモリ不足

- `instance_type`を`standard-3`（8GB RAM）に変更

## 拡張

### カスタムページの追加

`container/app/pages/`ディレクトリにPythonファイルを追加:

```python
# container/app/pages/1_Analytics.py
import streamlit as st

st.title("Analytics Dashboard")
# ...
```

### 外部データソース連携

環境変数でデータベース接続情報を渡す:

```toml
# wrangler.toml
[vars]
DATABASE_URL = "..."  # 非機密情報のみ

# 機密情報はシークレットで
# wrangler secret put DATABASE_PASSWORD
```

## 参考リンク

- [Cloudflare Containers ドキュメント](https://developers.cloudflare.com/containers/)
- [Streamlit ドキュメント](https://docs.streamlit.io/)
- [DuckDB ドキュメント](https://duckdb.org/docs/)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
