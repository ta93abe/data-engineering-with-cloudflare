import { generateModelMarkdown, inferFolder } from "./markdown";
import type { DbtManifest, DbtCatalog } from "./markdown";

interface Env {
  DBT_ARTIFACTS: R2Bucket;
  DATA_CATALOG: R2Bucket;
}

interface R2EventMessage {
  account: string;
  bucket: string;
  object: {
    key: string;
    size: number;
    eTag: string;
  };
  action: "PutObject" | "DeleteObject" | "CompleteMultipartUpload" | "CopyObject";
  eventTime: string;
}

export default {
  async queue(batch: MessageBatch<R2EventMessage>, env: Env): Promise<void> {
    // Only process if manifest.json or catalog.json was updated
    const hasRelevantUpdate = batch.messages.some(
      (msg) =>
        (msg.body.object.key === "manifest.json" || msg.body.object.key === "catalog.json") &&
        msg.body.action !== "DeleteObject"
    );
    if (!hasRelevantUpdate) return;

    // 1. Read manifest.json + catalog.json from source bucket
    const [manifestObj, catalogObj] = await Promise.all([
      env.DBT_ARTIFACTS.get("manifest.json"),
      env.DBT_ARTIFACTS.get("catalog.json"),
    ]);

    if (!manifestObj) {
      console.error("manifest.json not found in dbt-artifacts-modeling");
      return;
    }

    const manifest = (await manifestObj.json()) as DbtManifest;
    const catalog = catalogObj ? ((await catalogObj.json()) as DbtCatalog) : null;

    // 2. Generate Markdown for each model and write to data-catalog bucket in batches
    const BATCH_SIZE = 50;
    const entries: Array<{ path: string; md: string }> = [];
    for (const [key, node] of Object.entries(manifest.nodes)) {
      if (node.resource_type !== "model") continue;
      const md = generateModelMarkdown(node, catalog?.nodes?.[key]);
      const folder = inferFolder(node.fqn);
      entries.push({ path: `models/${folder}/${node.name}.md`, md });
    }

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((entry) =>
          env.DATA_CATALOG.put(entry.path, entry.md, {
            httpMetadata: { contentType: "text/markdown" },
          })
        )
      );
    }

    // Clean up removed models
    const currentModelPaths = new Set(
      Object.values(manifest.nodes)
        .filter((node) => node.resource_type === "model")
        .map((node) => `models/${inferFolder(node.fqn)}/${node.name}.md`)
    );

    const existingObjects = await env.DATA_CATALOG.list({ prefix: "models/" });
    const deletes: Promise<void>[] = [];
    for (const obj of existingObjects.objects) {
      if (!currentModelPaths.has(obj.key)) {
        deletes.push(env.DATA_CATALOG.delete(obj.key));
      }
    }
    if (deletes.length > 0) {
      await Promise.all(deletes);
      console.log(`Deleted ${deletes.length} stale model documents`);
    }

    console.log(`Generated ${entries.length} model documents`);
  },
};
