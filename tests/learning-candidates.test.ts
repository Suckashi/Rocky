import { test, expect, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { workSchema } from "../packages/contracts/src/index.js";
import { intentHash } from "../apps/daemon/src/intent.js";
import { skillCandidateDraftSchema } from "../packages/contracts/src/reflection.js";
import { AIMessage } from "@langchain/core/messages";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

// Hosted Windows runners need about twice the local time for the 108-run
// synthetic evaluation; local runs keep the 240s wall budget.
const evalMs = process.env.CI ? 480000 : 240000;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rocky-candidate-fixture-")),
    service = new WorkService(root);
  const source = workSchema.parse({
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: "Synthetic reviewed source",
    kind: "background",
    transport: "http",
    mode: "fixture",
    runMode: "normal",
    status: "completed",
    revision: 1,
    answer: "Observed fixture",
    createdAt: new Date().toISOString(),
  });
  service.store.add(source, source.id);
  const event = service.store.event(source, "rocky.tool.completed", {
    name: "inspect_sample",
  });
  service.store.event(source, "rocky.work.updated", { work: source });
  service.store.dispatchOutbox(() => {});
  service.learning.saveWorkConsent(source.id, {
    requestId: randomUUID(),
    expectedRevision: 0,
    private: false,
    excluded: false,
    sourceReuseAllowed: true,
  });
  const episode = service.learning.createEpisode({
    requestId: randomUUID(),
    workId: source.id,
    expectedPolicyRevision: 0,
    expectedConsentRevision: 1,
    trigger: "manual_request",
    goal: "Review source",
    constraints: [],
    corrections: [],
    verification: ["Observed fixture receipt"],
    failuresAndRepairs: [],
    preconditions: [],
    evidenceEventIds: [event.id],
  });
  service.learning.reviewEpisode(episode.id, {
    requestId: randomUUID(),
    expectedRevision: episode.revision,
    contentHash: episode.contentHash,
    decision: "approve",
  });
  const reviewed = service.learning.episode(episode.id),
    binding = {
      episodeId: reviewed.id,
      episodeRevision: reviewed.revision,
      episodeHash: reviewed.contentHash,
    };
  const draft = skillCandidateDraftSchema.parse({
    name: "fixture-learning",
    description: "Only synthetic reviewed samples",
    goal: "Check the fixture",
    preconditions: ["Synthetic fixture"],
    triggers: ["Explicit fixture request"],
    steps: ["Read the sample then verify"],
    stopConditions: ["Missing evidence"],
    verification: ["Read the observed receipt"],
    evidenceRefs: [event.id],
    requiredCapabilities: [],
    knownLimitations: ["Contract fixture, not a real evaluation claim"],
  });
  const candidate = service.store.transaction(() =>
    service.candidates.fromReflection({
      id: randomUUID(),
      episodeId: reviewed.id,
      sourceWorkId: source.id,
      binding,
      scope: { kind: "user" },
      kind: "propose_skill_create",
      payload: { candidate: draft },
    }),
  );
  return {
    service,
    source,
    episode: reviewed,
    candidate,
    draft,
    close: async () => {
      await service.close();
      const path = resolve(root),
        rel = relative(resolve(tmpdir()), path);
      if (!rel || rel.startsWith("..") || isAbsolute(rel))
        throw Error("Unsafe fixture cleanup");
      await rm(path, { recursive: true, force: true });
    },
  };
}

