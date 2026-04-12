package main

import (
	"github.com/pulumi/pulumi-cloudflare/sdk/v6/go/cloudflare"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
)

type CloudflareOutputs struct {
	D1DatabaseId     pulumi.IDOutput
	D1DatabaseName   pulumi.StringOutput
	R2BucketName     pulumi.StringOutput
	LakeR2BucketName pulumi.StringOutput
	KvNamespaceId    pulumi.IDOutput
}

func createCloudflareResources(ctx *pulumi.Context, accountId string) (*CloudflareOutputs, error) {
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
		return nil, err
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
		return nil, err
	}

	// ===========================================
	// R2 Bucket (for Iceberg data lake)
	// ===========================================
	lake, err := cloudflare.NewR2Bucket(ctx, "lake", &cloudflare.R2BucketArgs{
		AccountId: pulumi.String(accountId),
		Name:      pulumi.String("lake"),
		Location:  pulumi.String("APAC"),
	}, pulumi.Protect(true))
	if err != nil {
		return nil, err
	}

	// ===========================================
	// Workers KV Namespace (for caching)
	// ===========================================
	cacheKv, err := cloudflare.NewWorkersKvNamespace(ctx, "data-cache", &cloudflare.WorkersKvNamespaceArgs{
		AccountId: pulumi.String(accountId),
		Title:     pulumi.String("data-cache"),
	})
	if err != nil {
		return nil, err
	}

	// ===========================================
	// AI Gateway (for data-agent)
	// ===========================================
	// AI Gateway is not yet supported by the Pulumi Cloudflare provider.
	// Manage via Cloudflare Dashboard or API:
	//   wrangler ai-gateway create data-agent-gateway
	// Gateway config: cache TTL 3600s, rate limit 100 req/60s, logs disabled (health data)

	return &CloudflareOutputs{
		D1DatabaseId:     rawDb.ID(),
		D1DatabaseName:   rawDb.Name,
		R2BucketName:     dataLake.Name,
		LakeR2BucketName: lake.Name,
		KvNamespaceId:    cacheKv.ID(),
	}, nil
}
