-- =============================================================================
-- Snowflake Bootstrap: Pulumi IaC 用のロール・ユーザー・権限
-- =============================================================================
-- このスクリプトは Snowsight で手動実行する（Pulumi 自身では作成できない）
-- 実行順序: 1. ロール → 2. ユーザー → 3. 権限付与
-- =============================================================================

-- 1. ロール作成
USE ROLE USERADMIN;

CREATE ROLE IF NOT EXISTS PULUMI_ROLE
  COMMENT = 'Role for Pulumi infrastructure management';

GRANT ROLE PULUMI_ROLE TO ROLE SYSADMIN;

-- 2. サービスユーザー作成（GitHub Actions OIDC 認証）
CREATE USER IF NOT EXISTS PULUMI_SVC
  TYPE = SERVICE
  WORKLOAD_IDENTITY = (
    TYPE = OIDC
    ISSUER = 'https://token.actions.githubusercontent.com'
    SUBJECT = 'repo:ta93abe/data-engineering-with-cloudflare:environment:pulumi'
  )
  DEFAULT_ROLE = PULUMI_ROLE
  COMMENT = 'Service user for Pulumi IaC (GitHub Actions OIDC)';

GRANT ROLE PULUMI_ROLE TO USER PULUMI_SVC;

-- 3. 権限付与
USE ROLE SECURITYADMIN;

-- 基本リソース
GRANT CREATE DATABASE ON ACCOUNT TO ROLE PULUMI_ROLE;
GRANT CREATE WAREHOUSE ON ACCOUNT TO ROLE PULUMI_ROLE;
GRANT CREATE ROLE ON ACCOUNT TO ROLE PULUMI_ROLE;
GRANT CREATE USER ON ACCOUNT TO ROLE PULUMI_ROLE;
GRANT CREATE INTEGRATION ON ACCOUNT TO ROLE PULUMI_ROLE;
GRANT CREATE NETWORK POLICY ON ACCOUNT TO ROLE PULUMI_ROLE;
GRANT CREATE SHARE ON ACCOUNT TO ROLE PULUMI_ROLE;

-- Snowpark Container Services / Native App
GRANT CREATE COMPUTE POOL ON ACCOUNT TO ROLE PULUMI_ROLE;
GRANT CREATE APPLICATION ON ACCOUNT TO ROLE PULUMI_ROLE;
GRANT CREATE APPLICATION PACKAGE ON ACCOUNT TO ROLE PULUMI_ROLE;
GRANT BIND SERVICE ENDPOINT ON ACCOUNT TO ROLE PULUMI_ROLE;
