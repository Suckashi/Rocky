import { channel } from "node:diagnostics_channel";
import { mkdirSync, writeFileSync } from "node:fs";
const requests = [];
channel("undici:request:create").subscribe(({ request }) => {
  const url = new URL(request.path, request.origin);
  requests.push({
    transport: "undici",
    destination: url.origin,
    purpose: "observed",
  });
});
channel("http.client.request.start").subscribe(({ request }) => {
  requests.push({
    transport: "http",
    destination: request.protocol + "//" + request.host,
    purpose: "observed",
  });
});
process.on("exit", () => {
  mkdirSync(".rocky-reports", { recursive: true });
  const unexpected = requests.filter((r) => {
    try {
      return !["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(r.destination).hostname,
      );
    } catch {
      return true;
    }
  });
  writeFileSync(
    ".rocky-reports/node-egress.json",
    JSON.stringify(
      {
        requests,
        unexpected,
        limitations: [
          "HTTP/Undici diagnostics only; not packet-level OS enforcement.",
          "Browser egress is tested separately; fixtures launch no arbitrary executables.",
        ],
      },
      null,
      2,
    ),
  );
  if (unexpected.length) process.exitCode = 1;
});
