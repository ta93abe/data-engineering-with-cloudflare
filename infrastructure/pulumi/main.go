package main

import (
	"github.com/pulumi/pulumi-cloudflare/sdk/v5/go/cloudflare"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi/config"
)

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		cfg := config.New(ctx, "")
		accountId := cfg.Require("accountId")

		// ===========================================
		// D1 Database
		// ===========================================
		// 既存のD1データベースをインポートして管理
		// pulumi import cloudflare:index/d1Database:D1Database raw <account_id>/<database_id>
		rawDb, err := cloudflare.NewD1Database(ctx, "raw", &cloudflare.D1DatabaseArgs{
			AccountId: pulumi.String(accountId),
			Name:      pulumi.String("raw"),
		}, pulumi.Protect(true))
		if err != nil {
			return err
		}

		// ===========================================
		// R2 Bucket (for data lake)
		// ===========================================
		dataLake, err := cloudflare.NewR2Bucket(ctx, "data-lake", &cloudflare.R2BucketArgs{
			AccountId: pulumi.String(accountId),
			Name:      pulumi.String("data-lake"),
			Location:  pulumi.String("APAC"),
		})
		if err != nil {
			return err
		}

		// ===========================================
		// Workers KV Namespace (for caching)
		// ===========================================
		cacheKv, err := cloudflare.NewWorkersKvNamespace(ctx, "data-cache", &cloudflare.WorkersKvNamespaceArgs{
			AccountId: pulumi.String(accountId),
			Title:     pulumi.String("data-cache"),
		})
		if err != nil {
			return err
		}

		// ===========================================
		// Outputs
		// Worker の wrangler.jsonc で参照するためのID出力
		// ===========================================
		ctx.Export("d1DatabaseId", rawDb.ID())
		ctx.Export("d1DatabaseName", rawDb.Name)
		ctx.Export("r2BucketName", dataLake.Name)
		ctx.Export("kvNamespaceId", cacheKv.ID())

		return nil
	})
}
