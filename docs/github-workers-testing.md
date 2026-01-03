# GitHub Workers テストガイド

このドキュメントでは、GitHub データ取得 Workers のテストについて説明します。

## 📋 テスト概要

### テストフレームワーク

- **Vitest**: 高速なユニットテストフレームワーク
- **カバレッジ**: v8 プロバイダーによるコードカバレッジ測定

### テスト対象

#### Scheduler Worker (`workers/github-scheduler/`)
- リポジトリ一覧の取得
- ページネーション処理
- レート制限とリトライ
- Queueへのメッセージ送信（バッチ処理）
- KVへのメタデータ保存
- Analytics Engine統合
- HTTPエンドポイント（`/status/:id`, `/trigger`）

#### Fetcher Worker (`workers/github-fetcher/`)
- Queueメッセージの処理
- 7種類のGitHubリソース取得
- ページネーション処理
- レート制限とリトライ
- R2へのデータ保存（Hiveパーティション）
- データのエンリッチメント（メタデータ追加）
- エラーハンドリングとリトライ
- Analytics Engine統合

## 🚀 テスト実行方法

### セットアップ

依存関係のインストール:

```bash
# Scheduler Worker
cd workers/github-scheduler
npm install

# Fetcher Worker
cd workers/github-fetcher
npm install
```

### テストコマンド

#### すべてのテストを実行

```bash
# Scheduler Worker
cd workers/github-scheduler
npm test

# Fetcher Worker
cd workers/github-fetcher
npm test
```

#### ウォッチモード（開発時）

```bash
npm run test:watch
```

ファイル変更を監視して自動的にテストを再実行します。

#### カバレッジレポート

```bash
npm run test:coverage
```

カバレッジレポートは `coverage/` ディレクトリに生成されます:
- `coverage/index.html` - ブラウザで見やすいHTMLレポート
- `coverage/coverage-final.json` - JSON形式の詳細レポート

### 両方のWorkerをまとめてテスト

プロジェクトルートから:

```bash
# すべてのテストを実行
(cd workers/github-scheduler && npm test) && (cd workers/github-fetcher && npm test)

# カバレッジ付きで実行
(cd workers/github-scheduler && npm run test:coverage) && (cd workers/github-fetcher && npm run test:coverage)
```

## 📊 テストカバレッジ目標

### 現在のカバレッジ

| Worker | ライン | 関数 | ブランチ |
|--------|--------|------|---------|
| Scheduler | 目標: 80%+ | 目標: 80%+ | 目標: 75%+ |
| Fetcher | 目標: 80%+ | 目標: 80%+ | 目標: 75%+ |

### カバレッジの確認

```bash
cd workers/github-scheduler
npm run test:coverage

# HTMLレポートを開く
open coverage/index.html  # macOS
xdg-open coverage/index.html  # Linux
```

## 🧪 テストケース詳細

### Scheduler Worker テスト

#### 1. リポジトリ取得テスト

**テストケース**:
- ✅ GitHub APIからリポジトリ一覧を取得できる
- ✅ ページネーションが正しく動作する（100件/ページ）
- ✅ レート制限時に適切にリトライする

**検証内容**:
```typescript
// リポジトリ取得
expect(global.fetch).toHaveBeenCalledWith(
  expect.stringContaining('https://api.github.com/user/repos'),
  expect.objectContaining({
    headers: expect.objectContaining({
      Authorization: 'token test-token',
    }),
  })
);
```

#### 2. Queueメッセージ送信テスト

**テストケース**:
- ✅ リポジトリをQueueに送信できる
- ✅ 100件ごとにバッチ送信される
- ✅ メッセージに必要な情報が含まれる

**検証内容**:
```typescript
// バッチ送信
expect(env.GITHUB_QUEUE.sendBatch).toHaveBeenCalledTimes(3); // 250件 = 3バッチ

// メッセージ構造
expect(firstMessage.body).toHaveProperty('repository_id');
expect(firstMessage.body).toHaveProperty('execution_id');
```

