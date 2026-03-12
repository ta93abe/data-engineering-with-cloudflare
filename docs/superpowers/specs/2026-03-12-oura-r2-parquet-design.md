# Oura Ring データを R2 に Parquet で保存する

**Linear Issue**: TA-398
**Date**: 2026-03-12
**Status**: Design Approved

## 概要

Oura Ring の健康データ（睡眠・活動量・準備度・心拍数）を、Ingestion Worker で取得時に `parquet-wasm` を使って Parquet 形式に変換し、R2 バケット (`data-lake`) に直接保存する。D1 への Oura データ書き込みは廃止し、R2 Parquet を source of truth とする。

## 設計判断

| 判断項目 | 決定 | 理由 |
|---------|------|------|
| 保存先 | R2 Parquet のみ（D1 廃止） | D1 の 10GB 制限回避、カラムナーで分析向き、エグレス無料 |
| 変換タイミング | Ingestion 時に同時変換 | シンプル、リアルタイム性が高い |
| ファイル粒度 | テーブル別 × 日付パーティション | dbt source として自然、スケーラブル |
| Parquet 生成 | `parquet-wasm` | Workers V8 で動く唯一の実用的選択肢 |
| API 取得単位 | 1ヶ月チャンク | Oura API の制限に準拠 |
| 初回バックフィル | 環境変数で開始日指定 | 柔軟性確保 |
| 移行期間 | エージェントの D1 クエリは一時利用不可 | TA-401 (DuckDB WASM) で対応 |

## アーキテクチャ

```
Oura API (OAuth2)
    │
    ▼
┌──────────────────────────┐
│  Ingestion Worker (Cron) │
│  ├─ fetch Oura API       │
│  ├─ parquet-wasm encode  │
│  └─ R2 PUT               │
└──────────────────────────┘
    │
    ▼
R2 "data-lake" bucket
├── oura/daily_sleep/2024-01-01.parquet
├── oura/daily_activity/2024-01-01.parquet
├── oura/daily_readiness/2024-01-01.parquet
└── oura/heart_rate/2024-01-01.parquet
```

### 変更しないもの

- `agents/` — D1 → DuckDB WASM 移行は TA-401 で対応
- D1 マイグレーション — Oura テーブルの DROP は TA-401 完了後
- GitHub / Linear / Withings の取り込み — スコープ外

## R2 パス構造

```
data-lake/
└── oura/
    ├── daily_sleep/
    │   ├── 2024-01-01.parquet
    │   ├── 2024-01-02.parquet
    │   └── ...
    ├── daily_activity/
    │   └── ...
    ├── daily_readiness/
    │   └── ...
    └── heart_rate/
        ├── 2024-01-01.parquet   # 1日あたり最大288行（5分間隔）
        └── ...
```

## Parquet スキーマ

カラム名・型は D1 マイグレーション (`0002_oura_tables.sql`) に準拠する。

### daily_sleep

| カラム | Parquet 型 | 備考 |
|--------|-----------|------|
| day | STRING | `2026-03-12` |
| score | INT32 | nullable |
| deep_sleep | INT32 | contributor |
| efficiency | INT32 | contributor |
| latency | INT32 | contributor |
| rem_sleep | INT32 | contributor |
| restfulness | INT32 | contributor |
| timing | INT32 | contributor |
| total_sleep | INT32 | contributor |
| timestamp | STRING | ISO8601 |
| synced_at | STRING | ISO8601、取得時刻 |

### daily_activity

| カラム | Parquet 型 | 備考 |
|--------|-----------|------|
| day | STRING | |
| score | INT32 | nullable |
| active_calories | INT32 | |
| total_calories | INT32 | |
| steps | INT32 | |
| equivalent_walking_distance | FLOAT | メートル (REAL) |
| high_activity_time | INT32 | 秒 |
| medium_activity_time | INT32 | 秒 |
| low_activity_time | INT32 | 秒 |
| sedentary_time | INT32 | 秒 |
| resting_time | INT32 | 秒 |
| met_average | FLOAT | REAL |
| meet_daily_targets | INT32 | contributor |
| move_every_hour | INT32 | contributor |
| recovery_time | INT32 | contributor |
| stay_active | INT32 | contributor |
| training_frequency | INT32 | contributor |
| training_volume | INT32 | contributor |
| timestamp | STRING | ISO8601 |
| synced_at | STRING | ISO8601 |

### daily_readiness

| カラム | Parquet 型 | 備考 |
|--------|-----------|------|
| day | STRING | |
| score | INT32 | nullable |
| temperature_deviation | FLOAT | |
| temperature_trend_deviation | FLOAT | |
| activity_balance | INT32 | nullable, contributor |
| body_temperature | INT32 | nullable, contributor |
| hrv_balance | INT32 | nullable, contributor |
| previous_day_activity | INT32 | nullable, contributor |
| previous_night | INT32 | nullable, contributor |
| recovery_index | INT32 | nullable, contributor |
| resting_heart_rate | INT32 | nullable, contributor |
| sleep_balance | INT32 | nullable, contributor |
| timestamp | STRING | ISO8601 |
| synced_at | STRING | ISO8601 |

### heart_rate

| カラム | Parquet 型 | 備考 |
|--------|-----------|------|
| bpm | INT32 | |
| source | STRING | `awake`, `rest`, `sleep` 等 |
| timestamp | STRING | ISO8601 |
| day | STRING | パーティションキーと同値だがクエリ利便性のため保持 |
| synced_at | STRING | ISO8601 |

