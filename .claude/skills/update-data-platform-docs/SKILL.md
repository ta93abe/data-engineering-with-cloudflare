---
name: update-data-platform-docs
description: Cloudflare Data Platform のドキュメント (docs/cloudflare-data-platform.md) を最新の公式情報に基づいて更新する。サイトが更新されたときや定期的な情報の鮮度チェックに使用する。
argument-hint: "[セクション名(任意)] 特定セクションのみ更新する場合に指定"
---

# Cloudflare Data Platform ドキュメント更新スキル

## 目的

`docs/cloudflare-data-platform.md` を Cloudflare Data Platform の最新公式情報に基づいて更新する。

## 更新対象のセクション引数

引数 `$ARGUMENTS` が指定された場合、そのセクションのみを重点的に更新する。
指定がない場合はドキュメント全体を確認・更新する。

## 手順

### Step 1: 現在のドキュメントを読み込む

Read ツールで `docs/cloudflare-data-platform.md` を読み込み、現在の内容を把握する。

### Step 2: 最新情報を取得する

以下のソースから最新情報を取得する。**すべてのソースを並列で取得すること。**

#### 必須ソース（毎回取得）

1. **プロダクトページ**: WebFetch で `https://workers.cloudflare.com/product/data-platform/` を取得
2. **Pipelines ドキュメント**: WebFetch で `https://developers.cloudflare.com/pipelines/` を取得
3. **R2 Data Catalog ドキュメント**: WebFetch で `https://developers.cloudflare.com/r2/data-catalog/` を取得
4. **R2 SQL ドキュメント**: WebFetch で `https://developers.cloudflare.com/r2-sql/` を取得

#### 補足ソース（変更が検出された場合や詳細が必要な場合に取得）

5. **Pipelines 全文ドキュメント**: WebFetch で `https://developers.cloudflare.com/pipelines/llms-full.txt` を取得（制限値・CLI コマンド・スキーマ定義の詳細）
6. **発表ブログ**: WebFetch で `https://blog.cloudflare.com/cloudflare-data-platform/` を取得
7. **R2 SQL 深掘り**: WebFetch で `https://blog.cloudflare.com/r2-sql-deep-dive/` を取得
8. **E2E チュートリアル**: WebFetch で `https://developers.cloudflare.com/r2-sql/tutorials/end-to-end-pipeline/` を取得
9. **最新ニュース**: WebSearch で `Cloudflare Data Platform Pipelines R2 SQL update` を検索（直近の変更・新機能の確認）

### Step 3: 差分を特定する

取得した最新情報と現在のドキュメントを比較し、以下の変更点を特定する。

- **新機能の追加**: 新しいサービス、機能、SQL関数、APIエンドポイントなど
- **制限値の変更**: アカウントあたりの制限数、レート制限、ペイロードサイズなど
- **料金の変更**: ベータ終了、新しい課金体系など
- **ステータスの変更**: ベータ → GA、ロードマップの進捗など
- **CLI コマンドの変更**: 新コマンド、構文変更、非推奨化など
- **アーキテクチャの変更**: 新コンポーネント、統合先の追加など
- **廃止・非推奨**: 削除された機能、非推奨になったAPIなど

### Step 4: ドキュメントを更新する

変更点がある場合、Edit ツールで `docs/cloudflare-data-platform.md` を更新する。

#### 更新ルール

1. **既存の構成・スタイルを維持する**: セクション番号、見出しレベル、表形式、コードブロックのスタイルを統一
2. **日本語で記述する**: 技術用語・プロダクト名・コマンドは英語のまま、説明文は日本語
3. **差分のみ更新する**: 変更のないセクションは触らない
4. **最終更新日を更新する**: ドキュメント末尾の `最終更新:` を本日の日付に変更
5. **ロードマップの更新**: リリース済み機能は「リリース済み」に変更し、新しい予定を追加
6. **参考リンクの更新**: 新しい公式ドキュメントやブログ記事があれば追加
7. **コード例の更新**: APIやCLIの構文が変わった場合はコード例も更新

### Step 5: 更新サマリーを報告する

更新内容をユーザーに報告する。以下の形式で出力すること:

```
## 更新サマリー

### 変更あり
- [セクション名]: 変更内容の概要

### 変更なし
- 変更が検出されなかったセクションの一覧

### 注意事項
- ベータ終了予定、大きなアーキテクチャ変更予定など、今後注意が必要な点
```

変更が一切なかった場合は「最新の状態です。変更は検出されませんでした。」と報告する。
