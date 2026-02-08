# Pulumi Infrastructure Management

## Pulumiで管理していないリソース

以下のリソースは **Pulumiで管理していません**:

### Cloudflare Workers

| Worker名 | 管理方法 | 理由 |
|----------|---------|------|
| `ingestion` | Cloudflare Dashboard GitHub連携 | コードのデプロイはGitHub Actionsで自動化されており、Pulumiで管理する必要がない |

**注意**: Workers のコード、バインディング、環境変数などは `wrangler.jsonc` および GitHub 連携で管理されています。Pulumi で管理すると二重管理となり混乱を招くため、意図的に除外しています。

### その他のリソース

現時点で以下のリソースも Pulumi 管轄外です（必要に応じて今後追加検討）:

- **Cloudflare DNS**: DNSレコード管理
- **Cloudflare Access**: 認証・認可
- **Cloudflare Tunnels**: プライベートネットワーク接続
