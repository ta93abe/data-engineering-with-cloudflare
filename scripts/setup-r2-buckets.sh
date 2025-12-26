#!/bin/bash

# R2バケット作成スクリプト
# Usage: bash scripts/setup-r2-buckets.sh

set -e

echo "======================================"
echo "R2バケットセットアップスクリプト"
echo "======================================"
echo ""

# 色付け用の関数
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

success() {
    echo -e "${GREEN}✓${NC} $1"
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
}

# Wranglerインストール確認
if ! command -v wrangler &> /dev/null; then
    error "Wrangler CLIがインストールされていません"
    echo "以下のコマンドでインストールしてください:"
    echo "  npm install -g wrangler"
    exit 1
fi

success "Wrangler CLI確認完了"

# ログイン確認
echo ""
echo "Cloudflareアカウント情報を確認中..."
if ! wrangler whoami &> /dev/null; then
    warning "Cloudflareにログインしていません"
    echo "ログインを実行します..."
    wrangler login
fi

ACCOUNT_INFO=$(wrangler whoami 2>&1)
success "ログイン確認完了"
echo "$ACCOUNT_INFO"

# バケット作成
echo ""
echo "======================================"
echo "R2バケットを作成します"
echo "======================================"
echo ""

BUCKETS=("data-lake-raw" "data-lake-processed" "data-lake-curated" "data-lake-archive")

for BUCKET in "${BUCKETS[@]}"; do
    echo "Creating bucket: $BUCKET"

    # バケットが既に存在するか確認（正確な名前一致でチェック）
    if wrangler r2 bucket list 2>&1 | awk 'NR>1 {print $1}' | grep -Fxq "$BUCKET"; then
        warning "バケット '$BUCKET' は既に存在します（スキップ）"
    else
        if wrangler r2 bucket create "$BUCKET"; then
            success "バケット '$BUCKET' を作成しました"
        else
            error "バケット '$BUCKET' の作成に失敗しました"
        fi
    fi
    echo ""
done

# 確認
echo "======================================"
echo "作成されたバケット一覧"
echo "======================================"
wrangler r2 bucket list

echo ""
success "R2バケットのセットアップが完了しました！"
echo ""
echo "次のステップ:"
echo "1. Cloudflare Dashboardで data-lake-curated の R2 Data Catalog を有効化"
echo "   https://dash.cloudflare.com/ > R2 > Buckets > data-lake-curated > Data Catalog"
echo ""
echo "2. APIトークンとアクセスキーを作成"
echo "   詳細: docs/iceberg-setup-guide.md を参照"
echo ""