**注記**: D1 の `id` カラム（auto-increment PK）は Parquet では不要なため除外。

## 処理フロー

### 通常の Cron 実行（日次）

```
1. D1 の sync_state から last_sync_at を取得
2. start_date = last_sync_at, end_date = today
3. 1ヶ月チャンクに分割（通常は1チャンクで済む）
4. チャンクごとに:
   a. Oura API から4種のデータ取得（sleep, activity, readiness, heart_rate）
   b. 日付ごとにグループ化
   c. parquet-wasm で各日・各テーブルの Parquet 生成
   d. R2 PUT（既存ファイルは上書き = 冪等）
5. D1 の sync_state.last_sync_at を更新
```

### 初回バックフィル

```
1. sync_state の last_sync_at が NULL（レコードは存在するが値が未設定）
2. start_date = OURA_BACKFILL_START_DATE（環境変数）
3. end_date = today
4. 1ヶ月チャンクに分割（例: 2024-01-01〜2026-03-12 = 約27チャンク）
5. 各チャンクで上記 4a〜4d を実行
6. sync_state を作成・更新
```

### 冪等性

- 同じ日付のファイルは上書き → リトライ安全
- Oura API 側でデータが後から更新されても、次回 sync で上書きされる

### エラーハンドリング

- チャンク単位で try/catch、失敗したチャンクはスキップして次へ
- `sync_state` は成功した最後のチャンクの end_date で更新
- Workers の 30秒 CPU 制限を考慮し、1回の Cron で処理するチャンク数が多い場合は注意

### レートリミット

- Oura API の 429 レスポンスに対して、チャンク間に固定ディレイ（1秒）を挿入
- 429 発生時はそのチャンクをスキップし、次回の Cron で再取得（冪等性により安全）

### OAuth トークン管理

- バックフィル時はチャンクごとにトークンの有効期限を確認
- 期限切れの場合はリフレッシュしてから続行

## ファイル変更一覧

### 変更

| ファイル | 変更内容 |
|---------|---------|
| `ingestion/package.json` | `parquet-wasm` 依存追加 |
| `ingestion/src/services/oura.ts` | D1 書き込み → Parquet 生成 + R2 PUT に変更 |
| `ingestion/src/types.ts` | Parquet スキーマ定義の型追加、`Env` に `DATA_LAKE: R2Bucket` 追加 |
| `ingestion/wrangler.jsonc` | `r2_buckets` バインディング追加、`OURA_BACKFILL_START_DATE` 変数追加 |

### 新規作成

| ファイル | 内容 |
|---------|------|
| `ingestion/src/services/parquet.ts` | parquet-wasm ラッパー（スキーマ定義、エンコード関数） |
| `ingestion/src/__tests__/parquet.test.ts` | Parquet 生成の単体テスト |

## 後続タスクへの影響

| タスク | 影響 |
|--------|------|
| TA-399 (dbt モデル) | R2 の Parquet を dbt source として読む。httpfs 拡張で `s3://data-lake/oura/daily_sleep/*.parquet` をクエリ |
| TA-401 (DuckDB WASM) | エージェントが R2 の Parquet を DuckDB WASM で直接クエリ |
| TA-400 (Sandbox dbt) | R2 上の Parquet を入力として dbt 変換を実行 |

## 技術的考慮事項

### parquet-wasm の PoC（実装前に確認）

実装前に以下を検証する spike タスクを設ける:

1. `parquet-wasm` が Workers V8 ランタイムでバンドル・初期化できるか
2. WASM バイナリサイズが Paid プランのデプロイ制限 (10MB) 内に収まるか
3. 簡単なスキーマで Parquet エンコードが CPU・メモリ制限内で動くか

**フォールバック**: PoC で動かない場合、JSON で R2 に書き出し、後段 (Sandbox の dbt) で Parquet 変換する方式に切り替える。

### parquet-wasm のサイズ

- WASM バイナリは数MB。Paid プランのデプロイサイズ制限 (10MB) 内に収まるか確認が必要
- `parquet-wasm/esm` の tree-shakeable ビルドを使用してサイズ最小化

### Workers CPU 制限

- Paid プランで 30秒
- 1ヶ月チャンク × 4テーブル × 最大31日 = 最大124ファイル生成
- Parquet エンコード自体は軽量（数十行のデータ）なので問題なし
- バックフィル時の27チャンクを1回の Cron で処理するとタイムアウトの可能性あり → チャンク数制限の検討
- メモリ (128MB) は日単位処理のため問題なし（各ファイルは数KB）

### Heart Rate API の制限

- Oura Heart Rate API は `start_datetime` / `end_datetime` パラメータを使用（他の API とは異なる）
- 現在のコードでは30日超の場合は heart rate をスキップし、7日以内に制限している
- 1ヶ月チャンク（最大31日）は API 制限の境界にあるため、heart rate のみ安全マージンとして30日に制限する

### 既存 HTTP ルートの扱い

- `oura.ts` には `/oura/sleep`, `/oura/stats` 等の D1 クエリ HTTP ルートが存在する
- これらは TA-401 (DuckDB WASM) で R2 対応に書き換えるまで、一時的に動作しなくなる
- D1 の Oura テーブル自体は残るが、新規データの書き込みが停止するため、古いデータのみ返す状態になる

### D1 の残存用途

- `oauth_tokens`: Oura OAuth2 のアクセストークン/リフレッシュトークン管理
- `sync_state`: 各データソースの最終同期日時管理
- GitHub / Linear / Withings のデータテーブル（今回スコープ外）
