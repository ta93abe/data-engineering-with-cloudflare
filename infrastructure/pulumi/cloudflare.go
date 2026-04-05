package main

import (
	"github.com/pulumi/pulumi-cloudflare/sdk/v5/go/cloudflare"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
)

type CloudflareOutputs struct {
	D1DatabaseId   pulumi.IDOutput
	D1DatabaseName pulumi.StringOutput
	R2BucketName   pulumi.StringOutput
	KvNamespaceId  pulumi.IDOutput
	AiGatewayId    pulumi.StringOutput
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
	// Note: CollectLogs is disabled by default as this gateway processes health data.
	// Enable explicitly in non-production environments if needed for debugging.
	aiGateway, err := cloudflare.NewAiGateway(ctx, "data-agent-gateway", &cloudflare.AiGatewayArgs{
		AccountId:              pulumi.String(accountId),
		Id:                     pulumi.String("data-agent-gateway"),
		CacheInvalidateOnUpdate: pulumi.Bool(true),
		CacheTtl:               pulumi.Int(3600),
		CollectLogs:            pulumi.Bool(false),
		RateLimitingLimit:      pulumi.Int(100),
		RateLimitingInterval:   pulumi.Int(60),
		RateLimitingTechnique:  pulumi.String("fixed"),
	})
	if err != nil {
		return nil, err
	}

	return &CloudflareOutputs{
		D1DatabaseId:   rawDb.ID(),
		D1DatabaseName: rawDb.Name,
		R2BucketName:   dataLake.Name,
		KvNamespaceId:  cacheKv.ID(),
		AiGatewayId:    aiGateway.ID().ToStringOutput(),
	}, nil
}
