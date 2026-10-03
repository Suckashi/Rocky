import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage } from "@langchain/core/messages";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { ToolDefinition } from "@langchain/core/language_models/base";
import type { ChatResult } from "@langchain/core/outputs";
import { toModelWire } from "./model-wire.js";

type Options = BaseChatModelCallOptions & {
  tools?: ToolDefinition[];
  rockyPurpose?: "target";
};

/** Agent-side transport only. Credentials, provider I/O and accounting remain in daemon. */
export class WorkerModel extends BaseChatModel<Options> {
  constructor(
    private readonly child: boolean,
    private readonly request: (
      child: boolean,
      messages: unknown[],
      tools: ToolDefinition[],
      purpose: "target" | "summary",
    ) => Promise<{ content: string; tool_calls?: AIMessage["tool_calls"] }>,
    private readonly maxInputTokens?: number,
  ) {
    super({});
  }
  _llmType() {
    return "rocky-worker-model";
  }
  get profile() {
    return {
      ...(this.maxInputTokens === undefined
        ? {}
        : { maxInputTokens: this.maxInputTokens }),
      imageInputs: false,
    };
  }
  bindTools(tools: BindToolsInput[], kwargs?: Partial<Options>) {
    // createAgent binds target tools; native summarization invokes this model unbound.
    // This trusted call option distinguishes purpose without inspecting user text.
    return this.withConfig({
      ...kwargs,
      tools: tools.map((tool) => convertToOpenAITool(tool)),
      rockyPurpose: "target",
    });
  }
  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): Promise<ChatResult> {
    const purpose = options.rockyPurpose ?? "summary";
    const response = await this.request(
      this.child,
      toModelWire(messages),
      options.tools ?? [],
      purpose,
    );
    if (
      purpose === "summary" &&
      (!response.content.trim() || (response.tool_calls?.length ?? 0) > 0)
    )
      throw Error("Summarizer must return nonempty text without tool calls");
    const reply = new AIMessage(response);
    return {
      generations: [{ text: response.content, message: reply }],
    };
  }
}
