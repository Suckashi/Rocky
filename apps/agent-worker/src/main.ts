import "../../../packages/agent-runtime/src/environment.js";
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { createRockyAgent } from "../../../packages/agent-runtime/src/factory.js";
import { parseIpcMessage } from "../../../packages/contracts/src/ipc.js";
type Message = ReturnType<typeof parseIpcMessage>;
let owner: Message | undefined;
let saver: SqliteSaver | undefined;
let agent: ReturnType<typeof createRockyAgent> | undefined;
let sequence = 0n;
let received = 0n;
let running = false;
const requests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
const abort = new AbortController();
function send(
  requestId: string,
  payload: Message["payload"],
  after?: () => void,
) {
  if (!owner) throw Error("Agent worker not started");
  const wire = JSON.stringify({
    schemaVersion: 1,
    requestId,
    runId: owner.runId,
    executionSessionId: owner.executionSessionId,
    runCapability: owner.runCapability,
    sequence: String(++sequence),
    payload,
  });
  parseIpcMessage(wire);
  if (
    !process.send?.(wire, (error) => {
      if (!error) after?.();
    })
  )
    throw Error("Agent IPC disconnected or saturated");
}
function rpc(
  payload: Extract<
    Message["payload"],
    { kind: "tool_request" | "model_request" }
  >,
) {
  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    requests.set(id, { resolve, reject });
    try {
      send(id, payload);
    } catch (error) {
      requests.delete(id);
      reject(error);
    }
  });
}
async function invoke(requestId: string, decision?: "approve" | "reject") {
  if (!agent || !owner || running) throw Error("Agent invocation unavailable");
  running = true;
  try {
    const result = await agent.invoke(
      decision
        ? new Command({
            resume: {
              decisions: [
                decision === "approve"
                  ? { type: "approve" }
                  : {
                      type: "reject",
                      message: "Owner rejected synthetic write",
                    },
              ],
            },
          })
        : {
            messages: [
              {
                role: "user",
                content:
                  owner.payload.kind === "start" ? owner.payload.text : "",
              },
            ],
          },
      {
        configurable: { thread_id: owner.runId },
        signal: abort.signal,
        recursionLimit: 30,
      },
    );
    abort.signal.throwIfAborted();
    const output = result as unknown as {
      messages?: {
        type?: string;
        name?: string;
        content: unknown;
        tool_calls?: unknown[];
      }[];
      __interrupt__?: unknown;
    };
    const interrupted =
      Array.isArray(output.__interrupt__) && output.__interrupt__.length > 0;
    send(
      requestId,
      {
        kind: "run_result",
        result: {
          ...(output.__interrupt__
            ? { __interrupt__: output.__interrupt__ }
            : {}),
          messages: output.messages?.map((message) => ({
            type: message.type,
            name: message.name,
            content: message.content,
            tool_calls: message.tool_calls,
          })),
        },
      },
      interrupted
        ? undefined
        : () => {
            saver?.db.close();
            process.disconnect?.();
          },
    );
  } catch {
    if (!abort.signal.aborted)
      send(requestId, {
        kind: "error",
        error: {
          code: "agent_failed",
          message: "Agent worker invocation failed",
        },
      });
  } finally {
    running = false;
  }
}
process.on("message", (wire) => {
  try {
    if (typeof wire !== "string") throw Error("Invalid IPC wire");
    const message = parseIpcMessage(wire);
    if (BigInt(message.sequence) !== received + 1n)
      throw Error("IPC sequence changed");
    received = BigInt(message.sequence);
    if (
      owner &&
      (message.runId !== owner.runId ||
        message.executionSessionId !== owner.executionSessionId ||
        message.runCapability !== owner.runCapability)
    )
      throw Error("Run capability changed");
    if (message.payload.kind === "start") {
      if (owner || !message.payload.graphPath)
        throw Error("Agent start requires graph path");
      owner = message;
      saver = SqliteSaver.fromConnString(message.payload.graphPath);
      agent = createRockyAgent(saver, {
        event: (name, data) =>
          send(randomUUID(), { kind: "runtime_event", name, data }),
        call: async (name, args, callId) =>
          String(
            await rpc({
              kind: "tool_request",
              logicalToolCallId: callId,
              tool: name,
              args,
            }),
          ),
        modelRequest: async (
          messages: BaseMessage[],
          child: boolean,
        ): Promise<ChatResult> => {
          const response = (await rpc({
            kind: "model_request",
            child,
            messages: messages.map((m) => ({
              type: m.type,
              name: m.name,
              content: m.content,
            })),
          })) as {
            content: string;
            tool_calls?: {
              id: string;
              name: string;
              args: Record<string, unknown>;
              type: "tool_call";
            }[];
          };
          const reply = new AIMessage(response);
          return {
            generations: [
              {
                text: typeof reply.content === "string" ? reply.content : "",
                message: reply,
              },
            ],
          };
        },
      });
      void invoke(message.requestId);
    } else if (message.payload.kind === "resume")
      void invoke(message.requestId, message.payload.decision);
    else if (
      message.payload.kind === "tool_result" ||
      message.payload.kind === "model_result"
    ) {
      const request = requests.get(message.requestId);
      if (!request) throw Error("Unknown RPC response");
      requests.delete(message.requestId);
      request.resolve(
        message.payload.kind === "tool_result"
          ? message.payload.result
          : message.payload.message,
      );
    } else if (message.payload.kind === "error") {
      const request = requests.get(message.requestId);
      if (!request) throw Error("Unknown RPC error");
      requests.delete(message.requestId);
      request.reject(new Error(message.payload.error.message));
    } else if (message.payload.kind === "cancel") {
      abort.abort();
      for (const request of requests.values())
        request.reject(new Error("Agent cancelled"));
      requests.clear();
      saver?.db.close();
      process.exit(0);
    } else throw Error("Unexpected daemon message");
  } catch {
    abort.abort();
    process.exitCode = 1;
    process.disconnect?.();
  }
});
