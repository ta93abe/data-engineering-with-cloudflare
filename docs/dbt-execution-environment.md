# dbt実行環境設計: Cloudflare Containers

## 1. 概要

本ドキュメントでは、dbtの実行環境としてCloudflare Containersを採用する設計について説明します。従来のGitHub Actions/ローカル実行から、Cloudflareエッジ上でのコンテナ実行に移行することで、データ基盤全体をCloudflareプラットフォームに統合します。

### 1.1 現状の課題

| 課題 | 詳細 |
|------|------|
| 実行環境の分散 | dbtはGitHub Actions/ローカル、データはR2と分離 |
| ネットワークレイテンシ | GitHub ActionsからR2へのアクセスは外部通信 |
| 運用の複雑さ | 複数プラットフォームの管理が必要 |
| コスト | GitHub Actionsの実行時間課金 |

### 1.2 設計目標

- **統合プラットフォーム**: Cloudflare上でデータ基盤を完結
- **低レイテンシ**: R2との同一ネットワーク内通信
- **スケーラビリティ**: オンデマンドでコンテナをスケール
- **コスト最適化**: 実行時間ベースの課金、エグレス無料

## 2. アーキテクチャ

### 2.1 全体構成

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Platform                          │
│                                                                 │
│  ┌──────────────┐    ┌──────────────────────────────────────┐  │
│  │   Workers    │    │     Cloudflare Containers            │  │
│  │  (トリガー)   │───▶│  ┌────────────────────────────────┐ │  │
│  │              │    │  │  dbt + DuckDB Container        │ │  │
│  │  - Cron      │    │  │  ┌─────────┐   ┌────────────┐  │ │  │
│  │  - HTTP API  │    │  │  │  dbt    │──▶│  DuckDB    │  │ │  │
│  │  - Queue     │    │  │  └─────────┘   └────────────┘  │ │  │
│  └──────────────┘    │  │       │              │         │ │  │
│                      │  └───────┼──────────────┼─────────┘ │  │
│                      └──────────┼──────────────┼───────────┘  │
│                                 │              │               │
│                      ┌──────────▼──────────────▼───────────┐  │
│                      │              R2 Storage              │  │
│                      │  ┌─────────┐  ┌─────────────────┐   │  │
│                      │  │ Iceberg │  │ Parquet/Delta   │   │  │
│                      │  │ Tables  │  │ Files           │   │  │
│                      │  └─────────┘  └─────────────────┘   │  │
│                      └─────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 コンポーネント詳細

#### 2.2.1 Cloudflare Containers

Dockerコンテナをエッジで実行するサービス。dbt + DuckDB環境をコンテナ化して実行します。

**インスタンスタイプの選定**:

| インスタンス | vCPU | メモリ | ディスク | 用途 |
|-------------|------|--------|----------|------|
| basic | 1/4 | 1 GiB | 4 GB | 軽量テスト |
| standard-1 | 1/2 | 4 GiB | 8 GB | 開発環境 |
| **standard-2** | **1** | **6 GiB** | **12 GB** | **本番推奨** |
| standard-3 | 2 | 8 GiB | 16 GB | 大規模処理 |

**推奨**: `standard-2`（6GB RAM）
- DuckDBのインメモリ処理に十分なメモリ
- dbt変換の並列実行に対応
- コストとパフォーマンスのバランス

#### 2.2.2 Workers（オーケストレーション）

Containersの起動・管理を担当するWorkers。

**トリガー方式**:
- **Cron Triggers**: 定期実行（毎時、毎日など）
- **HTTP API**: 手動実行、外部システム連携
- **Queues**: イベントドリブン実行

#### 2.2.3 R2 Storage（FUSEマウント）

R2バケットをコンテナ内のファイルシステムとしてマウント。

```
/data/
├── bronze/          # 生データ（Parquet/JSON）
├── silver/          # クレンジング済みデータ
├── gold/            # 集計済みデータ
└── iceberg/         # Icebergテーブル
```

