# modeling Container 本番運用メモ

`modeling/` を Cloudflare Container (Worker + Durable Object) として
デプロイし、Snowflake に対して prod target で dbt build を通すまで
に踏んだ地雷と、その後の運用知見。2026-04-15 の検証結果ベース。

## 初回動作確認の最終形

```bash
# Worker URL
https://modeling.ta93abe.workers.dev

# Health (no auth)
curl https://modeling.ta93abe.workers.dev/health
# → {"status":"ok"}

# 環境変数の可視性確認 (no auth)
curl https://modeling.ta93abe.workers.dev/debug-env
# → {"SNOWFLAKE_ACCOUNT":"len=15","SNOWFLAKE_PRIVATE_KEY":"len=1703",
#    "SNOWFLAKE_PRIVATE_KEY_PATH":"len=25","SNOWFLAKE_USER":"len=7"}

# 本番 build
curl -X POST https://modeling.ta93abe.workers.dev/build \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"target":"prod","select":"stg_patients"}'
# → returncode=0, PASS=6, artifacts_saved=[manifest.json, run_results.json]
```

実行時間: 初回約 7 分 (Container cold start + dbt deps + snowflake
connector 初期化込み)。2 回目以降は Container が生きていれば
build 自体は数十秒。

## 踏んだ地雷と対処

### 1. Container instance は Worker code 更新だけでは再起動しない

Worker の TypeScript (`src/index.ts`) だけを変更して
`pnpm wrangler deploy` しても、Container 側の image hash が
変わらない限り既存の Container instance は再起動されない。
envVars / 環境依存の挙動を変更しても、古いインスタンスが
そのまま使い続けられてしまう。

**対処:**
- Container image を変更するデプロイを挟む (server.py か
  Dockerfile を変更) → image rebuild → 古いインスタンス stop →
  新 image で start。
- もしくは `POST /restart` エンドポイントから
  `container.destroy()` を呼ぶ (このリポジトリには実装済み)。
- 最悪 `wrangler containers instances <ID>` で確認して
  `sleepAfter` 経過を待つ。

### 2. envVars は constructor で設定するのが確実

```typescript
// ❌ ダメ: クラスフィールドとして書くと、Container 基底クラスの
// envVars={} 初期化と順序が競合して空になるケースがある
export class DbtContainer extends Container<Env> {
  envVars = {
    SNOWFLAKE_ACCOUNT: this.env.SNOWFLAKE_ACCOUNT, // ← undefined 化する
  };
}

// ✅ OK: constructor で super() 後に代入
export class DbtContainer extends Container<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      SNOWFLAKE_ACCOUNT: env.SNOWFLAKE_ACCOUNT,
      SNOWFLAKE_USER: env.SNOWFLAKE_USER,
      SNOWFLAKE_PRIVATE_KEY: env.SNOWFLAKE_PRIVATE_KEY,
    };
  }
}
```

TypeScript class field の初期化タイミングが `@cloudflare/containers`
の `Container` 基底クラスの `envVars = {}` と競合し、subclass の
代入が無効化されるケースがある。constructor で明示的に代入すれば
順序が保証される。

### 3. undefined な worker secret は literal "undefined" 文字列として Container に渡る

Worker secret 未設定のキーを `envVars` に列挙すると、JS の
`undefined` が Container runtime 側で文字列 `"undefined"` に
stringify されて Container プロセスの環境変数に入ってしまう。
その結果、dbt の `env_var('SNOWFLAKE_DATABASE', 'DEVELOPMENT')`
は `"undefined"` を受け取り、fallback default が効かなくなり、
最終的に `Database "undefined"` エラーで死ぬ。

**対処:**
- **必須 secret** (`SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`,
  `SNOWFLAKE_PRIVATE_KEY`) だけを envVars に列挙。
- **任意 secret** (`SNOWFLAKE_ROLE`, `SNOWFLAKE_WAREHOUSE`,
  `SNOWFLAKE_DATABASE`, `SNOWFLAKE_SCHEMA`,
  `SNOWFLAKE_PRIVATE_KEY_PASSPHRASE`) は envVars に列挙せず、
  profiles.yml 側の `env_var('KEY', 'DEFAULT')` default に任せる。
- Env interface も必須だけにしておくと TypeScript が警告で守って
  くれる。

### 4. profiles.yml に Jinja `{% if %}` ブロックは使えない

```yaml
# ❌ これは YAML パーサエラーになる
private_key_path: "{{ env_var('SNOWFLAKE_PRIVATE_KEY_PATH') }}"
{% if env_var('SNOWFLAKE_PRIVATE_KEY_PASSPHRASE', '') %}
private_key_passphrase: "{{ env_var('SNOWFLAKE_PRIVATE_KEY_PASSPHRASE') }}"
{% endif %}
```

