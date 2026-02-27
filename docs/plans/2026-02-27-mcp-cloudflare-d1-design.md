# MCP Cloudflare Server - Phase 1: D1 Design

## Overview

Cloudflare D1 を操作できる MCP サーバーを TypeScript/Hono で実装する。
Claude Desktop や Claude Code から自然言語で D1 データベースを操作できるようになる。

Linear Issue: [TA-216](https://linear.app/ta93abe/issue/TA-216)

## Decisions

| 項目 | 選択 | 理由 |
|------|------|------|
| 言語 | TypeScript | 既存 ingestion Worker と一貫性。MCP SDK が最も成熟 |
| フレームワーク | Hono | ingestion と同じパターン |
| MCP SDK | @modelcontextprotocol/sdk | プロトコル準拠保証、メンテナンスコスト低 |
| トランスポート | Streamable HTTP | MCP 2025-03-26 仕様。Workers と相性良好 |
| 初回スコープ | D1 のみ | 既存 raw DB で即動作確認可能 |

## Architecture

```
Claude Desktop / Claude Code
  ↓ HTTP POST (Streamable HTTP)
Cloudflare Worker (mcp-server/)
  ├── Hono routing
  ├── MCP SDK (McpServer)
  │   ├── tools/d1-query
  │   ├── tools/d1-list-tables
  │   └── tools/d1-describe
  └── D1 Binding ("DB")
```

## Directory Structure

```
mcp-server/
├── src/
│   ├── index.ts          # Hono entry + MCP transport
│   ├── types.ts          # Type definitions (Env, Bindings)
│   └── tools/
│       └── d1.ts         # D1 tool definitions
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── biome.json
└── vitest.config.ts
```

## Endpoints

| Path | Method | Description |
|------|--------|-------------|
| `/health` | GET | Health check |
| `/mcp` | POST | MCP Streamable HTTP endpoint |

## Tools (Phase 1)

### d1-query

SQL クエリを D1 データベースに対して実行する。

- **Input**: `sql` (string, required), `params` (array, optional)
- **Output**: クエリ結果 (rows) またはステートメント結果 (changes, last_row_id)

### d1-list-tables

D1 データベース内のテーブル一覧を取得する。

- **Input**: なし
- **Output**: テーブル名の一覧

### d1-describe

指定テーブルのスキーマ情報を取得する。

- **Input**: `table` (string, required)
- **Output**: カラム名、型、制約の一覧

## Authentication

- `MCP_AUTH_TOKEN` を Worker Secrets で管理
- `Authorization: Bearer <token>` ヘッダーで認証
- 未認証リクエストは 401 で拒否

## Future Phases

- Phase 2: R2 (オブジェクトストレージ操作)
- Phase 3: KV (キー・バリュー操作)
- Phase 4: Queues (メッセージキュー操作)
