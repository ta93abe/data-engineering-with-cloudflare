#!/usr/bin/env python3
"""
Cloudflare Data Platform コスト計算ツール

使用例:
    python scripts/cost_calculator.py --scenario small
    python scripts/cost_calculator.py --custom --workers-requests 30000000 --r2-storage 500
"""

import argparse
from typing import Dict


def calculate_monthly_cost(
    workers_requests_per_month: int,
    r2_storage_gb: int,
    d1_storage_gb: int = 1,
    d1_read_rows: int = 1_000_000,
    d1_write_rows: int = 10_000,
    kv_storage_gb: float = 0.1,
    kv_reads: int = 100_000,
    kv_writes: int = 1_000,
    analytics_engine_writes: int = 100_000,
    workers_plan: str = "free",  # "free", "bundled", "unbound"
    github_actions_minutes: int = 0,
) -> Dict:
    """月額コスト計算

    Args:
        workers_requests_per_month: Workers月間リクエスト数
        r2_storage_gb: R2ストレージ容量（GB）
        d1_storage_gb: D1ストレージ容量（GB）
        d1_read_rows: D1月間Read行数
        d1_write_rows: D1月間Write行数
        kv_storage_gb: KVストレージ容量（GB）
        kv_reads: KV月間Read回数
        kv_writes: KV月間Write回数
        analytics_engine_writes: Analytics Engine月間Write行数
        workers_plan: Workersプラン ("free", "bundled", "unbound")
        github_actions_minutes: GitHub Actions月間実行時間（分）

    Returns:
        コスト詳細を含む辞書
    """

    # 固定費
    workers_fixed_cost = {
        "free": 0,
        "bundled": 5,
        "unbound": 25
    }[workers_plan]

    # Workersリクエスト
    free_requests = {
        "free": 3_000_000,  # 10万/日 × 30
        "bundled": 10_000_000,
        "unbound": 1_000_000
    }[workers_plan]

    workers_cost = max(0, (workers_requests_per_month - free_requests) / 1_000_000 * 0.5)

    # R2
    r2_storage_cost = max(0, r2_storage_gb - 10) * 0.015
    r2_class_a = 0  # 通常無料枠内
    r2_class_b = 0  # 通常無料枠内
    r2_cost = r2_storage_cost + r2_class_a + r2_class_b

    # D1
    d1_storage_cost = max(0, d1_storage_gb - 5) * 0.75
    d1_read_cost = max(0, (d1_read_rows - 750_000_000) / 1_000_000 * 0.001)
    d1_write_cost = max(0, (d1_write_rows - 1_500_000) / 1_000_000 * 1.0)
    d1_cost = d1_storage_cost + d1_read_cost + d1_write_cost

    # KV
    kv_storage_cost = max(0, kv_storage_gb - 1) * 0.5
    kv_read_cost = max(0, (kv_reads - 300_000_000) / 1_000_000 * 0.5)
    kv_write_cost = max(0, (kv_writes - 30_000_000) / 1_000_000 * 5.0)
    kv_cost = kv_storage_cost + kv_read_cost + kv_write_cost

    # Analytics Engine
    analytics_cost = max(0, (analytics_engine_writes - 10_000_000) / 1_000_000 * 0.25)

    # R2 Data Catalog
    r2_catalog_cost = 0  # ベータ版無料

    # GitHub Actions (Linux)
    github_cost = max(0, (github_actions_minutes - 2_000) / 1_000 * 8.0)

    # 合計
    total_variable = (
        workers_cost + r2_cost + d1_cost + kv_cost +
        analytics_cost + r2_catalog_cost + github_cost
    )
    total_fixed = workers_fixed_cost
    total = total_fixed + total_variable

    return {
        "total": total,
        "fixed_cost": total_fixed,
        "variable_cost": total_variable,
        "breakdown": {
            "workers": {
                "fixed": workers_fixed_cost,
                "requests": workers_cost,
                "total": workers_fixed_cost + workers_cost
            },
            "r2": {
                "storage": r2_storage_cost,
                "class_a": r2_class_a,
                "class_b": r2_class_b,
                "total": r2_cost
            },
            "r2_catalog": r2_catalog_cost,
            "d1": {
                "storage": d1_storage_cost,
                "read": d1_read_cost,
                "write": d1_write_cost,
                "total": d1_cost
            },
            "kv": {
                "storage": kv_storage_cost,
                "read": kv_read_cost,
                "write": kv_write_cost,
                "total": kv_cost
            },
            "analytics_engine": analytics_cost,
            "github_actions": github_cost
        }
    }


