import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

test.each([
  "published",
  "untrusted",
  "quarantined",
  "same-name",
  "revoke-loaded",
  "revoke-pending",
])(
  "native progressive skill read: %s",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "rocky-skill-native-"));
    const service = new WorkService(root),
      id = randomUUID(),
      secondId = randomUUID(),
      memoryId = randomUUID();
    let observed = "",
      initial = "";
    const provider = await startAgentProvider({
      reply: async (messages) => {
        const result = messages.find((m) => m.type === "tool");
        if (result) {
          observed = JSON.stringify(result);
          if (
            mode === "revoke-pending" &&
            messages.filter((m) => m.type === "tool").length === 1
          )
            return new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "pending-memory",
                  name: "memory_write",
                  args: {
                    id: memoryId,
                    expectedRevision: 0,
                    scope: "user",
                    content: "MUST_NOT_BE_WRITTEN",
                    private: true,
                    sources: [],
                  },
                  type: "tool_call",
                },
              ],
            });
          if (mode === "revoke-loaded") {
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
                  id: "after-revoke",
                  name: "write_todos",
                  args: {
                    todos: [{ content: "MUST_NOT_EXECUTE", status: "pending" }],
                  },
                  type: "tool_call",
                },
              ],
            });
          }
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
              args: { file_path: `/skills/${id}/example-${id}/SKILL.md` },
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
      if (mode === "same-name") {
        const other = service.skills.import({
          requestId: randomUUID(),
          id: secondId,
          expectedRevision: 0,
          scope: { kind: "user" },
          source: {
            type: "manual",
            reference: "fixture/other",
            license: "MIT",
          },
          package: {
            directoryName: "example",
            files: [
              {
                path: "SKILL.md",
                contentBase64: Buffer.from(
                  "---\nname: example\ndescription: Another same-name skill\n---\nOTHER_SKILL_BODY",
                ).toString("base64"),
              },
            ],
          },
        });
        service.skills.select(secondId, {
          requestId: randomUUID(),
          expectedRevision: 0,
          skillRevision: 1,
          contentHash: other.contentHash,
          action: "publish",
        });
      }
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
      if (mode === "revoke-pending") {
        await expect
          .poll(() => service.store.get(work.id).status, { timeout: 15000 })
          .toBe("waiting_approval");
        const pending = service.store.get(work.id);
        const approval = pending.approval!;
        service.skills.select(id, {
          requestId: randomUUID(),
          expectedRevision: 1,
          skillRevision: 1,
          contentHash: revision.contentHash,
          action: "quarantine",
        });
        const decision = {
          requestId: randomUUID(),
          expectedRevision: approval.revision,
          intentFingerprint: approval.intentFingerprint,
          decision: "approve",
        };
        expect(() => service.decide(work.id, decision)).toThrow("quarantined");
        expect(service.store.get(work.id)).toEqual(pending);
        expect(
          service.store.db
            .prepare("SELECT * FROM decisions WHERE request_id=?")
            .get(decision.requestId),
        ).toBeUndefined();
        expect(() => service.memories.get(memoryId)).toThrow("not found");
        service.decide(work.id, {
          ...decision,
          requestId: randomUUID(),
          decision: "reject",
        });
        await expect
          .poll(() => service.store.get(work.id).status, { timeout: 15000 })
          .toBe("completed");
        expect(service.store.get(work.id).approval?.status).toBe("rejected");
        expect(service.operations.list(work.id)[0]?.outcome).toBe(
          "not_executed",
        );
        expect(() => service.memories.get(memoryId)).toThrow("not found");
        return;
      }
      await expect
        .poll(() => service.store.get(work.id).status, { timeout: 15000 })
        .toBe(
          ["quarantined", "revoke-loaded"].includes(mode)
            ? "failed"
            : "completed",
        );
      if (mode === "revoke-loaded") {
        const events = service.store.events("0", work.id);
        expect(
          events.some(
            (e) =>
              e.payload.kind === "domain" &&
              e.payload.name === "rocky.skill.revoked",
          ),
        ).toBe(true);
        expect(
          events.some(
            (e) =>
              e.payload.kind === "domain" &&
              e.payload.data.callId === "after-revoke",
          ),
        ).toBe(false);
        expect(() => service.skills.assertToolsAllowed(work)).toThrow(
          "quarantined",
        );
      }
      initial = JSON.stringify(provider.requests[0]);
      expect(initial).not.toContain("PRIVATE_SKILL_BODY_MARKER");
      if (mode === "same-name") {
        expect(initial).toContain(
          `/skills/${secondId}/example-${secondId}/SKILL.md`,
        );
        expect(initial).not.toContain("OTHER_SKILL_BODY");
      }
      const loads = service.store
        .events("0", work.id)
        .filter(
          (e) =>
            e.payload.kind === "domain" &&
            e.payload.name === "rocky.skill.loaded",
        );
      expect(loads).toHaveLength(
        ["published", "same-name", "revoke-loaded"].includes(mode) ? 1 : 0,
      );
      if (["published", "same-name", "revoke-loaded"].includes(mode)) {
        expect(initial).toContain("A discoverable fixture skill");
        expect(initial).toContain(`/skills/${id}/example-${id}/SKILL.md`);
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
