import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const allowed = new Set([
  "MIT",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Unlicense",
  "Python-2.0",
  "Artistic-2.0",
  "BlueOak-1.0.0",
  "(Apache-2.0 AND BSD-3-Clause)",
  "Apache-2.0 AND MIT",
  "(MPL-2.0 OR Apache-2.0)",
  "(MIT OR WTFPL)",
  "(WTFPL OR MIT)",
  "(AFL-2.1 OR BSD-3-Clause)",
  "(BSD-3-Clause OR GPL-2.0)",
  "(BSD-2-Clause OR MIT OR Apache-2.0)",
  "(MIT OR CC0-1.0)",
]);
const entries = Object.entries(lock.packages)
  .filter(([path, p]) => path.startsWith("node_modules/") && !p.link)
  .map(([path, p]) => ({
    path,
    version: p.version,
    license: p.license ?? "UNKNOWN",
    optional: p.optional ?? false,
    installed: existsSync(path + "/package.json"),
    permitted: allowed.has(p.license),
  }));
const reviewed = {
  "node_modules/khroma": { version: "2.1.0", license: "MIT" },
  "node_modules/xmlhttprequest-ssl": { version: "2.1.2", license: "MIT" },
  "node_modules/url-template": { version: "2.0.8", license: "BSD-3-Clause" },
  "node_modules/caniuse-lite": {
    version: "1.0.30001814",
    license: "CC-BY-4.0",
  },
};
for (const item of entries) {
  const review = reviewed[item.path];
  if (review?.version === item.version) {
    item.reviewedLicense = review.license;
    item.permitted = true;
  }
  if (item.license === "MIT-0") item.permitted = true;
}
const violations = entries.filter((p) => p.installed && !p.permitted);
mkdirSync("docs/implementation", { recursive: true });
writeFileSync(
  "docs/implementation/dependency-licenses.json",
  JSON.stringify(
    {
      scope:
        "Lockfile and installed packages. Optional omitted packages are inventoried but not approved for distribution.",
      entries,
      violations,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    installed: entries.filter((p) => p.installed).length,
    omitted: entries.filter((p) => !p.installed).length,
    violations,
  }),
);
if (violations.length) process.exitCode = 1;