test("evaluation rejects executable case extensions and quota exhaustion preserves sources without model calls", async () => {
  vi.stubEnv("ROCKY_LEARNING_CACHE_BYTES", "1048576");
  const f = await fixture();
  try {
    const definition = {
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      name: "Quota and data-only fixture",
      primaryMetric: "task_success",
      improvement: "task_success",
      minimumImprovement: 0.1,
      modelBudget: { maxCalls: 12 },
      maxRuns: 2,
      maxModelCalls: 24,
      maxTokens: 2000000,
      wallBudgetMs: 30000,
      reportByteBudget: 1048576,
      cases: [
        {
          id: randomUUID(),
          revision: 1,
          family: "quota",
          sourceGroup: "manual",
          split: "train",
          kind: "sample_workflow",
          prompt: "Inspect sample",
          transport: "http",
          decision: "approve",
          required: true,
          negative: false,
          expected: { writes: 1, childCompleted: true },
        },
      ],
    };
    for (const extension of [
      { providers: ["file://evil.js"] },
      { hooks: { beforeAll: "evil.js" } },
      { assertions: [{ type: "javascript", value: "process.exit()" }] },
    ]) {
      expect(() =>
        f.service.evaluations.suites.save({ ...definition, ...extension }),
      ).toThrow();
      expect(() =>
        f.service.evaluations.suites.save({
          ...definition,
          cases: [{ ...definition.cases[0], ...extension }],
        }),
      ).toThrow();
    }
    const suite = f.service.evaluations.suites.save(definition);
    const directory = join(f.service.store.root, "learning-evaluations");
    await mkdir(directory);
    const retained = join(directory, "retained-fixture.bin");
    await writeFile(retained, Buffer.alloc(1048576));
    const run = f.service.evaluations.start(f.candidate.proposalId, {
      requestId: randomUUID(),
      expectedRevision: f.candidate.revision,
      candidateHash: f.candidate.candidateHash,
      suiteId: suite.id,
      suiteRevision: suite.revision,
      suiteHash: suite.hash,
      target: { mode: "fixture" },
    });
    await expect
      .poll(() => f.service.evaluations.get(run.id).status)
      .toBe("failed");
    const result = f.service.evaluations.view(run.id);
    expect(result.reason).toContain("quota");
    expect(result.results).toEqual([]);
    expect(
      f.service.store.list().filter((work) => work.runMode === "evaluation"),
    ).toEqual([]);
    expect((await stat(retained)).size).toBe(1048576);
    expect(f.service.store.get(f.source.id).answer).toBe("Observed fixture");
    expect(
      f.service.candidates.package(f.candidate).files.length,
    ).toBeGreaterThan(0);
  } finally {
    await f.close();
    vi.unstubAllEnvs();
  }
});

