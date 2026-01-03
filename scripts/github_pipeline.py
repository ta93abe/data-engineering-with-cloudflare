"""
GitHub データ取得パイプライン

dlt の GitHub ソースを使用して、リポジトリのメトリクスとアクティビティを取得し、
Cloudflare R2 の Bronze Layer (data-lake-raw) に保存します。

取得データ:
- リポジトリ情報 (stars, forks, languages, topics)
- Issues (オープン/クローズ、ラベル、アサイン、コメント)
- Pull Requests (マージ状態、レビュー、コメント)
- Commits (履歴、コントリビューター)
- Releases (バージョン、アセット)
- Workflows (GitHub Actions実行履歴)
- Stars履歴
- Reactions

必要な環境変数:
- GITHUB_TOKEN: GitHub Personal Access Token
- R2_ENDPOINT: R2エンドポイントURL
- R2_ACCESS_KEY_ID: R2アクセスキーID
- R2_SECRET_ACCESS_KEY: R2シークレットアクセスキー
- R2_BUCKET_NAME: R2バケット名
"""

import os
import sys
from datetime import datetime, timezone
from typing import Optional

import dlt
from dlt.sources.helpers import requests


def load_github_data(
    access_token: str,
    r2_endpoint: str,
    r2_access_key_id: str,
    r2_secret_access_key: str,
    r2_bucket_name: str,
    owner: Optional[str] = None,
    repo_names: Optional[list[str]] = None,
) -> None:
    """
    GitHub データを R2 に取得・保存

    Args:
        access_token: GitHub Personal Access Token
        r2_endpoint: R2 エンドポイント URL
        r2_access_key_id: R2 アクセスキー ID
        r2_secret_access_key: R2 シークレットアクセスキー
        r2_bucket_name: R2 バケット名
        owner: GitHubユーザー名またはOrganization名 (Noneの場合は認証ユーザーの全リポジトリ)
        repo_names: 取得対象のリポジトリ名リスト (Noneの場合は全リポジトリ)
    """
    from dlt.sources.github_api import github_reactions, github_repo_events

    # dltのGitHubソースをインポート
    try:
        from dlt.sources.github_api import github_repo_events
    except ImportError:
        print("ERROR: dlt[github] がインストールされていません")
        print("実行してください: pip install 'dlt[github]'")
        sys.exit(1)

    # タイムスタンプ取得
    now = datetime.now(timezone.utc)
    print(f"⏰ パイプライン開始: {now.isoformat()}")

    # 認証ユーザー情報を取得 (ownerが指定されていない場合)
    if owner is None:
        headers = {"Authorization": f"Bearer {access_token}"}
        response = requests.get("https://api.github.com/user", headers=headers)
        response.raise_for_status()
        user_data = response.json()
        owner = user_data["login"]
        print(f"👤 認証ユーザー: {owner}")

    # リポジトリリストを取得 (repo_namesが指定されていない場合は全リポジトリ)
    if repo_names is None:
        print(f"📋 {owner} の全リポジトリを取得中...")
        headers = {"Authorization": f"Bearer {access_token}"}
        repos = []
        page = 1
        per_page = 100

        while True:
            response = requests.get(
                f"https://api.github.com/user/repos",
                headers=headers,
                params={
                    "per_page": per_page,
                    "page": page,
                    "affiliation": "owner,collaborator,organization_member",
                    "sort": "updated",
                },
            )
            response.raise_for_status()
            page_repos = response.json()

            if not page_repos:
                break

            repos.extend([repo["name"] for repo in page_repos])
            print(f"  📄 ページ {page}: {len(page_repos)} リポジトリ")
            page += 1

        repo_names = repos
        print(f"✅ 合計 {len(repo_names)} リポジトリを取得")

    # dlt パイプラインの設定
    # R2 Bronze Layer: data-lake-raw/sources/github/
    pipeline = dlt.pipeline(
        pipeline_name="github_data_pipeline",
        destination=dlt.destinations.filesystem(
            bucket_url=f"s3://{r2_bucket_name}",
            credentials={
                "aws_access_key_id": r2_access_key_id,
                "aws_secret_access_key": r2_secret_access_key,
                "endpoint_url": r2_endpoint,
                "region_name": "auto",
            },
            # Hive形式のパーティション構造
            layout="{table_name}/year={year}/month={month}/day={day}/{load_id}.{file_id}.{ext}",
        ),
        dataset_name="sources/github",
    )

    print(f"\n🚀 パイプライン設定:")
    print(f"  - バケット: s3://{r2_bucket_name}")
    print(f"  - データセット: sources/github")
    print(f"  - パーティション: year={now.year}/month={now.month:02d}/day={now.day:02d}")

    # リポジトリごとにデータを取得
    total_repos = len(repo_names)
    for idx, repo_name in enumerate(repo_names, 1):
        print(f"\n📦 [{idx}/{total_repos}] {owner}/{repo_name} を処理中...")

        try:
            # GitHub リポジトリイベントデータを取得
            # これには以下が含まれます:
            # - issues (Issues情報)
            # - pull_requests (PR情報)
            # - issue_comments (Issueコメント)
            # - pull_request_comments (PRコメント)
            # - commits (コミット履歴)
            # - stargazers (Star履歴)
            # - repository (リポジトリ情報)
            # - workflows (GitHub Actions ワークフロー)
            # - workflow_runs (ワークフロー実行履歴)
            # - releases (リリース情報)
            source = github_repo_events(
                owner=owner,
                name=repo_name,
                access_token=access_token,
                max_items=None,  # 全データを取得
            )

            # Reactions データも取得
            reactions_source = github_reactions(
                owner=owner,
                name=repo_name,
                access_token=access_token,
                max_items=None,
            )

            # パイプライン実行
            print(f"  ⚙️  データ取得中...")
            load_info = pipeline.run([source, reactions_source])

            # 結果を表示
            if hasattr(load_info, "loads") and load_info.loads:
                for load in load_info.loads:
                    if hasattr(load, "package_info"):
                        state = load.package_info.state
                        print(f"  ✅ ロード完了: {state}")

            print(f"  💾 保存先: sources/github/.../year={now.year}/month={now.month:02d}/day={now.day:02d}/")

        except Exception as e:
            print(f"  ❌ エラー: {str(e)}")
            # エラーが発生しても次のリポジトリに進む
            continue

    print(f"\n✨ パイプライン完了!")
    print(f"📊 処理済みリポジトリ: {total_repos}")
    print(f"💾 保存先: s3://{r2_bucket_name}/sources/github/")


