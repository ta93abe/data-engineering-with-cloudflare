import { AIChatAgent } from "@cloudflare/ai-chat";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { retrieveRelevantContext } from "./knowledge";
import { createTools, SYSTEM_PROMPT } from "./tools";
import type { Env } from "./types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

export class DataAgent extends AIChatAgent<Env> {
  async onChatMessage(
    _onFinish: Parameters<AIChatAgent<Env>["onChatMessage"]>[0],
    options?: Parameters<AIChatAgent<Env>["onChatMessage"]>[1]
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    // RAG: retrieve relevant context for the latest user message
    let ragContext = "";
    const lastUserMsg = this.messages.filter((m) => m.role === "user").at(-1);
    if (lastUserMsg?.parts) {
      const queryText = lastUserMsg.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ");

      if (queryText) {
        const context = await retrieveRelevantContext(this.env, queryText, 3);
        if (context) {
          ragContext = `\n\n関連する過去のインサイト:\n${context}`;
        }
      }
    }

    const result = streamText({
      model: workersai(MODEL_ID),
      system: SYSTEM_PROMPT + ragContext,
      messages: await convertToModelMessages(this.messages),
      abortSignal: options?.abortSignal,
      stopWhen: stepCountIs(5),
      tools: createTools(this.env),
    });

    return result.toUIMessageStreamResponse();
  }
}
