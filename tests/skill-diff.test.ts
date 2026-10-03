import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
test("immutable package diff covers additions/removals/binary and bounded text", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-skill-diff-")),
    service = new WorkService(root),
    id = randomUUID();
  const file = (path: string, content: string) => ({
    path,
    contentBase64: Buffer.from(content).toString("base64"),
  });
  const skill = file(
    "SKILL.md",
    "---\nname: example\ndescription: Diff fixture\n---\nInstructions",
  );
  const save = (expectedRevision: number, files: ReturnType<typeof file>[]) =>
    service.skills.import({
      requestId: randomUUID(),
      id,
      expectedRevision,
      scope: { kind: "user" },
      source: { type: "manual", reference: "fixture/diff", license: "MIT" },
      package: { directoryName: "example", files: [skill, ...files] },
    });
  try {
    save(0, [
      file("changed.txt", "old\n"),
      file("removed.txt", "gone\n"),
      file("binary.dat", "\0old"),
    ]);
    save(1, [
      file("changed.txt", "new\n"),
      file("added.txt", "added\n"),
      file("binary.dat", "\0new"),
      file("long.txt", "x\n".repeat(1000)),
    ]);
    const diff = service.skills.diff(id, 1, 2, "changed.txt");
    expect(diff.files.map((f) => [f.path, f.status])).toEqual([
      ["added.txt", "added"],
      ["binary.dat", "modified"],
      ["changed.txt", "modified"],
      ["long.txt", "added"],
      ["removed.txt", "removed"],
    ]);
    expect(
      diff.preview?.rows.filter((r) => r.kind !== "context"),
    ).toMatchObject([
      { kind: "remove", text: "old\n" },
      { kind: "add", text: "new\n" },
    ]);
    expect(
      service.skills.diff(id, 1, 2, "removed.txt").preview?.removedLines,
    ).toBe(1);
    expect(service.skills.diff(id, 1, 2, "binary.dat")).toMatchObject({
      binary: true,
      preview: null,
    });
    expect(service.skills.diff(id, 1, 2, "long.txt").preview).toMatchObject({
      complete: false,
      omittedRows: 500,
    });
    expect(() => service.skills.diff(id, 1, 2, "../no-file")).toThrow(
      "not present",
    );
    expect(() => service.skills.diff(id, 0, 2)).toThrow();
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
