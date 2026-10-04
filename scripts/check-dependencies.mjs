import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const levels = ["moderate", "high", "critical"];
const { exceptions } = JSON.parse(
  readFileSync("docs/implementation/dependency-audit-exceptions.json", "utf8"),
);
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const today = new Date().toISOString().slice(0, 10);

const audit = spawnSync(
  "npm audit --json --registry=https://registry.npmjs.org",
  { encoding: "utf8", shell: true },
);
let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  report = undefined;
}
if (!report?.vulnerabilities) {
  console.error("npm audit did not return a report; failing closed.");
  console.error(audit.stderr || audit.stdout);
  process.exit(1);
}

const lockedVersions = (name) =>
  new Set(
    Object.entries(lock.packages)
      .filter(([path]) => path.endsWith("node_modules/" + name))
      .map(([, entry]) => entry.version),
  );
const ghsa = (url) => url.split("/").pop();

const found = new Map();
for (const entry of Object.values(report.vulnerabilities))
  for (const via of entry.via)
    if (typeof via === "object" && levels.includes(via.severity))
      found.set(ghsa(via.url) + " " + via.name, via);

const failures = [];
const used = new Set();
for (const [key, via] of found) {
  const exception = exceptions.find(
    (e) => e.advisory + " " + e.package === key,
  );
  if (!exception) {
    failures.push(`${via.severity} ${key}: ${via.title} (${via.url})`);
    continue;
  }
  used.add(exception);
  const versions = lockedVersions(exception.package);
  if (versions.size !== 1 || !versions.has(exception.version))
    failures.push(
      `${key}: exception covers ${exception.version}, lockfile has ${[...versions].join(", ")}`,
    );
  if (exception.reviewBy < today)
    failures.push(`${key}: exception review expired on ${exception.reviewBy}`);
}
for (const exception of exceptions)
  if (!used.has(exception))
    failures.push(
      `${exception.advisory} ${exception.package}: stale exception, advisory no longer reported`,
    );

for (const exception of used)
  console.log(
    `excepted ${exception.severity} ${exception.advisory} ${exception.package}@${exception.version} until ${exception.reviewBy}`,
  );
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`dependency audit passed with ${used.size} documented exceptions`);
