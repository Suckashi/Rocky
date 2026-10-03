import { z } from "zod";
import { RockyError } from "../../contracts/src/index.js";

/** Decode provider SSE incrementally. Never expose reasoning fields or infer success at EOF. */
export async function readModelStream(
  response: {
    headers: { get(name: string): string | null };
    body: {
      getReader(): {
        read(): Promise<{ done: boolean; value?: Uint8Array }>;
        cancel(): Promise<unknown>;
        releaseLock(): void;
      };
    } | null;
  },
  provider: "anthropic" | "openai",
  delta: (text: string) => void,
) {
  if (
    !response.headers.get("content-type")?.includes("text/event-stream") ||
    !response.body
  ) {
    const unread = response.body?.getReader();
    if (unread) {
      try {
        await unread.cancel();
      } finally {
        unread.releaseLock();
      }
    }
    throw new RockyError(
      "stream_required",
      "Provider did not return an event stream",
      502,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    bytes = 0,
    ended = false,
    finish = "",
    text = "";
  let usage: Record<string, unknown> | undefined;
  const calls = new Map<
    number,
    { id: string; name: string; args: string; input?: unknown }
  >();
  const textBlocks = new Set<number>();
  const emit = (value: string) => {
    text += value;
    if (value) delta(value);
  };
  const record = (value: unknown) =>
    z.record(z.string(), z.unknown()).parse(value);
  function frame(raw: string) {
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (ended) throw Error("Data after stream terminator");
    if (data === "[DONE]") {
      if (provider !== "openai") throw Error("Invalid terminator");
      ended = true;
      return;
    }
    const event = record(JSON.parse(data));
    if (provider === "openai") {
      if (event.usage != null) usage = record(event.usage);
      const choices = z.array(z.unknown()).parse(event.choices);
      if (choices.length > 1) throw Error("Multiple stream choices");
      for (const choice of choices) {
        const c = record(choice);
        if (c.index !== 0) throw Error("Invalid choice identity");
        if (c.finish_reason != null)
          finish = z.enum(["stop", "tool_calls"]).parse(c.finish_reason);
        const d = record(c.delta);
        if (d.content != null) emit(z.string().parse(d.content));
        if (d.tool_calls != null)
          for (const part of z.array(z.unknown()).parse(d.tool_calls)) {
            const p = record(part),
              index = z.number().int().min(0).max(99).parse(p.index);
            const call = calls.get(index) ?? { id: "", name: "", args: "" };
            if (p.id != null) call.id += z.string().parse(p.id);
            if (p.function != null) {
              const f = record(p.function);
              if (f.name != null) call.name += z.string().parse(f.name);
              if (f.arguments != null)
                call.args += z.string().parse(f.arguments);
            }
            calls.set(index, call);
          }
      }
    } else {
      const type = z.string().parse(event.type);
      if (type === "error") throw Error("Provider stream error");
      if (type === "message_start") usage = record(record(event.message).usage);
      if (type === "content_block_start") {
        const index = z.number().int().min(0).max(99).parse(event.index),
          block = record(event.content_block);
        if (block.type === "text") {
          textBlocks.add(index);
          emit(z.string().parse(block.text));
        } else if (block.type === "tool_use")
          calls.set(index, {
            id: z.string().min(1).parse(block.id),
            name: z.string().min(1).parse(block.name),
            args: "",
            input: block.input,
          });
        // Thinking/signature blocks intentionally remain private and are never projected.
      }
      if (type === "content_block_delta") {
        const index = z.number().int().min(0).max(99).parse(event.index),
          d = record(event.delta);
        if (d.type === "text_delta") {
          if (!textBlocks.has(index)) throw Error("Unknown text block");
          emit(z.string().parse(d.text));
        }
        if (d.type === "input_json_delta") {
          const call = calls.get(index);
          if (!call) throw Error("Unknown tool block");
          call.args += z.string().parse(d.partial_json);
        }
      }
      if (type === "message_delta") {
        finish = z
          .enum(["end_turn", "tool_use", "stop_sequence"])
          .parse(record(event.delta).stop_reason);
        usage = { ...usage, ...record(event.usage) };
      }
      if (type === "message_stop") ended = true;
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      if (!value) throw Error("Missing stream bytes");
      bytes += value.byteLength;
      if (bytes > 1048576)
        throw new RockyError(
          "model_response_limit",
          "Model stream exceeds its byte limit",
          502,
        );
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replaceAll("\r\n", "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        frame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (buffer.length > 65536) throw Error("Oversized stream frame");
    }
    if (buffer.trim()) frame(buffer);
    if (!ended || !finish)
      throw new RockyError(
        "incomplete_model_stream",
        "Provider stream ended without a confirmed terminator",
        502,
      );
    const tools = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, c]) => {
        if (!c.id || !c.name) throw Error("Missing tool identity");
        const input = c.args
          ? record(JSON.parse(c.args))
          : record(c.input ?? {});
        return { id: c.id, name: c.name, input };
      });
    if ((finish === "tool_calls" || finish === "tool_use") !== tools.length > 0)
      throw Error("Tool completion mismatch");
    return provider === "anthropic"
      ? {
          content: [
            ...(text ? [{ type: "text", text }] : []),
            ...tools.map((c) => ({ type: "tool_use", ...c })),
          ],
          stop_reason: finish,
          usage,
        }
      : {
          choices: [
            {
              finish_reason: finish,
              message: {
                content: text,
                tool_calls: tools.map((c) => ({
                  id: c.id,
                  type: "function",
                  function: {
                    name: c.name,
                    arguments: JSON.stringify(c.input),
                  },
                })),
              },
            },
          ],
          usage,
        };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
