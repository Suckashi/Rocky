import "./environment.js";
import { randomUUID } from "node:crypto";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { ToolDefinition } from "@langchain/core/language_models/base";
import type { ChatResult } from "@langchain/core/outputs";
import { z } from "zod";
import {
  modelConfigSchema,
  type ModelConfig,
} from "../../contracts/src/models.js";
import {
  tokenUsageSchema,
  type TokenUsage,
} from "../../contracts/src/model-budget.js";
import { RockyError } from "../../contracts/src/index.js";
import { ModelNetwork } from "./model-network.js";

type Options = BaseChatModelCallOptions & { tools?: ToolDefinition[] };
export type ModelAccounting = {
  reserve: (
    requestId: string,
    inputTokenBound: number | null,
    outputTokenBound: number,
  ) => void;
  settle: (requestId: string, usage: TokenUsage | null) => void;
  // Only a trusted, model-specific tokenizer/profile may supply this; no character heuristic.
  inputTokenBound?: (body: Readonly<Record<string, unknown>>) => number;
};
function textContent(message: BaseMessage) {
  if (typeof message.content === "string") return message.content;
  const parts = z
    .array(z.object({ type: z.literal("text"), text: z.string() }))
    .safeParse(message.content);
  if (!parts.success)
    throw new RockyError(
      "unsupported_content",
      "This model adapter currently supports text and tool messages only",
      422,
    );
  return parts.data.map((p) => p.text).join("\n");
}
export function providerUsage(
  data: unknown,
  provider: ModelConfig["provider"],
): TokenUsage | null {
  const envelope = z.object({ usage: z.unknown().optional() }).parse(data);
  if (envelope.usage === undefined || envelope.usage === null) return null;
  if (provider === "anthropic") {
    const usage = z
      .object({
        input_tokens: z.number(),
        output_tokens: z.number(),
        cache_creation_input_tokens: z.number().optional(),
        cache_read_input_tokens: z.number().optional(),
      })
      .parse(envelope.usage);
    // Cache-priced accounting needs separate explicit rates; never misprice it as ordinary input.
    if (
      (usage.cache_creation_input_tokens ?? 0) !== 0 ||
      (usage.cache_read_input_tokens ?? 0) !== 0
    )
      return null;
    return tokenUsageSchema.parse({
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    });
  }
  const usage = z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      prompt_tokens_details: z
        .object({ cached_tokens: z.number().optional() })
        .optional(),
    })
    .parse(envelope.usage);
  if ((usage.prompt_tokens_details?.cached_tokens ?? 0) !== 0) return null;
  return tokenUsageSchema.parse({
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  });
}
const toolCallSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1).max(200),
    arguments: z.string(),
  }),
});

