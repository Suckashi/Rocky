import { test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
import { startHttpFixture } from "../fixtures/mcp/server.js";

test.each(["approve", "reject", "revoke", "invalid", "uncertain"] as const)(
  "configured native worker uses discovered MCP schema and exact approval: %s",
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), "rocky-mcp-work-")),
      receipts = join(root, "actual-effects"),
      mcp = await startHttpFixture(receipts, mode === "uncertain"),
      service = new WorkService(root);
    const provider = await startAgentProvider({
      reply: async (messages) => {
        const toolMessages = messages.filter((m) => m.type === "tool");
        const last = toolMessages.at(-1);
        if (last?.name === "mcp_call")
          return new AIMessage(
            "Observed tool response; do not infer additional effects.",
          );
        let name = "mcp_discover",
          args: Record<string, unknown> = {};
        if (last?.name === "mcp_discover") {
          const result = JSON.parse(String(last.content));
          if (result.servers)
            args = {
              serverId: "configured",
              registryRevision: result.servers[0].registryRevision,
            };
          else {
            name = "mcp_call";
            args = {
              serverId: "configured",
              registryRevision: result.registryRevision,
              toolName: "write_sample",
              arguments: {
                value: mode === "invalid" ? 42 : "actual configured effect",
              },
            };
          }
        }
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "configured-" + toolMessages.length,
              name,
              args,
              type: "tool_call",
            },
          ],
        });
      },
    });
    try {
      service.mcp.save({
        requestId: randomUUID(),
        expectedRevision: 0,
        config: {
          mcpServers: { configured: { url: mcp.url.href, enabled: true } },
          "x-rocky": {
            version: 1,
            servers: {
              configured: {
                transport: "streamable-http",
                networkPolicyId: "owned-fixture",
              },
            },
          },
        },
      });
      expect(
        (
          await service.mcpManager.connect("configured", {
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
          name: "configured MCP fixture",
          provider: "openai-compatible",
          baseUrl: provider.baseUrl,
          modelId: "scripted",
          contextWindowTokens: 65536,
          maxOutputTokens: 256,
        },
      });
      const work = service.submit({
        requestId: randomUUID(),
        text: "Use explicitly configured MCP",
        mode: "configured",
        transport: "http",
        modelSelection: { connectionId: id, revision: 1 },
      });
      await expect
        .poll(() => service.store.get(work.id).status, { timeout: 15000 })
        .toBe(mode === "invalid" ? "failed" : "waiting_approval");
      expect(readdirSync(receipts)).toEqual([]);
      if (mode === "invalid") {
        expect(service.operations.list(work.id)).toEqual([]);
        return;
      }
      const pending = service.store.get(work.id),
        approval = pending.approval!;
      expect(approval.tool).toBe("mcp_call");
      expect(service.operations.list(work.id)[0]?.phase).toBe("prepared");
      const decision = {
        requestId: randomUUID(),
        expectedRevision: approval.revision,
        intentFingerprint: approval.intentFingerprint,
        decision:
          mode === "approve" || mode === "uncertain" ? "approve" : "reject",
      };
      expect(() =>
        service.decide(work.id, {
          ...decision,
          intentFingerprint: "0".repeat(64),
        }),
      ).toThrow("fingerprint");
      if (mode === "revoke") {
        await service.mcpManager.stop("configured", {
          requestId: randomUUID(),
          expectedRevision: 1,
        });
        expect(() =>
          service.decide(work.id, { ...decision, decision: "approve" }),
        ).toThrow("not ready");
      }
      service.decide(work.id, decision);
      await expect
        .poll(() => service.store.get(work.id).status, { timeout: 15000 })
        .toBe(mode === "uncertain" ? "blocked" : "completed");
      expect(readdirSync(receipts)).toHaveLength(
        mode === "approve" || mode === "uncertain" ? 1 : 0,
      );
      const operation = service.operations.list(work.id)[0]!;
      expect(operation.outcome).toBe(
        mode === "approve"
          ? "succeeded"
          : mode === "uncertain"
            ? "unknown"
            : "not_executed",
      );
      if (mode === "approve")
        expect(service.operations.get(operation.id)?.result).toContain(
          "actual configured effect",
        );
      if (mode === "uncertain") {
        const current = service.store.get(work.id);
        expect(() =>
          service.retry(work.id, {
            requestId: randomUUID(),
            runId: current.runId,
            executionSessionId: current.executionSessionId,
            expectedRevision: current.revision,
            effectRefs: [],
          }),
        ).toThrow("Reconcile unknown");
        expect(readdirSync(receipts)).toHaveLength(1);
      }
      expect(
        provider.requests.some((r) =>
          JSON.stringify(r.tools).includes("mcp_call"),
        ),
      ).toBe(true);
    } finally {
      await service.close();
      await provider.close();
      await mcp.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
