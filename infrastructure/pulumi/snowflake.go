package main

import (
	"github.com/pulumi/pulumi-snowflake/sdk/v2/go/snowflake"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
)

type SnowflakeOutputs struct {
	DatabaseName  pulumi.StringOutput
	SchemaName    pulumi.StringOutput
	WarehouseName pulumi.StringOutput
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

	return &SnowflakeOutputs{
		DatabaseName:  sfDatabase.Name,
		SchemaName:    sfSchema.Name,
		WarehouseName: sfWarehouse.Name,
	}, nil
}
