import { test, expect } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pinnedLookup } from "../packages/agent-runtime/src/model-dns.js";
import { ModelNetwork } from "../packages/agent-runtime/src/model-network.js";
import { modelConfigSchema } from "../packages/contracts/src/models.js";

test("T-007 DNS re-resolution refuses rebinding before sending a second model request", async () => {
  let requests = 0,
    resolutions = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.setHeader("connection", "close");
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const config = modelConfigSchema.parse({
    name: "DNS test",
    provider: "openai-compatible",
    baseUrl: `http://model.test:${(server.address() as AddressInfo).port}/v1`,
    modelId: "fixture",
    maxOutputTokens: 128,
  });
  const network = new ModelNetwork(config, {}, async () => [
    { address: ++resolutions === 1 ? "127.0.0.1" : "127.0.0.2", family: 4 },
  ]);
  try {
    expect(
      await (await network.post({}, AbortSignal.timeout(2000))).text(),
    ).toBe("{}");
    await expect(network.post({}, AbortSignal.timeout(2000))).rejects.toThrow(
      "did not complete",
    );
    expect(resolutions).toBe(2);
    expect(requests).toBe(1);
  } finally {
    await network.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("T-007 pinned DNS validates exact hostname and both address families; answer order is irrelevant", async () => {
  let count = 0;
  const lookup = pinnedLookup("model.test", async () => {
    const addresses = [
      { address: "127.0.0.1", family: 4 },
      { address: "::1", family: 6 },
    ];
    return ++count % 2 ? addresses : addresses.reverse();
  });
  const call = (host: string, family = 0) =>
    new Promise((resolve, reject) =>
      lookup(host, { all: true, family }, (error, addresses) =>
        error ? reject(error) : resolve(addresses),
      ),
    );
  expect(await call("model.test")).toHaveLength(2);
  expect(await call("model.test", 6)).toEqual([{ address: "::1", family: 6 }]);
  await expect(call("other.test")).rejects.toThrow("resolution refused");
  expect(count).toBe(2);
});
