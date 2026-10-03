import { test, expect } from "vitest";
import { readModelStream } from "../packages/agent-runtime/src/model-stream.js";

const frame = (data: unknown) =>
  `data: ${typeof data === "string" ? data : JSON.stringify(data)}\r\n\r\n`;
const choice = (delta: unknown, finish_reason: string | null = null) => ({
  choices: [{ index: 0, delta, finish_reason }],
});
function response(data: unknown[]) {
  const bytes = new TextEncoder().encode(data.map(frame).join(""));
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("OpenAI SSE decodes split UTF-8/CRLF and fragmented tool arguments without reasoning", async () => {
  const chunks: string[] = [];
  const result = await readModelStream(
    response([
      choice({ content: "核准 🪨", reasoning_content: "PRIVATE REASONING" }),
      choice({
        tool_calls: [
          {
            index: 0,
            id: "call-1",
            function: { name: "inspect", arguments: '{"path":' },
          },
        ],
      }),
      choice({
        tool_calls: [{ index: 0, function: { arguments: '"文件"}' } }],
      }),
      choice({}, "tool_calls"),
      { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } },
      "[DONE]",
    ]),
    "openai",
    (text) => chunks.push(text),
  );
  expect(chunks.join("")).toBe("核准 🪨");
  expect(JSON.stringify(result)).not.toContain("PRIVATE REASONING");
  expect(result).toMatchObject({
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: "call-1",
              function: { name: "inspect", arguments: '{"path":"文件"}' },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 7 },
  });
});

test("provider text arrives before stream termination, with no fabricated completion", async () => {
  let release!: () => void, observed!: () => void;
  const seen = new Promise<void>((resolve) => (observed = resolve));
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(frame(choice({ content: "First" }))),
      );
      release = () => {
        controller.enqueue(
          new TextEncoder().encode(
            frame(choice({ content: " second" }, "stop")) + frame("[DONE]"),
          ),
        );
        controller.close();
      };
    },
  });
  let ended = false;
  const chunks: string[] = [];
  const pending = readModelStream(
    new Response(stream, { headers: { "content-type": "text/event-stream" } }),
    "openai",
    (text) => {
      chunks.push(text);
      observed();
    },
  ).then((result) => {
    ended = true;
    return result;
  });
  await seen;
  expect(ended).toBe(false);
  expect(chunks).toEqual(["First"]);
  release();
  await pending;
  expect(chunks.join("")).toBe("First second");
});

test("truncated SSE, unconfirmed finish and provider error fail closed", async () => {
  await expect(
    readModelStream(
      response([choice({ content: "Partial" }, "stop")]),
      "openai",
      () => {},
    ),
  ).rejects.toThrow("confirmed terminator");
  await expect(
    readModelStream(
      response([choice({ content: "Partial" }), "[DONE]"]),
      "openai",
      () => {},
    ),
  ).rejects.toThrow("confirmed terminator");
  await expect(
    readModelStream(
      response([
        { type: "error", error: { message: "private provider body" } },
      ]),
      "anthropic",
      () => {},
    ),
  ).rejects.toThrow("Provider stream error");
});

test("Anthropic incremental public text/tool JSON merge usage and omit thinking blocks", async () => {
  const chunks: string[] = [];
  const result = await readModelStream(
    response([
      {
        type: "message_start",
        message: { usage: { input_tokens: 7, output_tokens: 0 } },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "PRIVATE" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "PRIVATE" },
      },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "Public" },
      },
      {
        type: "content_block_start",
        index: 2,
        content_block: {
          type: "tool_use",
          id: "tool-1",
          name: "inspect",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: '{"x":1}' },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 3 },
      },
      { type: "message_stop" },
    ]),
    "anthropic",
    (text) => chunks.push(text),
  );
  expect(chunks).toEqual(["Public"]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(result).toMatchObject({
    content: [
      { type: "text", text: "Public" },
      { type: "tool_use", id: "tool-1", input: { x: 1 } },
    ],
    usage: { input_tokens: 7, output_tokens: 3 },
  });
});

test("non-SSE responses cancel their body and are not split into synthetic tokens", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    readModelStream(
      new Response(body, { headers: { "content-type": "application/json" } }),
      "openai",
      () => {},
    ),
  ).rejects.toThrow("event stream");
  expect(cancelled).toBe(true);
});
