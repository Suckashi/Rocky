# Development and verification

## Environment

Use the versions in `.node-version` and `package.json`: Node 24.12.0 and npm 11.6.4. The repository uses npm workspaces and a committed lockfile. `.npmrc` pins new dependencies exactly and omits optional dependencies to preserve the Node-only installation path.

```sh
npm ci
npm run dev
```

The UI uses port 3210 and the daemon uses 3211. Stop other Rocky instances before browser tests; tests start their own server and data root. Set `ROCKY_DATA_DIR` in the process environment only when you intentionally want a different data directory. The app does not promise automatic `.env` loading.

## Commands

| Command                                    | Purpose                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                            | TypeScript checking                                                                                                             |
| `npm run check:docs`                       | Task DAG, public documentation links, and community metadata                                                                    |
| `npm run docs:status`                      | Refresh the acceptance table from the existing plan                                                                             |
| `npm run lint` / `npm run format:check`    | Lint and formatting                                                                                                             |
| `npm test`                                 | Unit and service integration suite                                                                                              |
| `npm run test:contract`                    | Shared contracts, projection, and HTTP tests                                                                                    |
| `npm run test:recovery`                    | Persistence faults, worker restart, inbox, ledger, and backup fixtures                                                          |
| `npm run build`                            | Compile runtime, copy assets, and build the UI                                                                                  |
| `npm run doctor`                           | Read local prerequisites and configuration metadata                                                                             |
| `npm run test:learning`                    | Deterministic Learning evaluation through the actual runtime                                                                    |
| `npm run test:network`                     | Network policy tests and fixture evaluation audit                                                                               |
| `npm run test:no-python`                   | Restricted-PATH clean-copy install/build/core/Learning verification                                                             |
| `npm run test:no-python -- --install-only` | Restricted-PATH clean-copy install, typecheck, and build only; full AT-01 evidence still requires the default five-step command |
| `npm run setup:browser`                    | Download pinned Chromium; explicit network operation                                                                            |
| `npm run test:e2e`                         | Browser suite with independent fixture state                                                                                    |
| `npm run check:licenses`                   | Refresh and validate installed dependency license inventory                                                                     |
| `npm run check:dependencies`               | Registry advisory scan; fails at moderate severity or above                                                                     |
| `npm run check:secrets`                    | Source path, size, and secret-pattern guard                                                                                     |
| `npm run check:package`                    | Source/history guard and actual npm package inventory; build first                                                              |

Focused tests use `npx vitest run tests/<name>.test.ts` or `npx playwright test tests/e2e/<name>.spec.ts`. Format changed files with the installed Prettier (`npx prettier --write <paths>`).

## Test modes and evidence

Fixtures run the real local services with scripted providers and synthetic inputs. They do not prove live provider compatibility. A browser executable override is diagnostic evidence and does not satisfy the pinned-browser gate. Tests must not use production profiles or credentials.

Install the optional pinned browser with `npm run setup:browser` before running the native browser integration test. `npm test` skips that single case if no browser executable is available; CI installs Chromium first so the case runs there. A local `ROCKY_TEST_BROWSER` override must be recorded as compatibility evidence.

The normal browser suite starts with reconciliation fixtures and intentionally skips the empty-installation case. Run `npm run test:e2e -- tests/e2e/empty-install.spec.ts` separately with `ROCKY_E2E_EMPTY=1` in that process's environment. Restore the variable afterwards before a normal suite run. CI runs both modes. Do not run unit/integration workloads at the same time as the browser performance measurement.

Record commands, exit codes, Node version, operating system, relevant revision, lockfile hash, and scope limits. Keep initial failure records when documenting a repaired run. An aggregate of focused reruns must be labeled as such; it is not a fresh full-suite result.

The [implementation ledger](../specs/rocky/implementation-plan.json) holds acceptance statuses. See [evidence conventions](implementation/README.md). The current open gates are listed in the [roadmap](ROADMAP.md).

## CI

[Verify](../.github/workflows/verify.yml) runs Ubuntu verification and a separate dependency-audit job for pull requests. Pushes to main, the daily 03:17 UTC schedule, and manual dispatch run both Ubuntu and Windows verification. CI uses the install-only no-Python check because unit tests and Learning fixtures already run in the same job; the default five-step command remains the AT-01 acceptance check. Actions are pinned to commit SHAs, permissions are read-only, and no deployment credentials are needed. Failed dependency checks remain failures even if functional tests pass.

Workflow files are source configuration. GitHub execution and branch protection are established only after repository creation and successful hosted runs. No current local result stands in for that evidence.
