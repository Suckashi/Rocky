import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import {
  frameModelRequest,
  ModelTransferAssembler,
  MODEL_TRANSFER_LIMIT,
} from "../packages/contracts/src/model-transfer.js";
import { parseIpcMessage } from "../packages/contracts/src/ipc.js";
import { fromModelWire } from "../packages/agent-runtime/src/model-wire.js";

const request = () => ({
  kind: "model_request" as const,
  child: false,
  messages: Array.from({ length: 240 }, (_, index) => ({
    type: "human",
    content: `${index}:` + "岩石🙂".repeat(100),
  })),
  tools: [],
});
test("large model history roundtrips through bounded frames without dropping messages or Unicode", () => {
  const input = request(),
    frames = frameModelRequest(input),
    assembler = new ModelTransferAssembler();
  expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(65536);
  let result;
  for (const [index, payload] of frames.entries()) {
    const wire = JSON.stringify({
      schemaVersion: 1,
      requestId: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      runCapability: "a".repeat(64),
      sequence: String(index + 1),
      payload,
    });
    expect(Buffer.byteLength(wire)).toBeLessThan(65536);
    parseIpcMessage(wire);
    result = assembler.ingest(payload);
  }
  expect(result).toEqual(input);
  expect(fromModelWire(result!.messages)).toHaveLength(240);
  expect(() => assembler.ingest(frames.at(-1)!)).toThrow("ownership");
});
test("interleaved root/child uploads preserve their distinct model calls", () => {
  const first = frameModelRequest(request()),
    second = frameModelRequest({ ...request(), child: true }),
    assembler = new ModelTransferAssembler();
  let a, b;
  for (let i = 0; i < first.length; i++) {
    a = assembler.ingest(first[i]!);
    b = assembler.ingest(second[i]!);
  }
  expect(a?.child).toBe(false);
  expect(b?.child).toBe(true);
});
test("transfer rejects incomplete, altered, reordered, foreign and oversized requests", () => {
  const frames = frameModelRequest(request());
  for (const bad of [
    frames.at(-1)!,
    { ...frames[1]!, index: 4 },
    { ...frames[1]!, transferId: randomUUID() },
  ]) {
    const assembler = new ModelTransferAssembler();
    assembler.ingest(frames[0]!);
    expect(() => assembler.ingest(bad)).toThrow();
  }
  const altered = new ModelTransferAssembler();
  for (const [i, frame] of frames.entries()) {
    if (i === frames.length - 1)
      expect(() => altered.ingest(frame)).toThrow("Incomplete");
    else
      altered.ingest(
        i === 1 && frame.kind === "model_chunk"
          ? {
              ...frame,
              data: Buffer.from(
                Buffer.from(frame.data, "base64").map((v, index) =>
                  index === 0 ? 91 : v,
                ),
              ).toString("base64"),
            }
          : frame,
      );
  }
  expect(() =>
    frameModelRequest({
      kind: "model_request",
      child: false,
      messages: [{ type: "human", content: "x".repeat(MODEL_TRANSFER_LIMIT) }],
    }),
  ).toThrow("limit");
});
test("bounded upload capacity and shutdown clear prevent unbounded abandoned buffers", () => {
  const assembler = new ModelTransferAssembler();
  const begin = frameModelRequest(request())[0]!;
  for (let i = 0; i < 8; i++)
    assembler.ingest({ ...begin, transferId: randomUUID() });
  expect(() =>
    assembler.ingest({ ...begin, transferId: randomUUID() }),
  ).toThrow("capacity");
  assembler.clear();
  expect(assembler.ingest(begin)).toBeUndefined();
});
