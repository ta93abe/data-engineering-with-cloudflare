# Data Vault 2.0 学習ノート

## Data Vault とは

Data Vault 2.0 は、Dan Linstedt が考案したデータウェアハウスのモデリング手法。
従来のスター/スノーフレークスキーマとは異なり、**変更に強く、履歴を完全に保持する**設計を目指す。

### 従来手法との違い

| 観点 | Star Schema | Data Vault |
|------|------------|------------|
| 設計の起点 | ビジネス要件（どう分析したいか） | データソース（何が届くか） |
| 変更への耐性 | スキーマ変更が大きな影響 | Hub/Sat の追加で柔軟に拡張 |
| 履歴管理 | SCD Type 2 等を個別実装 | Satellite が自動的に全履歴保持 |
| ロード方式 | 全量洗い替え or マージ | Insert-only（既存行を更新しない） |

### 3つの基本構成要素

```
Hub（ハブ）          ── ビジネスキーの一意レジストリ
Link（リンク）        ── エンティティ間の関係（多対多）
Satellite（サテライト）── 記述属性の履歴（変更があれば新行追加）
```

## 今回の実装：医療データドメイン

### 全体アーキテクチャ

```
Seeds (CSV)
  └─ Staging (automate-dv stage マクロ)
       └─ Raw Vault (Hub / Link / Satellite)
```

Databricks 上の `transform/fusion/` プロジェクトで実装。
automate-dv パッケージ（v0.11.5）を使用。

### データの流れ

```
raw_patients.csv ──→ stg_patients ──→ hub_patient
                                  ──→ sat_patient_details

raw_doctors.csv  ──→ stg_doctors  ──→ hub_doctor
                                  ──→ sat_doctor_details

raw_visits.csv   ──→ stg_visits   ──→ hub_visit
                                  ──→ link_visit
                                  ──→ sat_visit_details
```

### ER図

```
hub_patient ──┐
              ├── link_visit ──── sat_visit_details
hub_doctor  ──┘       │
                      │
              hub_visit

hub_patient ──── sat_patient_details
hub_doctor  ──── sat_doctor_details
```

## Phase 1: Raw Vault Core

### 実装したもの

**Seeds（3テーブル）**

| テーブル | 件数 | 内容 |
|---------|------|------|
| raw_patients | 22行 | 患者20名 + 住所変更2件 |
| raw_doctors | 10行 | 医師10名（10専門科） |
| raw_visits | 40行 | 診察記録（リピート患者含む） |

Seed には `load_date` と `record_source` カラムを含めてある。
これは Data Vault のメタデータとして必須で、「いつ」「どこから」データが来たかを追跡する。

**Staging（3モデル：view）**

automate-dv の `stage` マクロで以下を自動生成：

- **ハッシュキー (HK)**: ビジネスキーの MD5 ハッシュ
- **ハッシュdiff (HASHDIFF)**: 記述属性群のハッシュ（変更検出用）

```sql
-- stg_patients.sql の核心部分
hashed_columns:
  PATIENT_HK: "PATIENT_ID"           -- ビジネスキー → ハッシュキー
  PATIENT_HASHDIFF:                    -- 属性群 → ハッシュdiff
    is_hashdiff: true
    columns:
      - "FIRST_NAME"
      - "LAST_NAME"
      - "DATE_OF_BIRTH"
      - "GENDER"
      - "ADDRESS"
      - "PHONE"
```

`stg_visits` では Link 用のハッシュキーも生成する：

```sql
hashed_columns:
  PATIENT_HK: "PATIENT_ID"        -- hub_patient 参照用
  DOCTOR_HK: "DOCTOR_ID"          -- hub_doctor 参照用
  VISIT_HK: "VISIT_ID"            -- hub_visit 用
  LINK_VISIT_HK:                   -- link_visit のPK（3キー結合ハッシュ）
    - "PATIENT_ID"
    - "DOCTOR_ID"
    - "VISIT_ID"
```

**Raw Vault（7モデル：incremental）**

Hub 3つ：

```sql
-- hub_patient.sql（全Hubがこのパターン）
{{ automate_dv.hub(src_pk=src_pk, src_nk=src_nk, src_ldts=src_ldts,
                   src_source=src_source, source_model=source_model) }}
```

Link 1つ（トランザクショナルLink）：

```sql
-- link_visit.sql - 患者×医師×診察の3キーLink
{%- set src_fk = ["PATIENT_HK", "DOCTOR_HK", "VISIT_HK"] -%}
{{ automate_dv.link(src_pk=src_pk, src_fk=src_fk, ...) }}
```

Satellite 3つ：