def main():
    """メイン処理"""
    print("=" * 80)
    print("🐙 GitHub データ取得パイプライン")
    print("=" * 80)

    # 環境変数チェック
    required_env_vars = {
        "GITHUB_TOKEN": "GitHub Personal Access Token",
        "R2_ENDPOINT": "R2エンドポイントURL",
        "R2_ACCESS_KEY_ID": "R2アクセスキーID",
        "R2_SECRET_ACCESS_KEY": "R2シークレットアクセスキー",
        "R2_BUCKET_NAME": "R2バケット名",
    }

    missing_vars = []
    for var_name, description in required_env_vars.items():
        if not os.getenv(var_name):
            missing_vars.append(f"  - {var_name}: {description}")

    if missing_vars:
        print("\n❌ エラー: 必要な環境変数が設定されていません:\n")
        print("\n".join(missing_vars))
        print("\n環境変数を設定してから再度実行してください。")
        sys.exit(1)

    # 環境変数取得
    github_token = os.getenv("GITHUB_TOKEN")
    r2_endpoint = os.getenv("R2_ENDPOINT")
    r2_access_key_id = os.getenv("R2_ACCESS_KEY_ID")
    r2_secret_access_key = os.getenv("R2_SECRET_ACCESS_KEY")
    r2_bucket_name = os.getenv("R2_BUCKET_NAME")

    # オプション: 特定のオーナー/リポジトリを指定
    owner = os.getenv("GITHUB_OWNER")  # 未指定の場合は認証ユーザーの全リポジトリ
    repo_names_str = os.getenv("GITHUB_REPOS")  # カンマ区切りのリポジトリ名
    repo_names = repo_names_str.split(",") if repo_names_str else None

    # パイプライン実行
    try:
        load_github_data(
            access_token=github_token,
            r2_endpoint=r2_endpoint,
            r2_access_key_id=r2_access_key_id,
            r2_secret_access_key=r2_secret_access_key,
            r2_bucket_name=r2_bucket_name,
            owner=owner,
            repo_names=repo_names,
        )
    except Exception as e:
        print(f"\n💥 パイプライン実行エラー: {str(e)}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
