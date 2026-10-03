import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { FixtureWorkService as WorkService } from "./support/fixture-work-service.js";
import { RockyEvaluationProvider } from "../packages/agent-runtime/src/evaluation-provider.js";
import { installEvaluationEgressGuard } from "../packages/agent-runtime/src/evaluation-egress.js";
import { ModelNetwork } from "../packages/agent-runtime/src/model-network.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

for (const decision of ["approve", "reject"] as const)
  test(`T-007 configured evaluation ${decision}: same native Work and budget, scoped endpoint revocation`, async () => {
    const root = mkdtempSync(join(tmpdir(), "rocky-eval-configured-"));
    const fixture = await startAgentProvider();
    const service = new WorkService(root);
    const guard = installEvaluationEgressGuard();
    const connectionId = randomUUID();
    const command = {
      id: connectionId,
      requestId: randomUUID(),
      expectedRevision: 0,
      config: {
        name: "Evaluation fixture",
        provider: "openai-compatible",
        baseUrl: fixture.baseUrl,
        modelId: "scripted",
        contextWindowTokens: 4096,
        maxOutputTokens: 128,
      },
    };
    try {
      service.models.save(command);
      const provider = new RockyEvaluationProvider(service, {
        mode: "configured",
        modelSelection: { connectionId, revision: 1 },
      });
      await expect(
        provider.callApi(
          JSON.stringify({
            transport: "http",
            decision,
            modelSelection: { connectionId, revision: 1 },
          }),
        ),
      ).rejects.toThrow();
      expect(fixture.requests).toHaveLength(0);
      const result = await provider.callApi(
        JSON.stringify({ transport: "http", decision }),
      );
      expect(result).toHaveProperty("output");
      if (!result.output || !result.metadata)
        throw Error("No evaluation output");
      expect(JSON.parse(result.output)).toMatchObject({
        status: "completed",
        childCompleted: true,
        writes: decision === "approve" ? 1 : 0,
      });
      const work = service.store.get(result.metadata.workId);
      expect(work.runMode).toBe("evaluation");
      expect(work.modelSelection).toEqual({ connectionId, revision: 1 });
      expect(result.metadata.mode).toBe("configured");
      expect(result.metadata.usage.knownUsage.inputTokens).toBe(
        fixture.requests.length * 7,
      );
      expect(guard.denied).toHaveLength(0);
      const config = service.models.assertRunnable(connectionId, 1).config;
      const network = new ModelNetwork(config);
      const count = fixture.requests.length;
      try {
        await expect(
          network.post({}, AbortSignal.timeout(1000)),
        ).rejects.toThrow("egress denied");
        expect(fixture.requests).toHaveLength(count);
      } finally {
        await network.close();
      }
      service.models.save({
        ...command,
        requestId: randomUUID(),
        expectedRevision: 1,
      });
      await expect(
        provider.callApi(JSON.stringify({ transport: "http", decision })),
      ).rejects.toThrow("changed");
      expect(fixture.requests).toHaveLength(count);
    } finally {
      await service.close();
      guard.restore();
      await fixture.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
