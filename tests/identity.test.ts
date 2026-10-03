import { test, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../apps/daemon/src/store.js";
import { assistantSchema } from "../packages/contracts/src/assistant.js";

test("T-037 assets retain provenance, hashes and a bounded first-party vector source", () => {
  const manifest = JSON.parse(
    readFileSync("assets/rocky/asset-manifest.json", "utf8"),
  );
  let bytes = 0;
  for (const asset of manifest.assets) {
    const source = readFileSync(asset.path, "utf8");
    bytes += Buffer.byteLength(source);
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      asset.sha256,
    );
    expect(asset.method).toBe("authored-svg");
    expect(asset.rightsReview).toBe("pending");
    expect(source).not.toMatch(
      /<script|<foreignObject|<image|https?:\/\/(?!www.w3.org)/i,
    );
    expect(source).not.toMatch(/(?:href|src)=["'](?!#)/i);
  }
  // Conservative source bound includes the entire app entry, not only its new img markup.
  bytes +=
    statSync("apps/web/src/main.tsx").size +
    statSync("apps/web/src/tokens.css").size;
  expect(bytes).toBeLessThan(100 * 1024);
  expect(manifest.userApprovedFinalArtwork).toBe(false);
});

test("T-037 assistant identity persists and its public schema cannot carry policy or remote artwork", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-identity-"));
  let store = new Store(root);
  try {
    const profile = store.assistant();
    store.close();
    store = new Store(root);
    expect(store.assistant()).toEqual(profile);
    expect(profile.personaVersion).toBe("1.0.0");
    expect(
      assistantSchema.safeParse({ ...profile, grants: ["*"] }).success,
    ).toBe(false);
    expect(
      assistantSchema.safeParse({
        ...profile,
        avatarAssetId: "https://external.invalid/avatar.svg",
      }).success,
    ).toBe(false);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-037 semantic text tokens meet 4.5:1 on both themes", () => {
  const css = readFileSync("apps/web/src/tokens.css", "utf8");
  const luminance = (hex: string) => {
    const c = hex
      .match(/[0-9a-f]{2}/gi)!
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
  };
  for (const block of css.split("}").slice(0, 2)) {
    const tokens = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    for (const text of ["text", "muted", "accent", "error"])
      for (const background of ["canvas", "surface", "raised"]) {
        const a = luminance(tokens[text]!),
          b = luminance(tokens[background]!);
        expect(
          (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        ).toBeGreaterThanOrEqual(4.5);
      }
  }
});