def print_cost_report(result: Dict, scenario_name: str = ""):
    """コストレポートを出力"""

    print("=" * 60)
    if scenario_name:
        print(f"  Cloudflare Data Platform コスト試算: {scenario_name}")
    else:
        print("  Cloudflare Data Platform コスト試算")
    print("=" * 60)
    print()

    print(f"月額合計: ${result['total']:.2f}")
    print(f"  固定費: ${result['fixed_cost']:.2f}")
    print(f"  変動費: ${result['variable_cost']:.2f}")
    print()

    print("年額合計: ${:.2f}".format(result['total'] * 12))
    print()

    print("-" * 60)
    print("サービス別内訳:")
    print("-" * 60)

    breakdown = result['breakdown']

    print(f"\n1. Workers:")
    print(f"   固定費 (プラン):          ${breakdown['workers']['fixed']:.2f}")
    print(f"   リクエスト:              ${breakdown['workers']['requests']:.2f}")
    print(f"   小計:                    ${breakdown['workers']['total']:.2f}")

    print(f"\n2. R2 Object Storage:")
    print(f"   ストレージ:              ${breakdown['r2']['storage']:.2f}")
    print(f"   Class A Operations:      ${breakdown['r2']['class_a']:.2f}")
    print(f"   Class B Operations:      ${breakdown['r2']['class_b']:.2f}")
    print(f"   小計:                    ${breakdown['r2']['total']:.2f}")

    print(f"\n3. R2 Data Catalog:")
    print(f"   料金 (ベータ版無料):      ${breakdown['r2_catalog']:.2f}")

    print(f"\n4. D1 Database:")
    print(f"   ストレージ:              ${breakdown['d1']['storage']:.2f}")
    print(f"   Read:                    ${breakdown['d1']['read']:.2f}")
    print(f"   Write:                   ${breakdown['d1']['write']:.2f}")
    print(f"   小計:                    ${breakdown['d1']['total']:.2f}")

    print(f"\n5. Workers KV:")
    print(f"   ストレージ:              ${breakdown['kv']['storage']:.2f}")
    print(f"   Read:                    ${breakdown['kv']['read']:.2f}")
    print(f"   Write:                   ${breakdown['kv']['write']:.2f}")
    print(f"   小計:                    ${breakdown['kv']['total']:.2f}")

    print(f"\n6. Analytics Engine:")
    print(f"   Write:                   ${breakdown['analytics_engine']:.2f}")

    print(f"\n7. GitHub Actions:")
    print(f"   実行時間 (Linux):         ${breakdown['github_actions']:.2f}")

    print()
    print("=" * 60)


# 事前定義シナリオ
SCENARIOS = {
    "small": {
        "name": "スタートアップ（小規模）",
        "params": {
            "workers_requests_per_month": 3_000_000,
            "r2_storage_gb": 50,
            "d1_storage_gb": 1,
            "d1_read_rows": 1_000_000,
            "d1_write_rows": 10_000,
            "kv_storage_gb": 0.1,
            "kv_reads": 100_000,
            "kv_writes": 720,
            "analytics_engine_writes": 100_000,
            "workers_plan": "free",
            "github_actions_minutes": 0
        }
    },
    "medium": {
        "name": "中規模スタートアップ",
        "params": {
            "workers_requests_per_month": 30_000_000,
            "r2_storage_gb": 500,
            "d1_storage_gb": 5,
            "d1_read_rows": 10_000_000,
            "d1_write_rows": 100_000,
            "kv_storage_gb": 1,
            "kv_reads": 10_000_000,
            "kv_writes": 2_880,
            "analytics_engine_writes": 5_000_000,
            "workers_plan": "bundled",
            "github_actions_minutes": 0
        }
    },
    "large": {
        "name": "成長企業（大規模）",
        "params": {
            "workers_requests_per_month": 300_000_000,
            "r2_storage_gb": 2000,
            "d1_storage_gb": 10,
            "d1_read_rows": 100_000_000,
            "d1_write_rows": 500_000,
            "kv_storage_gb": 5,
            "kv_reads": 50_000_000,
            "kv_writes": 1_000_000,
            "analytics_engine_writes": 50_000_000,
            "workers_plan": "unbound",
            "github_actions_minutes": 14_400
        }
    }
}