```sql
-- sat_patient_details.sql（全Satがこのパターン）
{%- set src_hashdiff = {"source_column": "PATIENT_HASHDIFF", "alias": "HASHDIFF"} -%}
{%- set src_payload = ["FIRST_NAME", "LAST_NAME", ...] -%}
{{ automate_dv.sat(src_pk=src_pk, src_hashdiff=src_hashdiff,
                   src_payload=src_payload, ...) }}
```

### ビルド結果

| テーブル | 行数 | ポイント |
|---------|------|---------|
| hub_patient | 20 | Seed 22行だが、ユニーク患者は20名 |
| hub_doctor | 10 | |
| hub_visit | 40 | |
| link_visit | 40 | 患者×医師×診察の交差 |
| sat_patient_details | **22** | 20 + 住所変更2件が履歴として残る |
| sat_doctor_details | 10 | |
| sat_visit_details | 40 | |

### 動作確認：Satellite の履歴管理

PAT-002（鈴木花子さん）のデータ：

```
LOAD_DATETIME | ADDRESS                 | PHONE
──────────────┼─────────────────────────┼──────────────
2026-01-01    | 東京都渋谷区神宮前2-3-4 | 03-2345-6789
2026-02-01    | 東京都渋谷区恵比寿1-5-8 | 03-2345-9999
```

- 同じ `PATIENT_HK` で2レコード存在
- automate-dv が HASHDIFF の変化を検出し、新レコードを INSERT
- Hub には1行のみ（ビジネスキーの重複は排除）

## 学んだこと

### ハッシュキーの役割

Data Vault では自然キー（patient_id 等）を直接 PK にせず、ハッシュ化して使う。

理由：
- 複合キーの Link でも単一カラムで結合できる（パフォーマンス）
- 異なるソースシステムのキーを統一的に扱える
- ハッシュは決定的なので、どの順番でロードしても同じ値になる

### Hub と Satellite の分離

なぜ1テーブルにまとめないのか？

- Hub は **ビジネスキーの存在** のみを管理（Insert-only、重複排除）
- Satellite は **属性の履歴** を管理（変更があれば新行追加）
- 属性の種類や変更頻度が異なるので、Satellite を分割できる
  - 例：`sat_patient_details`（基本情報）と `sat_patient_insurance`（保険情報）

### automate-dv の stage マクロ

ステージング層でハッシュキーを事前生成しておくことで、
Raw Vault のモデルは `SELECT` + `WHERE NOT EXISTS` だけのシンプルな SQL になる。
マクロが生成する SQL を理解するには `dbt compile` で展開結果を確認するとよい。

### Incremental のポイント

Raw Vault モデルは全て `materialized='incremental'`。
初回は全件ロード、2回目以降は「まだ存在しないキー」だけを INSERT する。
これが Data Vault の「Insert-only」哲学を実現している。

## Phase 2: Raw Vault 拡張

### 追加したもの

**Seeds（5テーブル）**

| テーブル | 件数 | 内容 |
|---------|------|------|
| raw_departments | 10行 | 病院の部門（内科、外科等） |
| raw_medications | 15行 | 薬品マスタ（内服/外用/注射） |
| raw_insurance_companies | 6行 | 保険会社（社保/国保/共済） |
| raw_prescriptions | 40行 | 処方箋（診察×薬の関係） |
| raw_patient_insurance | 21行 | 患者保険関係（切替履歴含む） |

**Raw Vault（11モデル）**

| 種別 | モデル | ポイント |
|------|--------|---------|
| Hub | hub_department, hub_medication, hub_insurance_company | Phase 1 と同じパターン |
| Link | link_prescription | visit_hk × medication_hk の標準Link（2キー） |
| Link | link_patient_insurance | patient_hk × insurance_hk |
| Satellite | sat_department_details, sat_medication_details, sat_insurance_details | Phase 1 と同じパターン |
| Satellite | sat_prescription_details | Link の PK をキーにした Satellite |
| Satellite | sat_patient_insurance_details | 保険契約の詳細情報 |
| **Eff Sat** | **eff_sat_patient_insurance** | **新パターン：有効期間管理** |

### ビルド結果

| テーブル | 行数 |
|---------|------|
| hub_department | 10 |
| hub_medication | 15 |
| hub_insurance_company | 6 |
| link_prescription | 40 |
| link_patient_insurance | 21 |
| sat_department_details | 10 |
| sat_medication_details | 15 |
| sat_insurance_details | 6 |
| sat_prescription_details | 40 |
| sat_patient_insurance_details | 21 |
| eff_sat_patient_insurance | 21 |

### 新パターン: Effectivity Satellite

通常の Satellite は「属性が変わったか」を hashdiff で検出するが、
**Effectivity Satellite** は「関係がいつ有効で、いつ終了したか」を管理する。

