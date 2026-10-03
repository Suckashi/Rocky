/** One replacement hunk with matching edge context; linear time, not a minimal edit script. */
export function replacementDiff(before: string, after: string) {
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const old = lines(before),
    next = lines(after);
  let start = 0,
    end = 0;
  while (
    start < old.length &&
    start < next.length &&
    old[start] === next[start]
  )
    start++;
  while (
    end < old.length - start &&
    end < next.length - start &&
    old[old.length - 1 - end] === next[next.length - 1 - end]
  )
    end++;
  const ranges = [
    { kind: "context", lines: old, from: Math.max(0, start - 3), to: start },
    { kind: "remove", lines: old, from: start, to: old.length - end },
    { kind: "add", lines: next, from: start, to: next.length - end },
    {
      kind: "context",
      lines: old,
      from: old.length - end,
      to: old.length - end + Math.min(3, end),
    },
  ] as const;
  const rows: {
    kind: "context" | "remove" | "add";
    text: string;
    truncated: boolean;
  }[] = [];
  let characters = 0;
  render: for (const range of ranges) {
    for (let i = range.from; i < range.to; i++) {
      if (characters >= 65536 || rows.length >= 500) break render;
      const original = range.lines[i]!;
      const text = original.slice(0, Math.min(8192, 65536 - characters));
      characters += text.length;
      rows.push({ kind: range.kind, text, truncated: text !== original });
    }
  }
  const omittedRows =
    ranges.reduce((count, range) => count + range.to - range.from, 0) -
    rows.length;
  const ending = (text: string): "none" | "lf" | "crlf" | "cr" | "mixed" => {
    const kinds = [
      text.includes("\r\n") ? ("crlf" as const) : null,
      /(?<!\r)\n/.test(text) ? ("lf" as const) : null,
      /\r(?!\n)/.test(text) ? ("cr" as const) : null,
    ].filter((value) => value !== null);
    return kinds.length > 1 ? "mixed" : (kinds[0] ?? "none");
  };
  return {
    previousHasBOM: before.startsWith("\uFEFF"),
    nextHasBOM: after.startsWith("\uFEFF"),
    previousLineEnding: ending(before),
    nextLineEnding: ending(after),
    rows,
    omittedRows,
    complete: omittedRows === 0 && rows.every((row) => !row.truncated),
    removedLines: old.length - start - end,
    addedLines: next.length - start - end,
    previousEndsWithNewline: before.endsWith("\n"),
    nextEndsWithNewline: after.endsWith("\n"),
  };
}
