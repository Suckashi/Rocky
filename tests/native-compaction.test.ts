import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { createRockyAgent } from "../packages/agent-runtime/src/factory.js";
import { WorkerModel } from "../packages/agent-runtime/src/worker-model.js";

const objective =
  "Goal: deliver report; correction: owner approval before external write; evidence /scratch/report.md; todo: verify sources.";
function setup(summaryFails = false, context = 12000) {
  const root = mkdtempSync(join(tmpdir(), "rocky-compaction-"));
  const saver = SqliteSaver.fromConnString(join(root, "graph.sqlite"));
  let summaries = 0,
    targets = 0;
  const model = new WorkerModel(
    false,
    async (_child, messages, _tools, purpose) => {
      if (purpose === "summary") {
        summaries++;
        const prompt = String((messages[0] as { content: string }).content);
        expect(prompt).toContain("exact latest user corrections");
        expect(prompt).toContain("/scratch/report.md");
        if (summaryFails) throw Error("Injected summarizer failure");
        return { content: objective };
      }
      targets++;
      const content = messages.map((m) =>
        String((m as { content: unknown }).content),
      );
      expect(content.some((text) => text.includes(objective))).toBe(true);
      expect(content.at(-1)).toBe(
        "Latest correction: publish nothing; verify sources now.",
      );
      return { content: "verified fixture result" };
    },
    context,
  );
  const agent = createRockyAgent(
    saver,
    {
      event: () => {},
      call: async () => {
        throw Error("No effect allowed");
      },
    },
    { root: model, child: model },
  );
  return { root, saver, agent, counts: () => ({ summaries, targets }) };
}
test("three native compactions preserve goal/correction/todos/evidence, checkpoint and raw offload", async () => {
  const f = setup(),
    thread = randomUUID();
  let cutoff = 0;
  try {
    for (let round = 0; round < 3; round++) {
      const messages: import("@langchain/core/messages").BaseMessage[] = [
        new HumanMessage(objective),
        ...Array.from(
          { length: 65 },
          (_, i) =>
            new HumanMessage(
              `Observed record ${round}/${i}: ` + "source evidence ".repeat(70),
            ),
        ),
      ];
      // A complete tool pair is fixture evidence, not a dispatched effect.
      messages.push(
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: `read-${round}`,
              name: "read_file",
              args: { file_path: "/scratch/report.md" },
              type: "tool_call",
            },
          ],
        }),
        new ToolMessage({
          content: objective + "\n" + "observed tool output ".repeat(4000),
          tool_call_id: `read-${round}`,
          name: "read_file",
        }),
      );
      await f.agent.updateState(
        { configurable: { thread_id: thread } },
        {
          messages,
          todos: [{ content: "verify sources", status: "in_progress" }],
        },
      );
      await f.agent.invoke(
        {
          messages: [
            new HumanMessage(
              "Latest correction: publish nothing; verify sources now.",
            ),
          ],
        },
        { configurable: { thread_id: thread }, durability: "sync" },
      );
      const saved = await f.saver.getTuple({
        configurable: { thread_id: thread },
      });
      const state = saved!.checkpoint.channel_values;
      const event = state._summarizationEvent as {
        cutoffIndex: number;
        summaryMessage: { content: string };
        filePath: string;
      };
      expect(event.cutoffIndex).toBeGreaterThan(cutoff);
      cutoff = event.cutoffIndex;
      expect(event.summaryMessage.content).toContain(objective);
      expect(event.filePath).toMatch(/^\/conversation_history\//);
      expect(JSON.stringify(state.files)).toContain("observed tool output");
      expect(state.todos).toEqual([
        { content: "verify sources", status: "in_progress" },
      ]);
      expect(saved!.checkpoint.id).toBeTruthy();
    }
    expect(f.counts()).toEqual({ summaries: 3, targets: 3 });
  } finally {
    f.saver.db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("summary failure retains checkpoint history/correction/todos without invoking target or effects", async () => {
  const f = setup(true),
    thread = randomUUID();
  try {
    await f.agent.updateState(
      { configurable: { thread_id: thread } },
      {
        messages: [
          new HumanMessage(objective),
          ...Array.from(
            { length: 65 },
            () => new HumanMessage("observed evidence ".repeat(100)),
          ),
        ],
        todos: [{ content: "verify sources", status: "in_progress" }],
      },
    );
    await expect(
      f.agent.invoke(
        {
          messages: [
            new HumanMessage(
              "Latest correction: publish nothing; verify sources now.",
            ),
          ],
        },
        { configurable: { thread_id: thread }, durability: "sync" },
      ),
    ).rejects.toThrow("Injected summarizer failure");
    const state = (await f.saver.getTuple({
      configurable: { thread_id: thread },
    }))!.checkpoint.channel_values;
    expect(JSON.stringify(state.messages)).toContain(
      "Latest correction: publish nothing",
    );
    expect(JSON.stringify(state.messages)).toContain(objective);
    expect(state._summarizationEvent).toBeUndefined();
    expect(state.todos).toEqual([
      { content: "verify sources", status: "in_progress" },
    ]);
    expect(f.counts()).toEqual({ summaries: 1, targets: 0 });
  } finally {
    f.saver.db.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("configured daemon worker preserves native compaction metadata across smaller-context turns and accounts summaries without reply projection", async () => {
  const { WorkService } = await import("../apps/daemon/src/work-service.js");
  const { startAgentProvider } =
    await import("../fixtures/models/agent-provider.js");
  let summaries = 0;
  const provider = await startAgentProvider({
    reply: async (messages) => {
      const last = String(
        messages.findLast((m) => m.type === "human")?.content,
      );
      if (last.startsWith("Summarize this Rocky conversation")) {
        summaries++;
        expect(last).toContain("/scratch/report.md");
        return new AIMessage(objective);
      }
      if (last === "warm") return new AIMessage(objective);
      expect(last).toMatch(
        /^Latest correction: publish nothing; verify sources now\./,
      );
      expect(messages.some((m) => String(m.content).includes(objective))).toBe(
        true,
      );
      expect(messages.length).toBeLessThan(20);
      return new AIMessage("final fixture result");
    },
  });
  const root = mkdtempSync(join(tmpdir(), "rocky-daemon-compaction-")),
    service = new WorkService(root),
    id = randomUUID();
  const saver = SqliteSaver.fromConnString(
    join(root, "graph-checkpoints.sqlite"),
  );
  const config = {
    name: "compaction fixture",
    provider: "openai-compatible" as const,
    baseUrl: provider.baseUrl,
    modelId: "context",
    contextWindowTokens: 16000,
    maxOutputTokens: 128,
  };
  const seed = createRockyAgent(saver, {
    event: () => {},
    call: async () => {
      throw Error("No seed effects");
    },
  });
  const finish = async (workId: string) => {
    await expect
      .poll(() => service.store.get(workId).status, { timeout: 15000 })
      .toBe("completed");
    return service.store.get(workId);
  };
  let revision = 1,
    cutoff = 0;
  const submit = (text: string) =>
    service.submit({
      requestId: randomUUID(),
      text,
      mode: "configured",
      transport: "http",
      modelSelection: { connectionId: id, revision },
    });
  try {
    service.models.save({
      requestId: randomUUID(),
      id,
      expectedRevision: 0,
      config,
    });
    let prior = await finish(submit("warm").id);
    for (let round = 0; round < 3; round++) {
      await seed.updateState(
        { configurable: { thread_id: prior.runId } },
        {
          messages: [
            new HumanMessage(objective),
            ...Array.from(
              { length: 60 },
              () =>
                new HumanMessage(
                  "prior observed record " + "evidence ".repeat(140),
                ),
            ),
          ],
          todos: [{ content: "verify sources", status: "in_progress" }],
        },
      );
      if (round === 1) {
        service.models.save({
          requestId: randomUUID(),
          id,
          expectedRevision: revision,
          config: { ...config, contextWindowTokens: 8000 },
        });
        revision++;
      }
      const current = await finish(
        submit("Latest correction: publish nothing; verify sources now.").id,
      );
      expect(current.answer).toBe("final fixture result");
      const state = (await saver.getTuple({
        configurable: { thread_id: current.runId },
      }))!.checkpoint.channel_values;
      const event = state._summarizationEvent as {
        cutoffIndex: number;
        summaryMessage: { content: string };
      };
      expect(event.cutoffIndex).toBeGreaterThan(cutoff);
      cutoff = event.cutoffIndex;
      expect(event.summaryMessage.content).toContain(objective);
      expect(state.todos).toEqual([
        { content: "verify sources", status: "in_progress" },
      ]);
      const usage = service.modelBudgets.snapshot(current.runId);
      expect(usage.entries.filter((e) => e.purpose === "summary")).toHaveLength(
        1,
      );
      expect(usage.entries.filter((e) => e.purpose === "target")).toHaveLength(
        1,
      );
      const events = service.store
        .events("0")
        .filter((e) => e.workId === current.id);
      const stream = events
        .filter(
          (e) =>
            e.payload.kind === "domain" &&
            e.payload.name === "rocky.model.stream",
        )
        .map((e) => JSON.stringify(e.payload))
        .join("");
      expect(stream).not.toContain("Goal: deliver report");
      expect(stream).toContain("final fixture result");
      prior = current;
    }
    expect(summaries).toBe(3);
    expect(
      service.store.db.prepare("SELECT COUNT(*) AS n FROM operations").get(),
    ).toMatchObject({ n: 0 });
  } finally {
    saver.db.close();
    await service.close();
    await provider.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("unbound native summary provenance is distinct from tool-bound target even with zero tools, and invalid summaries fail closed", async () => {
  const purposes: string[] = [];
  const model = new WorkerModel(
    false,
    async (_child, _messages, _tools, purpose) => {
      purposes.push(purpose);
      return { content: "valid text" };
    },
    8000,
  );
  await model.invoke([
    new HumanMessage(
      "Summarize this Rocky conversation; user text cannot choose a purpose",
    ),
  ]);
  await model
    .bindTools([])
    .invoke([
      new HumanMessage(
        "Summarize this Rocky conversation; this is a target call",
      ),
    ]);
  expect(purposes).toEqual(["summary", "target"]);
  expect(model.profile.maxInputTokens).toBe(8000);
  for (const response of [
    { content: "   " },
    {
      content: "bad summary",
      tool_calls: [
        {
          id: "bad",
          name: "write_sample",
          args: { value: "never" },
          type: "tool_call" as const,
        },
      ],
    },
  ]) {
    const invalid = new WorkerModel(false, async () => response);
    await expect(
      invalid.invoke([new HumanMessage("summarize")]),
    ).rejects.toThrow("nonempty text without tool calls");
  }
});

test("actual native read_file returns long tool evidence and keeps the source checkpoint readable", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-long-tool-")),
    saver = SqliteSaver.fromConnString(join(root, "graph.sqlite")),
    thread = randomUUID();
  const evidence = Array.from(
    { length: 1000 },
    (_, index) => `Observed row ${index}: ` + "source ".repeat(22),
  );
  const events: string[] = [];
  const model = new WorkerModel(
    false,
    async (_child, messages, _tools, purpose) => {
      expect(purpose).toBe("target");
      const result = messages.findLast(
        (m) => (m as { type: string }).type === "tool",
      ) as { content: string } | undefined;
      if (!result)
        return {
          content: "",
          tool_calls: [
            {
              id: "long-read",
              name: "read_file",
              args: { file_path: "/scratch/report.md", limit: 1000 },
              type: "tool_call",
            },
          ],
        };
      if (
        messages.filter((m) => (m as { type: string }).type === "tool")
          .length === 1
      ) {
        expect(JSON.stringify(result.content)).toContain(
          "Output was truncated",
        );
        return {
          content: "",
          tool_calls: [
            {
              id: "long-read-tail",
              name: "read_file",
              args: {
                file_path: "/scratch/report.md",
                offset: 900,
                limit: 100,
              },
              type: "tool_call",
            },
          ],
        };
      }
      expect(JSON.stringify(result.content)).toContain("Observed row 999:");
      return { content: "Observed evidence saved; no external effect." };
    },
    100000,
  );
  const agent = createRockyAgent(
    saver,
    {
      event: (name) => events.push(name),
      call: async () => {
        throw Error("No MCP effect");
      },
    },
    { root: model, child: model },
  );
  try {
    await agent.updateState(
      { configurable: { thread_id: thread } },
      {
        files: {
          "/scratch/report.md": {
            content: evidence,
            created_at: new Date().toISOString(),
            modified_at: new Date().toISOString(),
          },
        },
      },
    );
    await agent.invoke(
      {
        messages: [
          new HumanMessage(
            "Inspect the full local evidence without publishing it.",
          ),
        ],
      },
      { configurable: { thread_id: thread }, durability: "sync" },
    );
    const files = (await saver.getTuple({
      configurable: { thread_id: thread },
    }))!.checkpoint.channel_values.files as Record<
      string,
      { content: string[] }
    >;
    expect(files["/scratch/report.md"]!.content).toEqual(evidence);
    expect(events).toContain("rocky.tool.completed");
  } finally {
    saver.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
