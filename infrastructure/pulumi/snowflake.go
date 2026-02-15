package main

import (
	"github.com/pulumi/pulumi-snowflake/sdk/v2/go/snowflake"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
)

type SnowflakeOutputs struct {
	DatabaseName      pulumi.StringOutput
	SchemaName        pulumi.StringOutput
	WarehouseName     pulumi.StringOutput
	AdminDatabaseName pulumi.StringOutput
	GitRepositoryName pulumi.StringOutput
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
		DatabaseName:      sfDatabase.Name,
		SchemaName:        sfSchema.Name,
		WarehouseName:     sfWarehouse.Name,
		AdminDatabaseName: adminDb.Name,
		GitRepositoryName: gitRepo.Name,
	}, nil
}