```sql
-- eff_sat_patient_insurance.sql
{{ config(materialized='incremental', meta={'is_auto_end_dating': true}) }}

{{ automate_dv.eff_sat(src_pk=src_pk, src_dfk=src_dfk, src_sfk=src_sfk,
                       src_start_date=src_start_date,
                       src_end_date=src_end_date, ...) }}
```

パラメータの意味：
- `src_dfk` (driving FK): 関係の主体（PATIENT_HK = 保険を「持つ」側）
- `src_sfk` (secondary FK): 関係の対象（INSURANCE_HK = 「持たれる」側）
- `src_start_date` / `src_end_date`: 関係の有効期間
- `is_auto_end_dating: true`: 関係の終了日を自動推論

### 動作確認: PAT-002 の保険切り替え

```
START_DATE | END_DATE   | 保険
───────────┼────────────┼───────────────
2023-01-01 | 2025-12-31 | 国保（INS-002）← 終了
2026-01-01 |            | IT健保（INS-004）← 現在有効
```

異なる `LINK_PATIENT_INSURANCE_HK` で2レコード。
Link 自体には有効期間の概念がなく、Effectivity Satellite が「いつからいつまで」を管理する。

### 新パターン: Link に紐づく Satellite

`sat_prescription_details` は Hub ではなく **Link のハッシュキー** をPKとしている。
処方箋の「用量・頻度・日数」は、診察×薬の関係に付随する属性だから。

```sql
-- sat_prescription_details.sql
{%- set src_pk = "LINK_PRESCRIPTION_HK" -%}  -- ← Link の PK
```

これは「関係そのものに属性がある」場合のパターン。
Hub の Satellite = エンティティの属性、Link の Satellite = 関係の属性。

## ディレクトリ構成

```
transform/fusion/
├── packages.yml
├── dbt_project.yml
├── seeds/datavault/
│   ├── raw_patients.csv
│   ├── raw_doctors.csv
│   ├── raw_visits.csv
│   ├── raw_departments.csv          # Phase 2
│   ├── raw_medications.csv          # Phase 2
│   ├── raw_insurance_companies.csv  # Phase 2
│   ├── raw_prescriptions.csv        # Phase 2
│   └── raw_patient_insurance.csv    # Phase 2
└── models/
    ├── staging/datavault/
    │   ├── stg_patients.sql
    │   ├── stg_doctors.sql
    │   ├── stg_visits.sql
    │   ├── stg_departments.sql          # Phase 2
    │   ├── stg_medications.sql          # Phase 2
    │   ├── stg_insurance_companies.sql  # Phase 2
    │   ├── stg_prescriptions.sql        # Phase 2
    │   └── stg_patient_insurance.sql    # Phase 2
    └── raw_vault/
        ├── hubs/
        │   ├── hub_patient.sql
        │   ├── hub_doctor.sql
        │   ├── hub_visit.sql
        │   ├── hub_department.sql          # Phase 2
        │   ├── hub_medication.sql          # Phase 2
        │   └── hub_insurance_company.sql   # Phase 2
        ├── links/
        │   ├── link_visit.sql
        │   ├── link_prescription.sql        # Phase 2
        │   └── link_patient_insurance.sql   # Phase 2
        └── satellites/
            ├── sat_patient_details.sql
            ├── sat_doctor_details.sql
            ├── sat_visit_details.sql
            ├── sat_department_details.sql          # Phase 2
            ├── sat_medication_details.sql          # Phase 2
            ├── sat_insurance_details.sql           # Phase 2
            ├── sat_prescription_details.sql        # Phase 2
            ├── sat_patient_insurance_details.sql   # Phase 2
            └── eff_sat_patient_insurance.sql       # Phase 2
    └── business_vault/                            # Phase 3
        ├── pit_patient.sql
        ├── bridge_patient_medication.sql
        └── sat_patient_visit_summary.sql
```

## Phase 3: Business Vault

### Business Vault とは

Raw Vault は「ソースから届いたデータをそのまま保存する」層。
Business Vault は Raw Vault のデータに**ビジネスルールや計算ロジック**を適用する層。

Raw Vault がデータの「真実の記録」なら、Business Vault は「ビジネスの解釈」を加えたもの。

### automate-dv の PIT/Bridge マクロについて

automate-dv には `pit()` と `bridge()` マクロが存在するが、**v0.11.0 で非推奨（deprecated）** になった。
理由はユーザビリティとパフォーマンスの問題。将来の改善版リリースが予定されている。

今回は非推奨マクロに依存せず、**手書き SQL** で実装した。
これは実際にはより良い学習アプローチ：
- PIT/Bridge の内部ロジックを直接理解できる
- どの dbt アダプターでも動作する

### 実装したもの

