import "../../../packages/agent-runtime/src/environment.js";
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { createRockyAgent } from "../../../packages/agent-runtime/src/factory.js";
import type { RuntimeHooks } from "../../../packages/agent-runtime/src/factory.js";
import { WorkerModel } from "../../../packages/agent-runtime/src/worker-model.js";
import { toModelWire } from "../../../packages/agent-runtime/src/model-wire.js";
import { parseIpcMessage } from "../../../packages/contracts/src/ipc.js";
import { steeringReceiptSchema } from "../../../packages/contracts/src/steering.js";
import {
  frameModelRequest,
  type ModelRequest,
} from "../../../packages/contracts/src/model-transfer.js";
import {
  contextChunkSchema,
  contextReceiptSchema,
} from "../../../packages/contracts/src/context.js";
import {
  ResultTransferAssembler,
  frameResult,
  type ResultPayload,
} from "../../../packages/contracts/src/result-transfer.js";
if (
  (globalThis as { __rockyWorkerNetworkGuard?: boolean })
    .__rockyWorkerNetworkGuard !== true
)
  throw Error("Agent worker network guard missing");
type Message = ReturnType<typeof parseIpcMessage>;
let owner: Message | undefined;
let saver: SqliteSaver | undefined;
let agent: ReturnType<typeof createRockyAgent> | undefined;
let sequence = 0n;
let received = 0n;
let running = false;
const requests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    expectedKind: "model_result" | "tool_result";
  }
