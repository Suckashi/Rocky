import { test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  authorizeOperation,
  type PolicyInput,
} from "../apps/daemon/src/policy.js";
import { intentHash } from "../apps/daemon/src/intent.js";
function input(): PolicyInput {
  const owner = {
    workId: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
  };
  return {
    owner,
    resolvedOwner: owner,
    mode: "normal",
    effect: "known_read",
    configurationAllowed: true,
    resourceAllowed: true,
    revoked: false,
    preparedTargetHash: intentHash({ target: 1 }),
    currentTargetHash: intentHash({ target: 1 }),
    policyRevision: 1,
    preparedPolicyRevision: 1,
    operationId: "synthetic-operation",
    intentFingerprint: intentHash({ intent: 1 }),
    synthetic: false,
    allowLocalNew: false,
    targetExists: true,
    approval: null,
  };
}
test("T-008 deny-first owner/config/resource/revocation cannot be overridden by exact consent", () => {
  const base = input();
  base.approval = {
    status: "approved",
    operationId: base.operationId,
    intentFingerprint: base.intentFingerprint,
  };
  for (const change of [
    { configurationAllowed: false },
    { resourceAllowed: false },
    { revoked: true },
    { effect: "denied" as const },
    { mode: "unknown" as const },
    { resolvedOwner: { ...base.owner, runId: randomUUID() } },
  ])
    expect(() => authorizeOperation({ ...base, ...change })).toThrow("outside");
  expect(() =>
    authorizeOperation({ ...base, modelRisk: "safe" } as PolicyInput),
  ).toThrow();
});
test("T-008 critical/unknown need exact consent and evaluation cannot acquire production write authority", () => {
  const base = input();
  for (const effect of ["critical", "unknown"] as const) {
    expect(() => authorizeOperation({ ...base, effect })).toThrow(
      "Exact server approval",
    );
    const approval = {
      status: "approved" as const,
      operationId: base.operationId,
      intentFingerprint: base.intentFingerprint,
    };
    expect(authorizeOperation({ ...base, effect, approval })).toBe(
      "exact_consent",
    );
    for (const change of [
      { operationId: "another" },
      { intentFingerprint: intentHash({ intent: 2 }) },
      { status: "expired" as const },
    ])
      expect(() =>
        authorizeOperation({
          ...base,
          effect,
          approval: { ...approval, ...change },
        }),
      ).toThrow("Exact server approval");
    for (const mode of ["evaluation", "reflection"] as const)
      expect(() =>
        authorizeOperation({ ...base, effect, approval, mode }),
      ).toThrow("outside");
    expect(
      authorizeOperation({
        ...base,
        effect,
        approval,
        mode: "evaluation",
        synthetic: true,
      }),
    ).toBe("exact_consent");
  }
});
test("T-008 changed target/policy requires fresh preparation; local-new cannot overwrite without consent", () => {
  const base = input();
  expect(authorizeOperation(base)).toBe("read");
  expect(() =>
    authorizeOperation({
      ...base,
      currentTargetHash: intentHash({ target: 2 }),
    }),
  ).toThrow("changed");
  expect(() => authorizeOperation({ ...base, policyRevision: 2 })).toThrow(
    "changed",
  );
  expect(
    authorizeOperation({
      ...base,
      effect: "local_new",
      allowLocalNew: true,
      targetExists: false,
    }),
  ).toBe("local_new");
  expect(() =>
    authorizeOperation({
      ...base,
      effect: "local_new",
      allowLocalNew: true,
      targetExists: true,
    }),
  ).toThrow("Exact server approval");
});
