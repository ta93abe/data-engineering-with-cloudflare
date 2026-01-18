# Code Style & Conventions

## Python

### フォーマット・リント設定 (pyproject.toml)
```toml
[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "W", "F", "I", "B", "C4", "UP"]
ignore = ["E501"]

[tool.black]
line-length = 100
target-version = ['py311']

[tool.mypy]
python_version = "3.11"
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
```

### 規約
- 行長: 100文字
- 型ヒント: 必須 (disallow_untyped_defs)
- import順序: isortで自動整理

## TypeScript/JavaScript (Workers)

### 規約
- TypeScript優先
- 環境変数からの読み取り（ハードコード禁止）
- すべての非同期処理で適切なエラーハンドリング
- Workers実行時間: 50ms以内を目標

### コード例
```typescript
// ✅ Good: 環境変数からの読み取り
export default {
  async fetch(request: Request, env: Env) {
    const apiKey = env.API_KEY;
  }
}

// ✅ Good: エラーハンドリング
try {
  const data = await env.DB.prepare("SELECT * FROM users").all();
  return new Response(JSON.stringify(data), { status: 200 });
} catch (error) {
  console.error("Database error:", error);
  return new Response("Internal Server Error", { status: 500 });
}
```

## Rust (MCP Server)

### 規約
- console_error_panic_hook使用
- serde derive使用
- エラーは Result<T, worker::Error> で返す

## SQL (dbt)

### 規約
- SQLFluff使用
- dbt公式スタイルガイドに準拠

## Git

### ブランチ戦略
- `main`: 常にデプロイ可能な状態を維持
- 機能ブランチ: `feature/xxx`, `fix/xxx`

### コミットメッセージ
- Conventional Commits形式を推奨
- 例: `feat:`, `fix:`, `docs:`, `refactor:`

### プルリクエスト
- レビュー必須
- テスト通過が必要
- 新機能追加時はドキュメント更新
