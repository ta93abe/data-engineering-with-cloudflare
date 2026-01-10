# Cloudflare MCP Server

Cloudflare Workers上で動作する、Rust実装のModel Context Protocol (MCP) サーバーです。

## 概要

このMCPサーバーは、Cloudflareのエッジコンピューティングプラットフォーム上で、LLMアプリケーションに以下の機能を提供します：

- **Workers KV**: キー・バリューストアへのアクセス
- **D1 Database**: SQLiteデータベースクエリ
- **R2 Storage**: オブジェクトストレージの操作

## 機能

### 提供するツール

| ツール名 | 説明 | 主な用途 |
|---------|------|---------|
| `kv-get` | KVストアから値を取得 | 設定、キャッシュ読み取り |
| `kv-put` | KVストアに値を保存 | 設定、キャッシュ書き込み |
| `d1-query` | D1データベースにSQLクエリ実行 | データ検索、集計 |
| `r2-get` | R2バケットからオブジェクト取得 | ファイル読み取り |
| `r2-put` | R2バケットにオブジェクト保存 | ファイルアップロード |
| `r2-list` | R2バケット内のオブジェクト一覧 | ファイル管理 |

### 提供するリソース

| リソースURI | 説明 |
|------------|------|
| `config://server` | サーバー設定情報 |
| `stats://kv` | KVストレージ統計 |

## プロジェクト構造

```
workers/mcp-server/
├── Cargo.toml           # Rust依存関係とビルド設定
├── wrangler.toml        # Cloudflare Workers設定
├── DEPLOYMENT.md        # デプロイメントガイド（詳細）
├── README.md            # このファイル
└── src/
    └── lib.rs           # MCPサーバー実装
```

## クイックスタート

### 前提条件

- Rust 1.75+
- Node.js 18+
- Wrangler CLI
- Cloudflareアカウント

```bash
# Rustインストール
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Wranglerインストール
npm install -g wrangler

# worker-buildインストール
cargo install worker-build
```

### ローカル開発

```bash
# 1. プロジェクトディレクトリに移動
cd workers/mcp-server

# 2. 開発サーバー起動
wrangler dev

# 3. 別のターミナルでテスト
curl http://localhost:8787/health
```

### デプロイ

詳細は [DEPLOYMENT.md](./DEPLOYMENT.md) を参照してください。

```bash
# 1. Cloudflareリソースを作成
wrangler kv:namespace create "DATA"
wrangler d1 create mcp-database

# R2バケットはユニークな名前が必要（重要！）
# サフィックスを生成して名前の衝突を回避
SUFFIX=$(openssl rand -hex 3)
wrangler r2 bucket create "ta93abe-mcp-storage-${SUFFIX}-prod"
wrangler r2 bucket create "ta93abe-mcp-storage-${SUFFIX}-preview"

# 2. wrangler.tomlを編集（作成したリソースのIDとバケット名を設定）

# 3. デプロイ
wrangler deploy
```

**重要:** R2バケット名はアカウント内で一意である必要があります。DEPLOYMENT.mdのバケット名命名規則を必ず確認してください。

## 使用例

### MCP クライアントからの接続

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const client = new Client({
  name: 'mcp-client',
  version: '1.0.0'
});

// サーバーに接続
await client.connect(
  new URL('https://mcp-server.your-subdomain.workers.dev/mcp')
);

// ツール一覧を取得
const tools = await client.listTools();
console.log(tools);

// KVに値を保存
await client.callTool({
  name: 'kv-put',
  arguments: {
    key: 'user:123',
    value: JSON.stringify({ name: 'Alice', age: 30 })
  }
});

// KVから値を取得
const result = await client.callTool({
  name: 'kv-get',
  arguments: { key: 'user:123' }
});
console.log(result.content[0].text);
```

### cURLでのテスト

```bash
# ツール一覧
curl -X POST https://your-worker.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'

# D1クエリ実行
curl -X POST https://your-worker.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "d1-query",
      "arguments": {
        "sql": "SELECT * FROM users LIMIT 10"
      }
    }
  }'

# R2ファイル一覧
curl -X POST https://your-worker.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "r2-list",
      "arguments": {
        "prefix": "documents/",
        "limit": 50
      }
    }
  }'
