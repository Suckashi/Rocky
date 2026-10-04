import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { Store } from "../apps/daemon/src/store.js";
import { Attachments } from "../apps/daemon/src/attachments.js";
import { workSchema } from "../packages/contracts/src/index.js";

test("attachments validate bytes, persist exact receipts and restrict Work reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-attachments-")),
    store = new Store(root),
    attachments = new Attachments(store);
  try {
    const command = {
      requestId: randomUUID(),
      name: "note.md",
      mimeType: "text/markdown",
      base64: Buffer.from("# Owner evidence").toString("base64"),
    };
    const item = await attachments.upload(command);
    expect(await attachments.upload(command)).toEqual(item);
    await expect(
      attachments.upload({ ...command, name: "changed.md" }),
    ).rejects.toThrow("upload changed");
    const work = workSchema.parse({
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: randomUUID(),
      text: "Read attachments",
      transport: "stdio",
      mode: "fixture",
      runMode: "normal",
      status: "queued",
      revision: 1,
      answer: "",
      createdAt: new Date().toISOString(),
      attachments: [{ id: item.id, revision: 1, sha256: item.sha256 }],
    });
    store.add(work, "fixture");
    expect(attachments.read(work, item.id)).toMatchObject({
      text: "# Owner evidence",
      untrustedData: true,
    });
    expect(() =>
      attachments.read({ ...work, attachments: [] }, item.id),
    ).toThrow("not bound");
    await expect(
      attachments.upload({
        ...command,
        requestId: randomUUID(),
        mimeType: "image/png",
      }),
    ).rejects.toThrow();
    await expect(
      attachments.upload({
        ...command,
        requestId: randomUUID(),
        base64: Buffer.from([0xc0, 0xff]).toString("base64"),
      }),
    ).rejects.toThrow("UTF-8");
    const png = new PNG({ width: 2, height: 2 });
    png.data.fill(255);
    const image = await attachments.upload({
      requestId: randomUUID(),
      name: "pixel.png",
      mimeType: "image/png",
      base64: PNG.sync.write(png).toString("base64"),
    });
    const bound = {
      ...work,
      attachments: [
        { id: image.id, revision: 1 as const, sha256: image.sha256 },
      ],
    };
    expect(attachments.read(bound, image.id)).toHaveProperty("unavailable");
    expect(attachments.read(bound, image.id, true)).toHaveProperty(
      "image",
      expect.stringMatching(/^data:image\/png;base64,/),
    );
    store.db
      .prepare("UPDATE attachments SET bytes=? WHERE id=?")
      .run(Buffer.from("tampered"), item.id);
    expect(() => attachments.get(item.id)).toThrow("integrity");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
