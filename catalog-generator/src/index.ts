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
    // Only process if manifest.json was updated
    const hasManifestUpdate = batch.messages.some(
      (msg) => msg.body.object.key === "manifest.json" && msg.body.action !== "DeleteObject"
    );
    if (!hasManifestUpdate) return;

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

    // 2. Generate Markdown for each model and write to data-catalog bucket
    const writes: Promise<R2Object>[] = [];
    for (const [key, node] of Object.entries(manifest.nodes)) {
      if (node.resource_type !== "model") continue;

      const md = generateModelMarkdown(node, catalog?.nodes?.[key]);
      const folder = inferFolder(node.fqn);
      const path = `models/${folder}/${node.name}.md`;

      writes.push(
        env.DATA_CATALOG.put(path, md, {
          httpMetadata: { contentType: "text/markdown" },
        })
      );
    }

    await Promise.all(writes);
    console.log(`Generated ${writes.length} model documents`);
  },
};
