# GitHub Workers セットアップガイド

このドキュメントでは、GitHub データ取得 Workers のセットアップとデプロイ方法を説明します。

## 📋 前提条件

- Cloudflare アカウント
- GitHub Personal Access Token
- Node.js 20 以上
- Wrangler CLI (`npm install -g wrangler`)

## 🚀 セットアップ手順

### 1. Cloudflare R2 バケット作成

```bash
# データレイク用バケット作成
wrangler r2 bucket create data-lake-raw

# プレビュー用バケット作成 (オプション)
wrangler r2 bucket create data-lake-raw-preview
```

### 2. Cloudflare Queue 作成

```bash
# メインキュー作成
wrangler queues create github-fetch-queue

# デッドレターキュー作成
wrangler queues create github-fetch-dlq
```

### 3. Cloudflare KV Namespace 作成

```bash
# メタデータ用 KV Namespace 作成
wrangler kv:namespace create "METADATA_KV"

# 出力された ID をメモ
# 例: id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# 本番環境用 KV Namespace 作成
wrangler kv:namespace create "METADATA_KV" --env production

# 出力された ID をメモ
# 例: id = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
```

### 4. wrangler.toml の更新

#### Scheduler Worker

`workers/github-scheduler/wrangler.toml` の KV Namespace ID を更新:

```toml
[[kv_namespaces]]
binding = "METADATA_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # 手順3で取得したID

[[env.production.kv_namespaces]]
binding = "METADATA_KV"
id = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"  # 手順3で取得した本番ID
```

### 5. GitHub Personal Access Token 作成

1. GitHub にログイン
2. **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
3. **Generate new token (classic)** をクリック
4. スコープを選択:
   - ✅ `repo` (全リポジトリアクセス)
   - ✅ `read:org` (Organization データ)
   - ✅ `read:user`
   - ✅ `user:email`
5. トークンをコピー

### 6. Cloudflare Secrets 設定

#### Scheduler Worker

```bash
cd workers/github-scheduler

# GitHub トークンを設定
echo "ghp_xxxxxxxxxxxx" | wrangler secret put GITHUB_TOKEN
```

#### Fetcher Worker

```bash
cd workers/github-fetcher

# GitHub トークンを設定
echo "ghp_xxxxxxxxxxxx" | wrangler secret put GITHUB_TOKEN
```

### 7. 依存関係のインストール

```bash
# Scheduler Worker
cd workers/github-scheduler
npm install

# Fetcher Worker
cd workers/github-fetcher
npm install
```

### 8. ローカルテスト

#### Scheduler Worker のテスト

```bash
cd workers/github-scheduler

# 開発サーバー起動
npm run dev

# 別ターミナルで手動トリガー
curl -X POST http://localhost:8787/trigger
```

#### Fetcher Worker のテスト

```bash
cd workers/github-fetcher

# 開発サーバー起動
npm run dev
```

### 9. 本番デプロイ

#### 手動デプロイ

```bash
# Scheduler Worker
cd workers/github-scheduler
npm run deploy

# Fetcher Worker
cd workers/github-fetcher
npm run deploy
```

#### GitHub Actions による自動デプロイ

GitHub リポジトリに以下の Secrets を設定:

| Secret 名 | 説明 | 取得方法 |
|----------|------|---------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API トークン | Cloudflare ダッシュボード → My Profile → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID | Cloudflare ダッシュボード → Workers & Pages → 右サイドバー |
| `GITHUB_TOKEN` (Worker 用) | GitHub Personal Access Token | 手順5 で作成 |
| `SLACK_WEBHOOK_URL` | Slack Webhook URL (オプション) | Slack アプリ設定 |

設定後、`workers/` ディレクトリに変更を push すると自動デプロイされます。

## 🔧 設定

### Cron トリガーの調整

`workers/github-scheduler/wrangler.toml` の cron 設定を変更:

```toml
[triggers]
crons = ["0 2 * * *"]  # 毎日午前2時UTC (日本時間11時)

# その他の例:
# crons = ["0 * * * *"]      # 毎時実行
# crons = ["0 2 * * 1"]      # 毎週月曜日午前2時
# crons = ["0 2 1 * *"]      # 毎月1日午前2時
```

### Queue の設定調整

`workers/github-fetcher/wrangler.toml` の Queue 設定:

```toml
[[queues.consumers]]
queue = "github-fetch-queue"
max_batch_size = 10           # バッチサイズ (1-100)
max_batch_timeout = 30        # バッチタイムアウト秒
max_retries = 3               # 最大リトライ回数
dead_letter_queue = "github-fetch-dlq"
```

## 📊 監視

### 実行ステータスの確認

```bash
# 実行ステータスの確認 (execution_id が必要)
curl https://github-scheduler.your-subdomain.workers.dev/status/{execution_id}
```

### Cloudflare ダッシュボードでの確認

1. **Workers & Pages** → **github-scheduler** → **Logs**
2. **Workers & Pages** → **github-fetcher** → **Logs**
3. **Analytics** → **Analytics Engine** でカスタムメトリクス確認

### R2 データの確認

```bash
# バケット内のオブジェクト一覧
wrangler r2 object list data-lake-raw --prefix sources/github/

# 特定のオブジェクトのダウンロード
wrangler r2 object get data-lake-raw/sources/github/repositories/year=2025/month=01/day=03/xxxx.json --file output.json
```

## 🐛 トラブルシューティング

### GitHub API Rate Limit

**問題**: `API rate limit exceeded` エラー

**解決策**:
- Personal Access Token を使用していることを確認
- 認証ユーザーのレート制限: 5,000 requests/hour
- 必要に応じて Organization の GitHub App に移行

### Queue メッセージが処理されない

**問題**: Fetcher Worker がメッセージを処理しない

**解決策**:
1. Queue が正しく作成されているか確認:
   ```bash
   wrangler queues list
   ```
2. Fetcher Worker が正しくデプロイされているか確認:
   ```bash
   wrangler deployments list --name github-fetcher
   ```
3. Queue の設定が正しいか確認:
   ```bash
   wrangler queues consumer list github-fetch-queue
   ```

### R2 への書き込みエラー

**問題**: R2 バケットへの書き込みが失敗する

**解決策**:
1. バケットが存在することを確認:
   ```bash
   wrangler r2 bucket list
   ```
2. wrangler.toml の bucket_name が正しいか確認
3. Workers のログでエラー詳細を確認

### Secrets が認識されない

**問題**: `GITHUB_TOKEN is not defined` エラー

**解決策**:
1. Secret が設定されているか確認:
   ```bash
   wrangler secret list
   ```
2. Secret を再設定:
   ```bash
   wrangler secret put GITHUB_TOKEN
   ```

## 📚 次のステップ

1. **dbt セットアップ**: [github-dbt-design.md](./github-dbt-design.md) を参照
2. **Evidence.dev セットアップ**: [github-evidence-design.md](./github-evidence-design.md) を参照
3. **データ品質監視**: Elementary の導入

## 🔗 関連ドキュメント

- [GitHub Workers 設計](./github-workers-design.md)
- [GitHub 実装計画](./github-implementation-plan.md)
- [Cloudflare Workers ドキュメント](https://developers.cloudflare.com/workers/)
- [Wrangler CLI リファレンス](https://developers.cloudflare.com/workers/wrangler/)
