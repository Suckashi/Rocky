import { test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AIMessage } from "@langchain/core/messages";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
import { startHttpFixture } from "../fixtures/mcp/server.js";
for (const provider of ["openai-compatible", "anthropic"] as const)
  for (const visionEnabled of [false, true])
    for (const large of [false, true]) {
      test(`native MCP image/structured artifact and ${provider} wire format with vision=${visionEnabled}, large=${large}`, async () => {
        const label = large ? "large evidence" : "exact synthetic label";
        const root = mkdtempSync(join(tmpdir(), "rocky-vision-")),
          mcp = await startHttpFixture(undefined, false, true),
          service = new WorkService(root);
        const model = await startAgentProvider({
          reply: async (messages) =>
            messages.some((m) => m.type === "tool" && m.name === "mcp_call")
              ? new AIMessage(
                  "Observed response format only; this fixture does not prove image recognition.",
                )
              : new AIMessage({
                  content: "",
                  tool_calls: [
                    {
                      id: "visual-call",
                      name: "mcp_call",
                      args: {
                        serverId: "visual",
                        registryRevision: 1,
                        toolName: "visual_sample",
                        arguments: { label },
                      },
                      type: "tool_call",
                    },
                  ],
                }),
        });
        try {
          service.mcp.save({
            requestId: randomUUID(),
            expectedRevision: 0,
            config: {
              mcpServers: { visual: { url: mcp.url.href, enabled: true } },
              "x-rocky": {
                version: 1,
                servers: {
                  visual: {
                    transport: "streamable-http",
                    networkPolicyId: "synthetic-vision",
                  },
                },
              },
            },
          });
          expect(
            (
              await service.mcpManager.connect("visual", {
                requestId: randomUUID(),
                expectedRevision: 1,
              })
            )?.status,
          ).toBe("ready");
          const id = randomUUID();
          service.models.save({
            id,
            requestId: randomUUID(),
            expectedRevision: 0,
            config: {
              name: "visual fixture",
              provider,
              baseUrl: model.baseUrl,
              modelId: "visual",
              visionEnabled,
              contextWindowTokens: 65536,
              maxOutputTokens: 256,
            },
          });
          const work = service.submit({
            requestId: randomUUID(),
            text: "Test typed visual result",
            mode: "configured",
            transport: "http",
            modelSelection: { connectionId: id, revision: 1 },
          });
          await expect
            .poll(() => service.store.get(work.id).status, { timeout: 15000 })
            .toBe("waiting_approval");
          const approval = service.store.get(work.id).approval!;
          service.decide(work.id, {
            requestId: randomUUID(),
            expectedRevision: approval.revision,
            intentFingerprint: approval.intentFingerprint,
            decision: "approve",
          });
          await expect
            .poll(
              () => {
                const current = service.store.get(work.id);
                if (current.status === "failed")
                  throw new Error(JSON.stringify(current));
                return current.status;
              },
              { timeout: 15000 },
            )
            .toBe("completed");
          const wire = JSON.stringify(model.requests.at(-1)?.messages);
          if (!large) expect(wire).toContain("Structured MCP data");
          if (!large) expect(wire).toContain("Unfetched resource link");
          expect(wire).not.toContain("synthetic-visual-secret");
          if (!large) expect(wire).toContain("[REDACTED]");
          if (visionEnabled)
            expect(wire).toContain(
              provider === "anthropic"
                ? '"media_type":"image/png"'
                : '"type":"image_url"',
            );
          else {
            expect(wire).toContain("not inspected");
            expect(wire).not.toContain("iVBORw0KGgo");
          }
          const saver = SqliteSaver.fromConnString(
            join(root, "graph-checkpoints.sqlite"),
          );
          try {
            const state = (await saver.getTuple({
              configurable: { thread_id: work.runId },
            }))!.checkpoint.channel_values;
            const tool = (
              state.messages as {
                type: string;
                name?: string;
                content: unknown;
                artifact?: {
                  source: { serverId: string };
                  mcp: { structuredContent: unknown; content: unknown[] };
                };
              }[]
            ).find((m) => m.type === "tool" && m.name === "mcp_call")!;
            if (large) {
              const files = state.files as Record<
                string,
                { content: string[] }
              >;
              const text =
                files["/large_tool_results/visual-call.txt"]!.content.join(
                  "\n",
                );
              expect(text).toContain("Structured MCP data");
              expect(text).toContain("[REDACTED]");
              expect(text).not.toContain("iVBORw0KGgo");
              expect(wire).toContain("/large_tool_results/");
            }
            expect(tool.artifact?.source.serverId).toBe("visual");
            expect(tool.artifact?.mcp.structuredContent).toEqual({
              label,
              kind: "synthetic-image",
              credentials: { apiKey: "[REDACTED]" },
            });
            expect(JSON.stringify(tool.content)).toContain(
              '"type":"image_url"',
            );
          } finally {
            saver.db.close();
          }
          expect(service.operations.list(work.id)[0]?.outcome).toBe(
            "succeeded",
          );
          expect(
            service.operations.get(service.operations.list(work.id)[0]!.id)
              ?.result,
          ).toContain("synthetic-visual-secret");
        } finally {
          await service.close();
          await model.close();
          await mcp.close();
          rmSync(root, { recursive: true, force: true });
        }
      });
    }
