import { test, expect } from "vitest";
import { performance } from "node:perf_hooks";
import { cpus, totalmem, tmpdir, release } from "node:os";
import { mkdtemp, readdir, stat, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";

test("measured local warm startup, receipts and retained storage stay within the documented fixture budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-performance-"));
  const startup: number[] = [],
    receipts: number[] = [],
    heaps: number[] = [];
  const p95 = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
  let bytes = 0;
  try {
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const service = new WorkService(root);
      startup.push(performance.now() - start);
      try {
        for (let j = 0; j < 4; j++) {
          const begin = performance.now();
          await service.documents.createNew({
            requestId: randomUUID(),
            title: "Measured synthetic document",
            content: "# Fixture\n" + "bounded storage\n".repeat(100),
          });
          receipts.push(performance.now() - begin);
        }
        heaps.push(process.memoryUsage().heapUsed);
      } finally {
        await service.close();
      }
    }
    const walk = async (path: string): Promise<void> => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        expect(entry.isSymbolicLink()).toBe(false);
        const child = join(path, entry.name);
        if (entry.isDirectory()) await walk(child);
        else bytes += (await stat(child)).size;
      }
    };
    await walk(root);
    const report = {
      mode: "fixture",
      platform: process.platform,
      osRelease: release(),
      node: process.version,
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      startupMs: startup,
      receiptMs: receipts,
      heapBytes: heaps,
      retainedDiskBytes: bytes,
      startupP95Ms: p95(startup),
      receiptP95Ms: p95(receipts),
      thresholds: {
        warmStartupMs: 5000,
        localReceiptMs: 300,
        twentySmallDocumentsDiskBytes: 16777216,
      },
      limitations: [
        "In-process warm service construction after imports; UI and event lag measured separately.",
        "Current machine fixture baseline, not a pristine or low-end hardware claim; no prior comparable baseline exists.",
        "Heap samples include the Vitest process; not isolated daemon RSS. No paid model calls.",
      ],
    };
    if (process.env.ROCKY_PERFORMANCE_REPORT)
      await writeFile(
        process.env.ROCKY_PERFORMANCE_REPORT,
        JSON.stringify(report, null, 2),
      );
    expect(report.startupP95Ms).toBeLessThan(5000);
    expect(report.receiptP95Ms).toBeLessThan(300);
    expect(bytes).toBeLessThan(16777216);
  } finally {
    const rel = relative(resolve(tmpdir()), resolve(root));
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      throw Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
});
