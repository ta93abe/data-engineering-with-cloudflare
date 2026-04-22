# spotify-iceberg

Spotify の再生履歴（`me/player/recently-played`）を毎時取得し、R2 Data Catalog 上の Apache Iceberg テーブルに追記する Cloudflare Worker + Container パイプライン。

## アーキテクチャ

- **Worker** (TypeScript): cron トリガを受けて Durable Object backed Container を起動、KV を `outboundByHost` 経由でコンテナに露出
- **Container** (Python + FastAPI + PyIceberg): Spotify OAuth refresh、`recently-played` のページング取得、PyArrow テーブル生成、R2 Data Catalog への Iceberg commit
- **状態管理**: Workers KV に `refresh_token` と `played_at_ms` カーソルを保存
- **ELT 指向**: Iceberg レイヤは raw ネスト構造 + `_raw_json` 補助列、flatten/集計は dbt 側で実施

## セットアップ（初回のみ）

### 1. R2 Data Catalog を有効化

```bash
wrangler r2 bucket catalog enable lake
```

表示される **Catalog URI** と **Warehouse** を控えておく（手順 6 で使用）。

### 2. Spotify Developer アプリを作成

<https://developer.spotify.com/dashboard> でアプリを作成し、Redirect URI に `http://localhost:8888/callback` を登録。Client ID と Client Secret を控える。

### 3. 手元で refresh_token を取得

```bash
uv run --with spotipy python scripts/spotify/get_refresh_token.py
```

ブラウザフローに従って同意すると、スクリプトが refresh_token を表示する。

### 4. KV namespace を作成

```bash
cd spotify-iceberg/worker
wrangler kv namespace create SPOTIFY_STATE_KV
```

出力された `id` を `wrangler.jsonc` の `kv_namespaces[0].id` に貼り付ける。

### 5. refresh_token を KV に投入

```bash
wrangler kv key put --binding=SPOTIFY_STATE_KV refresh_token "<手順 3 の値>"
```

### 6. Secrets を登録（`spotify-iceberg/worker/` で実行）

```bash
wrangler secret put SPOTIFY_CLIENT_ID
wrangler secret put SPOTIFY_CLIENT_SECRET
wrangler secret put R2_CATALOG_URI
wrangler secret put R2_CATALOG_TOKEN
wrangler secret put R2_CATALOG_WAREHOUSE
wrangler secret put R2_ENDPOINT
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

必要な Spotify scope は `user-read-recently-played`。

### 7. デプロイ

```bash
cd spotify-iceberg/worker && pnpm deploy
```

### 8. 動作確認

- 手動トリガ: `curl -X POST https://spotify-iceberg.<account>.workers.dev/trigger`
- ログ確認: `wrangler tail`
- DuckDB からクエリ:

```sql
INSTALL iceberg; LOAD iceberg;
ATTACH '<R2_CATALOG_URI>' AS r2 (TYPE ICEBERG, ENDPOINT_TYPE S3_TABLES);
SELECT played_at, track.name, track.artists[1].name
FROM r2.spotify.recently_played
ORDER BY played_at DESC LIMIT 10;
```

## 開発

- Worker: `cd worker && pnpm test:run && pnpm typecheck && pnpm check`
- Container: `cd container && uv run pytest && uv run ruff check .`

## 運用メモ

- 実行頻度: 毎時（`0 * * * *`）
- ページング: 1 回の cron で最大 10 ページ（= 500 件）まで `next` URL を追随
- カーソル初期値: KV に未設定なら直近 1 時間を `after` に指定
- エラー時: Spotify 5xx/429 は 3 回 exponential backoff、`invalid_grant` は即停止（再認可が必要）、container 500 は scheduled ハンドラで throw して Cloudflare 側に failed 記録
