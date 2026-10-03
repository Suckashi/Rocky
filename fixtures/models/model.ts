import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
// Deterministic external-response fixture. Actual planning/tool execution stays in Deep Agents.
export class FixtureModel extends BaseChatModel {
  constructor(
    private readonly child = false,
    private readonly request?: (
      messages: BaseMessage[],
      child: boolean,
    ) => Promise<ChatResult>,
  ) {
    super({});
  }
  _llmType() {
    return "rocky-fixture";
  }
  bindTools() {
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    if (this.request) return this.request(messages, this.child);
    // Script only this invocation, while the real runtime retains earlier conversation context.
    const lastUser = messages.findLastIndex(
      (message) => message.type === "human",
    );
    messages = messages.slice(Math.max(0, lastUser));
    const seen = (name: string) =>
      messages.some((m) => m.type === "tool" && m.name === name);
    const call = (name: string, args: Record<string, unknown>) =>
      new AIMessage({
        content: "",
        tool_calls: [{ id: "fixture-" + name, name, args, type: "tool_call" }],
      });
    let message: AIMessage;
    if (this.child)
      message = seen("inspect_sample")
        ? new AIMessage("Synthetic sample inspection returned checked=true.")
        : call("inspect_sample", { label: "rocky" });
    else if (!seen("write_todos"))
      message = call("write_todos", {
        todos: [
          {
            content: "Inspect synthetic sample with a native child",
            status: "in_progress",
          },
          {
            content: "Request approval before synthetic write",
            status: "pending",
          },
        ],
      });
    else if (!seen("task"))
      message = call("task", {
        description: "Inspect the synthetic sample and report evidence.",
        subagent_type: "general-purpose",
      });
    else if (!seen("write_sample"))
      message = call("write_sample", { value: "Rocky fixture verified" });
    else {
      const result = messages.findLast(
        (m) => m.type === "tool" && m.name === "write_sample",
      );
      const denied = JSON.stringify(result?.content).includes("reject");
      message = new AIMessage(
        denied
          ? "已完成合成資料檢查；寫入已拒絕，未執行。"
          : "已完成合成流程：原生子代理檢查與核准後寫入。這是 fixture 結果，不是真實模型驗收。",
      );
    }
    return {
      generations: [
        {
          text: typeof message.content === "string" ? message.content : "",
          message,
        },
      ],
    };
  }
}
