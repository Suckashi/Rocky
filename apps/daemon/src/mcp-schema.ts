import { Ajv as Ajv7 } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type {
  JsonSchemaType,
  JsonSchemaValidator,
  jsonSchemaValidator,
} from "@modelcontextprotocol/sdk/validation/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import { canonicalIntent, intentHash } from "./intent.js";

const unsupported = () =>
  new RockyError(
    "mcp_schema_unsupported",
    "MCP schema is invalid or unsupported",
    422,
  );

/** No schema fetches, mutation, coercion, arbitrary regex or recursive validators. */
export class McpSchemaValidator implements jsonSchemaValidator {
  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    try {
      const snapshot = JSON.parse(canonicalIntent(schema));
      this.inspect(snapshot, snapshot, new Set(), 0, { visits: 0 });
      const draft = snapshot.$schema;
      if (
        draft &&
        ![
          "http://json-schema.org/draft-07/schema#",
          "https://json-schema.org/draft/2020-12/schema",
        ].includes(draft)
      )
        throw unsupported();
      // A fresh compiler for every schema prevents untrusted duplicate $id cache reuse.
      const options = {
        strictSchema: true,
        strictTypes: false,
        strictTuples: false,
        strictRequired: false,
        allowUnionTypes: true,
        validateSchema: true,
        allErrors: false,
        coerceTypes: false,
        useDefaults: false,
        removeAdditional: false,
        validateFormats: true,
        inlineRefs: false,
      };
      const compiler =
        draft === "http://json-schema.org/draft-07/schema#"
          ? new Ajv7(options)
          : new Ajv2020(options);
      (
        addFormats as unknown as (
          ajv: typeof compiler,
          options: { mode: "fast" },
        ) => void
      )(compiler, { mode: "fast" });
      const validate = compiler.compile(snapshot);
      return (input) => {
        const data = JSON.parse(canonicalIntent(input));
        return validate(data)
          ? { valid: true, data: data as T, errorMessage: undefined }
          : {
              valid: false,
              data: undefined,
              errorMessage: "MCP arguments do not match the original schema",
            };
      };
    } catch {
      throw unsupported();
    }
  }
  private inspect(
    node: unknown,
    root: unknown,
    ancestors: Set<object>,
    depth: number,
    budget: { visits: number },
  ): void {
    if (++budget.visits > 10000) throw unsupported();
    if (typeof node === "boolean") return;
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      depth > 64 ||
      ancestors.has(node)
    )
      throw unsupported();
    const schema = node as Record<string, unknown>;
    ancestors.add(node);
    try {
      for (const key of [
        "pattern",
        "patternProperties",
        "$dynamicRef",
        "$recursiveRef",
        "$dynamicAnchor",
        "$recursiveAnchor",
      ])
        if (key in schema) throw unsupported();
      if ("$ref" in schema) {
        if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/"))
          throw unsupported();
        let target: unknown = root;
        for (const token of schema.$ref.slice(2).split("/")) {
          const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
          if (
            !target ||
            typeof target !== "object" ||
            !Object.hasOwn(target, key)
          )
            throw unsupported();
          target = (target as Record<string, unknown>)[key];
        }
        this.inspect(target, root, ancestors, depth + 1, budget);
      }
      for (const key of [
        "properties",
        "$defs",
        "definitions",
        "dependentSchemas",
      ])
        if (schema[key] && typeof schema[key] === "object")
          for (const child of Object.values(schema[key]))
            this.inspect(child, root, ancestors, depth + 1, budget);
      if (schema.dependencies && typeof schema.dependencies === "object")
        for (const child of Object.values(schema.dependencies))
          if (!Array.isArray(child))
            this.inspect(child, root, ancestors, depth + 1, budget);
      for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"])
        if (Array.isArray(schema[key]))
          for (const child of schema[key])
            this.inspect(child, root, ancestors, depth + 1, budget);
      for (const key of [
        "items",
        "additionalItems",
        "additionalProperties",
        "unevaluatedProperties",
        "unevaluatedItems",
        "contains",
        "not",
        "if",
        "then",
        "else",
        "propertyNames",
      ])
        if (key in schema) {
          if (Array.isArray(schema[key]))
            for (const child of schema[key])
              this.inspect(child, root, ancestors, depth + 1, budget);
          else this.inspect(schema[key], root, ancestors, depth + 1, budget);
        }
    } finally {
      ancestors.delete(node);
    }
  }
}

export function mcpToolIdentity(
  serverId: string,
  configRevision: number,
  registryRevision: number,
  tool: Tool,
) {
  return {
    serverId,
    configRevision,
    registryRevision,
    toolName: tool.name,
    // Names are stable per server/tool, while approval schema identity changes with any metadata.
    runtimeName:
      "mcp_" + intentHash({ serverId, toolName: tool.name }).slice(0, 56),
    schemaHash: intentHash(tool),
    effect: "unknown" as const,
  };
}
