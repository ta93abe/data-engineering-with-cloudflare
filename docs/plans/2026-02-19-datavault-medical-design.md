# Data Vault 2.0 設計: 医療データドメイン

## Linear Issues

| Issue | Phase | Status |
|-------|-------|--------|
| [TA-369](https://linear.app/ta93abe/issue/TA-369) | 親Issue | Backlog |
| [TA-370](https://linear.app/ta93abe/issue/TA-370) | Phase 1: Raw Vault Core | Backlog |
| [TA-371](https://linear.app/ta93abe/issue/TA-371) | Phase 2: Raw Vault 拡張 | Backlog |
| [TA-372](https://linear.app/ta93abe/issue/TA-372) | Phase 3: Business Vault | Backlog |
| [TA-373](https://linear.app/ta93abe/issue/TA-373) | Phase 4: Information Mart | Backlog |

## 概要

`transform/fusion/` プロジェクト（Databricks）にData Vault 2.0を実装する。
新規Seedデータ（病院・医療ドメイン）を作成し、automate-dvパッケージを使用。

### 目的

- Data Vault 2.0の全レイヤーを実践的に学ぶ
- automate-dvパッケージの使い方を習得

### 技術スタック

- dbt (fusion project) + Databricks
- automate-dv パッケージ
- Seedデータ (CSV)

## アーキテクチャ

```text
Seeds (raw CSV)
  └─ Staging (automate-dv stage macro: ハッシュキー生成)
       └─ Raw Vault
       │    ├─ Hubs (6): patient, doctor, department, medication, insurance_company, visit
       │    ├─ Links (3): visit, prescription, patient_insurance
       │    └─ Satellites (9): *_details (7) + sat_patient_insurance_details + eff_sat_patient_insurance
       └─ Business Vault
       │    ├─ PIT: pit_patient
       │    ├─ Bridge: bridge_patient_medication
       │    └─ Computed Sat: sat_patient_visit_summary
       └─ Information Mart
            ├─ Dims: dim_patient, dim_doctor, dim_medication, dim_date
            └─ Facts: fct_visits, fct_prescriptions
```

## ディレクトリ構造

```text
transform/fusion/
├─ seeds/datavault/
│   ├─ raw_patients.csv
│   ├─ raw_doctors.csv
│   ├─ raw_departments.csv
│   ├─ raw_medications.csv
│   ├─ raw_insurance_companies.csv
│   ├─ raw_visits.csv
│   ├─ raw_prescriptions.csv
│   └─ raw_patient_insurance.csv
├─ models/
│   ├─ staging/datavault/
│   │   ├─ stg_patients.sql
│   │   ├─ stg_doctors.sql
│   │   ├─ stg_departments.sql
│   │   ├─ stg_medications.sql
│   │   ├─ stg_insurance_companies.sql
│   │   ├─ stg_visits.sql
│   │   ├─ stg_prescriptions.sql
│   │   ├─ stg_patient_insurance.sql
│   │   └─ _stg_datavault__schema.yml
│   ├─ raw_vault/
│   │   ├─ hubs/
│   │   │   ├─ hub_patient.sql
│   │   │   ├─ hub_doctor.sql
│   │   │   ├─ hub_department.sql
│   │   │   ├─ hub_medication.sql
│   │   │   ├─ hub_insurance_company.sql
│   │   │   └─ hub_visit.sql
│   │   ├─ links/
│   │   │   ├─ link_visit.sql
│   │   │   ├─ link_prescription.sql
│   │   │   └─ link_patient_insurance.sql
│   │   ├─ satellites/
│   │   │   ├─ sat_patient_details.sql
│   │   │   ├─ sat_doctor_details.sql
│   │   │   ├─ sat_department_details.sql
│   │   │   ├─ sat_medication_details.sql
│   │   │   ├─ sat_insurance_details.sql
│   │   │   ├─ sat_visit_details.sql
│   │   │   ├─ sat_prescription_details.sql
│   │   │   ├─ sat_patient_insurance_details.sql
│   │   │   └─ eff_sat_patient_insurance.sql
│   │   └─ _raw_vault__schema.yml
│   ├─ business_vault/
│   │   ├─ pit_patient.sql
│   │   ├─ bridge_patient_medication.sql
│   │   ├─ sat_patient_visit_summary.sql
│   │   └─ _business_vault__schema.yml
│   └─ marts/datavault/
│       ├─ dim_patient.sql
│       ├─ dim_doctor.sql
│       ├─ dim_medication.sql
│       ├─ dim_date.sql
│       ├─ fct_visits.sql
│       ├─ fct_prescriptions.sql
│       ├─ wide_patient_history.sql
│       └─ _marts_datavault__schema.yml
```

## Seedデータ設計

### raw_patients (20-30行)

| カラム | 型 | 説明 |
|--------|---|------|
| patient_id | string | PK: PAT-001 |
| first_name | string | 名 |
| last_name | string | 姓 |
| date_of_birth | date | 生年月日 |
| gender | string | M/F |
| address | string | 住所 |
| phone | string | 電話番号 |

### raw_doctors (10-15行)

| カラム | 型 | 説明 |
|--------|---|------|
| doctor_id | string | PK: DOC-001 |
| first_name | string | 名 |
| last_name | string | 姓 |
| specialty | string | 専門科 (内科/外科/小児科等) |
| license_number | string | 医師免許番号 |

### raw_departments (8-10行)

| カラム | 型 | 説明 |
|--------|---|------|
| department_id | string | PK: DEPT-001 |
| department_name | string | 部門名 |
| floor | integer | 階数 |
| phone_extension | string | 内線番号 |

### raw_medications (15-20行)

| カラム | 型 | 説明 |
|--------|---|------|
| medication_id | string | PK: MED-001 |
| medication_name | string | 薬品名 |
| type | string | 内服/外用/注射 |
| manufacturer | string | 製造元 |
| unit_price | decimal | 単価 |

### raw_insurance_companies (5-8行)

| カラム | 型 | 説明 |
|--------|---|------|
| insurance_id | string | PK: INS-001 |
| company_name | string | 会社名 |
| plan_type | string | 国保/社保/共済 |

### raw_visits (50-80行)

| カラム | 型 | 説明 |
|--------|---|------|
| visit_id | string | PK: VIS-001 |
| patient_id | string | FK → raw_patients |
| doctor_id | string | FK → raw_doctors |
| department_id | string | FK → raw_departments |
| visit_date | date | 診察日 |
| diagnosis_code | string | 診断コード |
| diagnosis_name | string | 診断名 |
| notes | string | 備考 |
| treatment_cost | decimal | 治療費 |

### raw_prescriptions (40-60行)

| カラム | 型 | 説明 |
|--------|---|------|
| prescription_id | string | PK: PRE-001 |
| visit_id | string | FK → raw_visits |
| medication_id | string | FK → raw_medications |
| dosage | string | 用量 |
| frequency | string | 頻度 (1日3回等) |
| duration_days | integer | 処方日数 |

### raw_patient_insurance (25-35行)

| カラム | 型 | 説明 |
|--------|---|------|
| patient_id | string | FK → raw_patients |
| insurance_id | string | FK → raw_insurance_companies |
| policy_number | string | 保険証番号 |
| start_date | date | 適用開始日 |
| end_date | date | 適用終了日 (NULL=現在有効) |

## フェーズ分割

### Phase 1: Raw Vault Core (TA-370)

**スコープ**: patients + doctors + visits のみ
**成果物**: Hub 3, Link 1, Satellite 3, automate-dvセットアップ
**学習ポイント**: Hub/Link/Satの基本、automate-dv stage macro、ハッシュキー

### Phase 2: Raw Vault 拡張 (TA-371)

**スコープ**: departments + medications + insurance + prescriptions + patient_insurance
**成果物**: Hub 3, Link 2, Satellite 5, Effectivity Satellite 1
**学習ポイント**: 標準Link (2キー), Effectivity Satellite, 既存Vault拡張

### Phase 3: Business Vault (TA-372)

**スコープ**: PIT + Bridge + Computed Satellite
**成果物**: PITテーブル 1, Bridgeテーブル 1, Computed Satellite 1
**学習ポイント**: クエリ最適化パターン、ビジネスルール適用

### Phase 4: Information Mart (TA-373)

**スコープ**: Dim + Fact テーブル
**成果物**: Dimension 4, Fact 2, Wide 1 (optional)
**学習ポイント**: Data Vault → Star Schema変換、SCD Type 2

## 決定事項

- **プロジェクト**: transform/fusion (Databricks)
- **データドメイン**: 病院・医療（新規Seed）
- **ツール**: automate-dv パッケージ
- **既存モデルへの影響**: なし（新規ディレクトリで独立）