test("two reviewed patches on one base cannot overwrite each other and rollback retains history", async () => {
  const f = await fixture();
  try {
    const policy = f.service.learning.savePolicy({
      requestId: randomUUID(),
      expectedRevision: 0,
      mode: "off",
      scopes: [],
    });
    const episode = f.service.learning.createEpisode({
      requestId: randomUUID(),
      workId: f.source.id,
      expectedPolicyRevision: policy.revision,
      expectedConsentRevision: 1,
      trigger: "manual_request",
      goal: "Review competing patches",
      constraints: [],
      corrections: [],
      verification: ["Synthetic gate contract"],
      failuresAndRepairs: [],
      preconditions: [],
      evidenceEventIds: f.draft.evidenceRefs,
    });
    f.service.learning.reviewEpisode(episode.id, {
      requestId: randomUUID(),
      expectedRevision: episode.revision,
      contentHash: episode.contentHash,
      decision: "approve",
    });
    const sourceEpisode = f.service.learning.episode(episode.id);
    const base = f.service.skills.import({
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      scope: { kind: "user" },
      source: {
        type: "manual",
        reference: "fixture/concurrent-publication",
        license: "MIT",
      },
      package: {
        directoryName: "shared-base",
        files: [
          {
            path: "SKILL.md",
            contentBase64: Buffer.from(
              "---\nname: shared-base\ndescription: Synthetic base\n---\nOriginal fixture instruction",
            ).toString("base64"),
          },
        ],
      },
    });
    f.service.skills.select(base.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      action: "publish",
      skillRevision: 1,
      contentHash: base.contentHash,
    });
    const proposals = ["first", "second"].map((label) =>
      f.service.store.transaction(() =>
        f.service.candidates.fromReflection({
          id: randomUUID(),
          episodeId: sourceEpisode.id,
          sourceWorkId: f.source.id,
          binding: {
            episodeId: sourceEpisode.id,
            episodeRevision: sourceEpisode.revision,
            episodeHash: sourceEpisode.contentHash,
          },
          scope: { kind: "user" },
          kind: "propose_skill_patch",
          payload: {
            base: {
              skillId: base.id,
              revision: 1,
              contentHash: base.contentHash,
            },
            reason: "Competing contract fixture " + label,
            changes: {
              ...f.draft,
              name: "shared-base",
              steps: ["Synthetic patch " + label],
            },
          },
        }),
      ),
    );
    const commands = proposals.map((candidate) => {
      const evaluationId = randomUUID(),
        manifest = {
          fixture:
            "Synthetic CAS gate evidence only, not an actual evaluation pass",
          proposalId: candidate.proposalId,
        };
      f.service.store.db
        .prepare("INSERT INTO learning_evaluations VALUES(?,?,?,0)")
        .run(
          evaluationId,
          candidate.proposalId,
          JSON.stringify({
            status: "completed",
            verdict: "passed",
            candidateHash: candidate.candidateHash,
            candidateRevision: candidate.candidateRevision,
            manifest,
          }),
        );
      f.service.candidates.transition(
        candidate.proposalId,
        "evaluating",
        evaluationId,
        null,
        candidate.candidateHash,
      );
      const reviewed = f.service.candidates.transition(
        candidate.proposalId,
        "needs_review",
        evaluationId,
        null,
        candidate.candidateHash,
      );
      return {
        requestId: randomUUID(),
        expectedRevision: reviewed.revision,
        candidateHash: reviewed.candidateHash,
        action: "approve",
        evaluationId,
        evaluationManifestHash: intentHash(manifest),
        baseRevision: 1,
        policyRevision: policy.revision,
      };
    });
    const published = f.service.candidates.command(
      proposals[0]!.proposalId,
      commands[0],
    );
    expect(() =>
      f.service.candidates.command(proposals[1]!.proposalId, commands[1]),
    ).toThrow();
    expect(f.service.skills.selection(base.id)?.contentHash).toBe(
      published.published!.contentHash,
    );
    const selection = f.service.skills.selection(base.id)!;
    f.service.skills.select(base.id, {
      requestId: randomUUID(),
      expectedRevision: selection.revision,
      action: "publish",
      skillRevision: 1,
      contentHash: base.contentHash,
    });
    expect(f.service.skills.selection(base.id)?.contentHash).toBe(
      base.contentHash,
    );
    expect(
      f.service.skills.get(base.id, published.published!.skillRevision).revision
        .revision,
    ).toBe(published.published!.skillRevision);
    expect(
      f.service.candidates.history(proposals[0]!.proposalId).entries.length,
    ).toBeGreaterThan(0);
  } finally {
    await f.close();
  }
});

