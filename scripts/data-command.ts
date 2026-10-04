import {
  createBackup,
  restoreBackup,
  verifyBackup,
} from "../apps/daemon/src/backup.js";
const [action, ...args] = process.argv.slice(2);
const options = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index],
    value = args[index + 1];
  if (
    !key ||
    !["--source", "--destination"].includes(key) ||
    !value ||
    options.has(key)
  )
    throw Error(
      "Use backup|restore|verify --source <Rocky path> [--destination <new empty directory>]",
    );
  options.set(key, value);
}
try {
  const source = options.get("--source"),
    destination = options.get("--destination");
  if (
    !source ||
    !["backup", "restore", "verify"].includes(action ?? "") ||
    (action !== "verify" && !destination)
  )
    throw Error(
      "Explicit source and destination are required; stop Rocky before backup",
    );
  const result =
    action === "backup"
      ? await createBackup(source, destination!)
      : action === "restore"
        ? await restoreBackup(source, destination!)
        : await verifyBackup(source).then((manifest) => ({
            productId: manifest.productId,
            status: "verified",
            schemaVersion: manifest.schemaVersion,
            fileCount: manifest.fileCount,
            totalBytes: manifest.totalBytes,
          }));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Rocky data command failed",
  );
  process.exitCode = 1;
}
