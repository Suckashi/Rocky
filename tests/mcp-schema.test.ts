import { test, expect } from "vitest";
import {
  McpSchemaValidator,
  mcpToolIdentity,
} from "../apps/daemon/src/mcp-schema.js";
const provider = new McpSchemaValidator();
test("original nested schema validates refs, unions, required fields, limits and additional properties without coercion", () => {
  const schema = {
    type: "object" as const,
    $defs: { selection: { type: "integer" as const, minimum: 1, maximum: 3 } },
    properties: {
      items: {
        type: "array" as const,
        maxItems: 2,
        items: { $ref: "#/$defs/selection" },
      },
      mode: { enum: ["a", "b"] },
    },
    required: ["items", "mode"],
    additionalProperties: false,
  };
  const validate = provider.getValidator(schema),
    input = { items: [1, 2], mode: "a" };
  expect(validate(input).valid).toBe(true);
  expect(input).toEqual({ items: [1, 2], mode: "a" });
  for (const bad of [
    { items: ["1"], mode: "a" },
    { items: [4], mode: "a" },
    { items: [1, 2, 3], mode: "a" },
    { items: [] },
    { ...input, extra: true },
  ])
    expect(validate(bad).valid).toBe(false);
});
test("duplicate schema IDs never reuse another server's validation; explicit draft 7 and 2020 formats are checked", () => {
  const one = provider.getValidator({
    $id: "urn:rocky:duplicate",
    type: "object",
    properties: { value: { const: 1 } },
    required: ["value"],
  });
  const two = provider.getValidator({
    $id: "urn:rocky:duplicate",
    type: "object",
    properties: { value: { const: 2 } },
    required: ["value"],
  });
  expect(one({ value: 1 }).valid).toBe(true);
  expect(two({ value: 1 }).valid).toBe(false);
  for (const $schema of [
    "http://json-schema.org/draft-07/schema#",
    "https://json-schema.org/draft/2020-12/schema",
  ])
    expect(
      provider.getValidator({
        $schema,
        type: "object",
        properties: { at: { type: "string", format: "date-time" } },
      })({ at: "invalid" }).valid,
    ).toBe(false);
});
test.each([
  { $ref: "https://unconfigured.invalid/schema" },
  { $ref: "#/missing" },
  { $defs: { loop: { $ref: "#/$defs/loop" } }, $ref: "#/$defs/loop" },
  {
    type: "object",
    properties: { name: { type: "string", pattern: "(a+)+$" } },
  },
  { type: "object", dependencies: { a: { pattern: ".*" } } },
  {
    type: "object",
    properties: { at: { type: "string", format: "unknown-format" } },
  },
  { type: "object", required: 1 },
  { $schema: "https://unconfigured.invalid/draft" },
])("unsafe or unsupported schemas fail closed: %j", (schema) => {
  expect(() => provider.getValidator(schema as never)).toThrow("unsupported");
});
test("same upstream name cannot collide across servers, annotations never grant read authority, revisions change the exact identity", () => {
  const tool = {
    name: "same",
    inputSchema: { type: "object" as const },
    annotations: { readOnlyHint: true },
  };
  const first = mcpToolIdentity("a", 1, 1, tool),
    second = mcpToolIdentity("b", 1, 1, tool);
  expect(first.runtimeName).not.toBe(second.runtimeName);
  expect(first.effect).toBe("unknown");
  expect(mcpToolIdentity("a", 2, 2, tool)).not.toEqual(first);
  expect(
    mcpToolIdentity("a", 1, 1, {
      ...tool,
      annotations: { readOnlyHint: false },
    }).schemaHash,
  ).not.toBe(first.schemaHash);
});
