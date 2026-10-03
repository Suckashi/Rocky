import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
for (const changed of [false, true])
  test(
    "native artifact delivery: changed=" + changed,
    async () => {
      const base = await mkdtemp(join(tmpdir(), "rocky-native-artifact-")),
        root = join(base, "project");
      await mkdir(root);
      const service = new WorkService(join(base, "data"));
      const provider = await startAgentProvider({
        reply: async (messages) => {
          const results = messages.filter((m) => m.type === "tool");
          if (results.length === 0)
            return new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "write-result",
                  name: "workspace_write",
                  args: {
                    path: "result.md",
                    content: "# Actual result",
                    expectedHash: null,
                  },
                  type: "tool_call",
                },
              ],
            });
          if (results.length === 1) {
            if (changed)
              await writeFile(join(root, "result.md"), "changed after receipt");
            return new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "publish-result",
                  name: "artifact_publish",
                  args: {
                    writeCallId: "write-result",
                    title: "Delivered result",
                  },
                  type: "tool_call",
                },
              ],
            });
          }
          return new AIMessage("Delivery inspected");
        },
      });
      try {
        const workspace = await service.workspaces.save({
            id: randomUUID(),
            requestId: randomUUID(),
            expectedRevision: 0,
            name: "Artifact source",
            root,
          }),
          connectionId = randomUUID();
        service.models.save({
          id: connectionId,
          requestId: randomUUID(),
          expectedRevision: 0,
          config: {
            name: "fixture",
            provider: "openai-compatible",
            baseUrl: provider.baseUrl,
            modelId: "fixture",
            contextWindowTokens: 65536,
            maxOutputTokens: 256,
          },
        });
        const work = service.submit({
          requestId: randomUUID(),
          text: "write and deliver",
          mode: "configured",
          modelSelection: { connectionId, revision: 1 },
          workspaceId: workspace.id,
          workspaceRevision: 1,
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
            () =>
              ["completed", "failed"].includes(
                service.store.get(work.id).status,
              ),
            { timeout: 15000 },
          )
          .toBe(true);
        const artifacts = service.artifacts.list();
        expect(artifacts).toHaveLength(changed ? 0 : 1);
        if (!changed) {
          expect(service.store.get(work.id).status).toBe("completed");
          const artifact = artifacts[0]!;
          expect(artifact.workId).toBe(work.id);
          expect(artifact.verificationRefs).toEqual([
            work.runId + ":write-result",
          ]);
          expect(
            (
              await service.artifacts.file(artifact.id, artifact.entry)
            ).bytes.toString(),
          ).toBe("# Actual result");
        }
      } finally {
        await service.close();
        await provider.close();
        await rm(base, { recursive: true, force: true });
      }
    },
    30000,
  );