dbt は profiles.yml を YAML として先にパースしてから Jinja を
レンダリングする。`{% if %}` は YAML 構造の外に置かれた時点で
`while scanning for the next token / found character that cannot
start any token` で死ぬ。Jinja は **値レベル** (`"{{ ... }}"` の
中身) でしか使えない。

**対処:**
- optional な設定行は **ファイルから削除**して、必要になったら
  後から再追加する運用に倒す。
- 今回は `private_key_passphrase:` を完全削除した。暗号化鍵を
  使う場合は都度書き戻す。

### 5. `private_key_passphrase: ""` は Snowflake connector を混乱させる

Jinja default `{{ env_var('SNOWFLAKE_PRIVATE_KEY_PASSPHRASE', '') }}`
で空文字を渡すと、dbt-snowflake は空文字のまま Snowflake Python
connector に転送する。connector 側はそれを「password として何か
渡された」と解釈し、`Password was given but private key is not
encrypted` というエラーで失敗する。

**対処:** 上記 4 と同じく、行ごと削除する。

### 6. Docker Desktop が起動していないと `wrangler deploy` が失敗

Container 付きの Worker を deploy するには local に Docker
daemon が必要。Cloudflare の managed registry に push する前に
image を local で build するため。

```
✘ [ERROR] The Docker CLI could not be launched. Please ensure that
the Docker CLI is installed and the daemon is running.
```

**対処:** Docker Desktop を起動してから `pnpm wrangler deploy`。

### 7. Container 側の stdout は `wrangler tail` では見えない

`wrangler tail` は Worker 側の `console.log` だけを流す。
Container プロセスの Python `print()` は Cloudflare Container
の observability 経由でダッシュボードに出るが、CLI で tail する
公式コマンドは今のところ無い (2026-04 時点)。

**対処:** デバッグしたい情報は **Worker 経由で exposable な
HTTP エンドポイント**として返すのが速い。このリポジトリでは
`/debug-env` を追加して、Container の `os.environ` の中身を
key 長だけマスク付きで JSON で返すようにした。

### 8. Snowflake 個人 DB `USER$<user>` は DDL 不可

`USER$TA93ABE` などの個人データベースは read-only。
`CREATE TABLE` / `CREATE VIEW` で `060119 (0A000): Tables cannot
currently be created in a personal database` エラー。

**対処:** 書き込み可能な dev 用 DB (例: `DEVELOPMENT`) を別途
`CREATE DATABASE` して、`generate_database_name.sql` が dev target
で `target.database` を返す時にそちらを指すよう profiles.yml の
デフォルトを合わせる。

### 9. prod target 用の各レイヤー DB は事前作成が必要

`dbt_project.yml` で `+database: staging`, `+database: raw_vault`,
`+database: business_vault`, `+database: marts` を指定している
ので、prod target で動かすなら 4 つの DB が Snowflake 上に
存在している必要がある。存在しないと dbt が connection 時点で
落ちる。

**対処:**
```sql
CREATE DATABASE IF NOT EXISTS STAGING;
CREATE DATABASE IF NOT EXISTS RAW_VAULT;
CREATE DATABASE IF NOT EXISTS BUSINESS_VAULT;
CREATE DATABASE IF NOT EXISTS MARTS;
```

`snow sql --temporary-connection --authenticator SNOWFLAKE_JWT
--private-key-file "$SNOWFLAKE_PRIVATE_KEY_PATH" ...` で key pair
認証経由で実行可能 (SSO は SAML 設定で失敗するケースあり)。

## 運用 Tips

- **初回 build は 7 分程度覚悟**。Container cold start + image
  pull + Python deps cache build + dbt deps + snowflake connector
  初期化 + 実際の dbt build の合計。`curl --max-time` は
  900 秒 (15 分) 以上で回す。
- **secret 変更後は Container を再起動**しないと反映されない。
  `POST /restart` (API_KEY 必須) か sleepAfter 経過待ち。
- **必須 env var の可視化**は `GET /debug-env` で即確認可能
  (値は長さだけ返す、値本体は漏洩しない)。
- **prod 4 DB の存在確認**も運用手順に入れる。権限付与もセット
  (GRANT USAGE / CREATE SCHEMA / SELECT on FUTURE TABLES etc.)。

## 次の改善候補

- `POST /restart` が本番コードにまだ commit されていない状態の
  まま動作確認したので、実コード化の commit が必要。
- `/debug-env` はデバッグ用途で本番に残すのは debatable。
  auth 付きエンドポイントに変えるか、Worker 側で本番リリース前
  に削除するのが綺麗。
- `server.py` 起動時の環境変数 print ログも同様。
- Container instance を `wrangler containers instances` 経由で
  監視するジョブがあってもよい (特に docs generate 中のタイム
  アウトなど長時間処理で)。
