#!/bin/bash

#
# Cloudflare Access セットアップスクリプト
#
# このスクリプトは、データ基盤のダッシュボードとレポートに
# Cloudflare Accessによるアクセス制御を設定します。
#
# 前提条件:
# - Cloudflare Zero Trustアカウントが有効
# - Identity Provider (Google, GitHub等) が設定済み
# - 環境変数が設定されている
#

set -e

# 色付き出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Cloudflare Access セットアップスクリプト${NC}\n"

# 環境変数チェック
if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo -e "${RED}エラー: CLOUDFLARE_ACCOUNT_ID が設定されていません${NC}"
    exit 1
fi

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo -e "${RED}エラー: CLOUDFLARE_API_TOKEN が設定されていません${NC}"
    exit 1
fi

if [ -z "$CLOUDFLARE_ZONE_ID" ]; then
    echo -e "${YELLOW}警告: CLOUDFLARE_ZONE_ID が設定されていません（カスタムドメイン使用時に必要）${NC}"
fi

ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID
API_TOKEN=$CLOUDFLARE_API_TOKEN

echo "Account ID: $ACCOUNT_ID"
echo ""

# Cloudflare API Base URL
API_BASE="https://api.cloudflare.com/client/v4"

#
# 関数: Access Applicationを作成
#
create_access_application() {
    local app_name=$1
    local domain=$2
    local allowed_emails=$3  # カンマ区切り
    local session_duration=$4

    echo -e "${GREEN}Creating Access Application: $app_name${NC}"
    echo "  Domain: $domain"
    echo "  Allowed: $allowed_emails"
    echo ""

    # Access Application作成APIリクエスト
    response=$(curl -s -X POST \
        "$API_BASE/accounts/$ACCOUNT_ID/access/apps" \
        -H "Authorization: Bearer $API_TOKEN" \
        -H "Content-Type: application/json" \
        --data @- <<EOF
{
  "name": "$app_name",
  "domain": "$domain",
  "type": "self_hosted",
  "session_duration": "$session_duration",
  "auto_redirect_to_identity": false,
  "allowed_idps": [],
  "policies": [
    {
      "name": "Allow Company Employees",
      "decision": "allow",
      "include": [
        {
          "email_domain": {
            "domain": "$(echo $allowed_emails | cut -d'@' -f2)"
          }
        }
      ],
      "require": [],
      "exclude": []
    }
  ]
}
EOF
    )

    # レスポンス確認
    if echo "$response" | grep -q '"success":true'; then
        echo -e "${GREEN}✓ Access Application作成成功: $app_name${NC}\n"
    else
        echo -e "${RED}✗ Access Application作成失敗: $app_name${NC}"
        echo "$response" | jq '.'
        echo ""
    fi
}

#
# 関数: Service Token作成
#
create_service_token() {
    local token_name=$1
    local duration=$2  # e.g., "8760h" (1 year)

    echo -e "${GREEN}Creating Service Token: $token_name${NC}"

    response=$(curl -s -X POST \
        "$API_BASE/accounts/$ACCOUNT_ID/access/service_tokens" \
        -H "Authorization: Bearer $API_TOKEN" \
        -H "Content-Type: application/json" \
        --data @- <<EOF
{
  "name": "$token_name",
  "duration": "$duration"
}
EOF
    )

    if echo "$response" | grep -q '"success":true'; then
        client_id=$(echo "$response" | jq -r '.result.client_id')
        client_secret=$(echo "$response" | jq -r '.result.client_secret')

        echo -e "${GREEN}✓ Service Token作成成功${NC}"
        echo -e "${YELLOW}以下をGitHub Secretsに保存してください:${NC}"
        echo "  CF_ACCESS_CLIENT_ID=$client_id"
        echo "  CF_ACCESS_CLIENT_SECRET=$client_secret"
        echo ""
    else
        echo -e "${RED}✗ Service Token作成失敗${NC}"
        echo "$response" | jq '.'
        echo ""
    fi
}

#
# メイン処理
#

echo -e "${YELLOW}=== Step 1: Access Applications作成 ===${NC}\n"

# ユーザー入力
read -p "会社のメールドメイン (例: yourcompany.com): " email_domain
read -p "セッション時間 (例: 24h, 8h): " session_duration

# Elementary Report
create_access_application \
    "Elementary Data Quality Report" \
    "elementary-report.pages.dev" \
    "@$email_domain" \
    "$session_duration"

# Great Expectations Data Docs
create_access_application \
    "Great Expectations Data Docs" \
    "gx-data-docs.pages.dev" \
    "@$email_domain" \
    "$session_duration"

# marimo Notebooks
create_access_application \
    "marimo Notebooks" \
    "marimo-notebooks.pages.dev" \
    "@$email_domain" \
    "$session_duration"

# dbt Docs (オプション)
read -p "dbt Docsも保護しますか? (y/n): " protect_dbt
if [ "$protect_dbt" = "y" ]; then
    create_access_application \
        "dbt Documentation" \
        "dbt-docs.pages.dev" \
        "@$email_domain" \
        "$session_duration"
fi

echo -e "${YELLOW}=== Step 2: Service Token作成 (GitHub Actions用) ===${NC}\n"

read -p "Service Tokenを作成しますか? (y/n): " create_token
if [ "$create_token" = "y" ]; then
    create_service_token "github-actions-deploy" "8760h"
fi

echo -e "${YELLOW}=== Step 3: 次のステップ ===${NC}\n"

echo "1. Cloudflare Zero Trust Dashboardで設定を確認:"
echo "   https://one.dash.cloudflare.com/"
echo ""
echo "2. Identity Providerが設定されていることを確認"
echo ""
echo "3. Service TokenをGitHub Secretsに追加:"
echo "   Settings > Secrets and variables > Actions"
echo ""
echo "4. テストアクセス:"
echo "   https://elementary-report.pages.dev"
echo "   → ログインプロンプトが表示されることを確認"
echo ""

echo -e "${GREEN}セットアップ完了！${NC}"
