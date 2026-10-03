import { test, expect } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { FixtureModel } from "../fixtures/models/model.js";
import { createRockyAgent } from "../packages/agent-runtime/src/factory.js";
import { validateScratchCall } from "../packages/agent-runtime/src/scratch-policy.js";

test("native scratch writes/edits/read survive checkpoints and stay isolated by execution thread", async () => {
  const events: Record<string, unknown>[] = [];
  const model = new FixtureModel(false, async (messages) => {
    const tools = messages.filter((m) => m.type === "tool");
    const readOnly = String(
      messages.find((m) => m.type === "human")?.content,
    ).includes("read only");
    const calls = readOnly
      ? [["read_file", { file_path: "/scratch/note.md" }]]
      : [
          [
            "write_file",
            { file_path: "/scratch/note.md", content: "private initial note" },
          ],
          [
            "edit_file",
            {
              file_path: "/scratch/note.md",
              old_string: "initial",
              new_string: "edited",
            },
          ],
          ["read_file", { file_path: "/scratch/note.md" }],
        ];
    const next = calls[tools.length];
    const message = next
      ? new AIMessage({
          content: "",
          tool_calls: [
            {
              id: `scratch-${tools.length}`,
              name: next[0] as string,
              args: next[1] as Record<string, unknown>,
              type: "tool_call",
            },
          ],
        })
      : new AIMessage(JSON.stringify(tools.at(-1)?.content));
    return { generations: [{ text: "", message }] };
  });
  const saver = new MemorySaver();
  const agent = createRockyAgent(
    saver,
    {
      event: (_name, data) => events.push(data),
      call: async () => {
        throw Error("No MCP effect expected");
      },
    },
    { root: model, child: model },
  );
  const first = await agent.invoke(
    { messages: [new HumanMessage("write scratch")] },
    { configurable: { thread_id: "scratch-one" } },
  );
  expect(String(first.messages.at(-1)?.content)).toContain(
    "private edited note",
  );
  const restored = await saver.getTuple({
    configurable: { thread_id: "scratch-one" },
  });
  expect(JSON.stringify(restored?.checkpoint.channel_values.files)).toContain(
    "private edited note",
  );
  expect(JSON.stringify(events)).not.toContain("private initial note");
  expect(JSON.stringify(events)).toContain("run-private-graph-state");
  const other = await agent.invoke(
    { messages: [new HumanMessage("read only")] },
    { configurable: { thread_id: "scratch-two" } },
  );
  expect(String(other.messages.at(-1)?.content)).not.toContain(
    "private edited note",
  );
  expect(String(other.messages.at(-1)?.content)).toMatch(
    /not found|does not exist/i,
  );
});

test("scratch scope denies traversal, host paths, context edits and oversized tool IPC", () => {
  for (const path of [
    "/etc/passwd",
    "/scratch/../etc/passwd",
    "D:\\Code\\Rocky\\package.json",
    "/scratch/a\\b",
    "/scratch/./a",
    "/scratch/a\0",
    "relative",
  ])
    expect(() =>
      validateScratchCall("read_file", { file_path: path }),
    ).toThrow();
  expect(() =>
    validateScratchCall("write_file", {
      file_path: "/conversation_history/a.md",
      content: "altered",
    }),
  ).toThrow();
  expect(
    validateScratchCall("read_file", {
      file_path: "/conversation_history/a.md",
    }).storage,
  ).toBe("run-private-graph-state");
  expect(() =>
    validateScratchCall("write_file", {
      file_path: "/scratch/a",
      content: "x".repeat(25 * 1024),
    }),
  ).toThrow(/24 KiB/);
});

test("native guard refuses execute and out-of-scope tools before any public start or MCP effect", async () => {
  for (const name of ["execute", "read_file"]) {
    const events: string[] = [];
    const model = new FixtureModel(false, async () => ({
      generations: [
        {
          text: "",
          message: new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "denied",
                name,
                args:
                  name === "execute"
                    ? { command: "whoami" }
                    : { file_path: "/etc/passwd" },
                type: "tool_call",
              },
            ],
          }),
        },
      ],
    }));
    const agent = createRockyAgent(
      new MemorySaver(),
      {
        event: (event) => events.push(event),
        call: async () => {
          throw Error("Unexpected effect");
        },
      },
      { root: model, child: model },
    );
    await expect(
      agent.invoke(
        { messages: [new HumanMessage("denied path")] },
        { configurable: { thread_id: name } },
      ),
    ).rejects.toThrow(/denied/);
    expect(events).toEqual([]);
  }
});
