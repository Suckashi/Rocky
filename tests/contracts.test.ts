import { test, expect } from "vitest";
import {
  submissionSchema,
  decisionSchema,
} from "../packages/contracts/src/index.js";
import { randomUUID } from "node:crypto";
test("fixture mode is explicit and forged permission fields are rejected", () => {
  expect(
    submissionSchema.safeParse({ requestId: randomUUID(), text: "hello" })
      .success,
  ).toBe(false);
  expect(
    submissionSchema.safeParse({
      requestId: randomUUID(),
      text: "hello",
      mode: "fixture",
      approved: true,
    }).success,
  ).toBe(false);
  expect(
    decisionSchema.safeParse({
      requestId: randomUUID(),
      expectedRevision: 1,
      intentFingerprint: "x",
      decision: "approve",
      actor: "owner",
    }).success,
  ).toBe(false);
});