test("configured local provider evaluates all three frozen variants before exact publication and next-Work loading", async () => {
  const f = await fixture();
  let requests: Record<string, unknown>[] = [];
  const provider = await startAgentProvider({
    reply: async (messages) => {
      const prompt = String(
        messages.findLast((m) => m.type === "human")?.content ?? "",
      );
      if (prompt.includes("[NEGATIVE]"))
        return new AIMessage("FIXTURE_CRITERION");
      const tool = messages.findLast((m) => m.type === "tool");
      if (tool)
        return new AIMessage(
          String(tool.content).includes("CANDIDATE_INSTRUCTION")
            ? "FIXTURE_CRITERION"
            : "No applicable candidate instruction",
        );
      const body = JSON.stringify(requests.at(-1)?.messages);
      const path = body.match(/\/skills\/[^\s<>"'\\]+\/SKILL\.md/)?.[0];
      return path
        ? new AIMessage({
            content: "",
            tool_calls: [
              {
                name: "read_file",
                args: { file_path: path },
                id: "read-frozen-skill",
                type: "tool_call",
              },
            ],
          })
        : new AIMessage("No applicable skill");
    },
  });
  requests = provider.requests;
  try {
    const connectionId = randomUUID();
    f.service.models.save({
      id: connectionId,
      requestId: randomUUID(),
      expectedRevision: 0,
      config: {
        name: "Local deterministic evaluation fixture",
        provider: "openai-compatible",
        baseUrl: provider.baseUrl,
        modelId: "fixture",
        contextWindowTokens: 65536,
        maxOutputTokens: 128,
      },
    });
    const base = f.service.skills.import({
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      scope: { kind: "user" },
      source: {
        type: "manual",
        reference: "fixture/current-comparison",
        license: "MIT",
      },
      package: {
        directoryName: "current-fixture",
        files: [
          {
            path: "SKILL.md",
            contentBase64: Buffer.from(
              "---\nname: current-fixture\ndescription: Synthetic positive cases only\n---\nCURRENT_INSTRUCTION",
            ).toString("base64"),
          },
        ],
      },
    });
    f.service.skills.select(base.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      skillRevision: 1,
      contentHash: base.contentHash,
      action: "publish",
    });
    const candidate = f.service.store.transaction(() =>
      f.service.candidates.fromReflection({
        id: randomUUID(),
        episodeId: f.episode.id,
        sourceWorkId: f.source.id,
        binding: {
          episodeId: f.episode.id,
          episodeRevision: f.episode.revision,
          episodeHash: f.episode.contentHash,
        },
        scope: { kind: "user" },
        kind: "propose_skill_patch",
        payload: {
          base: {
            skillId: base.id,
            revision: 1,
            contentHash: base.contentHash,
          },
          reason: "Synthetic full pipeline contract",
          changes: {
            ...f.draft,
            name: "current-fixture",
            steps: [
              "CANDIDATE_INSTRUCTION: verify the explicit synthetic criterion",
            ],
            stopConditions: ["Never load for a [NEGATIVE] prompt"],
          },
        },
      }),
    );
    const suite = f.service.evaluations.suites.save({
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      name: "Synthetic three-variant contract, not live model efficacy",
      primaryMetric: "task_success",
      improvement: "task_success",
      minimumImprovement: 0.1,
      modelBudget: { maxCalls: 4, maxTokens: 1000000 },
      maxRuns: 108,
      maxModelCalls: 432,
      maxTokens: 100000000,
      wallBudgetMs: evalMs,
      reportByteBudget: 2097152,
      cases: Array.from({ length: 12 }, (_, i) => ({
        id: randomUUID(),
        revision: 1,
        family: `independent-family-${i}`,
        sourceGroup: `manual-source-${i}`,
        split: i < 6 ? "train" : i < 9 ? "validation" : "holdout",
        kind: "sample_workflow",
        prompt: `${i === 0 ? "[NEGATIVE] do not load skills" : "Read an applicable frozen skill"} and report FIXTURE_CRITERION only when supported, case ${i}`,
        transport: "http",
        decision: "reject",
        required: true,
        negative: i === 0,
        expected: {
          writes: 0,
          childCompleted: false,
          answerContains: ["FIXTURE_CRITERION"],
        },
      })),
    });
    const run = f.service.evaluations.start(candidate.proposalId, {
      requestId: randomUUID(),
      expectedRevision: candidate.revision,
      candidateHash: candidate.candidateHash,
      suiteId: suite.id,
      suiteRevision: suite.revision,
      suiteHash: suite.hash,
      target: {
        mode: "configured",
        modelSelection: { connectionId, revision: 1 },
      },
    });
    await expect
      .poll(
        () => {
          const current = f.service.evaluations.get(run.id);
          return current.status === "failed"
            ? `failed: ${current.reason}`
            : current.status;
        },
        { timeout: evalMs, interval: 500 },
      )
      .toBe("completed");
    const report = f.service.evaluations.view(run.id);
    expect(
      report.verdict,
      report.reason ??
        JSON.stringify(
          report.results.map((x) => ({ variant: x.variant, result: x.result })),
        ),
    ).toBe("passed");
    expect(report.results).toHaveLength(108);
    expect(new Set(report.results.map((item) => item.variant))).toEqual(
      new Set(["baseline", "current", "candidate"]),
    );
    expect(report.unknownUsage).toBe(false);
    const reviewed = f.service.candidates.get(candidate.proposalId);
    const published = f.service.candidates.command(candidate.proposalId, {
      requestId: randomUUID(),
      expectedRevision: reviewed.revision,
      candidateHash: reviewed.candidateHash,
      action: "approve",
      evaluationId: run.id,
      evaluationManifestHash: report.manifestHash,
      baseRevision: 1,
      policyRevision: 0,
    });
    expect(published.published?.skillId).toBe(base.id);
    const next = f.service.submit({
      requestId: randomUUID(),
      text: "Read an applicable frozen skill and verify FIXTURE_CRITERION",
      mode: "configured",
      modelSelection: { connectionId, revision: 1 },
    });
    await expect
      .poll(() => f.service.store.get(next.id).status, { timeout: 15000 })
      .toBe("completed");
    expect(f.service.store.get(next.id).answer).toBe("FIXTURE_CRITERION");
    expect(
      f.service.store
        .eventsForWork(next.id)
        .some(
          (event) =>
            event.payload.kind === "domain" &&
            event.payload.name === "rocky.skill.loaded" &&
            event.payload.data.contentHash === published.published!.contentHash,
        ),
    ).toBe(true);
  } finally {
    await provider.close();
    await f.close();
  }
}, 510000);

test("scoped propose automatically turns a completed opted-in Work into a real candidate and evaluation without publishing", async () => {
  const f = await fixture();
  let evidenceId = "";
  const provider = await startAgentProvider({
    reply: async (messages) => {
      const tools = messages.filter((message) => message.type === "tool");
      if (tools.length >= 2)
        return new AIMessage("Saved scoped synthetic candidate.");
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: tools.length ? "propose-real-candidate" : "read-source",
            name: tools.length
              ? "propose_skill_create"
              : "read_learning_episode",
            args: tools.length
              ? { candidate: { ...f.draft, evidenceRefs: [evidenceId] } }
              : {},
            type: "tool_call",
          },
        ],
      });
    },
  });
  try {
    const connectionId = randomUUID();
    f.service.models.save({
      id: connectionId,
      requestId: randomUUID(),
      expectedRevision: 0,
      config: {
        name: "Automatic reflection local fixture",
        provider: "openai-compatible",
        baseUrl: provider.baseUrl,
        modelId: "fixture",
        contextWindowTokens: 65536,
        maxOutputTokens: 512,
      },
    });
    const suite = f.service.evaluations.suites.save({
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      name: "Automatic fixture pipeline, insufficient for publication",
      primaryMetric: "task_success",
      improvement: "task_success",
      minimumImprovement: 0.1,
      modelBudget: { maxCalls: 12 },
      maxRuns: 2,
      maxModelCalls: 24,
      maxTokens: 2000000,
      wallBudgetMs: 30000,
      reportByteBudget: 1048576,
      cases: [
        {
          id: randomUUID(),
          revision: 1,
          family: "auto-source",
          sourceGroup: "handwritten",
          split: "train",
          kind: "sample_workflow",
          prompt: "Inspect synthetic sample and request synthetic write",
          transport: "http",
          decision: "approve",
          required: true,
          negative: false,
          expected: { writes: 1, childCompleted: true },
        },
      ],
    });
    const policy = f.service.learning.savePolicy({
      requestId: randomUUID(),
      expectedRevision: 0,
      mode: "propose",
      scopes: [{ kind: "user" }],
      consent: true,
      automation: {
        modelSelection: { connectionId, revision: 1 },
        reflectionBudget: { maxCalls: 4, maxTokens: 500000 },
        suiteId: suite.id,
        suiteRevision: suite.revision,
        suiteHash: suite.hash,
        evaluationTarget: { mode: "fixture" },
        maxEpisodesPerDay: 1,
      },
    });
    const source = f.service.submit({
      requestId: randomUUID(),
      text: "New synthetic opted-in multistep source",
      mode: "fixture",
      transport: "http",
    });
    f.service.learning.saveWorkConsent(source.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      private: false,
      excluded: false,
      sourceReuseAllowed: true,
    });
    await expect
      .poll(
        () => {
          const current = f.service.store.get(source.id);
          return current.status === "failed" ? current.error : current.status;
        },
        { timeout: 10000 },
      )
      .toBe("waiting_approval");
    const approval = f.service.store.get(source.id).approval!;
    f.service.decide(source.id, {
      requestId: randomUUID(),
      expectedRevision: approval.revision,
      intentFingerprint: approval.intentFingerprint,
      decision: "approve",
    });
    await expect
      .poll(() => f.service.store.get(source.id).status, { timeout: 10000 })
      .toBe("completed");
    evidenceId = f.service.store
      .eventsForWork(source.id)
      .find(
        (event) =>
          event.payload.kind === "domain" &&
          event.payload.name === "rocky.operation.succeeded",
      )!.id;
    await f.service.learningAutomation.tick();
    const record = f.service.learningAutomation
      .list()
      .items.find((item) => item.sourceWorkId === source.id)!;
    expect(record.state, record.error ?? "").toBe("reflecting");
    await expect
      .poll(() => f.service.store.get(record.reflectionWorkId!).status, {
        timeout: 10000,
      })
      .toBe("completed");
    await f.service.learningAutomation.tick();
    const entry = f.service.learningAutomation
      .list()
      .items.find((item) => item.sourceWorkId === source.id)!;
    const evaluationId = Object.values(entry.evaluations)[0]!.evaluationId!;
    await expect
      .poll(() => f.service.evaluations.get(evaluationId).status, {
        timeout: 30000,
      })
      .toBe("completed");
    await f.service.learningAutomation.tick();
    expect(
      f.service.learningAutomation
        .list()
        .items.filter((item) => item.sourceWorkId === source.id),
    ).toHaveLength(1);
    expect(
      f.service.learningAutomation
        .list()
        .items.find((item) => item.sourceWorkId === source.id)?.state,
    ).toBe("completed");
    const candidate = f.service.candidates.get(
      f.service.evaluations.get(evaluationId).proposalId,
    );
    expect(candidate.status).toBe("insufficient_evidence");
    expect(
      f.service.candidates
        .package(candidate)
        .files.some((file) => file.path === "SKILL.md"),
    ).toBe(true);
    expect(f.service.skills.selection(candidate.proposalId)).toBeNull();
    f.service.learning.savePolicy({
      requestId: randomUUID(),
      expectedRevision: policy.revision,
      mode: "off",
      scopes: [],
    });
    const count = provider.requests.length;
    await f.service.learningAutomation.tick();
    expect(provider.requests).toHaveLength(count);
  } finally {
    await provider.close();
    await f.close();
  }
}, 60000);