/** Transport/model adapter only. Deep Agents owns all task and tool orchestration. */
export class ConfiguredModel extends BaseChatModel<Options> {
  private readonly config: ModelConfig;
  private readonly network: ModelNetwork;
  private pending = new Set<Promise<ChatResult>>();
  private closing?: Promise<void>;
  constructor(
    config: ModelConfig,
    private readonly accounting: ModelAccounting,
    private readonly runSignal: AbortSignal,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    super({});
    this.config = modelConfigSchema.parse(config);
    this.network = new ModelNetwork(this.config, env);
  }
  _llmType() {
    return "rocky-configured";
  }
  get profile() {
    return {
      ...(this.config.contextWindowTokens === null
        ? {}
        : {
            maxInputTokens:
              this.config.contextWindowTokens - this.config.maxOutputTokens,
          }),
      imageInputs: false,
    };
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
    if (this.closing)
      throw new RockyError("model_closed", "Model connection is closed", 409);
    const task = this.generateConfigured(messages, options).finally(() =>
      this.pending.delete(task),
    );
    this.pending.add(task);
    return task;
  }
  private async generateConfigured(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): Promise<ChatResult> {
    const signal = AbortSignal.any([
      this.runSignal,
      ...(options.signal ? [options.signal] : []),
      AbortSignal.timeout(60000),
    ]);
    signal.throwIfAborted();
    if (options.tool_choice !== undefined)
      throw new RockyError(
        "unsupported_tool_choice",
        "Explicit tool_choice is not supported by this adapter yet",
        422,
      );
    const anthropic = this.config.provider === "anthropic";
    const tools = options.tools ?? [];
    const wire: Record<string, unknown>[] = [];
    const system: string[] = [];
    for (const message of messages) {
      const text = textContent(message);
      if (message.type === "system") {
        if (anthropic) system.push(text);
        else wire.push({ role: "system", content: text });
      } else if (message.type === "human")
        wire.push({ role: "user", content: text });
      else if (message.type === "ai") {
        const calls = (message as AIMessage).tool_calls ?? [];
        if (calls.some((c) => !c.id))
          throw new RockyError(
            "tool_identity_required",
            "Tool call identity is required",
            422,
          );
        wire.push(
          anthropic
            ? {
                role: "assistant",
                content: [
                  ...(text ? [{ type: "text", text }] : []),
                  ...calls.map((c) => ({
                    type: "tool_use",
                    id: c.id,
                    name: c.name,
                    input: c.args,
                  })),
                ],
              }
            : {
                role: "assistant",
                content: text || null,
                ...(calls.length
                  ? {
                      tool_calls: calls.map((c) => ({
                        id: c.id,
                        type: "function",
                        function: {
                          name: c.name,
                          arguments: JSON.stringify(c.args),
                        },
                      })),
                    }
                  : {}),
              },
        );
      } else if (message.type === "tool") {
        const tool = message as ToolMessage;
        if (!tool.tool_call_id)
          throw new RockyError(
            "tool_identity_required",
            "Tool result identity is required",
            422,
          );
        wire.push(
          anthropic
            ? {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: tool.tool_call_id,
                    content: text,
                    is_error: tool.status === "error",
                  },
                ],
              }
            : { role: "tool", tool_call_id: tool.tool_call_id, content: text },
        );
      } else
        throw new RockyError(
          "unsupported_role",
          "Unsupported model message role",
          422,
        );
    }
    const body: Record<string, unknown> = {
      model: this.config.modelId,
      max_tokens: this.config.maxOutputTokens,
      messages: wire,
      ...(anthropic && system.length ? { system: system.join("\n\n") } : {}),
      ...(tools.length
        ? {
            tools: anthropic
              ? tools.map((t) => ({
                  name: t.function.name,
                  description: t.function.description,
                  input_schema: t.function.parameters,
                }))
              : tools,
          }
        : {}),
    };
    const inputTokenBound = this.accounting.inputTokenBound?.(body) ?? null;
    if (inputTokenBound !== null) {
      tokenUsageSchema.parse({
        inputTokens: inputTokenBound,
        outputTokens: this.config.maxOutputTokens,
      });
      if (this.config.contextWindowTokens === null)
        throw new RockyError(
          "context_required",
          "Configure a trusted context limit before bounded execution",
          422,
        );
      if (
        inputTokenBound + this.config.maxOutputTokens >
        this.config.contextWindowTokens
      )
        throw new RockyError(
          "context_exceeded",
          "Request exceeds the configured context window",
          429,
        );
    }
    if (Buffer.byteLength(JSON.stringify(body)) > 1048576)
      throw new RockyError(
        "model_input_limit",
        "Model request exceeds its byte limit",
        413,
      );
    const requestId = randomUUID();
    this.accounting.reserve(
      requestId,
      inputTokenBound,
      this.config.maxOutputTokens,
    );
    try {
      const response = await this.network.post(body, signal);
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 1048576)
            throw new RockyError(
              "model_response_limit",
              "Model response exceeds its byte limit",
              502,
            );
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const usage = providerUsage(data, this.config.provider);
      this.accounting.settle(requestId, usage);
      let content: string;
      let calls: NonNullable<AIMessage["tool_calls"]> = [];
      if (anthropic) {
        const reply = z
          .object({
            stop_reason: z.enum(["end_turn", "tool_use", "stop_sequence"]),
            content: z.array(
              z.discriminatedUnion("type", [
                z.object({ type: z.literal("text"), text: z.string() }),
                z.object({
                  type: z.literal("tool_use"),
                  id: z.string().min(1),
                  name: z.string().min(1),
                  input: z.record(z.string(), z.unknown()),
                }),
              ]),
            ),
          })
          .parse(data);
        content = reply.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
        calls = reply.content
          .filter((c) => c.type === "tool_use")
          .map((c) => ({
            id: c.id,
            name: c.name,
            args: c.input,
            type: "tool_call",
          }));
      } else {
        const reply = z
          .object({
            choices: z
              .array(
                z.object({
                  finish_reason: z.enum(["stop", "tool_calls"]),
                  message: z.object({
                    content: z.string().nullable().optional(),
                    tool_calls: z.array(toolCallSchema).optional(),
                  }),
                }),
              )
              .length(1),
          })
          .parse(data).choices[0]!;
        content = reply.message.content ?? "";
        calls = (reply.message.tool_calls ?? []).map((c) => ({
          id: c.id,
          name: c.function.name,
          args: z
            .record(z.string(), z.unknown())
            .parse(JSON.parse(c.function.arguments)),
          type: "tool_call",
        }));
      }
      if (new Set(calls.map((c) => c.id)).size !== calls.length)
        throw new RockyError(
          "duplicate_tool_id",
          "Provider repeated a tool call identity",
          502,
        );
      const message = new AIMessage({
        content,
        tool_calls: calls,
        ...(usage
          ? {
              usage_metadata: {
                input_tokens: usage.inputTokens,
                output_tokens: usage.outputTokens,
                total_tokens: usage.inputTokens + usage.outputTokens,
              },
            }
          : {}),
      });
      return { generations: [{ text: content, message }] };
    } catch (error) {
      if (error instanceof RockyError) throw error;
      throw new RockyError(
        signal.aborted ? "model_cancelled" : "invalid_model_response",
        "Configured model request did not return a usable response",
        502,
      );
    }
  }
  async close() {
    this.closing ??= (async () => {
      await this.network.close();
      await Promise.allSettled([...this.pending]);
    })();
    await this.closing;
  }
}
