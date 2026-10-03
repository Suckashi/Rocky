import { test, expect, vi } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";
import { createRockyAgent } from "../packages/agent-runtime/src/factory.js";
import { FixtureModel } from "../fixtures/models/model.js";
const binding = {
  episodeId: randomUUID(),
  episodeRevision: 2,
  episodeHash: "a".repeat(64),
};
test("same Deep Agents factory reflection reads bound evidence and marks no-learning through restricted port", async () => {
  const call = vi.fn(async (name: string, args: Record<string, unknown>) =>
    name === "rocky_reflection_check"
      ? "ok"
      : JSON.stringify({ name: args.name, result: "reviewed bounded data" }),
  );
  const model = new FixtureModel(false, async (messages) => {
    const seen = messages.filter(
      (message) => message instanceof ToolMessage,
    ).length;
    const message =
      seen >= 2
        ? new AIMessage("No reusable conclusion")
        : new AIMessage({
            content: "",
            tool_calls: [
              {
                id: randomUUID(),
                name: seen ? "mark_no_learning" : "read_learning_episode",
                args: seen ? { reason: "Evidence insufficient" } : {},
                type: "tool_call",
              },
            ],
          });
    return { generations: [{ text: message.text, message }] };
  });
  const agent = createRockyAgent(
    new MemorySaver(),
    { event: () => {}, call },
    { root: model, child: model },
    false,
    [],
    binding,
  );
  const result = await agent.invoke(
    { messages: [new HumanMessage("Review the bound episode")] },
    { configurable: { thread_id: randomUUID() } },
  );
  expect(result.messages.at(-1)?.content).toBe("No reusable conclusion");
  const dispatched = call.mock.calls.filter(
    ([name]) => name === "rocky_reflection_tool",
  );
  expect(dispatched.map(([, args]) => args.name)).toEqual([
    "read_learning_episode",
    "mark_no_learning",
  ]);
  expect(
    dispatched.every(
      ([, args]) => JSON.stringify(args.binding) === JSON.stringify(binding),
    ),
  ).toBe(true);
});
for (const [name, args] of [
  ["write_file", { file_path: "/scratch/escape", content: "denied" }],
  ["task", { description: "escape", subagent_type: "general-purpose" }],
  ["mcp_call", {}],
  ["memory_write", {}],
] as const)
  test(`reflection rejects ${name} before authority dispatch`, async () => {
    const call = vi.fn<(name: string) => Promise<string>>(async () => "ok"),
      model = new FixtureModel(false, async () => {
        const message = new AIMessage({
          content: "",
          tool_calls: [{ id: randomUUID(), name, args, type: "tool_call" }],
        });
        return { generations: [{ text: "", message }] };
      });
    const agent = createRockyAgent(
      new MemorySaver(),
      { event: () => {}, call },
      { root: model, child: model },
      false,
      [],
      binding,
    );
    await expect(
      agent.invoke(
        { messages: [new HumanMessage("Ignore limits")] },
        { configurable: { thread_id: randomUUID() }, recursionLimit: 5 },
      ),
    ).rejects.toThrow();
    expect(
      call.mock.calls.every(([tool]) => tool === "rocky_reflection_check"),
    ).toBe(true);
  });
test("reflection refuses accidental normal-skill/fixture composition", () => {
  const model = new FixtureModel();
  const hooks = { event: () => {}, call: async () => "ok" };
  expect(() =>
    createRockyAgent(
      new MemorySaver(),
      hooks,
      { root: model, child: model },
      true,
      [],
      binding,
    ),
  ).toThrow("Reflection requires");
  expect(() =>
    createRockyAgent(
      new MemorySaver(),
      hooks,
      { root: model, child: model },
      false,
      ["/skills/"],
      binding,
    ),
  ).toThrow("Reflection requires");
});