| テーブル | 行数 | 種別 |
|---------|------|------|
| pit_patient | 40 | PIT（Point-In-Time）テーブル |
| bridge_patient_medication | 40 | Bridge テーブル |
| sat_patient_visit_summary | 20 | Computed Satellite |

### PIT テーブル（pit_patient）

PITテーブルの目的は「任意の時点で、各 Satellite のどのレコードが最新だったか」を高速に特定すること。

```
PATIENT_HK | AS_OF_DATE | SAT_PATIENT_DETAILS_LDTS
───────────┼────────────┼─────────────────────────
abc123...  | 2026-01-01 | 2026-01-01T00:00:00Z
abc123...  | 2026-02-01 | 2026-01-01T00:00:00Z  ← 1月時点のレコードがまだ最新
def456...  | 2026-01-01 | 2026-01-01T00:00:00Z
def456...  | 2026-02-01 | 2026-02-01T00:00:00Z  ← 2月に更新があった
```

PIT がないと、「2026年1月時点での患者情報」を取得するたびに
Satellite 全件から `MAX(LOAD_DATETIME) WHERE LOAD_DATETIME <= '2026-01-01'` を計算する必要がある。
PIT があれば、そのルックアップ結果が事前計算されている。

**実装のポイント:**

```sql
-- as_of_dates: Raw Vault 内の全 LOAD_DATETIME を収集
-- hub × as_of_date の全組み合わせを CROSS JOIN で作成
-- 各組み合わせに対して MAX(LOAD_DATETIME <= AS_OF_DATE) で最新を特定
```

Satellite が複数ある場合（例: `sat_patient_details` + `sat_patient_insurance_details`）、
それぞれの LDTS カラムを追加すれば、1クエリで全 Satellite の最新を取得できる。

### Bridge テーブル（bridge_patient_medication）

Bridge テーブルの目的は「離れた Hub 間の JOIN パスを事前結合」すること。

通常、患者が処方された薬を知るには：
```sql
-- Bridge がない場合: 4テーブル JOIN
hub_patient → link_visit → link_prescription → hub_medication
```

Bridge があれば：
```sql
-- Bridge がある場合: 1テーブルで完結
SELECT * FROM bridge_patient_medication WHERE PATIENT_HK = 'xxx'
```

**結果のイメージ:**

```
PATIENT_HK | LINK_VISIT_HK | VISIT_HK | LINK_PRESCRIPTION_HK | MEDICATION_HK
───────────┼───────────────┼──────────┼──────────────────────┼──────────────
abc123...  | visit_hk_1    | vis_hk_1 | presc_hk_1           | med_hk_1
abc123...  | visit_hk_2    | vis_hk_2 | presc_hk_2           | med_hk_2
```

### Computed Satellite（sat_patient_visit_summary）

通常の Satellite は「ソースからの事実」を記録するが、
Computed Satellite は「計算・集約された派生データ」を保持する。

```
PATIENT_HK | TOTAL_VISITS | DISTINCT_DOCTORS | TOTAL_TREATMENT_COST | DISTINCT_MEDICATIONS
───────────┼──────────────┼──────────────────┼──────────────────────┼─────────────────────
abc123...  | 3            | 2                | 9400.00              | 2
def456...  | 2            | 1                | 5000.00              | 1
```

`RECORD_SOURCE = 'COMPUTED'` として、ソースシステムからのデータと明確に区別している。

### 学んだこと

#### Raw Vault vs Business Vault の分離

なぜ Business Vault を Raw Vault と分けるのか？

- **Raw Vault は不変**: ソースデータの「真実の記録」。ビジネスルールの変更に影響されない
- **Business Vault は変わりうる**: ビジネスルールが変われば再計算できる
- **トレーサビリティ**: 計算結果の元データが Raw Vault に残っているので、いつでも検証可能

#### PIT テーブルの設計判断

PIT テーブルの `as_of_dates`（時間軸）は設計の重要な判断ポイント：
- **全 LOAD_DATETIME を使う**（今回の実装）: 精度が高いが行数が多くなる
- **日次/月次の固定間隔**: 行数を制御できるが精度が下がる
- **ビジネス要件に合わせた日付**: 月末、四半期末など

#### Bridge vs View

Bridge テーブルは「物理テーブルとして事前結合」するので、クエリ時のJOINコストがゼロ。
ただし、元テーブルが更新されるたびに再構築が必要。
小規模なら View（仮想テーブル）でも十分だが、大規模データでは Bridge の効果が大きい。

## 次のステップ

- **Phase 4**: Information Mart（dim/fact テーブル、Star Schema への変換）

## 参考

- [automate-dv ドキュメント](https://automate-dv.readthedocs.io/en/latest/)
- [automate-dv GitHub](https://github.com/Datavault-UK/automate-dv)
