import { test, expect } from "vitest";
import {
  submissionSchema,
  decisionSchema,
} from "../packages/contracts/src/index.js";
import { randomUUID } from "node:crypto";
import { parseIpcMessage } from "../packages/contracts/src/ipc.js";
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

test("T-005 IPC wire requires run identity and rejects owner fields, unknown commands and oversized UTF-8", () => {
  const command = {
    schemaVersion: 1,
    requestId: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    runCapability: "a".repeat(64),
    sequence: "1",
    payload: { kind: "cancel", reason: "owner_stop" },
  };
  expect(parseIpcMessage(JSON.stringify(command))).toEqual(command);
  expect(() =>
    parseIpcMessage(JSON.stringify({ ...command, actor: "owner" })),
  ).toThrow();
  expect(() =>
    parseIpcMessage(JSON.stringify({ ...command, runCapability: "" })),
  ).toThrow();
  expect(() =>
    parseIpcMessage(
      JSON.stringify({ ...command, payload: { kind: "publish_skill" } }),
    ),
  ).toThrow();
  expect(() =>
    parseIpcMessage(
      JSON.stringify({
        ...command,
        payload: { kind: "tool_result", result: "岩".repeat(23000) },
      }),
    ),
  ).toThrow("65536 bytes");
});