>();
const abort = new AbortController();
const resultTransfer = new ResultTransferAssembler();
const pendingSteering: { id: string; text: string }[] = [];
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
    {
      kind:
        | "tool_request"
        | "model_request"
        | "steer_read"
        | "steer_ack"
        | "context_read"
        | "context_ack"
        | "model_begin"
        | "model_chunk"
        | "model_commit";
    }
  >,
) {
  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    requests.set(id, {
      resolve,
      reject,
      expectedKind:
        payload.kind === "model_request" || payload.kind === "model_commit"
          ? "model_result"
          : "tool_result",
    });
    try {
      send(id, payload);
    } catch (error) {
      requests.delete(id);
      reject(error);
    }
  });
}
async function modelRpc(payload: ModelRequest) {
  if (pendingSteering.length) {
    const checkpoint = await saver!.getTuple({
      configurable: { thread_id: owner!.runId },
    });
    if (!checkpoint) throw Error("Steering checkpoint missing");
    for (const command of pendingSteering.splice(0)) {
      const receipt = steeringReceiptSchema.parse(
        await rpc({
          kind: "steer_ack",
          id: command.id,
          checkpointId: checkpoint.checkpoint.id,
        }),
      );
      if (receipt.id !== command.id || receipt.status !== "applied")
        throw Error("Steering receipt mismatch");
    }
  }
  if (Buffer.byteLength(JSON.stringify(payload)) < 40000) return rpc(payload);
  let result: unknown;
  for (const frame of frameModelRequest(payload)) result = await rpc(frame);
  return result;
}
async function sendRunResult(
  requestId: string,
  payload: Extract<ResultPayload, { kind: "run_result" }>,
  after?: () => void,
) {
  if (Buffer.byteLength(JSON.stringify(payload)) < 40000) {
    send(requestId, payload, after);
    return;
  }
  for (const frame of frameResult(payload)) {
    abort.signal.throwIfAborted();
    if (!owner) throw Error("Worker owner missing");
    const wire = JSON.stringify({
      schemaVersion: 1,
      requestId,
      runId: owner.runId,
      executionSessionId: owner.executionSessionId,
      runCapability: owner.runCapability,
      sequence: String(++sequence),
      payload: frame,
    });
    parseIpcMessage(wire);
    await new Promise<void>((resolve, reject) => {
      if (!process.connected || !process.send) {
        reject(Error("IPC disconnected"));
        return;
      }
      process.send(wire, (error) => (error ? reject(error) : resolve()));
    });
  }
  after?.();
}
async function invoke(requestId: string, decision?: "approve" | "reject") {
  if (!agent || !owner || running) throw Error("Agent invocation unavailable");
  running = true;
  try {
    if (
      !decision &&
      owner.payload.kind === "start" &&
      owner.payload.sourceGraphThreadId
    ) {
      const source = await saver!.getTuple({
        configurable: { thread_id: owner.payload.sourceGraphThreadId },
      });
      if (!source?.checkpoint.channel_values.messages)
        throw Error("Confirmed conversation checkpoint is missing");
      // Copy only conversation context into a new owned thread; never copy pending tasks, interrupts or effects.
      await agent.updateState(
        { configurable: { thread_id: owner.runId } },
        {
          messages: source.checkpoint.channel_values.messages,
          files: source.checkpoint.channel_values.files ?? {},
          todos: source.checkpoint.channel_values.todos ?? [],
          ...(source.checkpoint.channel_values._summarizationEvent
            ? {
                _summarizationEvent:
                  source.checkpoint.channel_values._summarizationEvent,
              }
            : {}),
          ...(source.checkpoint.channel_values._summarizationSessionId
            ? {
                _summarizationSessionId:
                  source.checkpoint.channel_values._summarizationSessionId,
              }
            : {}),
        },
      );
    }
    if (
      !decision &&
      owner.payload.kind === "start" &&
      owner.payload.contextBatchId
    ) {
      const batchId = owner.payload.contextBatchId;
      let index = 0,
        offset = 0,
        content = "";
      for (;;) {
        const part = contextChunkSchema.parse(
          await rpc({
            kind: "context_read",
            batchId,
            index,
            offset,
          }),
        );
        if (part.done) {
          await agent.updateState(
            { configurable: { thread_id: owner.runId } },
            {
              messages: [
                new HumanMessage({ id: part.markerId!, content: part.marker! }),
              ],
            },
          );
          const checkpoint = await saver!.getTuple({
            configurable: { thread_id: owner.runId },
          });
          const checkpointId = checkpoint?.checkpoint.id;
          if (typeof checkpointId !== "string")
            throw Error("Context checkpoint identity missing");
          const receipt = contextReceiptSchema.parse(
            await rpc({ kind: "context_ack", batchId, checkpointId }),
          );
          if (
            receipt.batchId !== batchId ||
            receipt.checkpointId !== checkpointId
          )
            throw Error("Context checkpoint receipt mismatch");
          break;
        }
        content += part.text!;
        if (part.final) {
          await agent.updateState(
            { configurable: { thread_id: owner.runId } },
            { messages: [new HumanMessage({ id: part.id!, content })] },
          );
          content = "";
        }
        index = part.nextIndex!;
        offset = part.nextOffset!;
      }
    }
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
        durability: "sync",
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
    await sendRunResult(
      requestId,
      {
        kind: "run_result",
        result: {
          ...(output.__interrupt__
            ? { __interrupt__: output.__interrupt__ }
            : {}),
          messages: output.messages?.slice(-1).map((message) => ({
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
    if (
      message.payload.kind === "result_begin" ||
      message.payload.kind === "result_chunk" ||
      message.payload.kind === "result_commit"
    ) {
      if (
        !requests.has(message.requestId) ||
        (message.payload.kind === "result_begin" &&
          message.payload.resultKind !==
            requests.get(message.requestId)!.expectedKind)
      )
        throw Error("Unexpected RPC result transfer");
      const result = resultTransfer.ingest(message.requestId, message.payload);
      if (!result) return;
      if (result.kind === "run_result")
        throw Error("Unexpected RPC result kind");
      message.payload = result;
    }
    if (message.payload.kind === "start") {
      if (owner || !message.payload.graphPath)
        throw Error("Agent start requires graph path");
      owner = message;
      saver = SqliteSaver.fromConnString(message.payload.graphPath);
      const hooks: RuntimeHooks = {
        steer: message.payload.steering
          ? async () => {
              const commands: { id: string; text: string }[] = [];
              for (let i = 0; i < 8; i++) {
                const raw = await rpc({ kind: "steer_read" });
                if (raw === null) break;
                const receipt = steeringReceiptSchema.parse(raw);
                if (
                  receipt.runId !== owner!.runId ||
                  receipt.executionSessionId !== owner!.executionSessionId ||
                  receipt.status !== "accepted"
                )
                  throw Error("Steering target changed");
                commands.push({ id: receipt.id, text: receipt.text });
              }
              pendingSteering.push(...commands);
              return commands;
            }
          : undefined,
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
          const response = (await modelRpc({
            kind: "model_request",
            child,
            messages: toModelWire(messages),
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
      };
      const maxInputTokens = message.payload.maxInputTokens;
      const remote = (child: boolean) =>
        new WorkerModel(
          child,
          async (isChild, messages, tools, purpose) =>
            (await modelRpc({
              kind: "model_request",
              child: isChild,
              messages,
              tools,
              ...(purpose === "summary" ? { purpose: "summary" as const } : {}),
            })) as { content: string; tool_calls?: AIMessage["tool_calls"] },
          maxInputTokens,
        );
      agent = createRockyAgent(
        saver,
        hooks,
        message.payload.mode === "configured"
          ? {
              root: remote(false),
              child: remote(true),
            }
          : undefined,
        message.payload.testFixtureTools === true,
      );
      void invoke(message.requestId);
    } else if (message.payload.kind === "resume")
      void invoke(message.requestId, message.payload.decision);
    else if (
      message.payload.kind === "tool_result" ||
      message.payload.kind === "model_result"
    ) {
      const request = requests.get(message.requestId);
      if (!request) throw Error("Unknown RPC response");
      if (resultTransfer.has(message.requestId))
        throw Error("Incomplete RPC result transfer");
      if (message.payload.kind !== request.expectedKind)
        throw Error("RPC result kind changed");
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
      resultTransfer.clear(message.requestId);
    } else if (message.payload.kind === "cancel") {
      abort.abort();
      for (const request of requests.values())
        request.reject(new Error("Agent cancelled"));
      requests.clear();
      resultTransfer.clear();
      saver?.db.close();
      process.exit(0);
    } else throw Error("Unexpected daemon message");
  } catch {
    abort.abort();
    resultTransfer.clear();
    process.exitCode = 1;
    process.disconnect?.();
  }
});
