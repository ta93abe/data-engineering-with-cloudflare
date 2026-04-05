# Flame - Data Catalog

Cloudflare Workers上にデプロイされるデータカタログアプリケーション。
データプラットフォーム全体のデータセットを閲覧・検索できるUIを提供します。

## Tech Stack

- **Astro 6** - Webフレームワーク
- **React 19** - UIコンポーネント
- **Cloudflare Kumo** - UIコンポーネントライブラリ
- **Tailwind CSS v4** - スタイリング
- **Cloudflare Workers** - デプロイ先

## Project Structure

```text
data-catalog-app/
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   ├── AppSidebar.tsx      # Kumo Sidebar ナビゲーション
│   │   └── DataCatalog.tsx     # データセット一覧・検索UI
│   ├── layouts/
│   │   └── Layout.astro        # ベースHTMLレイアウト
│   ├── pages/
│   │   └── index.astro         # ホームページ
│   └── styles/
│       └── global.css          # Kumo + Tailwind CSS設定
├── astro.config.mjs            # Astro設定
├── wrangler.jsonc              # Cloudflare Workers設定
└── package.json
```

## Getting Started

```bash
pnpm install
pnpm dev        # localhost:4321 で起動
```

## Commands

| Command          | Action                              |
| :--------------- | :---------------------------------- |
| `pnpm install`   | 依存関係をインストール              |
| `pnpm dev`       | 開発サーバーを起動 (`localhost:4321`) |
| `pnpm build`     | プロダクションビルド (`./dist/`)     |
| `pnpm preview`   | ビルド結果をローカルでプレビュー    |
