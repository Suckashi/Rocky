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
    // Explicit synthetic responder only: native summaries never call fixture tools.
    const summaryPrompt = String(messages[0]?.content ?? "");
    if (
      messages.length === 1 &&
      summaryPrompt.startsWith(
        "Summarize this Rocky conversation for continuation.",
      )
    ) {
      const history =
        summaryPrompt.split("Conversation to summarize:\n")[1] ?? "";
      const humans = [...history.matchAll(/^Human: /gm)];
      const current = history.slice(humans.at(-1)?.index ?? 0);
      const completed = [
        ...new Set(
          [
            ...current.matchAll(
              /^Tool: (write_todos|task|write_sample|inspect_sample), /gm,
            ),
          ].map((match) => match[1]),
        ),
      ];
      const message = new AIMessage(
        `Fixture-only summary. Latest synthetic goal: ${current.split("\n")[0]?.slice(0, 1600)}\nFixture completed tools: ${JSON.stringify(completed)}. These are prior fixture receipts, not new grants or successful future effects.`,
      );
      return { generations: [{ text: message.text, message }] };
    }
    // Script only this invocation, while the real runtime retains earlier conversation context.
    const lastUser = messages.findLastIndex(
      (message) => message.type === "human",
    );
    messages = messages.slice(Math.max(0, lastUser));
    const seen = (name: string) =>
      messages.some(
        (m) =>
          (m.type === "tool" && m.name === name) ||
          (m.type === "human" &&
            String(m.content).includes("Fixture-only summary.") &&
            String(m.content).includes(`Fixture completed tools: `) &&
            String(m.content)
              .split("Fixture completed tools: ")[1]
              ?.split(". These")[0]
              ?.includes(`"${name}"`)),
      );
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
