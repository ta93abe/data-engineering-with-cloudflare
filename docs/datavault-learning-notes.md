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

## ディレクトリ構成

```
transform/fusion/
├── packages.yml                      # automate-dv 追加
├── dbt_project.yml                   # raw_vault 設定追加
├── seeds/datavault/
│   ├── raw_patients.csv
│   ├── raw_doctors.csv
│   └── raw_visits.csv
└── models/
    ├── staging/datavault/
    │   ├── stg_patients.sql
    │   ├── stg_doctors.sql
    │   └── stg_visits.sql
    └── raw_vault/
        ├── hubs/
        │   ├── hub_patient.sql
        │   ├── hub_doctor.sql
        │   └── hub_visit.sql
        ├── links/
        │   └── link_visit.sql
        └── satellites/
            ├── sat_patient_details.sql
            ├── sat_doctor_details.sql
            └── sat_visit_details.sql
```

## 次のステップ

- **Phase 2**: 薬・処方箋・部門・保険を追加（標準 Link、Effectivity Satellite）
- **Phase 3**: Business Vault（PIT テーブル、Bridge テーブル）
- **Phase 4**: Information Mart（dim/fact テーブル、Star Schema への変換）

## 参考

- [automate-dv ドキュメント](https://automate-dv.readthedocs.io/en/latest/)
- [automate-dv GitHub](https://github.com/Datavault-UK/automate-dv)
