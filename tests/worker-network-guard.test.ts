import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";

test("T-009 worker preload denies direct fetch, TCP, TLS, HTTP and UDP APIs", () => {
  const guard = new URL("../scripts/worker-network-guard.mjs", import.meta.url)
    .href;
  const code = `
    import net from 'node:net';
    import tls from 'node:tls';
    import http from 'node:http';
    import dgram from 'node:dgram';
    const attempts = [
      () => fetch('http://127.0.0.1/'),
      () => net.connect(80, '127.0.0.1'),
      () => new net.Socket().connect(80, '127.0.0.1'),
      () => tls.connect(443, '127.0.0.1'),
      () => http.get('http://127.0.0.1/'),
      () => dgram.createSocket('udp4'),
    ];
    if (globalThis.__rockyWorkerNetworkGuard !== true) process.exit(2);
    for (const attempt of attempts) {
      try { attempt(); process.exit(3); }
      catch (error) {
        if (error.message !== 'Agent worker direct network access denied') process.exit(4);
      }
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", guard, "--input-type=module", "-e", code],
    {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    },
  );
  expect({ status: result.status, stderr: result.stderr }).toEqual({
    status: 0,
    stderr: "",
  });
});
