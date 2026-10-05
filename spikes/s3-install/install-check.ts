// S3: install the planned dependency tree with `npm ci` and prove nothing was compiled.
// Fails on: an install script outside the allowlist, any binding.gyp, any addon built into
// build/Release, node-gyp / prebuild / cmake output, or an outbound host other than npm.
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { startHostLog } from '../s1-acp/host-log.ts';

const here = import.meta.dirname;

/** Packages allowed to have install scripts, and why each is harmless. */
const ALLOWED_SCRIPTS: Record<string, string> = {
  '@scarf/scarf':
    'install telemetry from CopilotKit; off via scarfSettings.enabled=false',
  fsevents: 'macOS only; never installed on Windows or Linux',
};

function npmCli(): string {
  // Run npm through node itself: npm.cmd on Windows would need a shell.
  const bin = dirname(process.execPath);
  const candidates = [
    join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });
  if (!found)
    throw new Error(`npm-cli.js not found next to ${process.execPath}`);
  return found;
}

function walk(dir: string, visit: (path: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walk(path, visit);
    else visit(path);
  }
}

const failures: string[] = [];
rmSync(join(here, 'node_modules'), { recursive: true, force: true });

const hostLog = await startHostLog(process.env['HTTPS_PROXY']);
const started = Date.now();
const env: Record<string, string> = { ...process.env } as Record<
  string,
  string
>;
for (const key of Object.keys(env)) {
  if (
    /^(https?_proxy|no_proxy|npm_config_(https?-)?proxy|npm_config_noproxy)$/i.test(
      key,
    )
  )
    delete env[key];
}
env['npm_config_https_proxy'] = hostLog.url;
env['npm_config_proxy'] = hostLog.url;
env['npm_config_noproxy'] = '';
// Install scripts run plain node; make their requests go through the same logging proxy.
env['HTTPS_PROXY'] = hostLog.url;
env['HTTP_PROXY'] = hostLog.url;
env['NODE_USE_ENV_PROXY'] = '1';
// Without this, npm's own CONNECT to the local proxy would be sent through the proxy again.
env['NO_PROXY'] = '127.0.0.1,localhost';
if (process.env['ROCKY_S3_FRESH_CACHE'] === '1') {
  env['npm_config_cache'] = mkdtempSync(join(tmpdir(), 'rocky-s3-npm-cache-'));
}
// Async on purpose: spawnSync would block the event loop that serves the logging proxy.
const install = await new Promise<{ status: number | null; output: string }>(
  (resolve) => {
    const child = spawn(
      process.execPath,
      [npmCli(), 'ci', '--foreground-scripts', '--no-audit', '--no-fund'],
      { cwd: here, env },
    );
    let output = '';
    child.stdout
      .setEncoding('utf8')
      .on('data', (text: string) => (output += text));
    child.stderr
      .setEncoding('utf8')
      .on('data', (text: string) => (output += text));
    child.on('close', (status) => resolve({ status, output }));
  },
);
const seconds = (Date.now() - started) / 1000;
await hostLog.close();
const { output } = install;
if (install.status !== 0) failures.push(`npm ci exited ${install.status}`);
for (const pattern of [
  /node-gyp/i,
  /gyp info/i,
  /prebuild-install/i,
  /node-pre-gyp/i,
  /cmake/i,
]) {
  if (pattern.test(output)) failures.push(`install output mentions ${pattern}`);
}
if (/scarf/i.test(output) && /analytics|statistics/i.test(output)) {
  failures.push('Scarf ran its analytics prompt');
}

const lock = JSON.parse(
  readFileSync(join(here, 'package-lock.json'), 'utf8'),
) as {
  packages: Record<string, { version?: string; hasInstallScript?: boolean }>;
};
const scripts = Object.entries(lock.packages)
  .filter(([, info]) => info.hasInstallScript)
  .map(([path]) => path.replace(/^.*node_modules\//, ''));
for (const name of scripts) {
  if (!(name in ALLOWED_SCRIPTS))
    failures.push(`unexpected install script: ${name}`);
}

const gyp: string[] = [];
const built: string[] = [];
const prebuilt: string[] = [];
let bytes = 0;
walk(join(here, 'node_modules'), (path) => {
  bytes += statSync(path).size;
  const rel = relative(here, path).split(sep).join('/');
  if (rel.endsWith('/binding.gyp')) gyp.push(rel);
  if (rel.endsWith('.node')) {
    (/\/build\/(Release|Debug)\//.test(rel) ? built : prebuilt).push(rel);
  }
});
if (gyp.length) failures.push(`binding.gyp present: ${gyp.join(', ')}`);
if (built.length)
  failures.push(`addons compiled during install: ${built.join(', ')}`);
const hosts = [...hostLog.hosts];
const unexpected = hosts.filter((host) => host !== 'registry.npmjs.org');
if (unexpected.length)
  failures.push(`unexpected hosts during npm ci: ${unexpected.join(', ')}`);

console.log('--- S3 install report ---');
console.log(`node ${process.version} on ${process.platform}-${process.arch}`);
console.log(`npm ci: exit ${install.status}, ${seconds.toFixed(1)} s`);
console.log(`packages in lockfile: ${Object.keys(lock.packages).length - 1}`);
console.log(`node_modules size: ${(bytes / 1024 / 1024).toFixed(0)} MiB`);
console.log(
  `install scripts: ${scripts.map((s) => `${s} (${ALLOWED_SCRIPTS[s] ?? 'NOT ALLOWED'})`).join('; ') || 'none'}`,
);
console.log(`binding.gyp files: ${gyp.length}`);
console.log(`prebuilt native addons: ${prebuilt.join(', ') || 'none'}`);
console.log(
  `hosts contacted by npm: ${hosts.join(', ') || 'none (all from cache)'}`,
);
if (failures.length) {
  console.log(`FAIL:\n- ${failures.join('\n- ')}`);
  console.log(output.slice(-4000));
  process.exit(1);
}
console.log('PASS: no compiler, no Python, no telemetry');
