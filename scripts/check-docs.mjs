import { readFileSync } from "node:fs";
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
console.log(
  JSON.stringify({
    tasks: tasks.size,
    requirements: requirements.size,
    acceptance: acceptance.size,
    dag: "valid",
  }),
);
