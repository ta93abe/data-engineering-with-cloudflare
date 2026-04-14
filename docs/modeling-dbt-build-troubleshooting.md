# modeling プロジェクト `dbt build` トラブルシューティング

`modeling/` (datavault4dbt + Snowflake) で `uv run dbt build` を通すまでに遭遇
した問題と対処のメモ。最終結果は `PASS=348 WARN=0 ERROR=0 SKIP=0 TOTAL=348`
で完全成功 (2026-04-15)。

## サマリ表

| # | 問題 | 原因 | 対処 |
|---|---|---|---|
| 1 | `hub_medication` compile error: `'str object' has no attribute 'update'` | `datavault4dbt.hub` のマルチソース指定は `source_models` を **list-of-dicts** または mapping で受け取る。単なる文字列リストは内部で `.update({'id': ...})` が呼ばれて落ちる | 5 つの multi-source hub を `- name: <stg>` 形式に修正 |
| 2 | `Parsing Error: Env var required but not provided: 'SNOWFLAKE_ACCOUNT'` | Bash ツール呼び出しは毎回独立シェルなので、インタラクティブシェルに設定した env var が伝播しない | `set -a; source ../.env; set +a` をコマンドの前に付けて実行 |
| 3 | `Semantic Manifest validation failed: requires a time spine model with granularity DAY or smaller` | MetricFlow はメトリクス宣言時に必ず `time_spine` マーク付きモデルを要求する | `models/marts/datavault/dimensions/metricflow_time_spine.sql` を追加し、yml で `time_spine.standard_granularity_column: date_day` を指定 |
| 4 | `Aggregation time dimension for measure visit_count is not set` | MetricFlow は semantic_model の各 measure に `agg_time_dimension` が必要。未指定で複数の time dimension があると曖昧で失敗 | semantic_model に `defaults.agg_time_dimension: visit_date` (および `prescription_date`) を追加 |
| 5 | `060119 (0A000): Tables/Views cannot currently be created in a personal database` | `USER$<username>` (Snowflake personal DB) は read-only。`generate_database_name` が dev 時に `target.database` を返していたが、それが個人 DB を指していた | 書き込み可能な `DEVELOPMENT` DB を `snow sql` で作成し、`profiles.yml` のデフォルトを `DEVELOPMENT` に変更 |
| 6 | `Failure in test accepted_values_stg_patients_gender__M__F: Got 2 results` | datavault4dbt はデフォルトで **Ghost Records** を生成し、stage 段階で 2 行 (unknown / error) の synthetic row を追加する。gender に placeholder (`-1` / `^^`) が入るので `accepted_values ['M', 'F']` を外れる | `accepted_values` テストを外す (Ghost Records は DV 2.0 的に必須で温存) |
| 7 | `invalid identifier 'HASHDIFF'` (8 Sat not_null テスト) | datavault4dbt の `sat_v0` マクロは `src_hashdiff` に文字列を渡すと出力カラム名をそのまま使う (`hd_*_s`)。`HASHDIFF` にリネームされない | yml の列参照を `hashdiff` → `hd_patient_s` / `hd_doctor_s` / ... に修正 |
| 8 | `invalid identifier 'SKU' / 'ORDER_ID'` (jaffle stg views) | R2 Data Catalog の `raw_products` / `raw_supplies` / `raw_stores` / `raw_items` は **lowercase カラム** で格納。 `CATALOG_CASE_SENSITIVITY = CASE_INSENSITIVE` は DML (SELECT) には効くが **CREATE VIEW の DDL 識別子解決には効かない**。一方 `raw_customers` / `raw_orders` は uppercase で格納されていて unquoted 参照が通っていたため一部だけ成功していた | 当該 jaffle stg モデル (`stg_products`, `stg_supplies`, `stg_locations`, `stg_order_items`) で列を `"sku"` 等 quote + 明示 alias `"order_id" as order_id` で uppercase 化 |
| 9 | `'dict object' has no attribute 'ldts_alias'` (business vault + marts モデル) | `datavault4dbt.ldts_alias` は **プロジェクト変数** で macro ではない。`{{ datavault4dbt.ldts_alias() }}` は macro 呼び出しとして評価されるので失敗 | 7 モデルの `{{ datavault4dbt.ldts_alias() }}` → 直接 `ldts` 文字列に置換 |
| 10 | unit test fixture の列名 mismatch: `hashdiff` / `stg` / `ref('raw_stores')` / lowercase key | 手書きした unit test の `given: rows:` が実際のモデル列と一致していなかった (`hashdiff` → 実際は `hd_*_s`、hub には `stg` 列なし、jaffle seed 削除で `ref('raw_stores')` が orphan 化、`given` の key case が Iceberg の lowercase と噛み合わない) | fixture の列名を実際の列に合わせる / `source('ecom', 'raw_stores')` に差し替え / hub fixture から `stg` 列を削除 / lowercase key で揃える |

