import { test, expect } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { FixtureModel } from "../fixtures/models/model.js";
import { createRockyAgent } from "../packages/agent-runtime/src/factory.js";
test("parallel native tasks preserve parent identity even with repeated child tool IDs", async () => {
  const events: { name: string; data: Record<string, unknown> }[] = [];
  const root = new FixtureModel(false, async (messages) => {
    const message = messages.some((m) => m.type === "tool")
      ? new AIMessage("Both tasks returned")
      : new AIMessage({
          content: "",
          tool_calls: ["parent-a", "parent-b"].map((id) => ({
            id,
            name: "task",
            args: {
              subagent_type: "general-purpose",
              description: "Inspect " + id,
            },
            type: "tool_call" as const,
          })),
        });
    return { generations: [{ text: "", message }] };
  });
  const child = new FixtureModel(true, async (messages) => {
    const message = messages.some((m) => m.type === "tool")
      ? new AIMessage("Child inspected")
      : new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "shared-child-call",
              name: "inspect_sample",
              args: { label: "synthetic source" },
              type: "tool_call",
            },
          ],
        });
    return { generations: [{ text: "", message }] };
  });
  const agent = createRockyAgent(
    new MemorySaver(),
    {
      event: (name, data) => events.push({ name, data }),
      call: async (name) => {
        if (name === "rocky_skill_check") return "ok";
        if (name !== "inspect_sample") throw Error(name);
        return "Observed fixture";
      },
    },
    { root, child },
    true,
  );
  await agent.invoke(
    { messages: [new HumanMessage("Run two native tasks")] },
    { configurable: { thread_id: "parent-identity" } },
  );
  const children = events.filter(
    (e) => e.name === "rocky.tool.completed" && e.data.child === true,
  );
  expect(children).toHaveLength(2);
  expect(children.map((e) => e.data.callId)).toEqual([
    "shared-child-call",
    "shared-child-call",
  ]);
  expect(new Set(children.map((e) => e.data.parentCallId))).toEqual(
    new Set(["parent-a", "parent-b"]),
  );
  for (const parentCallId of ["parent-a", "parent-b"]) {
    expect(
      events
        .filter((e) => e.data.parentCallId === parentCallId)
        .map((e) => e.name),
    ).toEqual(["rocky.tool.started", "rocky.tool.completed"]);
  }
  expect(
    events
      .filter((e) => e.name === "rocky.subagent.completed")
      .every((e) => e.data.parentCallId === undefined),
  ).toBe(true);
});
