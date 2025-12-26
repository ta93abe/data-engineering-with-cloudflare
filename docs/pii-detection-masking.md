# PII検出・データマスキング実装ガイド

個人識別情報（PII）の検出、マスキング、匿名化によるGDPR/CCPA準拠データ基盤の構築ガイド。

## 📋 目次

1. [PIIとは](#piiとは)
2. [アーキテクチャ](#アーキテクチャ)
3. [PII検出手法](#pii検出手法)
4. [データマスキング戦略](#データマスキング戦略)
5. [Cloudflare Workers実装](#cloudflare-workers実装)
6. [dbt実装](#dbt実装)
7. [Great Expectations統合](#great-expectations統合)
8. [運用・監視](#運用監視)

---

## PIIとは

### 個人識別情報（Personally Identifiable Information）

**PII**は、個人を特定できる情報のことで、GDPR、CCPA等のプライバシー規制の対象となります。

### PII分類

| カテゴリ | 例 | リスクレベル |
|---------|---|------------|
| **直接識別子** | 氏名、SSN、パスポート番号 | 🔴 高 |
| **準識別子** | 郵便番号、生年月日、性別の組み合わせ | 🟡 中 |
| **機密情報** | 医療記録、信用情報、犯罪歴 | 🔴 高 |
| **連絡先** | メールアドレス、電話番号、住所 | 🟡 中 |
| **オンライン識別子** | IPアドレス、Cookie ID、デバイスID | 🟢 低 |
| **バイオメトリクス** | 指紋、顔写真、声紋 | 🔴 高 |

### 法規制

- **GDPR** (EU一般データ保護規則): EUユーザーのデータ保護
- **CCPA** (カリフォルニア州消費者プライバシー法): CA州居住者のデータ保護
- **個人情報保護法** (日本): 個人情報の適正な取扱い

---

## アーキテクチャ

```
┌──────────────────────────────────────────────────────────────┐
│                    データ取り込み                               │
│  API → Workers → R2 (Bronze Layer)                           │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│              PII検出 (Workers / dbt)                          │
│  - 正規表現パターンマッチング                                    │
│  - 辞書ベース検出                                               │
│  - ML-based検出 (Workers AI)                                  │
│  - カラム名ヒューリスティック                                     │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│              マスキング処理                                     │
│  - ハッシング (SHA-256)                                        │
│  - トークン化 (KV保存)                                         │
│  - 部分マスキング (***-**-1234)                                │
│  - 匿名化 (k-anonymity)                                       │
│  - 合成データ生成                                               │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│            R2 (Silver Layer - マスク済み)                      │
│  - PII削除/マスク済みデータ                                     │
│  - 監査ログ記録                                                 │
└──────────────────────────────────────────────────────────────┘
```

---

## PII検出手法

### 1. 正規表現ベース検出

```javascript
// workers/pii-detector/patterns.js

export const PII_PATTERNS = {
  // メールアドレス
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

  // 電話番号（国際・日本）
  phone: /(\+?1-?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}|\d{2,4}-\d{2,4}-\d{4}/g,

  // クレジットカード番号
  credit_card: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,

  // SSN（米国社会保障番号）
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,

  // パスポート番号（日本）
  passport_jp: /\b[A-Z]{2}\d{7}\b/g,

  // IPアドレス
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,

  // 住所（日本の郵便番号）
  postal_code_jp: /\b\d{3}-\d{4}\b/g,

  // マイナンバー（日本）
  my_number: /\b\d{4}\s?\d{4}\s?\d{4}\b/g
};

/**
 * テキスト内のPIIを検出
 */
export function detectPII(text) {
  const findings = [];

  for (const [piiType, pattern] of Object.entries(PII_PATTERNS)) {
    const matches = text.matchAll(pattern);

    for (const match of matches) {
      findings.push({
        type: piiType,
        value: match[0],
        position: match.index,
        confidence: 0.9  // 正規表現は高信頼度
      });
    }
  }

  return findings;
}
```

### 2. カラム名ヒューリスティック

```javascript
// workers/pii-detector/column-detector.js

const SENSITIVE_COLUMN_NAMES = [
  'email', 'mail', 'e_mail',
  'phone', 'tel', 'telephone', 'mobile',
  'name', 'first_name', 'last_name', 'full_name',
  'ssn', 'social_security',
  'address', 'street', 'city', 'zip', 'postal',
  'dob', 'birth_date', 'birthdate',
  'passport', 'driver_license',
  'credit_card', 'card_number',
  'ip_address', 'ip',
  'password', 'pwd'
];

export function isSensitiveColumn(columnName) {
  const lower = columnName.toLowerCase();

  return SENSITIVE_COLUMN_NAMES.some(sensitive =>
    lower.includes(sensitive)
  );
}

export function analyzeSchemaPII(schema) {
  return schema.map(column => ({
    name: column.name,
    type: column.type,
    is_sensitive: isSensitiveColumn(column.name),
    suggested_masking: getSuggestedMasking(column.name)
  }));
}

function getSuggestedMasking(columnName) {
  const lower = columnName.toLowerCase();

  if (lower.includes('email')) return 'hash';
  if (lower.includes('phone')) return 'partial_mask';
  if (lower.includes('name')) return 'pseudonymize';
  if (lower.includes('ssn') || lower.includes('passport')) return 'full_mask';
  if (lower.includes('address')) return 'generalize';

  return 'none';
}
```

### 3. ML-basedPII検出（Workers AI）

```javascript
// workers/pii-detector/ml-detector.js

/**
 * Workers AIを使用したNER（固有表現抽出）によるPII検出
 */
export async function detectPIIWithAI(text, env) {
  // Workers AIのNERモデルを使用
  const response = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
    messages: [
      {
        role: 'system',
        content: 'Extract personally identifiable information (PII) from the text. Return JSON with: {pii_found: boolean, entities: [{type: string, value: string}]}'
      },
      {
        role: 'user',
        content: text
      }
    ],
    max_tokens: 512
  });

  try {
    const result = JSON.parse(response.response);
    return result.entities || [];
  } catch (error) {
    console.error('ML PII detection failed:', error);
    return [];
  }
}
```

---

## データマスキング戦略

### 1. ハッシング（不可逆）

```javascript
// workers/masking/hash.js

/**
 * SHA-256ハッシュによる不可逆マスキング
 * 用途: メールアドレス、ユーザーID等の一貫性が必要な場合
 */
export async function hashPII(value, salt = '') {
  const encoder = new TextEncoder();
  const data = encoder.encode(value + salt);

  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

// 使用例
const maskedEmail = await hashPII('user@example.com', 'secret-salt');
// → "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
```

### 2. トークン化（可逆）

```javascript
// workers/masking/tokenize.js

/**
 * トークン化（KVに元の値を保存）
 * 用途: 必要時に元の値を復元可能
 */
export async function tokenizePII(value, env) {
  // ランダムトークン生成
  const token = crypto.randomUUID();

  // KVに保存（有効期限付き）
  await env.PII_TOKENS.put(token, value, {
    expirationTtl: 86400 * 90  // 90日
  });

  return token;
}

export async function detokenizePII(token, env) {
  return await env.PII_TOKENS.get(token);
}

// 使用例
const token = await tokenizePII('john.doe@example.com', env);
// → "550e8400-e29b-41d4-a716-446655440000"

const original = await detokenizePII(token, env);
// → "john.doe@example.com"
```

### 3. 部分マスキング

```javascript
// workers/masking/partial.js

/**
 * 部分マスキング
 * 用途: 人間が読めるが特定はできない形式
 */
export function partialMask(value, visibleStart = 0, visibleEnd = 4) {
  if (value.length <= visibleStart + visibleEnd) {
    return '*'.repeat(value.length);
  }

  const start = value.substring(0, visibleStart);
  const end = value.substring(value.length - visibleEnd);
  const masked = '*'.repeat(value.length - visibleStart - visibleEnd);

  return start + masked + end;
}

// 使用例
partialMask('john.doe@example.com', 0, 4);    // → "***************.com"
partialMask('1234-5678-9012-3456', 0, 4);     // → "************3456"
partialMask('+1-555-123-4567', 3, 4);         // → "+1-********4567"
```

### 4. 一般化（k-匿名性）

```javascript
// workers/masking/generalize.js

/**
 * 年齢の一般化
 */
export function generalizeAge(age) {
  if (age < 18) return '0-17';
  if (age < 30) return '18-29';
  if (age < 50) return '30-49';
  if (age < 65) return '50-64';
  return '65+';
}

/**
 * 郵便番号の一般化
 */
export function generalizeZipCode(zipCode) {
  // 最初の3桁のみ保持
  return zipCode.substring(0, 3) + '****';
}

/**
 * 日付の一般化
 */
export function generalizeDate(date, granularity = 'month') {
  const d = new Date(date);

  if (granularity === 'year') {
    return d.getFullYear().toString();
  }

  if (granularity === 'month') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  return date;
}
```

### 5. 合成データ生成

```javascript
// workers/masking/synthetic.js

/**
 * Faker.jsを使用した合成データ生成
 */
import { faker } from '@faker-js/faker';

export function generateSyntheticPerson() {
  return {
    first_name: faker.person.firstName(),
    last_name: faker.person.lastName(),
    email: faker.internet.email(),
    phone: faker.phone.number(),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    zip: faker.location.zipCode(),
    dob: faker.date.birthdate({ min: 18, max: 80, mode: 'age' })
  };
}

// 使用例: 本番データの統計的特性を保持しつつ、完全に架空のデータ
const syntheticUser = generateSyntheticPerson();
// → { first_name: "Alice", last_name: "Johnson", email: "alice.johnson@example.com", ... }
```

---

## Cloudflare Workers実装

### PII検出・マスキングWorker

```javascript
// workers/pii-processor/index.js

import { detectPII } from './patterns.js';
import { hashPII, partialMask } from './masking.js';

export default {
  async fetch(request, env) {
    if (request.method === 'POST' && request.url.includes('/process')) {
      return await processPIIData(request, env);
    }

    return new Response('PII Processor API', { status: 200 });
  },

  // Queuesハンドラー（非同期処理）
  async queue(batch, env) {
    for (const message of batch.messages) {
      await processPIIMessage(message.body, env);
    }
  }
};

async function processPIIData(request, env) {
  const data = await request.json();

  // PII検出
  const piiFindings = detectAllPII(data);

  // マスキング適用
  const maskedData = await applyMasking(data, piiFindings, env);

  // 監査ログ記録
  await logPIIProcessing(env, {
    timestamp: new Date().toISOString(),
    findings_count: piiFindings.length,
    masking_applied: true
  });

  return new Response(JSON.stringify({
    original_fields: Object.keys(data).length,
    pii_found: piiFindings.length,
    masked_data: maskedData
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function detectAllPII(data) {
  const findings = [];

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      const detected = detectPII(value);

      findings.push(...detected.map(d => ({
        ...d,
        field: key
      })));
    }
  }

  return findings;
}

async function applyMasking(data, findings, env) {
  const masked = { ...data };

  for (const finding of findings) {
    const field = finding.field;
    const originalValue = masked[field];

    switch (finding.type) {
      case 'email':
        masked[field] = await hashPII(originalValue, env.PII_SALT);
        break;

      case 'phone':
        masked[field] = partialMask(originalValue, 0, 4);
        break;

      case 'credit_card':
        masked[field] = partialMask(originalValue, 0, 4);
        break;

      case 'ssn':
      case 'passport_jp':
        masked[field] = '***REDACTED***';
        break;

      default:
        masked[field] = partialMask(originalValue, 0, 3);
    }

    // 元データをセキュアストレージに保存（必要な場合）
    if (env.STORE_ORIGINAL) {
      const token = crypto.randomUUID();
      await env.PII_VAULT.put(token, originalValue, {
        metadata: {
          field,
          type: finding.type,
          masked_at: new Date().toISOString()
        }
      });
    }
  }

  return masked;
}

async function logPIIProcessing(env, logData) {
  await env.ANALYTICS.writeDataPoint({
    blobs: ['pii_processing', logData.masking_applied ? 'masked' : 'detected'],
    doubles: [logData.findings_count],
    indexes: [logData.timestamp]
  });
}
```

### wrangler設定

```toml
# wrangler-pii-processor.toml

name = "pii-processor"
main = "workers/pii-processor/index.js"
compatibility_date = "2024-01-01"

# KV (トークン保存)
[[kv_namespaces]]
binding = "PII_TOKENS"
id = "your-kv-namespace-id"

# R2 (セキュア保管)
[[r2_buckets]]
binding = "PII_VAULT"
bucket_name = "pii-vault"

# Analytics Engine
[[analytics_engine_datasets]]
binding = "ANALYTICS"

# 環境変数
[vars]
STORE_ORIGINAL = false  # 元データ保存するか

# Secrets
# wrangler secret put PII_SALT
```

---

## dbt実装

### マスキングマクロ

```sql
-- dbt/macros/mask_pii.sql

{% macro mask_email(column_name) %}
  CASE
    WHEN {{ column_name }} IS NULL THEN NULL
    WHEN {{ column_name }} ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
      CONCAT(
        LEFT(SPLIT_PART({{ column_name }}, '@', 1), 2),
        '***@',
        SPLIT_PART({{ column_name }}, '@', 2)
      )
    ELSE {{ column_name }}
  END
{% endmacro %}

{% macro mask_phone(column_name) %}
  CASE
    WHEN {{ column_name }} IS NULL THEN NULL
    ELSE CONCAT('***-***-', RIGHT({{ column_name }}, 4))
  END
{% endmacro %}

{% macro hash_pii(column_name, salt='default_salt') %}
  MD5(CONCAT({{ column_name }}, '{{ salt }}'))
{% endmacro %}

{% macro redact_pii(column_name) %}
  CASE
    WHEN {{ column_name }} IS NULL THEN NULL
    ELSE '***REDACTED***'
  END
{% endmacro %}
```

### マスク済みモデル

```sql
-- dbt/models/silver/users_masked.sql

{{
  config(
    materialized='view',
    tags=['pii_masked', 'silver']
  )
}}

WITH source_users AS (
  SELECT * FROM {{ source('bronze', 'users') }}
)

SELECT
  user_id,
  {{ mask_email('email') }} AS email_masked,
  {{ mask_phone('phone') }} AS phone_masked,
  {{ hash_pii('email', var('pii_salt', 'default')) }} AS email_hashed,
  first_name,
  -- 姓はイニシャルのみ
  LEFT(last_name, 1) || '.' AS last_name_initial,
  -- 年齢を範囲に一般化
  CASE
    WHEN age < 18 THEN '0-17'
    WHEN age < 30 THEN '18-29'
    WHEN age < 50 THEN '30-49'
    WHEN age < 65 THEN '50-64'
    ELSE '65+'
  END AS age_range,
  -- 郵便番号を一般化
  LEFT(zip_code, 3) || '****' AS zip_code_generalized,
  city,
  country,
  created_at

FROM source_users
```

---

## Great Expectations統合

### PII検出Expectation

```python
# great_expectations/plugins/pii_expectations.py

from great_expectations.expectations.expectation import ColumnMapExpectation
import re

class ExpectColumnValuesToNotContainPII(ColumnMapExpectation):
    """
    カラムにPIIが含まれていないことを検証
    """

    PII_PATTERNS = {
        'email': r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
        'phone': r'(\+?1-?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}',
        'ssn': r'\b\d{3}-\d{2}-\d{4}\b',
        'credit_card': r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b'
    }

    @classmethod
    def _atomic_map_function(cls, value, **kwargs):
        if value is None:
            return True

        for pii_type, pattern in cls.PII_PATTERNS.items():
            if re.search(pattern, str(value)):
                return False

        return True

    library_metadata = {
        "maturity": "production",
        "tags": ["pii", "security"],
        "contributors": ["@your-team"]
    }
```

### Expectation Suite

```python
# scripts/create_pii_suite.py

import great_expectations as gx

context = gx.get_context()

suite = context.add_expectation_suite("pii_detection_suite")

# ユーザーデータのPII検証
suite.add_expectation(
    gx.expectations.ExpectColumnValuesToNotContainPII(
        column="description",
        mostly=1.0  # 100%のレコードでPII検出されないこと
    )
)

suite.add_expectation(
    gx.expectations.ExpectColumnValuesToNotContainPII(
        column="comments",
        mostly=1.0
    )
)

# マスク済みカラムの検証
suite.add_expectation(
    gx.expectations.ExpectColumnValuesToMatchRegex(
        column="email_masked",
        regex=r".*\*\*\*@.*",  # マスク形式になっているか
        mostly=1.0
    )
)

context.save_expectation_suite(suite)
```

---

## 運用・監視

### 1. PII検出ダッシュボード

```sql
-- Analytics Engineクエリ

-- 日次PII検出統計
SELECT
  toDate(timestamp) as date,
  blob2 as pii_type,
  COUNT(*) as detections,
  COUNT(DISTINCT blob1) as affected_fields
FROM ANALYTICS_DATASET
WHERE blob1 = 'pii_processing'
  AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY date, pii_type
ORDER BY date DESC, detections DESC
```

### 2. アラート設定

```javascript
// workers/pii-alert/index.js

export default {
  async scheduled(event, env, ctx) {
    const recentDetections = await queryRecentPIIDetections(env);

    if (recentDetections > 1000) {
      await sendAlert(env, {
        severity: 'high',
        message: `High PII detection rate: ${recentDetections} in last hour`,
        action_required: 'Review data sources for PII leakage'
      });
    }
  }
};
```

### 3. 監査ログ

```javascript
// 完全な監査トレイル
const auditLog = {
  timestamp: new Date().toISOString(),
  operation: 'pii_masking',
  user: request.headers.get('cf-access-authenticated-user-email'),
  resource: 'users_table',
  fields_masked: ['email', 'phone', 'ssn'],
  masking_method: 'hash',
  compliance: ['GDPR', 'CCPA']
};

await env.AUDIT_LOG.put(
  `audit/${Date.now()}-${crypto.randomUUID()}`,
  JSON.stringify(auditLog)
);
```

---

## ベストプラクティス

### 1. 多層防御

- **入力時**: Workers でPII検出・マスキング
- **保存時**: R2に保存前にマスキング
- **変換時**: dbtでさらにマスキング
- **出力時**: APIレスポンスでマスキング確認

### 2. 最小権限

```javascript
// PII Vaultへのアクセス制限
if (!request.headers.get('cf-access-authenticated-user-email')?.endsWith('@company.com')) {
  return new Response('Forbidden', { status: 403 });
}

if (!hasRole(user, 'pii_admin')) {
  return new Response('Insufficient permissions', { status: 403 });
}
```

### 3. データ保持期限

```javascript
// 90日後に自動削除
await env.PII_VAULT.put(key, value, {
  expirationTtl: 86400 * 90
});
```

---

## 参考リンク

- [GDPR Official Site](https://gdpr.eu/)
- [CCPA Official Site](https://oag.ca.gov/privacy/ccpa)
- [Microsoft Presidio (PII Detection)](https://github.com/microsoft/presidio)
- [AWS Macie](https://aws.amazon.com/macie/)

---

最終更新: 2025-12-26