test("candidate edit invalidates evaluation and source withdrawal removes only its derived packages", async () => {
  const f = await fixture();
  try {
    const before = f.service.candidates.package(f.candidate);
    expect(
      Buffer.from(before.files[0]!.contentBase64, "base64").toString(),
    ).toContain("Read the sample then verify");
    const evaluationId = randomUUID();
    f.service.store.db
      .prepare("INSERT INTO learning_evaluations VALUES(?,?,?,0)")
      .run(
        evaluationId,
        f.candidate.proposalId,
        JSON.stringify({
          status: "completed",
          verdict: "passed",
          results: ["fixture evidence"],
        }),
      );
    const edited = f.service.candidates.edit(f.candidate.proposalId, {
      requestId: randomUUID(),
      expectedRevision: f.candidate.revision,
      candidateHash: f.candidate.candidateHash,
      draft: { ...f.draft, steps: ["Read twice and compare receipts"] },
      reason: "Synthetic correction",
    });
    expect(edited.candidateHash).not.toBe(f.candidate.candidateHash);
    expect(
      f.service.store.db
        .prepare("SELECT invalidated FROM learning_evaluations WHERE id=?")
        .get(evaluationId),
    ).toEqual({ invalidated: 1 });
    expect(
      f.service.candidates.history(edited.proposalId).entries.length,
    ).toBeGreaterThan(0);
    f.service.learning.saveWorkConsent(f.source.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      private: true,
      excluded: true,
      sourceReuseAllowed: false,
    });
    expect(() => f.service.candidates.package(edited)).toThrow();
    expect(
      f.service.store.db
        .prepare("SELECT 1 FROM candidate_packages WHERE hash IN (?,?)")
        .get(before.contentHash, edited.packageHash),
    ).toBeUndefined();
    expect(f.service.store.get(f.source.id).answer).toBe("Observed fixture");
    expect(
      f.service.store
        .eventsForWork(f.source.id)
        .some(
          (event) =>
            event.payload.kind === "domain" &&
            event.payload.name === "rocky.tool.completed",
        ),
    ).toBe(true);
  } finally {
    await f.close();
  }
});

