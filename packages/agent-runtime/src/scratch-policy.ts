// Native files are graph state, never host files or registered workspace effects.
export const scratchTools = [
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "delete_file",
  "glob",
  "grep",
];

export function scratchToolFailed(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(scratchToolFailed);
  if (typeof value === "string") return /^Error(?:\b|:)/i.test(value);
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (result.status === "error") return true;
  if (result.type === "text" && typeof result.text === "string")
    return scratchToolFailed(result.text);
  if (result.content !== undefined) return scratchToolFailed(result.content);
  if (result.update && typeof result.update === "object")
    return scratchToolFailed(
      (result.update as Record<string, unknown>).messages,
    );
  return false;
}

export function validateScratchCall(
  name: string,
  args: Record<string, unknown>,
) {
  const path = args.file_path ?? args.path ?? "/";
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.includes(":") ||
    path.split("/").some((part) => part === "." || part === "..")
  )
    throw Error("Rocky scratch path must be canonical and absolute");
  const scratch = path === "/scratch" || path.startsWith("/scratch/");
  const context =
    path.startsWith("/large_tool_results/") ||
    path.startsWith("/conversation_history/") ||
    path === "/large_tool_results" ||
    path === "/conversation_history";
  const readOnly = ["ls", "read_file", "glob", "grep"].includes(name);
  if (!scratch && !(context && readOnly))
    throw Error("Rocky scratch scope denied");
  // Keep public worker IPC and checkpoint writes bounded; never serialize file contents into traces.
  if (Buffer.byteLength(JSON.stringify(args), "utf8") > 24 * 1024)
    throw Error("Rocky scratch tool arguments exceed 24 KiB");
  // Upstream braces currently has no patched release for deeply nested input.
  // Bound model-supplied glob syntax before native middleware reaches micromatch.
  if (name === "glob" || name === "grep") {
    for (const pattern of [path, name === "glob" ? args.pattern : args.glob]) {
      if (pattern === undefined || pattern === null) continue;
      if (typeof pattern !== "string" || pattern.length > 1024)
        throw Error("Rocky glob pattern exceeds its bounded syntax budget");
      let braces = 0,
        parentheses = 0;
      for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] === "\\") {
          i++;
          continue;
        }
        if (pattern[i] === "{" && ++braces > 8)
          throw Error("Rocky glob nesting exceeds its bounded syntax budget");
        if (pattern[i] === "}") braces = Math.max(0, braces - 1);
        if (pattern[i] === "(" && ++parentheses > 8)
          throw Error("Rocky glob nesting exceeds its bounded syntax budget");
        if (pattern[i] === ")") parentheses = Math.max(0, parentheses - 1);
      }
    }
  }
  return {
    path,
    storage: "run-private-graph-state",
    argumentBytes: Buffer.byteLength(JSON.stringify(args), "utf8"),
  };
}
