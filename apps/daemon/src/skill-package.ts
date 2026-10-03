import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { z } from "zod";
import { RockyError } from "../../../packages/contracts/src/index.js";

const nameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const metadataSchema = z
  .object({
    name: nameSchema,
    description: z.string().trim().min(1).max(1024),
    license: z.string().max(4096).optional(),
    compatibility: z.string().min(1).max(500).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    "allowed-tools": z.string().max(4096).optional(),
  })
  .passthrough();
const inputSchema = z
  .object({
    directoryName: nameSchema,
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(512),
            contentBase64: z.string().max(1398104),
          })
          .strict(),
      )
      .min(1)
      .max(128),
  })
  .strict();
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
function invalid(message: string): never {
  throw new RockyError("skill_package", message, 422);
}

/** Data-only snapshot boundary. Never executes scripts or grants allowed-tools. */
export function validateSkillPackage(input: unknown) {
  const command = inputSchema.parse(input);
  const seen = new Set<string>();
  let totalBytes = 0;
  const files = command.files
    .map((file) => {
      const parts = file.path.split("/");
      if (
        parts.some(
          (part) =>
            !part ||
            part === "." ||
            part === ".." ||
            /[\\:\x00-\x1f<>"|?*]/.test(part) ||
            /[. ]$/.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
            [".git", "manifest.json"].includes(part.toLowerCase()),
        )
      )
        invalid("Unsafe or reserved package path");
      const key = file.path.normalize("NFC").toLowerCase();
      if (seen.has(key)) invalid("Duplicate or case-colliding package path");
      seen.add(key);
      const bytes = Buffer.from(file.contentBase64, "base64");
      if (bytes.toString("base64") !== file.contentBase64)
        invalid("Noncanonical base64 content");
      totalBytes += bytes.length;
      if (bytes.length > 1048576 || totalBytes > 4194304)
        invalid("Package size limit exceeded");
      return {
        path: file.path,
        contentBase64: file.contentBase64,
        bytes: bytes.length,
        sha256: sha256(bytes),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of files) {
    const parts = file.path.normalize("NFC").toLowerCase().split("/");
    for (let i = 1; i < parts.length; i++)
      if (seen.has(parts.slice(0, i).join("/")))
        invalid("File conflicts with package directory");
  }
  const skill = files.find((file) => file.path === "SKILL.md");
  if (!skill) invalid("Package requires SKILL.md");
  const bytes = Buffer.from(skill.contentBase64, "base64");
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes) || text.includes("\0"))
    invalid("SKILL.md must be UTF-8 text without NUL");
  const frontmatter = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
    text,
  );
  if (!frontmatter || Buffer.byteLength(frontmatter[1]!) > 16384)
    invalid("Missing or oversized YAML frontmatter");
  const document = parseDocument(frontmatter[1]!, {
    uniqueKeys: true,
    customTags: [],
  });
  if (document.errors.length || document.warnings.length)
    invalid("Invalid YAML frontmatter");
  let raw: unknown;
  try {
    raw = document.toJS({ maxAliasCount: 0 });
  } catch {
    invalid("YAML aliases are not supported");
  }
  const metadata = metadataSchema.parse(raw);
  if (metadata.name !== command.directoryName)
    invalid("Skill name must match source directory name");
  return {
    metadata,
    files,
    totalBytes,
    contentHash: sha256(
      JSON.stringify(
        files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
      ),
    ),
  };
}
