import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const glossary = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/glossary" }),
  schema: z.object({
    term: z.string(),
    termEn: z.string(),
    category: z.enum(["財務", "プロダクト", "マーケティング", "エンジニアリング", "データ"]),
    relatedModels: z.array(z.string()).default([]),
    relatedMetrics: z.array(z.string()).default([]),
    owner: z.string().optional(),
    lastReviewed: z.coerce.date().optional(),
  }),
});

export const collections = { glossary };
