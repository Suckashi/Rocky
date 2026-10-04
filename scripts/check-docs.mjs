import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import "./sync-acceptance.mjs";
const p = JSON.parse(
  readFileSync("specs/rocky/implementation-plan.json", "utf8"),
);
const tasks = new Map(p.tasks.map((t) => [t.id, t]));
const requirements = new Set(p.requirements.map((r) => r.id));
const acceptance = new Set(p.acceptance.map((a) => a.id));
const visited = new Set(),
  active = new Set();
function visit(id) {
  if (active.has(id)) throw Error("Task cycle: " + id);
  if (visited.has(id)) return;
  const t = tasks.get(id);
  if (!t) throw Error("Unknown task " + id);
  active.add(id);
  for (const dep of t.dependsOn) visit(dep);
  for (const r of t.requirementIds)
    if (!requirements.has(r)) throw Error("Unknown requirement " + r);
  for (const a of t.acceptanceIds)
    if (!acceptance.has(a)) throw Error("Unknown acceptance " + a);
  if (t.status === "done" && !t.evidence.length)
    throw Error("Missing evidence " + id);
  active.delete(id);
  visited.add(id);
}
for (const id of tasks.keys()) visit(id);
// Check the public entry points, without rewriting historical engineering notes.
const publicDocs = [
  ...readdirSync(".").filter((f) => f.endsWith(".md")),
  ...readdirSync("docs")
    .filter((f) => f.endsWith(".md"))
    .map((f) => "docs/" + f),
  "docs/adr/README.md",
  "docs/implementation/README.md",
  ".github/pull_request_template.md",
];
let localLinks = 0;
for (const file of publicDocs) {
  const source = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const match of source.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
    const path = decodeURIComponent(target.split(/[?#]/)[0]);
    if (!existsSync(resolve(dirname(file), path)))
      throw Error(`Broken local link in ${file}: ${target}`);
    localLinks++;
  }
}
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (readFileSync(".node-version", "utf8").trim() !== pkg.engines.node)
  throw Error("Node version files disagree");
for (const file of [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "README.zh-TW.md",
  "SECURITY.md",
])
  if (!existsSync(file) || !pkg.files.includes(file))
    throw Error(`Required public/package file missing: ${file}`);
const workflow = parse(readFileSync(".github/workflows/verify.yml", "utf8"));
for (const job of Object.values(workflow.jobs)) {
  for (const step of job.steps ?? []) {
    if (step.uses && !/@[a-f\d]{40}$/.test(step.uses))
      throw Error(`Action must be commit-pinned: ${step.uses}`);
  }
}
for (const file of ["bug_report.yml", "feature_request.yml", "question.yml"]) {
  const form = parse(readFileSync(".github/ISSUE_TEMPLATE/" + file, "utf8"));
  if (!form.name || !form.description || !Array.isArray(form.body))
    throw Error(`Invalid issue form: ${file}`);
  const ids = form.body
    .filter((field) => field.type !== "markdown")
    .map((field) => field.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
    throw Error(`Missing or duplicate issue form IDs: ${file}`);
}
if (parse(readFileSync(".github/dependabot.yml", "utf8")).version !== 2)
  throw Error("Dependabot requires version 2");
console.log(
  JSON.stringify({
    tasks: tasks.size,
    requirements: requirements.size,
    acceptance: acceptance.size,
    dag: "valid",
    publicDocs: publicDocs.length,
    localLinks,
  }),
);