> ⚠️ **R2 FUSEマウントの注意事項**
>
> | 特性 | 詳細 |
> |------|------|
> | **結果整合性** | R2は結果整合性モデル。書き込み直後の読み取りで古いデータが返る可能性あり |
> | **メタデータレイテンシ** | ディレクトリ一覧やファイル存在確認は通常のファイルシステムより遅い |
> | **一時ファイル** | コンテナディスクは**エフェメラル**（再起動で消失）。中間ファイルはR2に書き込む |
> | **Iceberg使用時** | コミットのアトミック性を保証するため、ロックプロバイダー設定が必要 |
>
> **推奨**: Icebergのスナップショット/マージ操作では、同時実行を避けるかロック機構を実装する

## 3. 実装設計

### 3.1 ディレクトリ構成

```
workers/
└── dbt-runner/
    ├── Dockerfile           # dbt + DuckDB環境
    ├── wrangler.toml        # Wrangler設定
    ├── src/
    │   └── index.ts         # Workerコード（トリガー）
    └── container/
        ├── entrypoint.sh    # コンテナエントリーポイント
        └── dbt/             # dbtプロジェクト（コピー）
```

### 3.2 Dockerfile

```dockerfile
# ⚠️ ベースイメージはダイジェストで固定（サプライチェーン攻撃対策）
FROM python:3.11-slim@sha256:abc123...  # 実際のダイジェストに置き換え

# セキュリティ: 非rootユーザーを作成
RUN groupadd --gid 1000 dbt \
    && useradd --uid 1000 --gid dbt --shell /bin/bash --create-home dbt

# システム依存関係（最小限、--no-install-recommends）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Python依存関係（バージョン固定 + ハッシュ検証）
COPY requirements.lock .
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

# アプリケーションディレクトリ
WORKDIR /app
RUN chown -R dbt:dbt /app

# ⚠️ profiles.ymlはイメージに含めない（ランタイムでマウント）
# dbtプロジェクト（機密情報を含まないもののみ）
COPY --chown=dbt:dbt dbt/dbt_project.yml dbt/packages.yml /app/dbt/
COPY --chown=dbt:dbt dbt/models/ /app/dbt/models/
COPY --chown=dbt:dbt dbt/macros/ /app/dbt/macros/

# エントリーポイント
COPY --chown=dbt:dbt entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 非rootユーザーで実行
USER dbt
WORKDIR /app/dbt

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import dbt; print('healthy')" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
```

**requirements.lock**（バージョン固定 + ハッシュ）:
```
# pip-compile --generate-hashes で生成
dbt-duckdb==1.7.4 \
    --hash=sha256:abc123...
duckdb==0.10.2 \
    --hash=sha256:def456...
pyarrow==15.0.0 \
    --hash=sha256:ghi789...
elementary-data[duckdb]==0.15.2 \
    --hash=sha256:jkl012...
```

> **Note**: `requirements.lock`は`pip-compile --generate-hashes requirements.txt`で生成します。Dependabot/Renovateで自動更新を推奨。

### 3.3 Wrangler設定

```toml
# wrangler.toml
name = "dbt-runner"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# Containerの設定
[[containers]]
class_name = "DbtContainer"
image = "./Dockerfile"
instance_type = "standard-2"

# R2バケットバインディング
[[r2_buckets]]
binding = "DATA_LAKE"
bucket_name = "data-lake"

# Analytics Engineバインディング（監視用）
[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "dbt_monitoring"

# 環境変数（非機密）
[vars]
DBT_TARGET = "prod"

# ⚠️ 機密情報は wrangler secret put で登録
# wrangler secret put API_KEY_SECRET
# wrangler secret put SLACK_WEBHOOK_URL

# Cronトリガー（定期実行）
[triggers]
crons = ["0 * * * *"]  # 毎時実行
```

### 3.4 Worker実装

