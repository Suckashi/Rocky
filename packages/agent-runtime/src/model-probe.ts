import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ModelConfig, ModelProbe } from "../../contracts/src/models.js";
import { RockyError } from "../../contracts/src/index.js";
import { ModelNetwork } from "./model-network.js";
import { ModelDnsPolicy } from "./model-dns.js";

const oaReply = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          role: z.literal("assistant"),
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1).max(200),
                type: z.literal("function"),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
});
const antReply = z.object({
  content: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({
        type: z.literal("tool_use"),
        id: z.string().min(1).max(200),
        name: z.string(),
        input: z.unknown(),
      }),
    ]),
  ),
});

async function boundedText(
  response: Awaited<ReturnType<ModelNetwork["post"]>>,
) {
  const reader = response.body!.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks).toString("utf8");
      size += value.byteLength;
      if (size > 65536)
        throw new RockyError(
          "probe_response_limit",
          "Probe response exceeded its limit",
          502,
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Five fixed protocol checks, not an agent loop. Only synthetic echo data is supplied.
export async function runModelProbe(
  config: ModelConfig,
  result: ModelProbe,
  record: () => void,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  dnsPolicy?: ModelDnsPolicy,
) {
  const network = new ModelNetwork(config, env, undefined, dnsPolicy);
  const nonce = randomUUID();
  const anthropic = config.provider === "anthropic";
  const messages: unknown[] = [
    { role: "user", content: `Reply with exactly this nonce: ${nonce}` },
  ];
  const base = {
    model: config.modelId,
    max_tokens: result.outputTokenLimitPerRequest,
  };
  let current: keyof ModelProbe["checks"] = "text";
  const request = async (extra: object, requestSignal = signal) => {
    if (signal.aborted)
      throw new RockyError("probe_cancelled", "Probe cancelled", 409);
    if (result.requests >= 5)
      throw new RockyError(
        "probe_budget",
        "Probe request budget exhausted",
        409,
      );
    result.requests++;
    record(); // Durable dispatch count before network I/O; never retry after a crash.
    return network.post({ ...base, messages, ...extra }, requestSignal);
  };
  const textOf = (data: unknown) =>
    anthropic
      ? antReply
          .parse(data)
          .content.filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("")
      : (oaReply.parse(data).choices[0]!.message.content ?? "");
  try {
    const text = textOf(JSON.parse(await boundedText(await request({}))));
    if (text.trim() !== nonce) throw Error("nonce");
    result.checks.text = "passed";
    record();
    current = "tools";
    const parameters = {
      type: "object",
      properties: { nonce: { type: "string", enum: [nonce] } },
      required: ["nonce"],
      additionalProperties: false,
    };
    const tool = {
      name: "rocky_probe_echo",
      description: "Echo the supplied nonce for connection verification.",
    };
    const tools = anthropic
      ? [{ ...tool, input_schema: parameters }]
      : [{ type: "function", function: { ...tool, parameters } }];
    // Probe the same automatic tool selection used by the runtime. Some reasoning
    // providers reject forced tool_choice even though they support normal tools.
    const toolMessages = [
      {
        role: "user",
        content: `Call rocky_probe_echo once with nonce ${nonce}. After its result, reply with exactly that nonce.`,
      },
    ];
    const toolData: unknown = JSON.parse(
      await boundedText(
        await request({
          tools,
          messages: toolMessages,
          tool_choice: anthropic ? { type: "auto" } : "auto",
        }),
      ),
    );
    let roundtrip: unknown[];
    if (anthropic) {
      const reply = antReply.parse(toolData);
      const calls = reply.content.filter((c) => c.type === "tool_use");
      const call = calls[0];
      if (
        calls.length !== 1 ||
        !call ||
        call.name !== tool.name ||
        !z.strictObject({ nonce: z.literal(nonce) }).safeParse(call.input)
          .success
      )
        throw Error("tool");
      roundtrip = [
        ...toolMessages,
        { role: "assistant", content: reply.content },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: call.id, content: nonce },
          ],
        },
      ];
    } else {
      const reply = oaReply.parse(toolData).choices[0]!.message;
      const call = reply.tool_calls?.[0];
      if (
        reply.tool_calls?.length !== 1 ||
        !call ||
        call.function.name !== tool.name ||
        !z
          .strictObject({ nonce: z.literal(nonce) })
          .safeParse(JSON.parse(call.function.arguments)).success
      )
        throw Error("tool");
      roundtrip = [
        ...toolMessages,
        reply,
        { role: "tool", tool_call_id: call.id, content: nonce },
      ];
    }
    if (
      textOf(
        JSON.parse(
          await boundedText(await request({ messages: roundtrip, tools })),
        ),
      ).trim() !== nonce
    )
      throw Error("roundtrip");
    result.checks.tools = "passed";
    record();
    current = "stream";
    const streamed = await request({ stream: true });
    if (!streamed.headers.get("content-type")?.includes("text/event-stream")) {
      await streamed.body?.cancel();
      throw Error("sse");
    }
    const raw = await boundedText(streamed);
    let output = "",
      done = false;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]" && !anthropic) {
        done = true;
        continue;
      }
      const chunk = JSON.parse(data);
      if (anthropic) {
        if (
          chunk.type === "content_block_delta" &&
          chunk.delta?.type === "text_delta"
        )
          output += chunk.delta.text;
        if (chunk.type === "message_stop") done = true;
      } else output += chunk.choices?.[0]?.delta?.content ?? "";
    }
    if (!done || output.trim() !== nonce) throw Error("stream");
    result.checks.stream = "passed";
    record();
    current = "cancellation";
    const cancel = new AbortController();
    const response = await request(
      { stream: true },
      AbortSignal.any([signal, cancel.signal]),
    );
    const reader = response.body!.getReader();
    try {
      const first = await reader.read();
      if (first.done) throw Error("empty_stream");
      cancel.abort();
      // Transport cancellation only: does not assert that a provider stopped billing.
      let aborted = false;
      try {
        while (!(await reader.read()).done) {
          /* drain any buffered frame */
        }
      } catch {
        aborted = true;
      }
      if (!aborted) throw Error("not_cancelled");
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    result.checks.cancellation = "passed";
    result.status = "completed";
    record();
  } catch (error) {
    result.checks[current] = "failed";
    result.status = "failed";
    result.error = signal.aborted
      ? "probe_cancelled"
      : error instanceof RockyError
        ? error.code
        : "invalid_probe_response";
    record();
  } finally {
    await network.close();
  }
}
