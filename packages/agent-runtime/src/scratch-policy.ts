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
  return {
    path,
    storage: "run-private-graph-state",
    argumentBytes: Buffer.byteLength(JSON.stringify(args), "utf8"),
  };
}
