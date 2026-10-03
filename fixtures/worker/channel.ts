import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { parseIpcMessage } from "../../packages/contracts/src/ipc.js";
let start: ReturnType<typeof parseIpcMessage> | undefined;
let sequence = 0;
let expected = "";
process.on("message", (wire) => {
  const message = parseIpcMessage(String(wire));
  if (message.payload.kind === "cancel") {
    if (
      start?.payload.kind === "start" &&
      !["stubborn", "stubborn-tree"].includes(start.payload.text)
    )
      process.exit(0);
    return;
  }
  if (message.payload.kind === "start") {
    start = message;
    const send = (tool: string, args: Record<string, unknown>, bad = false) => {
      expected = randomUUID();
      process.send!(
        JSON.stringify({
          ...message,
          requestId: expected,
          sequence: String(++sequence),
          runCapability: bad ? "0".repeat(64) : message.runCapability,
          payload: {
            kind: "tool_request",
            logicalToolCallId: expected,
            tool,
            args,
          },
        }),
      );
    };
    if (message.payload.text === "stubborn-tree") {
      const grandchild = spawn(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)"],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
      if (!grandchild.pid) throw Error("Synthetic grandchild failed to start");
      send("report_tree", { pid: grandchild.pid });
    } else if (message.payload.text === "flood")
      for (let i = 0; i < 9; i++) send("wait", {});
    else
      send(
        "inspect_sample",
        { label: message.payload.text },
        message.payload.text === "badcap",
      );
  } else if (message.payload.kind === "tool_result") {
    if (message.requestId !== expected) process.exit(2);
    if (
      start?.payload.kind === "start" &&
      start.payload.text === "stubborn-tree"
    )
      return;
    if (sequence === 1) {
      expected = randomUUID();
      process.send!(
        JSON.stringify({
          ...start!,
          requestId: expected,
          sequence: String(++sequence),
          payload: {
            kind: "tool_request",
            logicalToolCallId: expected,
            tool: "record_result",
            args: { result: message.payload.result },
          },
        }),
      );
    } else process.exit(0);
  } else if (message.payload.kind === "error") process.exit(3);
});