```typescript
// src/index.ts
import { Container, getContainer } from "@cloudflare/containers";

export class DbtContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";  // 5分アイドルで停止

  // R2をFUSEマウント
  async onStart() {
    await this.mountR2("/data", this.env.DATA_LAKE);
  }
}

interface Env {
  DbtContainer: DurableObjectNamespace<DbtContainer>;
  DATA_LAKE: R2Bucket;
  ANALYTICS: AnalyticsEngineDataset;
  DBT_TARGET: string;
  API_KEY_SECRET: string;      // wrangler secret put で設定
  SLACK_WEBHOOK_URL: string;   // wrangler secret put で設定
}

// エラー通知関数
async function notifyError(error: Error, env: Env, context: string) {
  // Analytics Engineに記録
  env.ANALYTICS.writeDataPoint({
    blobs: ["dbt_error", context, error.message],
    indexes: [new Date().toISOString()]
  });

  // Slack通知
  if (env.SLACK_WEBHOOK_URL) {
    await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🚨 dbt実行エラー\nContext: ${context}\nError: ${error.message}`
      })
    });
  }
}

// 構造化ログ出力
function logEvent(level: string, event: string, details: Record<string, unknown>) {
  console.log(JSON.stringify({
    level,
    service: "dbt-runner",
    event,
    timestamp: new Date().toISOString(),
    ...details
  }));
}

// ⚠️ コマンド許可リスト（任意コマンド実行防止）
const ALLOWED_COMMANDS = ["build", "run", "test", "compile", "deps"] as const;
type AllowedCommand = typeof ALLOWED_COMMANDS[number];

function isAllowedCommand(cmd: string): cmd is AllowedCommand {
  return ALLOWED_COMMANDS.includes(cmd as AllowedCommand);
}

// ⚠️ 引数許可リスト（コマンドインジェクション対策）
const ALLOWED_FLAGS = [
  "--select", "-s",
  "--exclude",
  "--models", "-m",
  "--full-refresh",
  "--vars",
  "--threads",
  "--defer",
  "--state",
  "--no-version-check"
] as const;

// 禁止フラグ（セキュリティ上危険なオプション）
const FORBIDDEN_FLAGS = [
  "--profiles-dir",  // パス変更禁止（固定値を使用）
  "--project-dir",   // プロジェクトパス変更禁止
  "--log-path",      // ログパス変更禁止
  "--target-path",   // ターゲットパス変更禁止
] as const;

