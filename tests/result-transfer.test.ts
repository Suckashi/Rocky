import { test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  frameResult,
  ResultTransferAssembler,
  RESULT_TRANSFER_LIMIT,
} from "../packages/contracts/src/result-transfer.js";
import { parseIpcMessage } from "../packages/contracts/src/ipc.js";
test("model/tool/run results roundtrip Unicode in bounded frames with exact request and kind", () => {
  for (const payload of [
    {
      kind: "model_result" as const,
      message: { content: "岩石🙂".repeat(30000) },
    },
    {
      kind: "tool_result" as const,
      result: { observed: "岩石🙂".repeat(30000) },
    },
    {
      kind: "run_result" as const,
      result: { messages: [{ content: "岩石🙂".repeat(30000) }] },
    },
  ]) {
    const frames = frameResult(payload),
      assembler = new ResultTransferAssembler(),
      requestId = randomUUID();
    let received;
    for (const [index, frame] of frames.entries()) {
      const wire = JSON.stringify({
        schemaVersion: 1,
        requestId,
        runId: randomUUID(),
        executionSessionId: randomUUID(),
        runCapability: "a".repeat(64),
        sequence: String(index + 1),
        payload: frame,
      });
      expect(Buffer.byteLength(wire)).toBeLessThan(65536);
      parseIpcMessage(wire);
      received = assembler.ingest(requestId, frame);
      if (index < frames.length - 1) expect(received).toBeUndefined();
    }
    expect(received).toEqual(payload);
    expect(() => assembler.ingest(requestId, frames.at(-1)!)).toThrow(
      "ownership",
    );
  }
});
test("incomplete, reordered, altered, expired and cross-request results never deliver", () => {
  const frames = frameResult({
      kind: "model_result",
      message: { content: "test".repeat(30000) },
    }),
    request = randomUUID();
  for (const bad of [frames.at(-1)!, { ...frames[1]!, index: 4 }]) {
    const a = new ResultTransferAssembler();
    a.ingest(request, frames[0]!);
    expect(() => a.ingest(request, bad)).toThrow();
  }
  const a = new ResultTransferAssembler();
  a.ingest(request, frames[0]!);
  expect(() => a.ingest(randomUUID(), frames[1]!)).toThrow("ownership");
  for (const [i, frame] of frames.entries())
    if (i > 0 && i < frames.length - 1) a.ingest(request, frame);
  const commit = frames.at(-1)!;
  // Header digest cannot be changed after receiving chunks.
  const wrong = new ResultTransferAssembler();
  if (frames[0]!.kind !== "result_begin") throw Error("Header missing");
  wrong.ingest(request, { ...frames[0]!, digest: "0".repeat(64) });
  for (const frame of frames.slice(1, -1)) wrong.ingest(request, frame);
  expect(() => wrong.ingest(request, commit)).toThrow("Incomplete");
  vi.useFakeTimers();
  try {
    const expired = new ResultTransferAssembler();
    expired.ingest(request, frames[0]!);
    vi.advanceTimersByTime(30001);
    expect(() => expired.ingest(request, frames[1]!)).toThrow("expired");
  } finally {
    vi.useRealTimers();
  }
});
test("result capacity and explicit size limits bound abandoned delivery", () => {
  const assembler = new ResultTransferAssembler();
  const begin = frameResult({
    kind: "tool_result",
    result: "x".repeat(100000),
  })[0]!;
  for (let i = 0; i < 8; i++)
    assembler.ingest(randomUUID(), { ...begin, transferId: randomUUID() });
  expect(() =>
    assembler.ingest(randomUUID(), { ...begin, transferId: randomUUID() }),
  ).toThrow("capacity");
  assembler.clear();
  expect(assembler.ingest(randomUUID(), begin)).toBeUndefined();
  expect(() =>
    frameResult({
      kind: "model_result",
      message: "x".repeat(RESULT_TRANSFER_LIMIT),
    }),
  ).toThrow("limit");
});
