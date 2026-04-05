package main

import (
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi/config"
)

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		cfg := config.New(ctx, "")
		accountId := cfg.Require("accountId")

		cf, err := createCloudflareResources(ctx, accountId)
		if err != nil {
			return err
		}

		sf, err := createSnowflakeResources(ctx)
		if err != nil {
			return err
		}

		// ===========================================
		// Outputs
		// ===========================================
		ctx.Export("d1DatabaseId", cf.D1DatabaseId)
		ctx.Export("d1DatabaseName", cf.D1DatabaseName)
		ctx.Export("r2BucketName", cf.R2BucketName)
		ctx.Export("kvNamespaceId", cf.KvNamespaceId)
		ctx.Export("snowflakeDatabaseName", sf.DatabaseName)
		ctx.Export("snowflakeSchemaName", sf.SchemaName)
		ctx.Export("snowflakeWarehouseName", sf.WarehouseName)
		ctx.Export("snowflakeAdminDatabaseName", sf.AdminDatabaseName)
		ctx.Export("snowflakeCoreDatabaseName", sf.CoreDatabaseName)
		ctx.Export("snowflakeDbtRoleName", sf.DbtRoleName)
		ctx.Export("snowflakeDbtServiceUserName", sf.DbtServiceUserName)
		ctx.Export("snowflakeGitRepositoryName", sf.GitRepositoryName)

		return nil
	})
}