// 危険な文字パターン
const UNSAFE_PATTERNS = [
  /[;&|`$(){}[\]<>\\]/,  // シェルメタ文字
  /\.\./,                 // パストラバーサル
  /^-.*=/,               // --flag=value形式（パース回避の可能性）
];

function validateExtraArgs(args: string[]): { valid: boolean; reason?: string } {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // 禁止フラグのチェック
    for (const forbidden of FORBIDDEN_FLAGS) {
      if (arg === forbidden || arg.startsWith(`${forbidden}=`)) {
        return { valid: false, reason: `Forbidden flag: ${forbidden}` };
      }
    }

    // フラグの場合、許可リストに含まれているかチェック
    if (arg.startsWith("-")) {
      const isAllowed = ALLOWED_FLAGS.some(f => arg === f || arg.startsWith(`${f}=`));
      if (!isAllowed) {
        return { valid: false, reason: `Unknown flag: ${arg}` };
      }
    }

    // 危険なパターンのチェック
    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(arg)) {
        return { valid: false, reason: `Unsafe characters in argument: ${arg}` };
      }
    }

    // 引数の長さ制限
    if (arg.length > 500) {
      return { valid: false, reason: `Argument too long: ${arg.slice(0, 50)}...` };
    }
  }

  // 引数の総数制限
  if (args.length > 20) {
    return { valid: false, reason: `Too many arguments: ${args.length}` };
  }

  return { valid: true };
}

// 実行ID生成（トレーサビリティ用）
function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// リトライ付き実行
async function execWithRetry(
  container: Container,
  args: string[],
  maxRetries = 2,
  backoffMs = 5000
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await container.exec("dbt", args);
      if (result.exitCode === 0) return result;

      // Exit code 1 = 標準的なdbt失敗（テスト失敗等）- リトライしない
      // Exit code 2+ = インフラ系の一時的エラーの可能性 - リトライする
      if (attempt < maxRetries && result.exitCode > 1) {
        await new Promise(r => setTimeout(r, backoffMs * (attempt + 1)));
        continue;
      }
      return result;
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, backoffMs * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error("Execution failed after retries");
}

export default {
  // HTTP APIトリガー
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ヘルスチェックは認証不要
    if (url.pathname === "/health") {
      return Response.json({ status: "healthy" });
    }

    // ⚠️ API認証（必須）
    const apiKey = request.headers.get("X-API-KEY");
    if (apiKey !== env.API_KEY_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    // ⚠️ メソッド制限（POST のみ許可）
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // ⚠️ リクエストサイズ制限（JSONボディ考慮）
    const contentLength = request.headers.get("Content-Length");
    if (contentLength && parseInt(contentLength) > 4096) {
      return new Response("Payload Too Large", { status: 413 });
    }

    // ⚠️ リクエストボディからパラメータを取得（拡張性向上）
    let body: { command?: string; args?: string[] };
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    const container = getContainer(env.DbtContainer, "dbt-runner");

    if (url.pathname === "/run") {
      const runId = generateRunId();

      try {
        const command = body.command || "build";
        const extraArgs = body.args || [];

        // ⚠️ コマンド許可リストチェック
        if (!isAllowedCommand(command)) {
          return Response.json(
            { error: `Command not allowed: ${command}. Allowed: ${ALLOWED_COMMANDS.join(", ")}` },
            { status: 400 }
          );
        }

        // ⚠️ extraArgsのバリデーション（コマンドインジェクション対策）
        const validationResult = validateExtraArgs(extraArgs);
        if (!validationResult.valid) {
          return Response.json(
            { error: `Invalid argument: ${validationResult.reason}` },
            { status: 400 }
          );
        }

        logEvent("info", "manual_run_started", { runId, command, args: extraArgs });

        const result = await execWithRetry(container, [
          command,
          "--target", env.DBT_TARGET,
          "--profiles-dir", ".",
          ...extraArgs  // バリデーション済みの引数のみ展開
        ]);

        logEvent(
          result.exitCode === 0 ? "info" : "error",
          "manual_run_completed",
          { runId, command, exitCode: result.exitCode }
        );

        // アーティファクトをR2に永続化
        await persistArtifacts(container, env, runId);

        return Response.json({
          runId,
          success: result.exitCode === 0,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr
        });
      } catch (error) {
        await notifyError(error as Error, env, `manual_run:${runId}`);
        return Response.json({ runId, error: (error as Error).message }, { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },

  // Cronトリガー
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const runId = generateRunId();
    const container = getContainer(env.DbtContainer, "dbt-runner");

    logEvent("info", "scheduled_run_started", { runId, cron: event.cron });

    try {
      // dbt build: run + test を統合実行（依存関係を考慮）
      const buildResult = await execWithRetry(container, [
        "build",
        "--target", env.DBT_TARGET,
        "--profiles-dir", "."
      ]);

      logEvent(
        buildResult.exitCode === 0 ? "info" : "error",
        "dbt_build_result",
        { runId, exitCode: buildResult.exitCode }
      );

      if (buildResult.exitCode !== 0) {
        throw new Error(`dbt build failed with exit code ${buildResult.exitCode}`);
      }

      // Elementary実行（データ品質監視）- リトライ処理適用
      const elementaryResult = await execWithRetry(container, [
        "run",
        "--select", "elementary",
        "--target", env.DBT_TARGET,
        "--profiles-dir", "."
      ]);

      logEvent(
        elementaryResult.exitCode === 0 ? "info" : "error",
        "elementary_result",
        { runId, exitCode: elementaryResult.exitCode }
      );

      if (elementaryResult.exitCode !== 0) {
        throw new Error(`Elementary run failed with exit code ${elementaryResult.exitCode}`);
      }

      // アーティファクトをR2に永続化
      await persistArtifacts(container, env, runId);

      logEvent("info", "scheduled_run_completed", { runId, success: true });

    } catch (error) {
      logEvent("error", "scheduled_run_failed", { runId, error: (error as Error).message });
      await notifyError(error as Error, env, `scheduled_run:${runId}`);
    }
  }
};

// dbtアーティファクトをR2に永続化
async function persistArtifacts(container: Container, env: Env, runId: string) {
  const artifacts = ["manifest.json", "run_results.json", "catalog.json"];
  const timestamp = new Date().toISOString().split("T")[0];

  for (const artifact of artifacts) {
    try {
      const result = await container.exec("cat", [`/app/dbt/target/${artifact}`]);
      if (result.exitCode === 0 && result.stdout) {
        await env.DATA_LAKE.put(
          `_dbt_artifacts/${timestamp}/${runId}/${artifact}`,
          result.stdout
        );
      }
    } catch (error) {
      // アーティファクトがない場合はスキップするが、予期せぬエラーはログに残す
      logEvent("warn", "persist_artifact_failed", {
        runId,
        artifact,
        error: (error as Error).message
      });
    }
  }
}
```

### 3.5 dbt profiles.yml（Container用）

```yaml
# dbt/profiles.yml
cloudflare_data_platform:
  target: prod
  outputs:
    prod:
      type: duckdb
      path: ':memory:'
      extensions:
        - httpfs
        - parquet
        - iceberg
      settings:
        # R2はFUSEマウントされるため、ローカルパスでアクセス
        # ⚠️ standard-2のvCPUは1のため、threads=1〜2が最適
        # 過度なスレッド数はコンテキストスイッチのオーバーヘッドで逆効果
        threads: 2
        memory_limit: '4GB'
```

### 3.6 モデル例（R2マウント対応）

```sql
-- models/staging/stg_events.sql
{{ config(materialized='view') }}

SELECT
    event_id,
    event_type,
    user_id,
    event_timestamp,
    properties
FROM read_parquet('/data/bronze/events/*.parquet')
WHERE event_timestamp >= current_date - interval '30 days'
```

## 4. 代替案: Cloudflare Sandbox SDK

より簡易な実装が必要な場合、Sandbox SDKも選択肢となります。

### 4.1 Sandbox SDKの特徴

| 観点 | Containers | Sandbox SDK |
|------|-----------|-------------|
| カスタマイズ性 | ◎ Dockerfile自由 | △ プリセット環境 |
| セットアップ | △ やや複雑 | ◎ 簡単 |
| R2連携 | ◎ FUSEマウント | ◎ mountBucket API |
| Python環境 | ◎ 完全制御 | ○ 組み込み |
| 長時間実行 | ◎ | △ タイムアウト制限 |

### 4.2 Sandbox SDK実装例

```typescript
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  DATA_LAKE: R2Bucket;
  ACCOUNT_ID: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const sandbox = getSandbox(env.Sandbox, "dbt-runner");

    // R2をマウント
    await sandbox.mountBucket("data-lake", "/data", {
      endpoint: `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`
    });

    // dbtプロジェクトをセットアップ
    await sandbox.gitCheckout(
      "https://github.com/your-org/dbt-project.git",
      { targetDir: "/app/dbt" }
    );

    // 依存関係インストール
    await sandbox.exec("pip", {
      args: ["install", "dbt-duckdb", "elementary-data[duckdb]"]
    });

    // dbt実行
    const result = await sandbox.exec("dbt", {
      args: ["run", "--target", "prod"],
      cwd: "/app/dbt"
    });

    return Response.json(result);
  }
};
```

### 4.3 推奨選択

| ユースケース | 推奨 |
|-------------|------|
| 本番運用、定期実行 | **Containers** |
| PoC、軽量な検証 | Sandbox SDK |
| カスタム環境が必要 | **Containers** |
| 簡易なアドホック実行 | Sandbox SDK |

## 5. 運用設計

### 5.1 実行スケジュール

```toml
# wrangler.toml
[triggers]
crons = [
  "0 * * * *",     # 毎時: インクリメンタル更新
  "0 2 * * *",     # 毎日2時: フル更新
  "0 3 * * 0"      # 毎週日曜3時: Elementary監視
]
```

### 5.2 監視・アラート

```typescript
// エラー時の通知（context引数でエラー発生源を特定）
async function notifyError(error: Error, env: Env, context: string) {
  // Cloudflare Workers Analyticsに記録
  env.ANALYTICS.writeDataPoint({
    blobs: ["dbt_error", context, error.message],
    indexes: [new Date().toISOString()]
  });

  // 外部通知（Slack, PagerDutyなど）
  await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    body: JSON.stringify({
      text: `dbt実行エラー\nContext: ${context}\nError: ${error.message}`
    })
  });
}
```

### 5.3 ログ管理

```typescript
// 構造化ログ
console.log(JSON.stringify({
  level: "info",
  service: "dbt-runner",
  event: "run_started",
  target: env.DBT_TARGET,
  timestamp: new Date().toISOString()
}));
```

### 5.4 デバッグTips

```bash
# Workerのリアルタイムログを表示
wrangler tail dbt-runner

# コンテナの標準出力・エラーログを表示
wrangler containers logs dbt-runner

# ローカルでWorkerをテスト
wrangler dev

# 手動でdbtを実行（API経由）
curl -X POST "https://dbt-runner.<your-subdomain>.workers.dev/run" \
  -H "X-API-KEY: $API_KEY_SECRET" \
  -H "Content-Type: application/json"
```

### 5.5 環境分離（staging/prod）

本番環境と検証環境を分離し、安全なデプロイを実現します。

**wrangler.toml** (単一ファイルで環境管理):
```toml
# 共通設定（全環境で継承される）
name = "dbt-runner"
main = "src/index.ts"
compatibility_date = "2024-01-01"
account_id = "$ACCOUNT_ID"

# 本番環境（デフォルト）
[[containers]]
class_name = "DbtContainer"
image = "./Dockerfile"
instance_type = "standard-2"
max_instances = 1

[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "dbt_metrics"

[vars]
DBT_TARGET = "prod"

[[r2_buckets]]
binding = "DATA_LAKE"
bucket_name = "data-lake"

[triggers]
crons = [
  "0 * * * *",
  "0 2 * * *",
  "0 3 * * 0"
]

# ========================================
# staging環境 (wrangler deploy --env staging)
# ========================================
[env.staging]
name = "dbt-runner-staging"

# バインディングは非継承のため、環境ごとに完全定義が必要
[[env.staging.containers]]
class_name = "DbtContainer"
image = "./Dockerfile"
instance_type = "standard-1"  # stagingは低スペック
max_instances = 1

[[env.staging.analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "dbt_metrics_staging"

[[env.staging.r2_buckets]]
binding = "DATA_LAKE"
bucket_name = "data-lake-staging"

[env.staging.vars]
DBT_TARGET = "staging"

# staging用Cron（本番より頻度を下げる）
[env.staging.triggers]
crons = ["0 */6 * * *"]  # 6時間ごと
```

**デプロイフロー**:
```bash
# staging環境へデプロイ
wrangler deploy --env staging

# stagingでテスト後、本番へデプロイ
wrangler deploy
```

**CI/CDでの事前検証**:
```yaml
# .github/workflows/dbt-deploy.yml
- name: Preflight check
  run: |
    # 変更されたモデルのみテスト
    uv run dbt test --select state:modified --target ci

    # staging環境へデプロイ
    wrangler deploy -c wrangler.staging.toml

    # E2Eテスト
    curl -X POST "$STAGING_URL/run?command=build" -H "X-API-KEY: $STAGING_API_KEY"
```

## 6. セキュリティ

### 6.1 認証・認可

| 対策 | 実装 |
|------|------|
| API認証 | `X-API-KEY`ヘッダーによる認証 |
| Secrets管理 | `wrangler secret put`で暗号化保存 |
| アクセス制御 | Cloudflare Accessとの連携（オプション） |

**Cloudflare Accessによる保護（推奨）**:
より強固な認証が必要な場合、Cloudflare AccessをWorkerの前に配置し、許可されたユーザー/グループのみがアクセスできるように保護できます。

### 6.2 コンテナセキュリティ

**脆弱性スキャンの導入**:

CI/CDパイプラインにTrivyやSnykを組み込み、ベースイメージとPythonライブラリの脆弱性を定期的にチェックします。

```yaml
# .github/workflows/container-scan.yml
name: Container Security Scan

on:
  push:
    paths:
      - 'workers/dbt-runner/Dockerfile'
      - 'workers/dbt-runner/requirements.txt'

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: docker build -t dbt-runner workers/dbt-runner/

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'dbt-runner'
          format: 'table'
          exit-code: '1'
          severity: 'CRITICAL,HIGH'
```

### 6.3 ベストプラクティス

1. **最小権限の原則**: R2バケットへのアクセスは必要最小限に
2. **Secretsのローテーション**: API キーは定期的に更新
3. **監査ログ**: Analytics Engineで重要なイベントを記録
4. **ネットワーク分離**: Service Bindingsで内部通信を保護

## 7. コスト試算

### 7.1 Cloudflare Containers料金

| 項目 | 単価 | 想定使用量 | 月額コスト |
|------|------|-----------|-----------|
| vCPU（アクティブ） | $0.02/vCPU-hr | 30時間/月 | $0.60 |
| メモリ | $0.002/GiB-hr | 180 GiB-hr/月 | $0.36 |
| ディスク | $0.0002/GB-hr | 360 GB-hr/月 | $0.07 |
| **合計** | | | **~$1/月** |

※ standard-2インスタンス、1日1時間実行の場合

### 7.2 GitHub Actionsとの比較

| 項目 | GitHub Actions | Cloudflare Containers |
|------|---------------|----------------------|
| 実行時間 | $0.008/分 | ~$0.03/時間 |
| R2アクセス | 外部通信 | 内部通信（高速） |
| エグレス | 課金あり | 無料 |
| 管理 | 分離 | 統合 |

## 8. 移行計画

### Phase 1: PoC（1週間）
- [ ] Dockerfileの作成・テスト
- [ ] ローカルでのコンテナ動作確認
- [ ] Wrangler設定の作成

### Phase 2: 開発環境（1週間）
- [ ] Cloudflare Containersへのデプロイ
- [ ] R2マウントの動作確認
- [ ] 手動実行のテスト

### Phase 3: 本番移行（1週間）
- [ ] Cronトリガーの設定
- [ ] 監視・アラートの設定
- [ ] GitHub Actions CIの並行運用

### Phase 4: 完全移行
- [ ] GitHub Actions CIの停止
- [ ] ドキュメント更新
- [ ] 運用手順の確立

## 9. 参考リンク

- [Cloudflare Containers ドキュメント](https://developers.cloudflare.com/containers/)
- [Cloudflare Sandbox SDK](https://developers.cloudflare.com/sandbox/)
- [R2 FUSEマウント](https://developers.cloudflare.com/containers/examples/r2-fuse-mount/)
- [dbt-duckdb アダプター](https://github.com/duckdb/dbt-duckdb)

---

最終更新: 2026-01-16
