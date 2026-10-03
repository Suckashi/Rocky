import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

test.each(["published", "untrusted", "quarantined"])(
  "native progressive skill read: %s",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "rocky-skill-native-"));
    const service = new WorkService(root),
      id = randomUUID();
    let observed = "",
      initial = "";
    const provider = await startAgentProvider({
      reply: async (messages) => {
        const result = messages.find((m) => m.type === "tool");
        if (result) {
          observed = JSON.stringify(result);
          return new AIMessage("Skill result inspected");
        }
        initial = JSON.stringify(messages);
        if (mode === "quarantined")
          service.skills.select(id, {
            requestId: randomUUID(),
            expectedRevision: 1,
            skillRevision: 1,
            contentHash: service.skills.selection(id)!.contentHash,
            action: "quarantine",
          });
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "read-skill",
              name: "read_file",
              args: { file_path: `/skills/${id}/example/SKILL.md` },
              type: "tool_call",
            },
          ],
        });
      },
    });
    try {
      const revision = service.skills.import({
        requestId: randomUUID(),
        id,
        expectedRevision: 0,
        scope: { kind: "user" },
        source: {
          type: "manual",
          reference: "fixture/example",
          license: "MIT",
        },
        package: {
          directoryName: "example",
          files: [
            {
              path: "SKILL.md",
              contentBase64: Buffer.from(
                "---\nname: example\ndescription: A discoverable fixture skill\n---\nPRIVATE_SKILL_BODY_MARKER",
              ).toString("base64"),
            },
          ],
        },
      });
      if (mode !== "untrusted")
        service.skills.select(id, {
          requestId: randomUUID(),
          expectedRevision: 0,
          skillRevision: 1,
          contentHash: revision.contentHash,
          action: "publish",
        });
      const connectionId = randomUUID();
      service.models.save({
        id: connectionId,
        requestId: randomUUID(),
        expectedRevision: 0,
        config: {
          name: "Skills fixture",
          provider: "openai-compatible",
          baseUrl: provider.baseUrl,
          modelId: "fixture",
          contextWindowTokens: 65536,
          maxOutputTokens: 256,
        },
      });
      const work = service.submit({
        requestId: randomUUID(),
        text: "Read the example skill",
        mode: "configured",
        modelSelection: { connectionId, revision: 1 },
      });
      await expect
        .poll(() => service.store.get(work.id).status, { timeout: 15000 })
        .toBe(mode === "quarantined" ? "failed" : "completed");
      initial = JSON.stringify(provider.requests[0]);
      expect(initial).not.toContain("PRIVATE_SKILL_BODY_MARKER");
      const loads = service.store
        .events("0", work.id)
        .filter(
          (e) =>
            e.payload.kind === "domain" &&
            e.payload.name === "rocky.skill.loaded",
        );
      expect(loads).toHaveLength(mode === "published" ? 1 : 0);
      if (mode === "published") {
        expect(initial).toContain("A discoverable fixture skill");
        expect(initial).toContain(`/skills/${id}/example/SKILL.md`);
        expect(observed).toContain("PRIVATE_SKILL_BODY_MARKER");
        expect(loads[0]?.payload).toMatchObject({
          data: {
            skillId: id,
            revision: 1,
            contentHash: revision.contentHash,
            path: "SKILL.md",
          },
        });
      } else expect(observed).not.toContain("PRIVATE_SKILL_BODY_MARKER");
    } finally {
      await service.close();
      await provider.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