#### 3. メタデータ保存テスト

**テストケース**:
- ✅ 実行開始時にメタデータを保存
- ✅ 実行完了時にメタデータを更新
- ✅ エラー時にステータスを'failed'に更新

**検証内容**:
```typescript
const metadata = JSON.parse(value);
expect(metadata).toHaveProperty('execution_id');
expect(metadata).toHaveProperty('repositories_count', 1);
expect(metadata).toHaveProperty('status', 'completed');
```

#### 4. HTTPエンドポイントテスト

**テストケース**:
- ✅ `GET /status/:execution_id` でステータスを取得できる
- ✅ 存在しない実行IDで404を返す
- ✅ `POST /trigger` で手動実行できる

### Fetcher Worker テスト

#### 1. Queueメッセージ処理テスト

**テストケース**:
- ✅ 単一メッセージを処理できる
- ✅ バッチ内の複数メッセージを処理できる
- ✅ エラー時にメッセージをリトライする

**検証内容**:
```typescript
// 成功時
expect(message.ack).toHaveBeenCalled();

// エラー時
expect(message.retry).toHaveBeenCalled();
```

#### 2. GitHubリソース取得テスト

**テストケース**:
- ✅ 7種類のリソースを取得できる
  - repositories（リポジトリ詳細）
  - issues（課題）
  - pull_requests（PR）
  - commits（コミット）
  - stargazers（Star履歴）
  - releases（リリース）
  - workflow_runs（CI/CD実行履歴）
- ✅ ページネーションが動作する
- ✅ 404エラーを適切に処理する
- ✅ レート制限時にリトライする

**検証内容**:
```typescript
// 全リソース取得
expect(global.fetch).toHaveBeenCalledTimes(7);

// ページネーション
expect(issuesCallCount).toBe(2); // 2ページ取得
```

#### 3. R2保存テスト

**テストケース**:
- ✅ Hiveパーティション構造で保存される
- ✅ データにメタデータが追加される
- ✅ 正しいContent-Typeが設定される

**検証内容**:
```typescript
// Hiveパーティション
expect(path).toMatch(
  /^sources\/github\/repositories\/year=\d{4}\/month=\d{2}\/day=\d{2}\/[a-f0-9-]+\.json$/
);

// メタデータ追加
expect(firstRecord).toHaveProperty('_extracted_at');
expect(firstRecord).toHaveProperty('_execution_id');
expect(firstRecord).toHaveProperty('_repository_full_name');
```

#### 4. エラーハンドリングテスト

**テストケース**:
- ✅ APIエラー時にリトライする
- ✅ ネットワークエラーを処理できる
- ✅ Analytics Engineにエラーを記録する

## 🔧 モック実装

### 環境変数のモック

```typescript
const createMockEnv = () => ({
  GITHUB_TOKEN: 'test-token',
  GITHUB_QUEUE: {
    sendBatch: vi.fn(),
    _messages: [],
  },
  METADATA_KV: {
    put: vi.fn(),
    get: vi.fn(),
    _store: new Map(),
  },
  RAW_BUCKET: {
    put: vi.fn(),
    get: vi.fn(),
    _objects: new Map(),
  },
  ANALYTICS: {
    writeDataPoint: vi.fn(),
    _data: [],
  },
});
```

### GitHub API のモック

```typescript
const createMockFetch = (responses) => {
  return vi.fn(async (url, options) => {
    // URLパターンに応じてレスポンスを返す
    for (const [pattern, response] of responseMap.entries()) {
      if (url.includes(pattern)) {
        return {
          ok: response.ok ?? true,
          status: response.status ?? 200,
          json: async () => response.data || [],
          headers: new Map(Object.entries(response.headers || {})),
        };
      }
    }
  });
};
```

### Queueメッセージのモック

