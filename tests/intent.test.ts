import { test, expect } from "vitest";
import { canonicalIntent, intentHash } from "../apps/daemon/src/intent.js";

test("T-008 exact canonical intent ignores object insertion order but preserves arrays and values", () => {
  const first = {
    tool: "write",
    args: { z: 1, a: ["x", { b: true, a: null }] },
  };
  const second = {
    args: { a: ["x", { a: null, b: true }], z: 1 },
    tool: "write",
  };
  expect(intentHash(first)).toBe(intentHash(second));
  for (const change of [
    { ...first, tool: "read" },
    { ...first, args: { z: "1" } },
    { ...first, args: { a: [{ b: true, a: null }, "x"], z: 1 } },
  ])
    expect(intentHash(change)).not.toBe(intentHash(first));
  expect(canonicalIntent({ "10": true, "2": false })).toBe(
    '{"10":true,"2":false}',
  );
  expect(intentHash({ session: "a", ...first })).not.toBe(
    intentHash({ session: "b", ...first }),
  );
});

test("T-008 invalid/coerced/oversized intents fail before getters or serialization hooks execute", () => {
  let called = false;
  const getter = Object.defineProperty({}, "private", {
    enumerable: true,
    get: () => {
      called = true;
      return "secret";
    },
  });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const sparse = new Array(2);
  for (const value of [
    undefined,
    NaN,
    Infinity,
    BigInt(1),
    { x: undefined },
    getter,
    cycle,
    sparse,
    new Date(),
    {
      toJSON: () => {
        called = true;
        return "x";
      },
    },
    { x: "a".repeat(65537) },
    Array(10001).fill(0),
  ]) {
    expect(() => canonicalIntent(value)).toThrow("bounded JSON");
  }
  expect(called).toBe(false);
  const repeated = { a: 1 };
  expect(canonicalIntent([repeated, repeated])).toBe('[{"a":1},{"a":1}]');
});