test("publication CAS requires exact manifest, base and policy; registry load is pinned and source edit revokes it", async () => {
  const f = await fixture();
  try {
    const evaluationId = randomUUID(),
      manifest = {
        fixture: "publication gate contract only; not a real evaluation pass",
      };
    f.service.store.db
      .prepare("INSERT INTO learning_evaluations VALUES(?,?,?,0)")
      .run(
        evaluationId,
        f.candidate.proposalId,
        JSON.stringify({
          status: "completed",
          verdict: "passed",
          candidateHash: f.candidate.candidateHash,
          candidateRevision: f.candidate.candidateRevision,
          manifest,
        }),
      );
    f.service.candidates.transition(
      f.candidate.proposalId,
      "evaluating",
      evaluationId,
      null,
      f.candidate.candidateHash,
    );
    const reviewed = f.service.candidates.transition(
      f.candidate.proposalId,
      "needs_review",
      evaluationId,
      null,
      f.candidate.candidateHash,
    );
    const command = {
      requestId: randomUUID(),
      expectedRevision: reviewed.revision,
      candidateHash: reviewed.candidateHash,
      action: "approve",
      evaluationId,
      evaluationManifestHash: intentHash(manifest),
      baseRevision: null,
      policyRevision: 0,
    };
    expect(() =>
      f.service.candidates.command(reviewed.proposalId, {
        ...command,
        evaluationManifestHash: "0".repeat(64),
      }),
    ).toThrow("manifest");
    expect(() =>
      f.service.candidates.command(reviewed.proposalId, {
        ...command,
        policyRevision: 1,
      }),
    ).toThrow("policy");
    const published = f.service.candidates.command(
      reviewed.proposalId,
      command,
    );
    expect(published.status).toBe("published");
    expect(f.service.candidates.command(reviewed.proposalId, command)).toEqual(
      published,
    );
    expect(
      f.service.skills.selection(published.published!.skillId),
    ).toMatchObject({
      state: "published",
      contentHash: published.published!.contentHash,
    });
    const next = workSchema.parse({
      ...f.source,
      mode: "configured",
      modelSelection: { connectionId: randomUUID(), revision: 1 },
      status: "running",
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: randomUUID(),
    });
    f.service.store.transaction(() => {
      f.service.store.add(next, next.id);
      f.service.skills.freeze(next);
    });
    expect(JSON.stringify(f.service.skills.catalog(next.id))).toContain(
      published.published!.contentHash,
    );
    const paths = f.service.skills.backend(next, {
      operation: "sources",
    }) as string[];
    f.service.skills.backend(next, {
      operation: "read",
      path: paths[0]!.replace(/^\/skills/, "") + "SKILL.md",
    });
    f.service.learning.editEpisode(f.episode.id, {
      requestId: randomUUID(),
      expectedRevision: f.episode.revision,
      contentHash: f.episode.contentHash,
      summary: {
        goal: "Corrected source",
        constraints: [],
        corrections: ["Earlier evidence insufficient"],
        verification: [],
        failuresAndRepairs: [],
        preconditions: [],
      },
    });
    expect(f.service.learning.episode(f.episode.id).status).toBe(
      "pending_review",
    );
    expect(
      f.service.skills.selection(published.published!.skillId)?.state,
    ).toBe("quarantined");
    expect(() => f.service.skills.assertToolsAllowed(next)).toThrow();
  } finally {
    await f.close();
  }
});

