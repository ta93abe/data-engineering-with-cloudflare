# Code Style & Conventions (2026-02更新)

## TypeScript/JavaScript (ingestion Worker)

### ツール: Biome (ESLint+Prettier統合代替)
設定ファイル: `ingestion/biome.json`

```json
{
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "es5"
    }
  },
  "linter": {
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "warn" },
      "complexity": { "noForEach": "off" }
    }
  }
}
```

### 規約
- ダブルクォート使用
- セミコロン必須
- インデント: スペース2つ
- 行長: 100文字
- TypeScript優先
- 環境変数からの読み取り（ハードコード禁止）
- すべての非同期処理で適切なエラーハンドリング
- Workers実行時間: 50ms以内を目標

## SQL (dbt / sqruff)

### ツール: sqruff (SQLFluff後継のRust製リンター)
設定ファイル: `transform/core/.sqruff.toml`

```toml
[sqruff]
dialect = "duckdb"
templater = "jinja"
max_line_length = 120

[sqruff.rules.capitalisation.keywords]
capitalisation_policy = "lower"

[sqruff.rules.capitalisation.identifiers]
capitalisation_policy = "lower"

[sqruff.rules.capitalisation.functions]
capitalisation_policy = "lower"

[sqruff.rules.layout.indent]
tab_space_size = 4
```

### 規約
- キーワード: 小文字 (select, from, where)
- 識別子: 小文字
- 関数名: 小文字
- インデント: スペース4つ
- 行長: 120文字
- DuckDB方言

## Python (transform/core)
- Python 3.11〜3.12
- パッケージ管理: uv (pyproject.toml)
- 型ヒント推奨

## Go (infrastructure/pulumi)
- Go標準フォーマッタ (gofmt)

## Git

### ブランチ命名
```text
<type>/<description>
例: feat/add-r2-bucket, fix/auth-error, chore/update-deps
```

### コミットメッセージ
- Conventional Commits形式
- `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`
- Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>

### ⚠️ mainブランチでの直接コミット禁止
すべての変更はフィーチャーブランチ→PR経由