def main():
    parser = argparse.ArgumentParser(
        description="Cloudflare Data Platform コスト計算ツール"
    )

    parser.add_argument(
        "--scenario",
        choices=["small", "medium", "large"],
        help="事前定義されたシナリオを使用"
    )

    parser.add_argument(
        "--custom",
        action="store_true",
        help="カスタムパラメータを使用"
    )

    parser.add_argument("--workers-requests", type=int, help="Workers月間リクエスト数")
    parser.add_argument("--r2-storage", type=int, help="R2ストレージ容量（GB）")
    parser.add_argument("--d1-storage", type=int, default=1, help="D1ストレージ容量（GB）")
    parser.add_argument("--d1-read-rows", type=int, default=1_000_000, help="D1月間Read行数")
    parser.add_argument("--d1-write-rows", type=int, default=10_000, help="D1月間Write行数")
    parser.add_argument("--kv-storage", type=float, default=0.1, help="KVストレージ容量（GB）")
    parser.add_argument("--kv-reads", type=int, default=100_000, help="KV月間Read回数")
    parser.add_argument("--kv-writes", type=int, default=1_000, help="KV月間Write回数")
    parser.add_argument("--analytics-writes", type=int, default=100_000, help="Analytics Engine月間Write行数")
    parser.add_argument("--workers-plan", choices=["free", "bundled", "unbound"], default="free", help="Workersプラン")
    parser.add_argument("--github-minutes", type=int, default=0, help="GitHub Actions月間実行時間（分）")

    parser.add_argument("--all", action="store_true", help="全シナリオを表示")

    args = parser.parse_args()

    if args.all:
        # 全シナリオ表示
        for scenario_key in ["small", "medium", "large"]:
            scenario = SCENARIOS[scenario_key]
            result = calculate_monthly_cost(**scenario["params"])
            print_cost_report(result, scenario["name"])
            print("\n")
        return

    if args.scenario:
        # 事前定義シナリオ
        scenario = SCENARIOS[args.scenario]
        result = calculate_monthly_cost(**scenario["params"])
        print_cost_report(result, scenario["name"])

    elif args.custom:
        # カスタムパラメータ
        if not args.workers_requests or not args.r2_storage:
            print("エラー: --custom を使用する場合、--workers-requests と --r2-storage は必須です")
            return

        result = calculate_monthly_cost(
            workers_requests_per_month=args.workers_requests,
            r2_storage_gb=args.r2_storage,
            d1_storage_gb=args.d1_storage,
            d1_read_rows=args.d1_read_rows,
            d1_write_rows=args.d1_write_rows,
            kv_storage_gb=args.kv_storage,
            kv_reads=args.kv_reads,
            kv_writes=args.kv_writes,
            analytics_engine_writes=args.analytics_writes,
            workers_plan=args.workers_plan,
            github_actions_minutes=args.github_minutes
        )
        print_cost_report(result, "カスタム設定")

    else:
        # デフォルト: 使い方表示
        parser.print_help()
        print("\n使用例:")
        print("  python scripts/cost_calculator.py --scenario small")
        print("  python scripts/cost_calculator.py --scenario medium")
        print("  python scripts/cost_calculator.py --all")
        print("  python scripts/cost_calculator.py --custom --workers-requests 10000000 --r2-storage 100")


if __name__ == "__main__":
    main()
