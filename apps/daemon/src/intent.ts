import { createHash } from "node:crypto";
import { RockyError } from "../../../packages/contracts/src/index.js";

/** Deterministic exact JSON intent. No coercion, getters, omitted values or toJSON hooks. */
export function canonicalIntent(value: unknown): string {
  const parents = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  const invalid = () =>
    new RockyError(
      "invalid_intent",
      "Operation intent must be bounded JSON data",
      400,
    );
  const charge = (text: string) => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > 65536) throw invalid();
    return text;
  };
  const visit = (item: unknown, depth: number): string => {
    if (++nodes > 10000 || depth > 64) throw invalid();
    if (item === null) return charge("null");
    if (typeof item === "string" && item.length > 65536) throw invalid();
    if (typeof item === "string" || typeof item === "boolean")
      return charge(JSON.stringify(item));
    if (typeof item === "number" && Number.isFinite(item))
      return charge(JSON.stringify(item));
    if (typeof item !== "object" || parents.has(item)) throw invalid();
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw invalid();
    parents.add(item);
    try {
      if (Array.isArray(item) && item.length > 10000) throw invalid();
      const descriptors = Object.getOwnPropertyDescriptors(item);
      if (Object.getOwnPropertySymbols(item).length) throw invalid();
      const read = (key: string) => {
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
          throw invalid();
        return visit(descriptor.value, depth + 1);
      };
      if (Array.isArray(item)) {
        if (Object.keys(descriptors).length !== item.length + 1)
          throw invalid();
        charge("[]" + ",".repeat(Math.max(0, item.length - 1)));
        return (
          "[" +
          Array.from({ length: item.length }, (_, i) => read(String(i))).join(
            ",",
          ) +
          "]"
        );
      }
      const keys = Object.keys(descriptors).sort();
      if (keys.length > 10000) throw invalid();
      charge("{}" + ",".repeat(Math.max(0, keys.length - 1)));
      return (
        "{" +
        keys
          .map((key) => charge(JSON.stringify(key) + ":") + read(key))
          .join(",") +
        "}"
      );
    } finally {
      parents.delete(item);
    }
  };
  const result = visit(value, 0);
  if (Buffer.byteLength(result, "utf8") > 65536) throw invalid();
  return result;
}
export function intentHash(value: unknown): string {
  return createHash("sha256")
    .update("rocky.intent.v1\n")
    .update(canonicalIntent(value))
    .digest("hex");
}
