import { createHash } from "node:crypto";
import { z } from "zod";
import type { connectFixture } from "../../../packages/agent-runtime/src/mcp.js";
import type { OperationObservation } from "./operation-reconciler.js";
import { randomUUID } from "node:crypto";

const receiptSchema = z.strictObject({
  operationId: z.string().min(1).max(300),
  intentHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: z.string().max(65536),
  evidenceRef: z.uuid(),
  observedAt: z.iso.datetime(),
});
/** Trusted synthetic adapter: receipt absence never proves no effect. */
export async function observeFixtureOperation(
  connection: Awaited<ReturnType<typeof connectFixture>>,
  operation: { id: string; args_hash: string },
  signal: AbortSignal,
): Promise<OperationObservation> {
  const key = createHash("sha256").update(operation.id).digest("hex");
  const uri = `rocky-fixture://receipts/${key}`;
  const response = await connection.client.readResource(
    { uri },
    { signal, timeout: 10000 },
  );
  const content = response.contents[0];
  if (
    response.contents.length !== 1 ||
    !content ||
    content.uri !== uri ||
    !("text" in content) ||
    typeof content.text !== "string" ||
    content.text.length > 131072
  )
    throw Error("Invalid synthetic receipt response");
  const { receipt } = z
    .strictObject({ receipt: receiptSchema.nullable() })
    .parse(JSON.parse(content.text));
  if (receipt) return { ...receipt, outcome: "succeeded" };
  return {
    operationId: operation.id,
    intentHash: operation.args_hash,
    outcome: "unknown",
    result: null,
    evidenceRef: randomUUID(),
    observedAt: new Date().toISOString(),
  };
}
