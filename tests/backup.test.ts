import { test, expect } from "vitest";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { Store } from "../apps/daemon/src/store.js";
import {
  createBackup,
  verifyBackup,
  restoreBackup,
} from "../apps/daemon/src/backup.js";

test("Rocky backup verifies immutable content and restores with automation fenced", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-backup-fixture-"));
  const source = join(base, "source"),
    backup = join(base, "backup"),
    restored = join(base, "restored");
  let service: WorkService | undefined = new WorkService(source);
  try {
    const document = service.documents.createNew({
      requestId: randomUUID(),
      title: "Backup fixture",
      content: "Keep this exact revision",
    });
    await expect(createBackup(source, backup)).rejects.toThrow();
    await service.close();
    service = undefined;
    const created = await createBackup(source, backup);
    expect(created.fileCount).toBeGreaterThan(1);
    const manifest = await verifyBackup(backup);
    expect(
      manifest.files.some((file) => file.path === "writer-lock.sqlite"),
    ).toBe(false);
    expect(() => new Store(backup)).toThrow();
    const receipt = await restoreBackup(backup, restored);
    expect(receipt.effectsReplayed).toBe(false);
    service = new WorkService(restored);
    expect(service.documents.get(document.document.id, 1).content).toBe(
      "Keep this exact revision",
    );
    expect(service.learning.policy().mode).toBe("off");
    await service.close();
    service = undefined;
    await expect(restoreBackup(backup, restored)).rejects.toThrow("empty");
    expect((await verifyBackup(backup)).files).toEqual(manifest.files);
    const productManifest = join(backup, "manifest.json");
    await writeFile(
      productManifest,
      (await readFile(productManifest, "utf8")) + " ",
    );
    await expect(verifyBackup(backup)).rejects.toThrow("checksum");
    const untouched = join(base, "untouched");
    await expect(restoreBackup(backup, untouched)).rejects.toThrow();
    expect(await readdir(base)).not.toContain("untouched");
  } finally {
    await service?.close();
    const target = resolve(base),
      containment = relative(resolve(tmpdir()), target);
    if (!containment || containment.startsWith("..") || isAbsolute(containment))
      throw Error("Unsafe fixture cleanup target");
    await rm(target, { recursive: true, force: true });
  }
});

test("backup rejects foreign product metadata before touching its database", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-backup-foreign-"));
  try {
    const source = join(base, "foreign"),
      destination = join(base, "output");
    await mkdir(source);
    await writeFile(
      join(source, "manifest.json"),
      JSON.stringify({ productId: "unrelated", schemaVersion: 1 }),
    );
    await writeFile(join(source, "domain.sqlite"), "DO NOT OPEN");
    await expect(createBackup(source, destination)).rejects.toThrow(
      "no database was read",
    );
    expect(await readFile(join(source, "domain.sqlite"), "utf8")).toBe(
      "DO NOT OPEN",
    );
    expect(await readdir(base)).toEqual(["foreign"]);
  } finally {
    const target = resolve(base),
      containment = relative(resolve(tmpdir()), target);
    if (!containment || containment.startsWith("..") || isAbsolute(containment))
      throw Error("Unsafe fixture cleanup target");
    await rm(target, { recursive: true, force: true });
  }
});