```typescript
const createMockMessage = (overrides = {}) => ({
  id: 'msg-123',
  timestamp: new Date(),
  body: {
    repository_id: 1,
    repository_full_name: 'user/test-repo',
    execution_id: 'exec-123',
    ...overrides,
  },
  ack: vi.fn(),
  retry: vi.fn(),
});
```

## 🐛 テストデバッグ

### デバッグモード

特定のテストだけを実行:

```bash
# テスト名でフィルタ
npm test -- -t "should fetch repositories"

# ファイルを指定
npm test -- test/index.test.ts
```

### 詳細ログ出力

```bash
# デバッグ情報を出力
DEBUG=* npm test
```

### VSCodeでのデバッグ

`.vscode/launch.json` に追加:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Vitest",
  "runtimeExecutable": "npm",
  "runtimeArgs": ["run", "test"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

## 📝 新しいテストの追加

### テストファイルの配置

```
workers/github-scheduler/
├── src/
│   └── index.ts
└── test/
    ├── index.test.ts       # メインテスト
    └── utils.test.ts       # ユーティリティテスト（必要に応じて）
```

### テストの書き方

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('新機能', () => {
  beforeEach(() => {
    // テストごとの初期化
  });

  it('should do something', async () => {
    // Arrange: テストデータの準備
    const mockData = { id: 1 };

    // Act: テスト対象の実行
    const result = await someFunction(mockData);

    // Assert: 結果の検証
    expect(result).toBe(expected);
  });
});
```

## 🚦 CI/CD統合

### GitHub Actionsでのテスト実行

`.github/workflows/test-workers.yml`:

```yaml
name: Test Workers

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Test Scheduler Worker
        working-directory: workers/github-scheduler
        run: |
          npm ci
          npm test

      - name: Test Fetcher Worker
        working-directory: workers/github-fetcher
        run: |
          npm ci
          npm test

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./workers/*/coverage/coverage-final.json
```

### デプロイ前の必須チェック

デプロイ前に以下を確認:

1. ✅ すべてのテストがパスする
2. ✅ カバレッジが目標値を満たす（80%以上）
3. ✅ リンターエラーがない
4. ✅ TypeScriptコンパイルエラーがない

```bash
# すべてのチェックを実行
cd workers/github-scheduler
npm test && npm run test:coverage
npx tsc --noEmit

cd ../github-fetcher
npm test && npm run test:coverage
npx tsc --noEmit
```

## 🔗 関連ドキュメント

- [GitHub Workers設計](./github-workers-design.md)
- [GitHub Workersセットアップガイド](./github-workers-setup.md)
- [GitHub実装計画](./github-implementation-plan.md)
- [Vitest公式ドキュメント](https://vitest.dev/)

## 📚 ベストプラクティス

### 1. テストは独立させる

各テストは他のテストに依存せず、独立して実行できるようにします。

### 2. モックは最小限に

実装の詳細ではなく、インターフェースをテストします。

### 3. 意味のあるテスト名

テスト名は「何をテストしているか」が明確にわかるようにします。

```typescript
// ✅ Good
it('should retry message when GitHub API returns 500 error', ...)

// ❌ Bad
it('test retry', ...)
```

### 4. Arrange-Act-Assert パターン

```typescript
it('should process repository', async () => {
  // Arrange: データ準備
  const mockRepo = { id: 1, name: 'test' };

  // Act: 実行
  const result = await processRepo(mockRepo);

  // Assert: 検証
  expect(result).toBeDefined();
});
```

### 5. エッジケースのテスト

正常系だけでなく、エラーケースやエッジケースもテストします:
- 空配列
- null/undefined
- レート制限
- ネットワークエラー
- 無効なデータ

## 🎯 まとめ

テストは以下を保証します:

1. **品質**: コードが期待通りに動作する
2. **信頼性**: リグレッションを防ぐ
3. **保守性**: リファクタリングを安全に行える
4. **ドキュメント**: テストコードが仕様を表現する

テストを書いて、安心してデプロイしましょう！
