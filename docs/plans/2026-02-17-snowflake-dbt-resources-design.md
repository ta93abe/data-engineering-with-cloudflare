# Snowflake dbt Resources Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** dbt core プロジェクト用の Snowflake リソース (サービスユーザー、ロール、データベース) を Pulumi で管理する

**Architecture:** 既存の `snowflake.go` に dbt 用リソースを追加。`CORE` データベースに dbt が staging/marts スキーマを書き込み、`RAW` データベースからソースデータを読み取る。WIF (OIDC) で GitHub Actions から認証。

**Tech Stack:** Go, Pulumi, pulumi-snowflake/sdk/v2

---

## Context

- 既存ファイル: `infrastructure/pulumi/snowflake.go`
- 既存リソース: RAW DB, INGESTION schema, ANALYTICS_WH, ADMIN DB, Git repo
- Provider: デフォルト (env vars で設定、`Pulumi.dev.yaml` に Snowflake 設定なし)
- 既存の WIF 参考: `pulumi-deploy.yml` の PULUMI_SVC (environment: pulumi)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database name | `CORE` | dbt project name と一致 |
| Warehouse | `ANALYTICS_WH` (既存共用) | 個人プロジェクトでリソース節約 |
| Auth method | WIF (OIDC) | GitHub Actions のみで実行。パスワードレスでセキュア |
| Role | `DBT_ROLE` | 最小権限の原則に従った専用ロール |
| WIF 実装 | `NewExecute` (raw SQL) | experimental feature flag を避け、既存パターンに合わせる |

---

### Task 1: Add CORE database and DBT_ROLE

**Files:**
- Modify: `infrastructure/pulumi/snowflake.go`

**Step 1: Add CORE database and DBT_ROLE to `createSnowflakeResources`**

`snowflake.go` の `createSnowflakeResources` 関数の Git Repository セクションの前に以下を追加:

```go
// ===========================================
// Snowflake Database for dbt
// ===========================================
coreDb, err := snowflake.NewDatabase(ctx, "core", &snowflake.DatabaseArgs{
    Name: pulumi.String("CORE"),
})
if err != nil {
    return nil, err
}

// ===========================================
// Snowflake Role for dbt
// ===========================================
dbtRole, err := snowflake.NewAccountRole(ctx, "dbtRole", &snowflake.AccountRoleArgs{
    Name:    pulumi.String("DBT_ROLE"),
    Comment: pulumi.String("Role for dbt service user to run transformations"),
})
if err != nil {
    return nil, err
}
```

**Step 2: Add outputs to `SnowflakeOutputs` struct**

```go
type SnowflakeOutputs struct {
    DatabaseName      pulumi.StringOutput
    SchemaName        pulumi.StringOutput
    WarehouseName     pulumi.StringOutput
    AdminDatabaseName pulumi.StringOutput
    GitRepositoryName pulumi.StringOutput
    CoreDatabaseName  pulumi.StringOutput  // NEW
    DbtRoleName       pulumi.StringOutput  // NEW
}
```

return 文にも追加:
```go
CoreDatabaseName:  coreDb.Name,
DbtRoleName:       dbtRole.Name,
```

**Step 3: Add outputs to `main.go`**

```go
ctx.Export("snowflakeCoreDatabaseName", sf.CoreDatabaseName)
ctx.Export("snowflakeDbtRoleName", sf.DbtRoleName)
```

**Step 4: Verify with `pulumi preview`**

Run: `cd infrastructure/pulumi && pulumi preview`
Expected: 2 resources to create (Database "core", AccountRole "dbtRole")

**Step 5: Commit**

```bash
git add infrastructure/pulumi/snowflake.go infrastructure/pulumi/main.go
git commit -m "feat: Add CORE database and DBT_ROLE for dbt"
```

---

### Task 2: Add grants for DBT_ROLE

**Files:**
- Modify: `infrastructure/pulumi/snowflake.go`

**Step 1: Add warehouse USAGE grant**

Git Repository セクションの前に追加:

```go
// ===========================================
// Grants for DBT_ROLE
// ===========================================

// Grant USAGE on warehouse
_, err = snowflake.NewGrantPrivilegesToAccountRole(ctx, "dbtGrantWarehouse", &snowflake.GrantPrivilegesToAccountRoleArgs{
    AccountRoleName: dbtRole.FullyQualifiedName,
    Privileges:      pulumi.ToStringArray([]string{"USAGE"}),
    OnAccountObject: &snowflake.GrantPrivilegesToAccountRoleOnAccountObjectArgs{
        ObjectType: pulumi.String("WAREHOUSE"),
        ObjectName: sfWarehouse.FullyQualifiedName,
    },
})
if err != nil {
    return nil, err
}
```

