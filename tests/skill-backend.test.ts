import { test, expect, vi } from "vitest";
import { SkillBackend } from "../packages/agent-runtime/src/skill-backend.js";
import { createSkillsMiddleware } from "deepagents";

test("read-only native skill backend preserves bytes, paginates and rechecks every read", async () => {
  const text = "---\nname: example\ndescription: Example\n---\nOne\nTwo";
  const read = vi.fn(async () => ({
    contentBase64: Buffer.from(text).toString("base64"),
    createdAt: "2026-10-04T00:00:00Z",
  }));
  const backend = new SkillBackend({
    list: async (path) => [{ path: path + "SKILL.md", is_dir: false }],
    read,
  });
  // Use the installed native middleware's backend contract, not another skill loader.
  expect(
    createSkillsMiddleware({ backend, sources: ["/skills/example/"] }),
  ).toBeDefined();
  expect(await backend.ls("/skills/example/")).toMatchObject({
    files: [{ path: "/skills/example/SKILL.md" }],
  });
  expect(await backend.read("/skills/example/SKILL.md", 4, 1)).toMatchObject({
    content: "One",
    nextOffset: 5,
    totalLines: 6,
  });
  expect(
    (await backend.downloadFiles(["/skills/example/SKILL.md"]))[0]?.content,
  ).toEqual(Buffer.from(text));
  expect(backend.write().error).toContain("read-only");
  expect(backend.edit().error).toContain("read-only");
  expect(backend.delete().error).toContain("read-only");
  read.mockRejectedValueOnce(Error("quarantined"));
  await expect(backend.read("/skills/example/SKILL.md")).rejects.toThrow(
    "quarantined",
  );
  expect(read).toHaveBeenCalledTimes(3);
});
test("skill read size and binary boundaries", async () => {
  let content = "a".repeat(12000) + "\n" + "b".repeat(12000);
  const backend = new SkillBackend({
    list: async () => [],
    read: async () => ({
      contentBase64: Buffer.from(content).toString("base64"),
      createdAt: "2026-10-04T00:00:00Z",
    }),
  });
  expect(await backend.read("/a")).toMatchObject({ nextOffset: 1 });
  expect(await backend.read("/a", -1)).toHaveProperty("error");
  content = "x".repeat(17000);
  expect(await backend.read("/a")).toHaveProperty("error");
  content = "\0binary";
  expect(await backend.read("/a")).toHaveProperty("error");
});
