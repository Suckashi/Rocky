import { test, expect, vi } from "vitest";
import fs, {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { STORE_SCHEMA_VERSION } from "../apps/daemon/src/storage-metadata.js";

test("fresh Rocky ignores synthetic foreign home stores and refuses unknown or newer stores without conversion", async () => {
  const base = mkdtempSync(join(tmpdir(), "rocky-fresh-home-"));
  const foreign = join(base, "home", "Apsis"),
    other = join(base, "home", "OpenDots");
  mkdirSync(foreign, { recursive: true });
  mkdirSync(other, { recursive: true });
  for (const folder of [foreign, other]) {
    writeFileSync(
      join(folder, "manifest.json"),
      JSON.stringify({ productId: "foreign" }),
    );
    writeFileSync(
      join(folder, "cookies.sqlite"),
      "synthetic private bytes, never import",
    );
  }
  const monitored: string[] = [];
  const read = fs.readFileSync,
    list = fs.readdirSync;
  const observe = (path: unknown) => {
    if (typeof path !== "string") return;
    const normalized = resolve(path).toLowerCase();
    if (
      [foreign, other].some(
        (folder) =>
          normalized === folder.toLowerCase() ||
          normalized.startsWith(folder.toLowerCase() + "/") ||
          normalized.startsWith(folder.toLowerCase() + "\\"),
      )
    ) {
      monitored.push(normalized);
      throw Error("Forbidden synthetic foreign-store access");
    }
  };
  const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((
    path: Parameters<typeof read>[0],
    ...args: unknown[]
  ) => {
    observe(path);
    return Reflect.apply(read, fs, [path, ...args]);
  }) as typeof read);
  const listSpy = vi.spyOn(fs, "readdirSync").mockImplementation(((
    path: Parameters<typeof list>[0],
    ...args: unknown[]
  ) => {
    observe(path);
    return Reflect.apply(list, fs, [path, ...args]);
  }) as typeof list);
  vi.stubEnv("APSIS_DATA_DIR", foreign);
  vi.stubEnv("HOME", join(base, "home"));
  vi.stubEnv("USERPROFILE", join(base, "home"));
  let service: WorkService | undefined;
  try {
    service = new WorkService(join(base, "Rocky"));
    expect(service.store.list()).toEqual([]);
    expect(monitored).toEqual([]);
    await service.close();
    service = undefined;
    const unknown = join(base, "unknown");
    mkdirSync(unknown);
    writeFileSync(join(unknown, "private.txt"), "unchanged");
    expect(() => new Store(unknown)).toThrow("unknown nonempty");
    expect(readdirSync(unknown)).toEqual(["private.txt"]);
    expect(readFileSync(join(unknown, "private.txt"), "utf8")).toBe(
      "unchanged",
    );
    const future = new Store(join(base, "future"));
    future.db.exec(`PRAGMA user_version=${STORE_SCHEMA_VERSION + 1}`);
    future.close();
    const bytes = readFileSync(join(base, "future", "domain.sqlite"));
    expect(() => new Store(join(base, "future"))).toThrow(
      "newer than this application",
    );
    expect(readFileSync(join(base, "future", "domain.sqlite"))).toEqual(bytes);
    expect(monitored).toEqual([]);
  } finally {
    await service?.close();
    readSpy.mockRestore();
    listSpy.mockRestore();
    vi.unstubAllEnvs();
    const rel = relative(resolve(tmpdir()), resolve(base));
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      throw Error("Unsafe fixture cleanup");
    rmSync(base, { recursive: true, force: true });
  }
});
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
