import { test, expect } from "vitest";
import { replacementDiff } from "../apps/daemon/src/write-diff.js";

test("replacement hunk preserves exact changed lines, context, CRLF and trailing newline state", () => {
  const diff = replacementDiff("same\r\nold\r\nend", "same\r\nnew\r\nend\n");
  expect(diff).toMatchObject({
    complete: true,
    removedLines: 2,
    addedLines: 2,
    previousEndsWithNewline: false,
    nextEndsWithNewline: true,
  });
  expect(
    diff.rows
      .filter((r) => r.kind === "remove")
      .map((r) => r.text)
      .join(""),
  ).toBe("old\r\nend");
  expect(
    diff.rows
      .filter((r) => r.kind === "add")
      .map((r) => r.text)
      .join(""),
  ).toBe("new\r\nend\n");
  expect(replacementDiff("", "")).toMatchObject({
    complete: true,
    rows: [],
    removedLines: 0,
    addedLines: 0,
  });
  expect(replacementDiff("unchanged\n", "unchanged\n")).toMatchObject({
    removedLines: 0,
    addedLines: 0,
  });
  expect(replacementDiff("\uFEFFtext", "text")).toMatchObject({
    removedLines: 1,
    addedLines: 1,
  });
});

test("large and very long differences explicitly report bounded incomplete preview", () => {
  const lines = replacementDiff("old\n".repeat(10000), "new\n".repeat(10000));
  expect(lines.complete).toBe(false);
  expect(lines.rows).toHaveLength(500);
  expect(lines.omittedRows).toBe(19500);
  const long = replacementDiff("x".repeat(100000), "new");
  expect(long.complete).toBe(false);
  expect(long.rows[0]).toMatchObject({ truncated: true });
  expect(long.rows[0]!.text).toHaveLength(8192);
});