test("Promptfoo executes full local fixture Works but cannot publish an insufficient fixture-only evaluation", async () => {
  const f = await fixture();
  try {
    const suite = f.service.evaluations.suites.save({
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      name: "Insufficient synthetic contract suite",
      primaryMetric: "task_success",
      improvement: "task_success",
      minimumImprovement: 0.1,
      modelBudget: { maxCalls: 48 },
      maxRuns: 4,
      maxModelCalls: 192,
      maxTokens: 2000000,
      wallBudgetMs: 60000,
      reportByteBudget: 1048576,
      cases: (["train", "validation"] as const).map((split) => ({
        id: randomUUID(),
        revision: 1,
        family: split,
        sourceGroup: split,
        split,
        kind: "sample_workflow",
        prompt: `Synthetic ${split}: inspect through a native task then write the synthetic sample with approval`,
        transport: "http",
        decision: "approve",
        required: true,
        negative: false,
        expected: { writes: 1, childCompleted: true },
      })),
    });
    const run = f.service.evaluations.start(f.candidate.proposalId, {
      requestId: randomUUID(),
      expectedRevision: f.candidate.revision,
      candidateHash: f.candidate.candidateHash,
      suiteId: suite.id,
      suiteRevision: suite.revision,
      suiteHash: suite.hash,
      target: { mode: "fixture" },
    });
    const deadline = Date.now() + 65000;
    while (
      ["queued", "running"].includes(
        f.service.evaluations.get(run.id).status,
      ) &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    const report = f.service.evaluations.view(run.id);
    expect(report.status).toBe("completed");
    expect(
      report.verdict,
      JSON.stringify(report.results.map((x) => x.result)),
    ).toBe("insufficient_evidence");
    expect(report.promptfoo.length).toBeGreaterThan(0);
    expect(report.results).toHaveLength(4);
    expect(
      report.results.every(
        (entry) =>
          entry.result.workId &&
          "childCompleted" in entry.result &&
          entry.result.childCompleted,
      ),
      JSON.stringify(report.results),
    ).toBe(true);
    expect(report.manifestHash).toBe(intentHash(report.manifest));
    const candidate = f.service.candidates.get(f.candidate.proposalId);
    expect(() =>
      f.service.candidates.command(candidate.proposalId, {
        requestId: randomUUID(),
        expectedRevision: candidate.revision,
        candidateHash: candidate.candidateHash,
        action: "approve",
        evaluationId: run.id,
        evaluationManifestHash: report.manifestHash,
        baseRevision: null,
        policyRevision: 0,
      }),
    ).toThrow("exact current evaluation");
    expect(f.service.skills.selection(candidate.proposalId)).toBeNull();
  } finally {
    await f.close();
  }
}, 90000);
