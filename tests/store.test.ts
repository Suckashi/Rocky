import { test, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
test("foreign store refusal leaves synthetic private bytes unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-foreign-"));
  try {
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({ productId: "foreign-fixture" }),
    );
    writeFileSync(join(root, "private.txt"), "never import");
    expect(() => new Store(root)).toThrow("Not a supported Rocky store");
    expect(readFileSync(join(root, "private.txt"), "utf8")).toBe(
      "never import",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("single writer rejects duplicate daemon and receipts survive restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-store-"));
  let service = new WorkService(root);
  try {
    expect(() => new Store(root)).toThrow("Another daemon");
    const input = {
      requestId: randomUUID(),
      text: "Fixture receipt",
      mode: "fixture",
    };
    const w = service.submit(input);
    expect(service.submit(input).id).toBe(w.id);
    expect(() => service.submit({ ...input, text: "changed" })).toThrow(
      "different content",
    );
    service.stop(w.id, {
      requestId: randomUUID(),
      runId: w.runId,
      executionSessionId: w.executionSessionId,
      expectedRevision: w.revision,
    });
    await service.close();
    service = new WorkService(root);
    expect(service.submit(input).id).toBe(w.id);
    expect(service.store.get(w.id).status).toBe("cancelled");
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
