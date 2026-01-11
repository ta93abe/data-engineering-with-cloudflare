# 実装ガイド

このディレクトリには、Cloudflareデータ基盤の各コンポーネントの実装詳細と開発方針が記載されています。

## 目次

| ファイル | 内容 |
|---------|------|
| [mcp-server.md](./mcp-server.md) | Rust製MCPサーバー実装 |
| [data-pipelines.md](./data-pipelines.md) | dltデータパイプライン実装 |
| [dbt-models.md](./dbt-models.md) | dbt SQLモデル実装 |
| [ci-cd.md](./ci-cd.md) | GitHub Actionsワークフロー実装 |
| [data-quality.md](./data-quality.md) | データ品質監視（Great Expectations, marimo） |
| [utilities.md](./utilities.md) | ユーティリティスクリプト |

## 開発方針

### 全般

1. **型安全性**: TypeScript/Rustでは厳密な型定義を使用
2. **エラーハンドリング**: すべての非同期処理で適切なエラー処理を実装
3. **セキュリティ**: 環境変数で機密情報を管理、SQLインジェクション対策
4. **テスト**: ユニットテスト、統合テストを実装
5. **ドキュメント**: コード内コメントとREADMEを維持

### Cloudflare Workers

- CPU時間制限（Free: 50ms, Paid: 30秒）を考慮
- メモリ制限（128MB）を考慮
- エッジで完結できる処理を優先

### データレイヤー構成

```text
Bronze Layer (data-lake-raw)
    ↓ dlt でロード
Silver Layer (data-lake-staging)
    ↓ dbt で変換
Gold Layer (data-lake-curated)
    ↓ Iceberg テーブル化
```

## 実装ステータス

| コンポーネント | 状態 | 備考 |
|---------------|------|------|
| MCPサーバー | 📄 ドキュメント化済み | Rust実装参照 |
| dltパイプライン | 📄 ドキュメント化済み | Python実装参照 |
| dbtモデル | 📄 ドキュメント化済み | SQL実装参照 |
| GitHub Actions | 📄 ドキュメント化済み | YAML実装参照 |
| データ品質 | 📄 ドキュメント化済み | GE/marimo参照 |
| コスト計算 | 📄 ドキュメント化済み | Python実装参照 |

---

最終更新: 2026-01-11
