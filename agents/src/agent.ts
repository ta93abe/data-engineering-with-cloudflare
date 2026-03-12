import { AIChatAgent } from "@cloudflare/ai-chat";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { createTools, SYSTEM_PROMPT } from "./tools";
import type { Env } from "./types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

export class DataAgent extends AIChatAgent<Env> {
  async onChatMessage(
    _onFinish: Parameters<AIChatAgent<Env>["onChatMessage"]>[0],
    options?: Parameters<AIChatAgent<Env>["onChatMessage"]>[1]
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai(MODEL_ID),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(this.messages),
      abortSignal: options?.abortSignal,
      stopWhen: stepCountIs(5),
      tools: createTools(this.env.DB),
    });

    return result.toUIMessageStreamResponse();
  }
}
