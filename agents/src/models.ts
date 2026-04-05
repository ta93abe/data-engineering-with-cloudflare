import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";

/**
 * チャットモデル: 高性能→コスト効率→軽量の順にフォールバック
 * - gemma-4-26b-a4b-it:  $0.100/M input, $0.300/M output (256K ctx, Reasoning, Vision, Function calling)
 * - qwen3-30b-a3b-fp8:   $0.051/M input, $0.335/M output (最安 30B クラス)
 * - llama-3-8b-instruct-awq: $0.123/M input, $0.266/M output (8B 最軽量フォールバック)
 */
export const CHAT_MODELS = [
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/meta/llama-3-8b-instruct-awq",
] as const;

/**
 * 埋め込みモデル: 1024次元、多言語対応 (日本語含む)
 */
export const EMBEDDING_MODEL = "@cf/baai/bge-m3" as const;
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * generateText をモデルフォールバック付きで実行する。
 * CHAT_MODELS を順に試し、最初に成功したものを返す。
 */
export async function generateTextWithFallback(
  ai: Ai,
  options: { system?: string; prompt: string }
): Promise<{ text: string }> {
  const workersai = createWorkersAI({ binding: ai });
  let lastError: unknown;

  for (const modelId of CHAT_MODELS) {
    try {
      const result = await generateText({
        model: workersai(modelId),
        system: options.system,
        prompt: options.prompt,
      });
      return { text: result.text };
    } catch (error) {
      console.error(`Model ${modelId} failed, trying next:`, error);
      lastError = error;
    }
  }

  throw lastError ?? new Error("All chat models failed");
}
