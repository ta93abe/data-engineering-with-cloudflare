# Cloudflare Data Infrastructure Project

このドキュメントは、Cloudflareをベースとしたデータ基盤プロジェクトの開発ガイドです。

## プロジェクト概要

Cloudflareのエッジコンピューティングプラットフォームを活用し、グローバルに分散された低レイテンシ、高スケーラビリティなデータ基盤を構築するプロジェクトです。

### 主な特徴

- **エッジファースト**: Cloudflareのグローバルネットワークを活用した低レイテンシ処理
- **サーバーレス**: 自動スケーリングと運用負荷の削減
- **コスト最適化**: R2のエグレス無料など、従来のクラウドより低コスト
- **統合プラットフォーム**: Workers、KV、R2、D1など、統合されたサービス群

## 技術スタック

### コアテクノロジー

- **Cloudflare Workers**: JavaScriptランタイムでのエッジコンピューティング
- **TypeScript**: 型安全な開発
- **Wrangler**: Cloudflare Workers用CLI

### データストレージ

| サービス | 用途 | 特徴 |
|---------|------|------|
| **Workers KV** | キー・バリューストア | 低レイテンシ読み取り、最終的整合性 |
| **R2** | オブジェクトストレージ | S3互換、エグレス無料 |
| **D1** | SQLデータベース | SQLite、リレーショナルデータ |
| **Analytics Engine** | 時系列データ | 高カーディナリティ、SQL分析 |
| **Durable Objects** | ステートフル処理 | 強整合性、WebSocket対応 |
| **Queues** | メッセージキュー | 非同期処理、リトライ機能 |
| **Hyperdrive** | DB接続プール | PostgreSQL高速接続 |

## プロジェクト構造

```
data-engineering-with-cloudflare/
├── .claude/                    # Claude Code設定
│   └── CLAUDE.md              # このファイル
├── docs/                       # ドキュメント
│   └── architecture-design.md  # アーキテクチャ設計
├── terraform/                  # Terraform IaC設定
│   ├── main.tf                # Provider設定
│   ├── variables.tf           # 変数定義
│   ├── outputs.tf             # 出力定義
│   ├── storage.tf             # R2、D1、KVリソース
│   ├── queues.tf              # Cloudflare Queues
│   ├── workers.tf             # Workers設定（オプション）
│   ├── terraform.tfvars.example  # 設定例
│   └── README.md              # Terraform利用ガイド
├── src/                        # ソースコード（今後追加）
│   ├── workers/               # Workers実装
│   ├── schemas/               # D1スキーマ定義
│   └── utils/                 # ユーティリティ
├── scripts/                    # スクリプト（今後追加）
│   ├── deploy/                # デプロイスクリプト
│   └── migrations/            # D1マイグレーション
├── tests/                      # テストコード（今後追加）
├── wrangler.toml              # Wrangler設定（今後追加）
└── README.md                  # プロジェクト概要
```

## 開発ガイドライン

### コーディング規約

1. **TypeScript優先**: 型安全性を確保するため、TypeScriptを使用
2. **エラーハンドリング**: すべての非同期処理で適切なエラーハンドリングを実装
3. **レスポンス時間**: Workers実行時間は50ms以内を目標（CPU time制限考慮）
4. **セキュリティ**: APIキーや認証情報は環境変数で管理、コードに埋め込まない

### Workersベストプラクティス

```typescript
// ✅ Good: 環境変数からの読み取り
export default {
  async fetch(request: Request, env: Env) {
    const apiKey = env.API_KEY;
    // ...
  }
}

// ❌ Bad: ハードコード
const apiKey = "sk-xxx...";

// ✅ Good: 適切なエラーハンドリング
try {
  const data = await env.DB.prepare("SELECT * FROM users").all();
  return new Response(JSON.stringify(data), { status: 200 });
} catch (error) {
  console.error("Database error:", error);
  return new Response("Internal Server Error", { status: 500 });
}
```

### ストレージ選択の判断基準

```typescript
// KV: 頻繁な読み取り、更新頻度が低い
await env.KV.put("config:theme", "dark");
const theme = await env.KV.get("config:theme");

// D1: リレーショナルデータ、トランザクション
const result = await env.DB.prepare(
  "INSERT INTO users (name, email) VALUES (?, ?)"
).bind(name, email).run();

// R2: 大容量ファイル
await env.BUCKET.put("uploads/file.pdf", fileData);

// Analytics Engine: メトリクス、イベント
env.ANALYTICS.writeDataPoint({
  blobs: ["user_action", userId],
  doubles: [responseTime],
  indexes: ["action_timestamp"]
});
```

### パフォーマンス考慮事項

1. **KVのキャッシュ活用**
   - 頻繁にアクセスするデータはKVでキャッシュ
   - TTL（Time To Live）を適切に設定

2. **バッチ処理**
   - Queuesを使った非同期処理
   - Cron Triggersでの定期実行

3. **データローカリティ**
   - エッジで完結できる処理は最大限エッジで実行
   - 外部API呼び出しは最小限に

## Cloudflare固有の考慮事項

### 制限値

| リソース | 制限 | 備考 |
|---------|------|------|
| Workers CPU時間 | 50ms（Free）/ 30秒（Paid） | CPU集約的な処理に注意 |
| Workers メモリ | 128MB | 大きなオブジェクトの処理に注意 |
| KV キーサイズ | 512バイト | |
| KV バリューサイズ | 25MB | |
| D1 データベースサイズ | 10GB（有料プラン） | |
| R2 オブジェクトサイズ | 5TB | マルチパートアップロード使用 |

### コスト最適化