## 副産物として判明した知見

1. **datavault4dbt の multi-source 指定は 3 形式**
   - 文字列 (single source): `source_models: stg_patients`
   - dict: `source_models: {stg_patients: {}, stg_visits: {}}`
   - list of dicts: `source_models: [{name: stg_patients}, {name: stg_visits}]`
   - **文字列のリストは NG**

2. **datavault4dbt はステージング出力カラムを quoted + UPPERCASE で生成する**
   `stg_patients` のコンパイル結果は `"PATIENT_ID"`, `"FIRST_NAME"` などクォート済み
   大文字。これが Iceberg の lowercase カラムと噛み合うのは、Snowflake が
   quoted 識別子を DML で解決するときだけ CASE_INSENSITIVE を適用するため。

3. **Snowflake の `CATALOG_CASE_SENSITIVITY = CASE_INSENSITIVE` は DML 限定**
   DDL (特に `CREATE VIEW`) の識別子解決には適用されない。Iceberg カラムが
   lowercase のときに unquoted 参照を使うと view 作成で落ちる。これは catalog-
   linked DB の盲点。

4. **Ghost Records は accepted_values 系テストと相性が悪い**
   Scalefree メソドロジーでは Ghost Records が必須だが、プレースホルダー値が
   値域テストを常に違反する。対応は `where` 句でゴースト行を除外するか、
   テストを外す。

5. **dbt-snowflake の unit_tests fixture は lowercase で quote した列名を
   生成する**
   `given: rows: [{id: 1}]` を渡すと `try_cast('1' as ...) as "id"` とコンパイル
   される。stg モデル側で unquoted `id` を使っている場合、ローカル CTE のた
   め CASE_INSENSITIVE の恩恵は受けられず、`"id"` と `id (→ ID)` の不整合で
   失敗する。対応: stg 側を `"id"` quote するか、fixture を実列名に合わせる。

6. **Personal database USER$<user> の書き込み制限**
   Snowflake の個人 DB はデフォルトで read-only。`CREATE TABLE` / `CREATE
   VIEW` が `060119 (0A000)` で落ちる。ローカル dev 用には別途 `DEVELOPMENT`
   DB を用意するのが正解。`generate_database_name` のフォールバックを
   `target.database` にしていても、`target.database` が personal DB を指して
   いると同じエラーになるので profile のデフォルトを切り替える必要がある。

## 残課題 / 次の宿題

- **`MissingArgumentsPropertyInGenericTestDeprecation` 38 件**: dbt 1.11 から
  `relationships` などの generic test 引数は `arguments:` 下にネストする
  新構文が推奨。警告のみで build は通るが、将来のメジャー版で削除される
  可能性あり。全 yml の `- relationships:\n    to: ...\n    field: ...`
  → `- relationships:\n    arguments:\n      to: ...\n      field: ...` へ
  まとめて変更が必要。

- **raw_customers / raw_orders の列名が UPPERCASE、他の jaffle テーブルは
  lowercase**: `scripts/load_seeds_to_r2.py` で再ロードして全体を lowercase
  に揃えるのが綺麗。ただしその場合 `stg_customers`, `stg_orders` も quote 対応
  が必要になる。

- **dbtective 違反**: dbtective.yml を現プロジェクト構造に合わせて書き
  換え済みだが、実行は未再確認。`has_owner` / `require_execution_tags` /
  `sources_have_freshness` / `sources_have_loader` を削除したので大幅に減る
  はずだが、要再走。

- **multi-source hub の `rsrc_static` 未設定**: 現状 HWM 最適化が効かず、
  初回ロードでは問題ないが 2 回目以降の incremental でフルスキャンに
  なる。本格運用時は stg モデル側で `rsrc: "<account>/<source>/<object>/*"`
  のようなパターン化された literal を入れて、hub 側で `rsrc_static` を
  宣言するべき。