**Step 2: Add CORE database grants**

```go
// Grant ALL PRIVILEGES on CORE database
_, err = snowflake.NewGrantPrivilegesToAccountRole(ctx, "dbtGrantCoreDb", &snowflake.GrantPrivilegesToAccountRoleArgs{
    AccountRoleName: dbtRole.FullyQualifiedName,
    AllPrivileges:   pulumi.Bool(true),
    OnAccountObject: &snowflake.GrantPrivilegesToAccountRoleOnAccountObjectArgs{
        ObjectType: pulumi.String("DATABASE"),
        ObjectName: coreDb.FullyQualifiedName,
    },
})
if err != nil {
    return nil, err
}
```

**Step 3: Add RAW database read grants**

```go
// Grant USAGE on RAW database
_, err = snowflake.NewGrantPrivilegesToAccountRole(ctx, "dbtGrantRawDbUsage", &snowflake.GrantPrivilegesToAccountRoleArgs{
    AccountRoleName: dbtRole.FullyQualifiedName,
    Privileges:      pulumi.ToStringArray([]string{"USAGE"}),
    OnAccountObject: &snowflake.GrantPrivilegesToAccountRoleOnAccountObjectArgs{
        ObjectType: pulumi.String("DATABASE"),
        ObjectName: sfDatabase.FullyQualifiedName,
    },
})
if err != nil {
    return nil, err
}

// Grant USAGE on all schemas in RAW
_, err = snowflake.NewGrantPrivilegesToAccountRole(ctx, "dbtGrantRawSchemasUsage", &snowflake.GrantPrivilegesToAccountRoleArgs{
    AccountRoleName: dbtRole.FullyQualifiedName,
    Privileges:      pulumi.ToStringArray([]string{"USAGE"}),
    OnSchema: &snowflake.GrantPrivilegesToAccountRoleOnSchemaArgs{
        AllSchemasInDatabase: sfDatabase.FullyQualifiedName,
    },
})
if err != nil {
    return nil, err
}

// Grant SELECT on all tables in RAW
_, err = snowflake.NewGrantPrivilegesToAccountRole(ctx, "dbtGrantRawTablesSelect", &snowflake.GrantPrivilegesToAccountRoleArgs{
    AccountRoleName: dbtRole.FullyQualifiedName,
    Privileges:      pulumi.ToStringArray([]string{"SELECT"}),
    OnSchemaObject: &snowflake.GrantPrivilegesToAccountRoleOnSchemaObjectArgs{
        All: &snowflake.GrantPrivilegesToAccountRoleOnSchemaObjectAllArgs{
            ObjectTypePlural: pulumi.String("TABLES"),
            InDatabase:       sfDatabase.FullyQualifiedName,
        },
    },
})
if err != nil {
    return nil, err
}

// Grant SELECT on future tables in RAW
_, err = snowflake.NewGrantPrivilegesToAccountRole(ctx, "dbtGrantRawFutureTablesSelect", &snowflake.GrantPrivilegesToAccountRoleArgs{
    AccountRoleName: dbtRole.FullyQualifiedName,
    Privileges:      pulumi.ToStringArray([]string{"SELECT"}),
    OnSchemaObject: &snowflake.GrantPrivilegesToAccountRoleOnSchemaObjectArgs{
        Future: &snowflake.GrantPrivilegesToAccountRoleOnSchemaObjectFutureArgs{
            ObjectTypePlural: pulumi.String("TABLES"),
            InDatabase:       sfDatabase.FullyQualifiedName,
        },
    },
})
if err != nil {
    return nil, err
}

// Grant CREATE SCHEMA on CORE (for dbt to create staging/marts schemas)
_, err = snowflake.NewGrantPrivilegesToAccountRole(ctx, "dbtGrantCoreCreateSchema", &snowflake.GrantPrivilegesToAccountRoleArgs{
    AccountRoleName: dbtRole.FullyQualifiedName,
    Privileges:      pulumi.ToStringArray([]string{"CREATE SCHEMA"}),
    OnAccountObject: &snowflake.GrantPrivilegesToAccountRoleOnAccountObjectArgs{
        ObjectType: pulumi.String("DATABASE"),
        ObjectName: coreDb.FullyQualifiedName,
    },
})
if err != nil {
    return nil, err
}
```

