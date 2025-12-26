# Cloudflare Zero Trust & Tunnels セキュリティガイド

データ基盤のダッシュボード、レポート、内部ツールを保護するためのCloudflare Zero TrustとTunnels活用ガイド。

## 📋 目次

1. [概要](#概要)
2. [Cloudflare Access (Zero Trust)](#cloudflare-access-zero-trust)
3. [Cloudflare Tunnels](#cloudflare-tunnels)
4. [ダッシュボード保護の実装](#ダッシュボード保護の実装)
5. [Workers API保護](#workers-api保護)
6. [ベストプラクティス](#ベストプラクティス)

---

## 概要

### 保護対象

このプロジェクトで保護すべきリソース：

| リソース | デプロイ先 | 公開レベル | 保護方法 |
|---------|-----------|-----------|---------|
| **Elementary Report** | Cloudflare Pages | 🔒 社内のみ | Cloudflare Access |
| **Great Expectations Docs** | Cloudflare Pages | 🔒 社内のみ | Cloudflare Access |
| **marimo Notebooks** | Cloudflare Pages | 🔒 社内のみ | Cloudflare Access |
| **AI Workers** | Cloudflare Workers | 🔐 API認証 | Workers Secrets + Access |
| **dbt Docs** | Cloudflare Pages | 🔒 社内のみ | Cloudflare Access |
| **R2 Data Lake** | R2 Storage | 🔒 プライベート | Pre-signed URLs + Access |

### セキュリティレイヤー

```
┌─────────────────────────────────────────────────────────┐
│                    ユーザー                              │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│        Cloudflare Access (Zero Trust)                    │
│  - Identity Provider認証 (Google, GitHub, Okta)         │
│  - アクセスポリシー (メール、グループベース)                │
│  - セッション管理とMFA                                    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Cloudflare Pages / Workers                  │
│  - Elementary Report                                     │
│  - Great Expectations Data Docs                          │
│  - marimo Notebooks                                      │
│  - AI Workers APIs                                       │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Cloudflare Tunnel                           │
│  - プライベートネットワークへの安全なアクセス                │
│  - オンプレミスDBへの接続                                  │
│  - 内部サービスへのアクセス                                 │
└─────────────────────────────────────────────────────────┘
```

---

## Cloudflare Access (Zero Trust)

### 1. セットアップ

#### 1.1 Zero Trustダッシュボードへのアクセス

```bash
# Cloudflare Dashboardから
# Zero Trust > Access > Applications
# https://one.dash.cloudflare.com/
```

#### 1.2 Identity Provider (IdP) 設定

##### Google Workspaceの例

1. **Zero Trust > Settings > Authentication** に移動
2. **Login methods** で **Add new** をクリック
3. **Google** を選択
4. Google Cloud Consoleで OAuth 2.0 クライアントを作成：

```
Authorized redirect URIs:
https://<your-team-name>.cloudflareaccess.com/cdn-cgi/access/callback
```

5. Client IDとClient Secretを入力して保存

##### GitHubの例

1. **Login methods** で **GitHub** を選択
2. GitHub OAuth App作成:
   - Settings > Developer settings > OAuth Apps > New OAuth App
   - Authorization callback URL: `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback`
3. Client IDとClient Secretを設定

##### その他のIdP

- **Azure AD** - Microsoft 365ユーザー向け
- **Okta** - エンタープライズSSO
- **OneLogin** - エンタープライズSSO
- **SAML 2.0** - カスタムSAML IdP

### 2. アクセスポリシーの作成

#### 2.1 Elementary Reportの保護

```yaml
Application Name: Elementary Data Quality Report
Application Domain: elementary-report.pages.dev

Policy:
  Name: Allow Company Employees
  Action: Allow

  Rules:
    - Include:
        Emails ending in: @company.com
    - Require:
        Email: data-team@company.com
        OR
        Groups: data-engineering, analytics
```

**実装手順:**

1. **Zero Trust > Access > Applications** で **Add an application**
2. **Self-hosted** を選択
3. アプリケーション設定:

```yaml
Application name: Elementary Report
Session Duration: 24 hours
Application domain: elementary-report.pages.dev
```

4. ポリシー追加:

```yaml
Policy name: Allow Data Team
Action: Allow

Include:
  - Emails ending in: @yourcompany.com

Require (少なくとも1つ):
  - Email: alice@yourcompany.com
  - Email: bob@yourcompany.com
  - Everyone in group: data-team
```

5. **Save application**

#### 2.2 Great Expectations Data Docsの保護

同様に設定:

```yaml
Application name: Great Expectations Data Docs
Application domain: gx-data-docs.pages.dev

Policy:
  Include: Emails ending in @yourcompany.com
  Require: Everyone in group "data-quality"
```

#### 2.3 marimo Notebooksの保護

```yaml
Application name: marimo Notebooks
Application domain: marimo-notebooks.pages.dev

Policy:
  Include: Emails ending in @yourcompany.com
  Require: Everyone in group "data-scientists"
```

### 3. Service Tokenによる自動化

GitHub ActionsからPages deploymentする際、Accessを回避する方法：

#### 3.1 Service Token作成

```bash
# Zero Trust > Access > Service Auth > Service Tokens
# Create Service Token

Token Name: github-actions-deploy
Duration: 1 year
```

保存される値:
- **Client ID**: `xxxxx.access`
- **Client Secret**: `yyyyyyyyyyyyyy`

#### 3.2 GitHub Secretsに登録

```bash
# GitHub Repository > Settings > Secrets and variables > Actions

CF_ACCESS_CLIENT_ID: xxxxx.access
CF_ACCESS_CLIENT_SECRET: yyyyyyyyyyyyyy
```

#### 3.3 Wrangler設定でBypass

デプロイ時にService Tokenを使用してAccess保護をバイパス:

```toml
# wrangler.toml または Pages設定
[env.production]
compatibility_date = "2024-01-01"

# Access保護されたPages
# デプロイ後に手動でAccessを有効化
```

デプロイ後、手動でCloudflare Accessを有効化するのが推奨。

### 4. API保護 (Workers)

Workers APIエンドポイントの保護:

#### 4.1 Access Policy for Workers

```yaml
Application name: AI Workers API
Application domain: ai-workers.yourcompany.workers.dev

Policy:
  Include:
    - Service Token: github-actions
    - Emails: engineering@yourcompany.com
```

#### 4.2 Worker内でのAccess JWT検証

```javascript
// workers/ai/protected-llm-chat.js

export default {
  async fetch(request, env) {
    // Cloudflare AccessのJWT検証
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');

    if (!jwt) {
      return new Response('Unauthorized - No JWT', { status: 401 });
    }

    try {
      // JWTを検証（Cloudflare Access自動検証）
      // 追加のカスタム検証が必要な場合
      const payload = await verifyAccessJWT(jwt, env);

      if (!payload.email.endsWith('@yourcompany.com')) {
        return new Response('Forbidden', { status: 403 });
      }

      // 通常のWorker処理
      return await handleLLMChat(request, env);

    } catch (error) {
      return new Response('Invalid JWT', { status: 401 });
    }
  }
};

async function verifyAccessJWT(jwt, env) {
  // Cloudflare Accessの公開鍵でJWT検証
  // https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN; // e.g., "yourcompany"
  const certsUrl = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;

  // JWT検証ロジック（省略）
  // 実際にはjsonwebtokenライブラリ等を使用

  return JSON.parse(atob(jwt.split('.')[1]));
}
```

---

## Cloudflare Tunnels

### 1. Tunnelの概要

Cloudflare Tunnelを使用すると、プライベートネットワーク内のリソースにインバウンドポートを開けずに安全にアクセスできます。

**ユースケース:**
- オンプレミスのPostgreSQL/MySQLへの接続
- 内部API、管理ダッシュボードへのアクセス
- プライベートR2バケットへのアクセス
- 開発環境のプレビュー

### 2. Tunnel セットアップ

#### 2.1 cloudflaredのインストール

```bash
# Linux
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# macOS
brew install cloudflare/cloudflare/cloudflared

# Docker
docker pull cloudflare/cloudflared:latest
```

#### 2.2 認証

```bash
cloudflared tunnel login
# ブラウザが開き、Cloudflareアカウントで認証
```

#### 2.3 Tunnelの作成

```bash
# Tunnel作成
cloudflared tunnel create data-platform-tunnel

# 出力例:
# Tunnel credentials written to /home/user/.cloudflared/xxxxx-xxxx-xxxx.json
# Tunnel token: eyJhIjoixxxxx...
```

#### 2.4 設定ファイル作成

```yaml
# ~/.cloudflared/config.yml

tunnel: data-platform-tunnel
credentials-file: /home/user/.cloudflared/xxxxx-xxxx-xxxx.json

# ルーティング設定
ingress:
  # Elementary Report (ローカルホスト)
  - hostname: elementary-internal.yourcompany.com
    service: http://localhost:8080

  # Great Expectations Docs
  - hostname: gx-internal.yourcompany.com
    service: http://localhost:8081

  # PostgreSQL (Hyperdrive経由)
  - hostname: db-internal.yourcompany.com
    service: tcp://localhost:5432

  # marimo開発サーバー
  - hostname: marimo-dev.yourcompany.com
    service: http://localhost:2718

  # デフォルトルート
  - service: http_status:404
```

#### 2.5 DNSルートの設定

```bash
# DNS CNAME作成
cloudflared tunnel route dns data-platform-tunnel elementary-internal.yourcompany.com
cloudflared tunnel route dns data-platform-tunnel gx-internal.yourcompany.com
cloudflared tunnel route dns data-platform-tunnel marimo-dev.yourcompany.com
```

#### 2.6 Tunnel起動

```bash
# フォアグラウンド実行
cloudflared tunnel run data-platform-tunnel

# バックグラウンド実行 (systemd)
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

### 3. Dockerでの実行

```dockerfile
# docker-compose.yml

version: '3.8'

services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
    restart: unless-stopped
    networks:
      - data-platform
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}

  elementary-server:
    image: nginx:alpine
    volumes:
      - ./dbt/elementary_output:/usr/share/nginx/html
    ports:
      - "8080:80"
    networks:
      - data-platform

  gx-server:
    image: nginx:alpine
    volumes:
      - ./great_expectations/uncommitted/data_docs:/usr/share/nginx/html
    ports:
      - "8081:80"
    networks:
      - data-platform

networks:
  data-platform:
    driver: bridge
```

起動:

```bash
export CLOUDFLARE_TUNNEL_TOKEN="eyJhIjoixxxxx..."
docker-compose up -d
```

### 4. Tunnel + Access連携

Tunnelで公開したエンドポイントをCloudflare Accessで保護:

```yaml
# Zero Trust > Access > Applications

Application: Elementary Internal Report
Type: Self-hosted
Domain: elementary-internal.yourcompany.com

Policy:
  Include: Emails ending in @yourcompany.com
  Require: Groups - data-team
```

これにより、Tunnel経由でアクセスするユーザーも認証が必要になります。

---

## ダッシュボード保護の実装

### 1. Elementary Report

#### GitHub Actions修正

```yaml
# .github/workflows/elementary-monitor.yml

- name: Deploy Report to Cloudflare Pages
  if: github.ref == 'refs/heads/main'
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: pages deploy dbt/elementary_output --project-name=elementary-report --branch=main

# デプロイ後、手動でCloudflare Accessを有効化
# または、Wrangler API経由で自動設定
```

#### wrangler設定

```toml
# wrangler-elementary-pages.toml

name = "elementary-report"
compatibility_date = "2024-01-01"

[site]
bucket = "./dbt/elementary_output"

# アクセス制御はCloudflare Dashboardで手動設定
# または以下のコマンドで設定:
# wrangler pages deployment create elementary-report --branch=main
```

#### 手動Access設定

1. Cloudflare Dashboard > Zero Trust > Access > Applications
2. Add application > Self-hosted
3. **Application domain**: `elementary-report.pages.dev`
4. ポリシー設定（上記参照）

### 2. Great Expectations Data Docs

同様に保護:

```yaml
# .github/workflows/great-expectations.yml

- name: Deploy Data Docs to Cloudflare Pages (Protected)
  if: github.ref == 'refs/heads/main'
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: pages deploy great_expectations/uncommitted/data_docs/cloudflare_pages_site --project-name=gx-data-docs --branch=main

# 手動でAccess設定を追加
```

### 3. marimo Notebooks

```yaml
# .github/workflows/marimo-notebooks.yml

- name: Deploy notebooks to Cloudflare Pages (Protected)
  if: github.ref == 'refs/heads/main'
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    command: pages deploy marimo/outputs --project-name=marimo-notebooks --branch=main
```

---

## Workers API保護

### 1. API Key認証 + Cloudflare Access

```javascript
// workers/ai/protected-api.js

export default {
  async fetch(request, env) {
    // レイヤー1: Cloudflare Access JWT検証
    const accessJWT = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!accessJWT) {
      return new Response('Access JWT required', { status: 401 });
    }

    // レイヤー2: API Key検証
    const apiKey = request.headers.get('X-API-Key');
    const validKey = await env.API_KEYS.get(apiKey);

    if (!validKey) {
      return new Response('Invalid API Key', { status: 403 });
    }

    // レイヤー3: レート制限
    const rateLimitKey = `ratelimit:${apiKey}`;
    const count = await env.RATE_LIMIT.get(rateLimitKey);

    if (parseInt(count || '0') > 100) {
      return new Response('Rate limit exceeded', { status: 429 });
    }

    await env.RATE_LIMIT.put(rateLimitKey, (parseInt(count || '0') + 1).toString(), {
      expirationTtl: 3600
    });

    // 実際のAPI処理
    return await handleAPIRequest(request, env);
  }
};
```

### 2. mTLS (Mutual TLS) 認証

さらに高いセキュリティが必要な場合:

```yaml
# Cloudflare Dashboard > SSL/TLS > Client Certificates

# クライアント証明書を発行して、特定のクライアントのみアクセス許可
```

Workers側:

```javascript
export default {
  async fetch(request, env) {
    const clientCert = request.cf?.tlsClientAuth;

    if (!clientCert?.verified) {
      return new Response('Client certificate required', { status: 401 });
    }

    // 証明書のフィンガープリント検証
    const allowedFingerprints = [
      'xx:xx:xx:xx:...',
      'yy:yy:yy:yy:...'
    ];

    if (!allowedFingerprints.includes(clientCert.fingerprint)) {
      return new Response('Invalid certificate', { status: 403 });
    }

    // API処理
  }
};
```

---

## ベストプラクティス

### 1. 多層防御 (Defense in Depth)

```
Layer 1: Cloudflare Access (IdP認証)
  ↓
Layer 2: API Key / Service Token
  ↓
Layer 3: Rate Limiting
  ↓
Layer 4: Worker内部のロジック検証
  ↓
Layer 5: R2 / D1 アクセス制御
```

### 2. 最小権限の原則

```yaml
# アクセスポリシー例

# データエンジニア - フルアクセス
Group: data-engineering
Access:
  - Elementary Report (Read/Write)
  - GX Data Docs (Read/Write)
  - marimo Notebooks (Read/Write)
  - AI Workers (All)

# データアナリスト - 読み取りのみ
Group: data-analysts
Access:
  - Elementary Report (Read)
  - GX Data Docs (Read)
  - marimo Notebooks (Read)
  - AI Workers (Query only)

# 経営層 - ダッシュボードのみ
Group: executives
Access:
  - marimo Notebooks (Read - Summary dashboards only)
```

### 3. 監査ログ

```javascript
// Workers内でアクセスログを記録

export default {
  async fetch(request, env) {
    const accessJWT = request.headers.get('Cf-Access-Jwt-Assertion');
    const user = parseJWT(accessJWT);

    // Analytics Engineにアクセスログ記録
    env.ANALYTICS.writeDataPoint({
      blobs: [
        'access_log',
        user.email,
        request.url,
        request.method
      ],
      doubles: [Date.now()],
      indexes: [new Date().toISOString()]
    });

    // 処理継続...
  }
};
```

### 4. セッション管理

```yaml
# Cloudflare Access設定

Session Duration: 8 hours
Idle Timeout: 1 hour
Require MFA: Yes (for sensitive resources)

# セッション失効後は再認証が必要
```

### 5. 環境分離

```yaml
# 本番環境
Domain: *.production.yourcompany.com
Access Policy: Strict (MFA required, specific emails only)

# ステージング環境
Domain: *.staging.yourcompany.com
Access Policy: Medium (All employees)

# 開発環境
Domain: *.dev.yourcompany.com
Access Policy: Relaxed (Engineering team)
```

### 6. シークレット管理

```bash
# GitHub Secretsに保存（絶対にコードにハードコードしない）

CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET
CLOUDFLARE_TUNNEL_TOKEN

# Workers Secretsに保存
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put DATABASE_PASSWORD
```

### 7. 定期的なアクセスレビュー

```bash
# 四半期ごとに実施
1. Cloudflare Access > Access Groups - メンバー確認
2. Service Tokens - 使用状況確認、未使用トークン削除
3. API Keys (KV) - 期限切れキー削除
4. Audit Logs - 異常なアクセスパターン確認
```

---

## トラブルシューティング

### 1. Access認証ループ

**症状**: ログイン後も何度もログイン画面に戻る

**解決策**:
```bash
# ブラウザのCookie削除
# または
# Cloudflare Access > Applications > [Your App] > Session Duration 確認
```

### 2. Tunnel接続エラー

**症状**: `cloudflared` が接続できない

**解決策**:
```bash
# ログ確認
cloudflared tunnel info data-platform-tunnel

# DNS設定確認
dig elementary-internal.yourcompany.com

# 再起動
sudo systemctl restart cloudflared
```

### 3. Service Token動作しない

**症状**: GitHub Actionsからのデプロイが401エラー

**解決策**:
```bash
# Service Token有効期限確認
# Zero Trust > Access > Service Auth > Service Tokens

# Token再生成して、GitHub Secretsに再登録
```

---

## 参考リンク

### 公式ドキュメント

- [Cloudflare Zero Trust](https://developers.cloudflare.com/cloudflare-one/)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [Service Tokens](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)
- [JWT Validation](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/)

### チュートリアル

- [Protect Pages with Access](https://developers.cloudflare.com/pages/how-to/access-protected-pages/)
- [Tunnel Quick Start](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/get-started/)

---

最終更新: 2025-12-26
