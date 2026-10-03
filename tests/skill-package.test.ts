import { expect, test } from "vitest";
import { validateSkillPackage } from "../apps/daemon/src/skill-package.js";

const file = (path: string, text: string) => ({
  path,
  contentBase64: Buffer.from(text).toString("base64"),
});
const skill = file(
  "SKILL.md",
  "---\nname: example-skill\ndescription: |\n  Use for fixture analysis.\nlicense: MIT\nallowed-tools: Bash(*)\nmetadata:\n  author: owner\n---\n# Instructions\n",
);
const input = {
  directoryName: "example-skill",
  files: [skill, file("references/guide.md", "Guidance")],
};
test("portable skill metadata, immutable file hashes, deterministic package identity and binary assets", () => {
  const result = validateSkillPackage(input);
  expect(result.metadata).toMatchObject({
    name: "example-skill",
    description: "Use for fixture analysis.",
    "allowed-tools": "Bash(*)",
    metadata: { author: "owner" },
  });
  expect(result).not.toHaveProperty("grants");
  expect(
    validateSkillPackage({ ...input, files: [...input.files].reverse() })
      .contentHash,
  ).toBe(result.contentHash);
  expect(
    validateSkillPackage({
      ...input,
      files: [skill, file("references/guide.md", "Changed")],
    }).contentHash,
  ).not.toBe(result.contentHash);
  expect(
    validateSkillPackage({
      ...input,
      files: [
        skill,
        {
          path: "assets/image.bin",
          contentBase64: Buffer.from([0, 255, 128]).toString("base64"),
        },
      ],
    }).files[1]?.bytes,
  ).toBe(3);
});
test.each([
  "../escape",
  "/absolute",
  "C:/escape",
  "a\\b",
  "a/./b",
  "a//b",
  "a/NUL.txt",
  "x:stream",
  "x.",
  "manifest.json",
  ".git/config",
])("reject unsafe path %s", (path) => {
  expect(() =>
    validateSkillPackage({ ...input, files: [skill, file(path, "x")] }),
  ).toThrow();
});
test("reject collisions, malformed data and oversized packages", () => {
  for (const files of [
    [skill, file("skill.md", "duplicate")],
    [skill, file("references", "file"), file("references/a", "nested")],
    [skill, { path: "bad", contentBase64: "%%%" }],
    [file("readme.md", "no skill")],
    [skill, file("large", "a".repeat(1048577))],
    [
      skill,
      ...Array.from({ length: 5 }, (_, i) =>
        file(`asset-${i}`, "x".repeat(1048576)),
      ),
    ],
    [
      {
        path: "SKILL.md",
        contentBase64: Buffer.from([255]).toString("base64"),
      },
    ],
  ])
    expect(() => validateSkillPackage({ ...input, files })).toThrow();
});
test.each([
  "name: other\ndescription: Wrong name",
  "name: example-skill\nname: duplicate\ndescription: Duplicate",
  "name: example-skill\ndescription: !unknown value",
  "name: example-skill\ndescription: &a text\nlicense: *a",
  "name: example-skill\ndescription: 123",
])("reject invalid metadata: %s", (yaml) => {
  expect(() =>
    validateSkillPackage({
      ...input,
      files: [file("SKILL.md", `---\n${yaml}\n---\nBody`)],
    }),
  ).toThrow();
});
