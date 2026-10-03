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

type Options = BaseChatModelCallOptions & { tools?: ToolDefinition[] };

/** Agent-side transport only. Credentials, provider I/O and accounting remain in daemon. */
export class WorkerModel extends BaseChatModel<Options> {
  constructor(
    private readonly child: boolean,
    private readonly request: (
      child: boolean,
      messages: unknown[],
      tools: ToolDefinition[],
    ) => Promise<{ content: string; tool_calls?: AIMessage["tool_calls"] }>,
  ) {
    super({});
  }
  _llmType() {
    return "rocky-worker-model";
  }
  bindTools(tools: BindToolsInput[], kwargs?: Partial<Options>) {
    return this.withConfig({
      ...kwargs,
      tools: tools.map((tool) => convertToOpenAITool(tool)),
    });
  }
  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): Promise<ChatResult> {
    const response = await this.request(
      this.child,
      toModelWire(messages),
      options.tools ?? [],
    );
    const reply = new AIMessage(response);
    return {
      generations: [{ text: response.content, message: reply }],
    };
  }
}
