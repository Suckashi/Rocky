import { test, expect } from "vitest";
import { createServer } from "node:http";
import { ExplicitNetwork } from "../packages/agent-runtime/src/network.js";
import { installEvaluationEgressGuard } from "../packages/agent-runtime/src/evaluation-egress.js";
test("evaluation guard rejects unregistered endpoints before sending", async () => {
  const guard = installEvaluationEgressGuard();
  try {
    await expect(
      fetch("https://unconfigured.example.invalid/"),
    ).rejects.toThrow("egress denied");
    expect(guard.denied).toHaveLength(1);
  } finally {
    guard.restore();
  }
});
test("configured loopback endpoint allowed, unconfigured and redirect denied", async () => {
  const server = createServer((req, res) =>
    req.url === "/redirect"
      ? res.writeHead(302, { location: "http://example.invalid" }).end()
      : res.end("fixture"),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error("Missing address");
  const url = "http://127.0.0.1:" + addr.port;
  const network = new ExplicitNetwork(
    new Map([
      ["target", url + "/"],
      ["grader", url + "/redirect"],
    ]),
  );
  try {
    expect(await (await network.request(url + "/", "target")).text()).toBe(
      "fixture",
    );
    await expect(
      network.request("http://example.invalid", "target"),
    ).rejects.toThrow("not explicitly");
    await expect(network.request(url + "/redirect", "grader")).rejects.toThrow(
      "Redirect",
    );
    expect(network.trace.map((t) => t.allowed)).toEqual([true, false, true]);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
