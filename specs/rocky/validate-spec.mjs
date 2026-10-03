#!/usr/bin/env node
/**
 * Validate Rocky's specification bundle using Node built-ins only.
 * Usage: node validate-spec.mjs [--handoff] [--json]
 * --handoff additionally requires untouched pending/not_run implementation state.
 * This checks documents, not the application, its dependencies or its artwork.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const allowedArgs = new Set(['--handoff', '--json']);
const checks = [];
function check(name, valid, detail = '') {
  checks.push({ name, passed: Boolean(valid), ...(detail ? { detail } : {}) });
}
function text(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function unique(a) { return new Set(a).size === a.length; }
function sorted(a) { return [...a].sort(); }
function registryIds(rows) { return rows.map(x => x.id); }
function finish() {
  const report = {
    scope: 'specification_documents_only',
    specVersion: '2.0.0',
    runtime: process.version,
    mode: args.has('--handoff') ? 'initial_handoff' : 'ongoing_documents',
    passed: checks.every(x => x.passed),
    passedChecks: checks.filter(x => x.passed).length,
    totalChecks: checks.length,
    checks,
  };
  if (args.has('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ': ' + c.detail : ''}`);
    console.log(`\n${report.passedChecks}/${report.totalChecks} document checks passed. Application tests have NOT been executed by this script.`);
  }
  process.exitCode = report.passed ? 0 : 1;
}
try {
  check('Known CLI arguments', [...args].every(a => allowedArgs.has(a)));
  const required = ['ROCKY_GREENFIELD_SPEC.md', 'ROCKY_BOT_DESIGN_SPEC.md',
    'implementation-plan.json', 'AGENT_START_HERE.md', 'DECISIONS.md', 'README.md'];
  check('All core documents exist', required.every(f => fs.existsSync(path.join(root, f))));
  const p = JSON.parse(text('implementation-plan.json'));
  const main = text('ROCKY_GREENFIELD_SPEC.md');
  const bot = text('ROCKY_BOT_DESIGN_SPEC.md');
  const start = text('AGENT_START_HERE.md');
  const ids = {
    R: registryIds(p.requirements), T: registryIds(p.tasks),
    AT: registryIds(p.acceptance), SRC: registryIds(p.sources),
  };
  check('Spec identity and filenames', p.specVersion === '2.0.0' && p.schemaVersion === 2 &&
    p.specFile === 'ROCKY_GREENFIELD_SPEC.md' && p.designSpecFile === 'ROCKY_BOT_DESIGN_SPEC.md' &&
    main.includes('文件版本：2.0.0') && bot.includes('規格版本：2.0.0'));
  check('Expected handoff scope: 56 requirements, 38 tasks, 70 acceptance items',
    p.requirements.length === 56 && p.tasks.length === 38 && p.acceptance.length === 70);
  for (const [kind, values] of Object.entries(ids)) {
    check(`${kind} IDs unique and well formed`, unique(values) && values.every(v => new RegExp(`^${kind}-\\d{${kind === 'AT' ? 2 : kind === 'SRC' ? 2 : 3}}$`).test(v)));
  }
  for (const [key, max, width] of [['R',56,3], ['T',38,3], ['AT',70,2], ['SRC',31,2]]) {
    const expected = Array.from({ length: max }, (_, i) => `${key}-${String(i+1).padStart(width,'0')}`);
    check(`${key} sequence complete`, same(sorted(ids[key]), sorted(expected)));
  }
  const taskById = new Map(p.tasks.map(t => [t.id,t]));
  const atById = new Map(p.acceptance.map(a => [a.id,a]));
  check('Task dependencies exist and are not self-references', p.tasks.every(t =>
    unique(t.dependsOn) && t.dependsOn.every(id => id !== t.id && taskById.has(id))));
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Cycle at ${id}`);
    if (visited.has(id)) return;
    const t = taskById.get(id);
    if (!t) throw new Error(`Missing dependency ${id}`);
    visiting.add(id); t.dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
  }
  let cycleError = '';
  try { p.tasks.forEach(t => visit(t.id)); } catch(e) { cycleError = e.message; }
  check('Task dependency graph acyclic', !cycleError, cycleError);
  check('Every task has valid acceptance references', p.tasks.every(t =>
    t.acceptanceIds.length > 0 && unique(t.acceptanceIds) && t.acceptanceIds.every(id => atById.has(id))));
  check('Every acceptance item references defined requirements', p.acceptance.every(a =>
    a.requirementIds.length > 0 && unique(a.requirementIds) && a.requirementIds.every(id => ids.R.includes(id))));
  const coveredRequirements = new Set(p.acceptance.flatMap(a => a.requirementIds));
  check('Every requirement has acceptance coverage', ids.R.every(id => coveredRequirements.has(id)));
  const coveredAcceptances = new Set(p.tasks.flatMap(t => t.acceptanceIds));
  check('Every acceptance item has an owning/contributing task', ids.AT.every(id => coveredAcceptances.has(id)));
  check('Task requirements match acceptance-derived coverage', p.tasks.every(t => {
    const expected = sorted(new Set(t.acceptanceIds.flatMap(id => atById.get(id)?.requirementIds ?? [])));
    return same(sorted(t.requirementIds), expected);
  }));
  check('Every task has a local doneWhen and phase', p.tasks.every(t =>
    Array.isArray(t.doneWhen) && t.doneWhen.length > 0 && t.doneWhen.every(v => typeof v === 'string' && v.trim()) && /^P[0-8]$/.test(t.phase)));
  check('Valid task and acceptance status vocabulary',
    p.tasks.every(t => p.statusLegend.includes(t.status)) && p.acceptance.every(a => p.testStatusLegend.includes(a.status)));
  check('Completed task / passed acceptance must contain evidence',
    p.tasks.every(t => t.status !== 'done' || t.evidence.length > 0) &&
    p.acceptance.every(a => a.status !== 'passed' || a.evidence.length > 0));
  if (args.has('--handoff')) {
    check('All implementation tasks pending with no fabricated evidence',
      p.tasks.every(t => t.status === 'pending' && t.evidence.length === 0));
    check('All product acceptance not_run with no fabricated evidence',
      p.acceptance.every(a => a.status === 'not_run' && a.evidence.length === 0 && a.testFiles.length === 0));
  }
  check('Requirements table matches plan exactly', p.requirements.every(r =>
    main.includes(`| ${r.id} | ${r.title} | ${r.requirement} |`)));
  check('Acceptance table matches plan exactly', p.acceptance.every(a =>
    main.includes(`| ${a.id} | ${a.title} | ${a.requirementIds.join(', ')} | ${a.passCondition} |`)));
  check('Task table matches plan exactly', p.tasks.every(t =>
    main.includes(`| ${t.id} | ${t.phase} | ${t.title} | ${t.dependsOn.length ? t.dependsOn.join(', ') : '—'} | ${t.deliverable} | ${t.acceptanceIds.join(', ')} |`)));
  check('Main chapters 0–26 complete', same(
    [...main.matchAll(/^## (\d+)\./gm)].map(m => Number(m[1])), Array.from({length:27},(_,i)=>i)));
  check('Bot chapters B0–B10 complete', same(
    [...bot.matchAll(/^## B(\d+)\./gm)].map(m => Number(m[1])), Array.from({length:11},(_,i)=>i)));
  const allIds = new Set(Object.values(ids).flat());
  for (const f of required.filter(f => f.endsWith('.md'))) {
    const s = text(f);
    const cited = [...s.matchAll(/\b(?:R-\d{3}|T-\d{3}|AT-\d{2})\b/g)].map(m => m[0]);
    check(`${f}: defined requirement/task/test references`, cited.every(id => allIds.has(id)));
    check(`${f}: code fences paired`, [...s.matchAll(/^\s*```/gm)].length % 2 === 0);
    check(`${f}: no internal tool citation artifacts`, !/[]|turn\d+(?:file|search|view)\d+/.test(s));
    const refs = [...s.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)].map(m => m[1]);
    const missing = refs.filter(u => !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('#'))
      .filter(u => !fs.existsSync(path.resolve(root, decodeURIComponent(u.split('#')[0]))));
    check(`${f}: relative file links resolve`, missing.length === 0, missing.join(', '));
  }
  const sourceDefs = [...main.matchAll(/^\[(SRC-\d{2})\]:\s+(\S+)/gm)].map(m => [m[1],m[2]]);
  check('Source definitions unique and cover registry', unique(sourceDefs.map(x=>x[0])) &&
    same(sorted(sourceDefs.map(x=>x[0])), sorted(ids.SRC)) &&
    p.sources.every(s => sourceDefs.some(([id,url]) => id === s.id && url === s.url)));
  const sourceRefs = [...main.matchAll(/\[(SRC-\d{2})\]/g)].map(m=>m[1]);
  check('All main source references defined', sourceRefs.every(id => ids.SRC.includes(id)));
  check('Sources disclose inherited versus current verification', p.sources.every(s =>
    typeof s.verificationStatus === 'string' && s.verificationStatus.length > 0));
  check('Rocky target is greenfield; references are not baseline', p.targetRepository.name === 'Rocky' &&
    p.targetRepository.strategy === 'greenfield_no_fork_no_imported_git_history' &&
    !Object.hasOwn(p,'baselineRepository') && !Object.hasOwn(p,'baselineCommit') && p.referenceRepositories.length >= 2);
  if (args.has('--handoff')) check('Remote creation/commit not falsely claimed',
    p.targetRepository.remoteUrl === null && p.targetRepository.implementationCommit === null &&
    p.targetRepository.creationRequiresSeparateAuthorization === true);
  check('Local + Explicit Network and Node-only retained', p.fixedDecisions.deployment === 'Local + Explicit Network' &&
    p.fixedDecisions.languageRuntime.includes('no Python') && p.fixedDecisions.primaryHarness.includes('Deep Agents'));
  check('New brand tasks are required by UI and final verification', taskById.get('T-019').dependsOn.includes('T-037') &&
    taskById.get('T-035').dependsOn.includes('T-038'));
  check('No stale in-place development commands in main/start/task deliverables',
    !/請直接在 Apsis repository 開始實作|保留 Apsis 品牌與已有合法自有 avatar|48 既有自有 avatars|舊 HTTP config 可唯讀分析轉換|docs\/rebuild\/|specs\/apsis-v2\//.test(
      main + '\n' + start + '\n' + p.tasks.flatMap(t => [t.deliverable,...t.doneWhen]).join('\n')));
  check('Explicit new namespace contract exists', ['ROCKY_DATA_DIR','/api/v1','rocky.work.updated','x-rocky','productId'].every(s => main.includes(s)));
  check('Bot design is a specification, not fabricated finished artwork',
    bot.includes('不是已產出的最終插畫') && bot.includes('Learning') && bot.includes('reduced') && bot.includes('personaVersion'));
} catch (error) {
  check('Validation execution completed without exception', false, error instanceof Error ? error.message : String(error));
}
finish();
