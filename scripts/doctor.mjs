import { existsSync, readFileSync, lstatSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--data-dir"))
  throw Error("Usage: npm run doctor -- [--data-dir <Rocky directory>]");
const root = resolve(
  args[1] ??
    process.env.ROCKY_DATA_DIR ??
    (process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? homedir(), "Rocky")
      : join(
          process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
          "rocky",
        )),
);
const report = {
  productId: "rocky",
  platform: process.platform,
  arch: process.arch,
  node: {
    actual: process.version,
    required: pkg.engines.node,
    matches: process.version === `v${pkg.engines.node}`,
  },
  npm: {
    required: pkg.engines.npm,
    actual:
      process.env.npm_config_user_agent?.match(/npm\/([^ ]+)/)?.[1] ??
      "unknown",
  },
  installed: existsSync(new URL("../node_modules/", import.meta.url)),
  built: existsSync(
    new URL("../dist/apps/daemon/src/main.js", import.meta.url),
  ),
  data: { path: root, status: "not_initialized" },
  networkProbes: "not_run",
  modelCalls: 0,
  browserLaunch: "not_run",
  environmentEngineLaunch: "not_run",
  ubuntuEvidence: "not_run",
  browserOverride: !!process.env.ROCKY_TEST_BROWSER,
};
let db;
try {
  if (existsSync(root)) {
    for (let current = root; ; current = dirname(current)) {
      if (lstatSync(current).isSymbolicLink())
        throw Error("linked_data_directory");
      if (dirname(current) === current) break;
    }
    if (lstatSync(root).isSymbolicLink()) throw Error("linked_data_directory");
    const manifestPath = join(root, "manifest.json");
    if (!existsSync(manifestPath))
      throw Error("unknown_directory_no_database_read");
    const stat = lstatSync(manifestPath);
    if (stat.isSymbolicLink() || stat.size > 65536 || !stat.isFile())
      throw Error("invalid_manifest_no_database_read");
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      throw Error("invalid_manifest_no_database_read");
    }
    if (manifest.productId !== "rocky" || manifest.schemaVersion !== 1)
      throw Error("foreign_or_unsupported_manifest_no_database_read");
    if (
      [".restore-incomplete", ".backup-incomplete", "rocky-backup.json"].some(
        (name) => existsSync(join(root, name)),
      )
    )
      throw Error("backup_or_incomplete_restore_not_active_store");
    const path = join(root, "domain.sqlite");
    if (!existsSync(path)) throw Error("rocky_database_missing");
    if (lstatSync(path).isSymbolicLink())
      throw Error("linked_database_not_read");
    db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
    const version = db.prepare("PRAGMA user_version").get().user_version;
    const schemaModule = new URL(
      "../dist/apps/daemon/src/storage-metadata.js",
      import.meta.url,
    );
    const schemaSource = existsSync(schemaModule)
      ? schemaModule
      : new URL("../apps/daemon/src/storage-metadata.ts", import.meta.url);
    const supported = Number(
      readFileSync(schemaSource, "utf8").match(
        /STORE_SCHEMA_VERSION\s*=\s*(\d+)/,
      )?.[1],
    );
    if (!supported || version < 1 || version > supported)
      throw Error("unsupported_database_schema_metadata_not_read");
    // Read metadata only: no migration, startup recovery, credentials or networking.
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name),
    );
    const count = (table) =>
      tables.has(table)
        ? db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count
        : null;
    const connections = tables.has("model_connections")
      ? db
          .prepare("SELECT data FROM model_connections")
          .all()
          .map((row) => JSON.parse(row.data))
      : [];
    const learning = tables.has("learning_policy")
      ? db.prepare("SELECT data FROM learning_policy WHERE id=1").get()
      : null;
    report.data = {
      path: root,
      status: "read_only_metadata",
      schemaVersion: version,
      daemonLockPresent: existsSync(join(root, "daemon.lock")),
      works: count("works"),
      documents: count("documents"),
      skills: count("skill_heads"),
      modelConnections: connections.length,
      unavailableCredentialReferences: connections.filter(
        (item) =>
          item.config.credentialRef && !process.env[item.config.credentialRef],
      ).length,
      missingContextLimits: connections.filter(
        (item) => !item.config.contextWindowTokens,
      ).length,
      learning: learning ? JSON.parse(learning.data).mode : "off",
      environmentConfigurations: count("environments"),
      browserProfiles: count("browser_profiles"),
    };
  }
} catch (error) {
  report.data = {
    path: root,
    status: "unavailable",
    reason:
      error instanceof Error && /^[a-z_]+$/.test(error.message)
        ? error.message
        : "metadata_read_failed",
  };
  process.exitCode = 1;
} finally {
  db?.close();
}
if (!report.node.matches || !report.installed) process.exitCode = 1;
console.log(JSON.stringify(report, null, 2));
