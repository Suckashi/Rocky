import { test, expect } from "vitest";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { connect, type AddressInfo } from "node:net";
import { ModelNetwork } from "../packages/agent-runtime/src/model-network.js";
import { modelConfigSchema } from "../packages/contracts/src/models.js";
import { tlsMaterial } from "../fixtures/models/tls-material.mjs";

test("T-007 AT-24: actual CONNECT proxy traffic and NO_PROXY bypass stay scoped to the connection", async () => {
  const destination = httpServer((req, res) => {
    expect(req.url).toBe("/v1/chat/completions");
    res.end("{}");
  });
  await new Promise<void>((r) => destination.listen(0, "127.0.0.1", r));
  const port = (destination.address() as AddressInfo).port;
  const proxy = httpServer();
  let tunnels = 0;
  proxy.on("connect", (req, socket, head) => {
    expect(req.url).toBe(`127.0.0.1:${port}`);
    tunnels++;
    const upstream = connect(port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  const c = modelConfigSchema.parse({
    name: "proxy test",
    provider: "openai-compatible",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    modelId: "fixture",
    maxOutputTokens: 128,
  });
  try {
    for (const [policy, env, expected] of [
      [{ mode: "explicit", url: proxyUrl }, {}, 1],
      [{ mode: "environment" }, { HTTP_PROXY: proxyUrl }, 2],
      [
        { mode: "environment" },
        { HTTP_PROXY: proxyUrl, NO_PROXY: "127.0.0.1" },
        2,
      ],
      [{ mode: "direct" }, { HTTP_PROXY: proxyUrl }, 2],
    ] as const) {
      const network = new ModelNetwork({ ...c, proxy: policy }, env);
      try {
        expect(
          await (await network.post({}, AbortSignal.timeout(2000))).text(),
        ).toBe("{}");
        expect(tunnels).toBe(expected);
      } finally {
        await network.close();
      }
    }
  } finally {
    destination.closeAllConnections();
    await Promise.all([
      new Promise<void>((r) => destination.close(() => r())),
      new Promise<void>((r) => proxy.close(() => r())),
    ]);
  }
});

test("T-007 AT-24: real TLS handshake requires explicit CA, does not relax other connections", async () => {
  const material = tlsMaterial();
  const server = httpsServer(material, (_req, res) => res.end("{}"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const config = modelConfigSchema.parse({
    name: "TLS test",
    provider: "openai-compatible",
    baseUrl: `https://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    modelId: "fixture",
    maxOutputTokens: 128,
  });
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    for (const trusted of [false, true, false]) {
      const network = new ModelNetwork(
        { ...config, caRef: trusted ? "ROCKY_TEST_CA" : null },
        { ROCKY_TEST_CA: material.cert },
      );
      try {
        if (trusted)
          expect(
            await (await network.post({}, AbortSignal.timeout(2000))).text(),
          ).toBe("{}");
        else
          await expect(
            network.post({}, AbortSignal.timeout(2000)),
          ).rejects.toThrow("did not complete");
      } finally {
        await network.close();
      }
    }
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(previous);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