**Step 4: Verify with `pulumi preview`**

Run: `cd infrastructure/pulumi && pulumi preview`
Expected: 7 grant resources to create

**Step 5: Commit**

```bash
git add infrastructure/pulumi/snowflake.go
git commit -m "feat: Add grants for DBT_ROLE on CORE and RAW databases"
```

---

### Task 3: Add DBT_SERVICE_USER with WIF

**Files:**
- Modify: `infrastructure/pulumi/snowflake.go`
- Modify: `infrastructure/pulumi/main.go`

**Step 1: Add service user creation**

Grant セクションの後に追加:

```go
// ===========================================
// Snowflake Service User for dbt
// ===========================================
dbtUser, err := snowflake.NewServiceUser(ctx, "dbtServiceUser", &snowflake.ServiceUserArgs{
    Name:             pulumi.String("DBT_SERVICE_USER"),
    LoginName:        pulumi.String("DBT_SERVICE_USER"),
    Comment:          pulumi.String("Service user for dbt transformations via GitHub Actions"),
    DefaultRole:      pulumi.String("DBT_ROLE"),
    DefaultWarehouse: pulumi.String("ANALYTICS_WH"),
    DefaultNamespace: pulumi.String("CORE"),
}, pulumi.DependsOn([]pulumi.Resource{dbtRole, sfWarehouse, coreDb}))
if err != nil {
    return nil, err
}
```

**Step 2: Add WIF configuration via Execute**

既存パターン (git API integration) に合わせて `NewExecute` を使用:

```go
// ===========================================
// WIF (OIDC) configuration for dbt service user
// ===========================================
_, err = snowflake.NewExecute(ctx, "dbtUserWif", &snowflake.ExecuteArgs{
    Execute: pulumi.Sprintf(
        "ALTER USER %s SET DEFAULT_WORKLOAD_IDENTITY = '(oidc=<issuer=https://token.actions.githubusercontent.com subject=repo:ta93abe/data-engineering-with-cloudflare:environment:dbt oidcAudienceList=(snowflakecomputing.com)>)'",
        dbtUser.Name,
    ),
    Revert: pulumi.Sprintf(
        "ALTER USER %s UNSET DEFAULT_WORKLOAD_IDENTITY",
        dbtUser.Name,
    ),
}, pulumi.DependsOn([]pulumi.Resource{dbtUser}))
if err != nil {
    return nil, err
}
```

**Step 3: Grant DBT_ROLE to DBT_SERVICE_USER**

```go
// Grant DBT_ROLE to DBT_SERVICE_USER
_, err = snowflake.NewGrantAccountRole(ctx, "dbtGrantRoleToUser", &snowflake.GrantAccountRoleArgs{
    RoleName: dbtRole.Name,
    UserName: dbtUser.Name,
})
if err != nil {
    return nil, err
}
```

**Step 4: Add outputs**

`SnowflakeOutputs` struct に追加:
```go
DbtServiceUserName pulumi.StringOutput
```

return 文に追加:
```go
DbtServiceUserName: dbtUser.Name,
```

`main.go` に追加:
```go
ctx.Export("snowflakeDbtServiceUserName", sf.DbtServiceUserName)
```

**Step 5: Verify with `pulumi preview`**

Run: `cd infrastructure/pulumi && pulumi preview`
Expected: 3 resources to create (ServiceUser, Execute for WIF, GrantAccountRole)

**Step 6: Commit**

```bash
git add infrastructure/pulumi/snowflake.go infrastructure/pulumi/main.go
git commit -m "feat: Add DBT_SERVICE_USER with WIF (OIDC) authentication"
```

---

### Task 4: Verify full preview and final cleanup

**Step 1: Run full `pulumi preview`**

Run: `cd infrastructure/pulumi && pulumi preview`
Expected: 12 total new resources:
- 1 Database (CORE)
- 1 AccountRole (DBT_ROLE)
- 7 Grants
- 1 ServiceUser (DBT_SERVICE_USER)
- 1 Execute (WIF config)
- 1 GrantAccountRole

**Step 2: Run `go vet`**

Run: `cd infrastructure/pulumi && go vet ./...`
Expected: No errors

**Step 3: Squash into final commit (optional)**

If all looks good, the 3 commits can be kept as-is or squashed when merging the PR.
