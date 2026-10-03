import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
export type HostResolver = (host: string) => Promise<LookupAddress[]>;
const resolveHost: HostResolver = (host) =>
  lookup(host, { all: true, order: "verbatim" });

/** Revalidate DNS on each new socket, and never follow a changed answer set in this lease. */
export function pinnedLookup(
  expectedHost: string,
  resolve: HostResolver = resolveHost,
): LookupFunction {
  let pinned: string | undefined;
  return (hostname, options, callback) => {
    void (async () => {
      if (hostname.toLowerCase() !== expectedHost.toLowerCase())
        throw Error("Unexpected lookup host");
      const addresses = await resolve(hostname);
      if (
        !addresses.length ||
        addresses.some((a) => !isIP(a.address) || isIP(a.address) !== a.family)
      )
        throw Error("Invalid DNS answer");
      const fingerprint = [
        ...new Set(addresses.map((a) => `${a.family}:${a.address}`)),
      ]
        .sort()
        .join(",");
      if (pinned !== undefined && pinned !== fingerprint)
        throw Error("DNS answer changed during connection lease");
      pinned = fingerprint;
      const family =
        options.family === "IPv4"
          ? 4
          : options.family === "IPv6"
            ? 6
            : options.family;
      const selected = addresses.filter((a) => !family || a.family === family);
      if (!selected.length) throw Error("No address for requested family");
      return selected;
    })().then(
      (addresses) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      () =>
        callback(
          Object.assign(new Error("Model DNS resolution refused"), {
            code: "ROCKY_DNS_DENIED",
          }),
          "",
        ),
    );
  };
}
