import { test, expect } from "vitest";
import {
  mapMcpDelivery,
  validateInlineImage,
} from "../packages/agent-runtime/src/mcp-result.js";
import {
  toModelWire,
  fromModelWire,
} from "../packages/agent-runtime/src/model-wire.js";
import { ToolMessage } from "@langchain/core/messages";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA0sAAAAASUVORK5CYII=";
const source = {
  serverId: "test",
  configRevision: 1,
  registryRevision: 1,
  toolName: "visual",
  schemaHash: "a".repeat(64),
};
test("MCP image, structured content and source retain types/artifact across model wire; resource links remain unfetched data", () => {
  const result = {
    content: [
      { type: "text", text: "observed" },
      { type: "image", mimeType: "image/png", data: png },
      {
        type: "resource_link",
        uri: "https://unconfigured.invalid/secret",
        name: "do not fetch",
      },
    ],
    structuredContent: { nested: { value: [1, true] } },
  };
  const [content, artifact] = mapMcpDelivery({
    kind: "mcp_result",
    source,
    result,
  });
  expect(artifact.mcp).toEqual(result);
  expect(artifact.source).toEqual(source);
  expect(content.some((p) => p.type === "image_url")).toBe(true);
  expect(
    content.some(
      (p) => p.type === "text" && p.text.includes("Unfetched resource"),
    ),
  ).toBe(true);
  const message = new ToolMessage({
    content,
    artifact,
    tool_call_id: "owned",
    name: "mcp_call",
  });
  const wire = toModelWire([message]);
  expect(wire[0]).not.toHaveProperty("artifact");
  expect(fromModelWire(wire)[0]?.content).toEqual(content);
});
test("unsupported binary types are retained as uninspected artifacts without becoming model text/base64 instructions", () => {
  const result = {
    content: [
      {
        type: "image",
        mimeType: "image/svg+xml",
        data: Buffer.from("<svg onload='execute()'/>").toString("base64"),
      },
    ],
  };
  const [content, artifact] = mapMcpDelivery({
    kind: "mcp_result",
    source,
    result,
  });
  expect(content.some((p) => p.type === "image_url")).toBe(false);
  expect(JSON.stringify(content)).toContain("Uninspected image");
  expect(artifact.mcp).toEqual(result);
});
test.each([
  "https://unconfigured.invalid/image.png",
  "data:image/svg+xml;base64,PHN2Zy8+",
  "data:image/png;base64,bm90LWFuLWltYWdl",
  "data:image/png;base64," + png + "=",
])("image source is local bounded data only: %s", (url) => {
  expect(() => validateInlineImage(url)).toThrow("invalid");
});
test("oversized image dimensions fail before decoder/provider", () => {
  const bytes = Buffer.from(png, "base64");
  bytes.writeUInt32BE(100000, 16);
  expect(() =>
    validateInlineImage("data:image/png;base64," + bytes.toString("base64")),
  ).toThrow("bounds");
});
