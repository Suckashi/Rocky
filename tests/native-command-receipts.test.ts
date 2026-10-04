import { test, expect } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeCommandReceipts } from "../apps/daemon/src/native-command-receipts.js";
import { intentHash } from "../apps/daemon/src/intent.js";

test("native reconciliation survives a new adapter instance, validates binding, and never treats missing/corrupt receipts as no-effect", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-native-receipt-"));
  const operation = {
    id: "fixture-run:command",
    args_hash: intentHash("exact-intent"),
  };
  const signal = new AbortController().signal;
  const receipt = {
    reason: "exited",
    launched: true,
    exitCode: 0,
    signal: null,
    stdout: "confirmed",
    stderr: "",
    outputTruncated: false,
    untrustedData: true,
    meaning: "Process receipt only",
    isolation: "none",
    networkEnforcement: "application_only",
  };
  try {
    expect(
      (await new NativeCommandReceipts(root).observe(operation, signal))
        .outcome,
    ).toBe("unknown");
    await new NativeCommandReceipts(root).save(operation, receipt);
    expect(
      await new NativeCommandReceipts(root).observe(operation, signal),
    ).toMatchObject({
      outcome: "succeeded",
      intentHash: operation.args_hash,
      result: JSON.stringify(receipt),
    });
    expect(
      (
        await new NativeCommandReceipts(root).observe(
          { ...operation, args_hash: intentHash("other") },
          signal,
        )
      ).outcome,
    ).toBe("unknown");
    const path = join(
      root,
      "native-command-receipts",
      intentHash(operation.id) + ".json",
    );
    const data = JSON.parse(await readFile(path, "utf8"));
    data.receipt.result.stdout = "tampered";
    await writeFile(path, JSON.stringify(data));
    expect(
      (await new NativeCommandReceipts(root).observe(operation, signal))
        .outcome,
    ).toBe("unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
