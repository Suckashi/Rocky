import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";

test("owner documents need no synthetic Work; revisions remain immutable and paginated", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-new-document-"));
  const service = new WorkService(root);
  try {
    const command = {
      requestId: randomUUID(),
      title: "Owner note",
      content: "# Original\n",
    };
    const first = service.documents.createNew(command);
    expect(service.documents.createNew(command)).toEqual(first);
    expect(first.document.sourceWorkId).toBeUndefined();
    expect(service.store.list()).toEqual([]);
    expect(() =>
      service.documents.createNew({ ...command, content: "changed" }),
    ).toThrow("Document request changed");
    for (let revision = 1; revision < 53; revision++)
      service.documents.save(first.document.id, {
        requestId: randomUUID(),
        expectedRevision: revision,
        title: "Owner note",
        content: `Revision ${revision + 1}`,
      });
    const newest = service.documents.history(first.document.id);
    expect(newest.revisions).toHaveLength(50);
    expect(newest.revisions[0].revision).toBe(53);
    const older = service.documents.history(
      first.document.id,
      newest.nextBefore!,
    );
    expect(older.revisions.map((entry) => entry.revision)).toEqual([3, 2, 1]);
    expect(older.nextBefore).toBeNull();
    expect(service.documents.get(first.document.id, 1).content).toBe(
      command.content,
    );
    expect(() =>
      service.documents.save(first.document.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        title: "stale",
        content: "stale",
      }),
    ).toThrow("Document changed");
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
