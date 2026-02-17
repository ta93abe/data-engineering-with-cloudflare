package main

import (
	"github.com/pulumi/pulumi-snowflake/sdk/v2/go/snowflake"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
)

type SnowflakeOutputs struct {
	DatabaseName       pulumi.StringOutput
	SchemaName         pulumi.StringOutput
	WarehouseName      pulumi.StringOutput
	AdminDatabaseName  pulumi.StringOutput
	CoreDatabaseName   pulumi.StringOutput
	DbtRoleName        pulumi.StringOutput
	DbtServiceUserName pulumi.StringOutput
	GitRepositoryName  pulumi.StringOutput
}

func createSnowflakeResources(ctx *pulumi.Context) (*SnowflakeOutputs, error) {
	// ===========================================
	// Snowflake Database
	// ===========================================
	sfDatabase, err := snowflake.NewDatabase(ctx, "raw", &snowflake.DatabaseArgs{
		Name: pulumi.String("RAW"),
	})
	if err != nil {
		return nil, err
	}

	// ===========================================
	// Snowflake Schema
	// ===========================================
	sfSchema, err := snowflake.NewSchema(ctx, "ingestion", &snowflake.SchemaArgs{
		Database: sfDatabase.Name,
		Name:     pulumi.String("INGESTION"),
	})
	if err != nil {
		return nil, err
	}

	// ===========================================
	// Snowflake Warehouse
	// ===========================================
	sfWarehouse, err := snowflake.NewWarehouse(ctx, "analytics", &snowflake.WarehouseArgs{
		Name:          pulumi.String("ANALYTICS_WH"),
		WarehouseSize: pulumi.String("XSMALL"),
		AutoSuspend:   pulumi.Int(60),
		AutoResume:    pulumi.String("true"),
	})
	if err != nil {
		return nil, err
	}

	// ===========================================
	// Snowflake Admin Database (for tools/management)
	// ===========================================
	adminDb, err := snowflake.NewDatabase(ctx, "admin", &snowflake.DatabaseArgs{
		Name: pulumi.String("ADMIN"),
	})
	if err != nil {
		return nil, err
	}

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

	// Grant USAGE, CREATE SCHEMA, MONITOR on CORE database
	_, err = snowflake.NewGrantPrivilegesToAccountRole(ctx, "dbtGrantCoreDb", &snowflake.GrantPrivilegesToAccountRoleArgs{
		AccountRoleName: dbtRole.FullyQualifiedName,
		Privileges:      pulumi.ToStringArray([]string{"USAGE", "CREATE SCHEMA", "MONITOR"}),
		OnAccountObject: &snowflake.GrantPrivilegesToAccountRoleOnAccountObjectArgs{
			ObjectType: pulumi.String("DATABASE"),
			ObjectName: coreDb.FullyQualifiedName,
		},
	})
	if err != nil {
		return nil, err
	}

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



	// ===========================================
	// Snowflake Service User for dbt
	// ===========================================
	dbtUser, err := snowflake.NewServiceUser(ctx, "dbtServiceUser", &snowflake.ServiceUserArgs{
		Name:             pulumi.String("DBT_SERVICE_USER"),
		LoginName:        pulumi.String("DBT_SERVICE_USER"),
		Comment:          pulumi.String("Service user for dbt transformations via GitHub Actions"),
		DefaultRole:      dbtRole.Name,
		DefaultWarehouse: sfWarehouse.Name,
		DefaultNamespace: coreDb.Name,
	})
	if err != nil {
		return nil, err
	}

	// Grant DBT_ROLE to DBT_SERVICE_USER
	_, err = snowflake.NewGrantAccountRole(ctx, "dbtGrantRoleToUser", &snowflake.GrantAccountRoleArgs{
		RoleName: dbtRole.Name,
		UserName: dbtUser.Name,
	})
	if err != nil {
		return nil, err
	}

	// ===========================================
	// Snowflake Git API Integration (Execute)
	// ApiIntegration resource does not support git_https_api provider
	// ===========================================
	gitApiIntegration, err := snowflake.NewExecute(ctx, "gitApiIntegration", &snowflake.ExecuteArgs{
		Execute: pulumi.String("CREATE OR REPLACE API INTEGRATION git_api_integration API_PROVIDER = git_https_api API_ALLOWED_PREFIXES = ('https://github.com/ta93abe') ENABLED = TRUE"),
		Revert:  pulumi.String("DROP INTEGRATION IF EXISTS git_api_integration"),
	})
	if err != nil {
		return nil, err
	}

	// ===========================================
	// Snowflake Git Repository
	// ===========================================
	gitRepo, err := snowflake.NewGitRepository(ctx, "dataEngineering", &snowflake.GitRepositoryArgs{
		Database:       adminDb.Name,
		Schema:         pulumi.String("PUBLIC"),
		Name:           pulumi.String("DATA_ENGINEERING"),
		Origin:         pulumi.String("https://github.com/ta93abe/data-engineering-with-cloudflare.git"),
		ApiIntegration: pulumi.String("GIT_API_INTEGRATION"),
	}, pulumi.DependsOn([]pulumi.Resource{gitApiIntegration, adminDb}))
	if err != nil {
		return nil, err
	}

	return &SnowflakeOutputs{
		DatabaseName:       sfDatabase.Name,
		SchemaName:         sfSchema.Name,
		WarehouseName:      sfWarehouse.Name,
		AdminDatabaseName:  adminDb.Name,
		CoreDatabaseName:   coreDb.Name,
		DbtRoleName:        dbtRole.Name,
		DbtServiceUserName: dbtUser.Name,
		GitRepositoryName:  gitRepo.Name,
	}, nil
}