```

## アーキテクチャ

### リクエストフロー

```
LLM Client
    ↓
MCP SDK
    ↓
[HTTP POST /mcp]
    ↓
Cloudflare Workers (Rust)
    ↓
├─ Workers KV (キャッシュ)
├─ D1 Database (SQLite)
└─ R2 Storage (オブジェクト)
```

### JSON-RPC 2.0プロトコル

MCPサーバーはJSON-RPC 2.0仕様に準拠：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "kv-get",
    "arguments": { "key": "my-key" }
  }
}
```

レスポンス：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "my-value"
      }
    ]
  }
}
```

## 開発ガイド

### コードの変更

```bash
# 1. src/lib.rs を編集

# 2. ローカルでテスト
wrangler dev

# 3. 変更をデプロイ
wrangler deploy
```

### 新しいツールの追加

1. `handle_tools_list()` にツール定義を追加
2. `handle_tools_call()` にツール実装を追加
3. 新しいツール関数を実装

例：

```rust
// ツール定義
Tool {
    name: "custom-tool".to_string(),
    description: "カスタムツールの説明".to_string(),
    input_schema: serde_json::json!({
        "type": "object",
        "properties": {
            "param": { "type": "string" }
        },
        "required": ["param"]
    }),
}

// ツール実装
"custom-tool" => tool_custom(ctx, arguments).await,

async fn tool_custom(ctx: &RouteContext<()>, args: &serde_json::Value) -> Result<serde_json::Value> {
    // 実装
}
```

### ログとデバッグ

```rust
// ログ出力
console_log!("Debug message: {}", value);

// エラーログ
console_error!("Error occurred: {:?}", error);
```

ログ確認：

```bash
wrangler tail
```

## パフォーマンス

### 最適化ポイント

- **バイナリサイズ**: `opt-level = "z"` でサイズ最適化
- **KVキャッシング**: 頻繁にアクセスするデータをKVでキャッシュ
- **D1バッチクエリ**: 複数クエリをバッチで実行
- **R2プレフィックス**: オブジェクト一覧取得時にプレフィックスフィルタ使用

### 制限値

| リソース | 無料プラン | 有料プラン |
|---------|-----------|-----------|
| Workers CPU時間 | 10ms | 30秒 |
| Workers メモリ | 128MB | 128MB |
| KV 読み取り | 100,000/日 | 無制限 |
| KV 書き込み | 1,000/日 | 無制限 |
| D1 ストレージ | 5MB | 500MB |
| R2 ストレージ | 10GB/月 | 無制限 |

## セキュリティ

### 認証

環境変数でAPI Keyを設定：

```bash
wrangler secret put API_KEY
```

実装例：

```rust
let auth = req.headers().get("Authorization")?;
let expected = format!("Bearer {}", ctx.secret("API_KEY")?.to_string());

if auth != Some(expected) {
    return Response::error("Unauthorized", 401);
}
```

### CORS設定

本番環境では適切なCORS設定を追加：

```rust
headers.set("Access-Control-Allow-Origin", "https://your-domain.com")?;
```

## トラブルシューティング

### よくあるエラー

| エラー | 原因 | 解決方法 |
|-------|------|---------|
| `KV binding not found` | wrangler.tomlの設定ミス | KV namespace IDを確認 |
| `D1 database not found` | D1未作成 | `wrangler d1 create` 実行 |
| `CPU time exceeded` | 処理時間超過 | 有料プランにアップグレード |
| `Parse error` | 不正なJSON | リクエストボディを確認 |

詳細は [DEPLOYMENT.md](./DEPLOYMENT.md) のトラブルシューティングセクション参照。

## コントリビューション

バグ報告や機能リクエストは [GitHub Issues](https://github.com/ta93abe/data-engineering-with-cloudflare/issues) へ。

## ライセンス

このプロジェクトのライセンスは親プロジェクトに従います。

## 参考リソース

- [Model Context Protocol Specification](https://github.com/modelcontextprotocol/modelcontextprotocol)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [workers-rs GitHub](https://github.com/cloudflare/workers-rs)
- [Wrangler Documentation](https://developers.cloudflare.com/workers/wrangler/)

## 作者

Takumi Abe <ta93abe@ta93abe.com>

---

**Last Updated**: 2025-01-10