1. **R2の活用**: S3からのマイグレーションでエグレス料金削減
2. **KVの書き込み制限**: 書き込みは有料なので、更新頻度を最小化
3. **Workers実行時間**: 処理を効率化してCPU時間を削減
4. **Analytics Engineのサンプリング**: 必要に応じてデータをサンプリング

## デプロイメント

### インフラストラクチャ管理（Terraform）

Cloudflareリソース（R2、D1、KV、Queues）をTerraformで管理できます。

**推奨デプロイ戦略**: Terraform（インフラ）+ Wrangler（Workersデプロイ）

```bash
# 1. Terraformでインフラをプロビジョニング
cd terraform
terraform init
terraform apply

# 2. リソースIDを確認
terraform output kv_namespace_ids
terraform output d1_database_ids

# 3. wrangler.toml にリソースIDを設定
# 4. Wranglerでデプロイ
cd ..
wrangler deploy
```

**管理対象リソース**:
- R2 Buckets: データレイク（Bronze/Silver/Gold）、Terraformステート
- D1 Databases: パイプラインメタデータ、データ品質、ユーザープロファイル
- Workers KV: パイプライン状態、セッション、設定キャッシュ
- Cloudflare Queues: データ処理、パイプラインタスク
- Workers Scripts（オプション）

詳細は [terraform/README.md](../terraform/README.md) を参照してください。

### Wranglerを使ったデプロイ

```bash
# 開発環境での実行
wrangler dev

# プロダクションへのデプロイ
wrangler deploy

# 環境変数の設定
wrangler secret put API_KEY

# D1マイグレーション
wrangler d1 migrations apply <DATABASE_NAME>
```

### CI/CDパイプライン

GitHub Actionsを使用した自動デプロイ（推奨）:

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

## テスト戦略

1. **ユニットテスト**: Vitest または Jest
2. **統合テスト**: Miniflare（ローカルWorkersシミュレータ）
3. **E2Eテスト**: 本番環境でのスモークテスト

```typescript
// テスト例（Vitest）
import { describe, it, expect } from 'vitest';

describe('User API', () => {
  it('should return user data', async () => {
    const response = await handleRequest(mockRequest);
    expect(response.status).toBe(200);
  });
});
```

## セキュリティ

### 認証・認可

- **API認証**: Workers SecretsでAPIキー管理
- **ユーザー認証**: Cloudflare Access または外部IdP連携
- **CORS**: 適切なCORSヘッダー設定

### データ保護

- **暗号化**: R2はデフォルトで保存時暗号化
- **アクセス制御**: Service BindingsでWorkers間通信を制限
- **監査ログ**: Analytics Engineで重要なイベントを記録

## 監視とオブザーバビリティ

### メトリクス

- **Workers Analytics**: リクエスト数、レイテンシ、エラー率
- **Analytics Engine**: カスタムメトリクスの記録
- **外部ツール連携**: Grafana、Datadog、Sentryなど

### ログ管理

```typescript
// 構造化ログの推奨
console.log(JSON.stringify({
  level: "info",
  message: "User created",
  userId: userId,
  timestamp: new Date().toISOString()
}));
```

### アラート設定

- エラー率が閾値を超えた場合
- レスポンス時間の異常
- ストレージ容量の警告

## トラブルシューティング

### よくある問題

1. **Workers CPU時間超過**
   - 解決策: 処理を分割、Queuesで非同期化

2. **KV整合性の問題**
   - 解決策: 最終的整合性を考慮した設計、D1への移行検討

3. **D1接続エラー**
   - 解決策: リトライロジック実装、エラーハンドリング強化

## 参考リソース

### 公式ドキュメント

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Workers KV](https://developers.cloudflare.com/kv/)
- [R2 Storage](https://developers.cloudflare.com/r2/)
- [D1 Database](https://developers.cloudflare.com/d1/)
- [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)

### コミュニティ

- [Cloudflare Developers Discord](https://discord.gg/cloudflaredev)
- [Cloudflare Community](https://community.cloudflare.com/)
- [GitHub - cloudflare/workers-sdk](https://github.com/cloudflare/workers-sdk)

### ブログ・チュートリアル

- [Cloudflare Blog](https://blog.cloudflare.com/)
- [Workers Examples](https://developers.cloudflare.com/workers/examples/)

## プロジェクトロードマップ

### Phase 1: 基盤構築（現在）
- [x] アーキテクチャ設計ドキュメント作成
- [ ] Wrangler環境セットアップ
- [ ] 基本的なWorkers実装
- [ ] D1スキーマ設計

### Phase 2: コア機能実装
- [ ] データ取り込みパイプライン
- [ ] ストレージ層の実装
- [ ] Analytics Engine統合
- [ ] 基本的なダッシュボード
- [x] dbtプロジェクトセットアップ
- [x] Elementaryデータ品質監視統合

### Phase 3: 拡張機能
- [ ] リアルタイム処理（Durable Objects）
- [ ] 高度な分析機能
- [ ] 外部システム連携（Hyperdrive）
- [ ] 監視・アラート体制

### Phase 4: 最適化
- [ ] パフォーマンスチューニング
- [ ] コスト最適化
- [ ] セキュリティ強化
- [ ] ドキュメント整備

## 貢献ガイドライン

1. **ブランチ戦略**: `main` ブランチは常にデプロイ可能な状態を維持
2. **コミットメッセージ**: Conventional Commits形式を推奨
3. **プルリクエスト**: レビュー必須、テスト通過が必要
4. **ドキュメント**: 新機能追加時は必ずドキュメント更新

## ライセンス

TBD

---

最終更新: 2025-12-25
