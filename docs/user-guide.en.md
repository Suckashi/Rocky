# Rocky user guide

Rocky stores Works, approvals, documents, memory, skills and Learning data locally. You explicitly configure model and MCP connections. Core installation and standard Learning fixtures require Node/npm, with no Python, container or commercial platform account.

## Install and start

Use Node 24.12.0 and npm 11.6.4. In a source checkout run `npm ci`, `npm run build`, `npm run doctor`, then `npm start`. Open `http://127.0.0.1:3211`; `npm run dev` serves the development UI on 3210. Doctor reads metadata without model calls, browser launches, migrations or configuration changes.

Production data defaults to `%LOCALAPPDATA%/Rocky` on Windows or `$XDG_DATA_HOME/rocky` on Linux (`~/.local/share/rocky` otherwise). Set `ROCKY_DATA_DIR` in the daemon process environment to choose a fresh Rocky directory. Development defaults to `.rocky-dev`. Foreign manifests, unknown nonempty roots and future database schemas are rejected without conversion or deletion.

A prebuilt local package containing `dist` can install runtime dependencies with `npm ci --omit=dev --omit=optional`, then `npm start`. Building source needs development dependencies. Installation instructions do not establish cross-platform validation; Ubuntu evidence remains separately tracked.

## Models, Works and approvals

Select a provider, exact endpoint, model ID, trusted context limit and output limit in Settings. Credentials are environment-variable references, never inline secrets. The first-run setup can store a key in the optional local `secrets.env` in the data directory (unencrypted, mode 0600); explicit process environment variables always take precedence, and the API only ever returns key names. Proxy and CA policies belong to each connection; Rocky does not change system DNS, proxy or TLS settings. Probes and configured work make real requests and may incur charges. Cost remains unknown without trusted prices; call/token/cost budgets are separate.

Before submitting, choose workspace/read scope and optional isolated environment or browser origins/shared profile. Native children share root budgets and permission boundaries. Approvals bind exact arguments and targets. Rejection cannot be bypassed with another tool. Stop does not undo effects already dispatched; unknown outcomes need receipt reconciliation and remain unknown when no trustworthy observer exists.

Steering applies at the next confirmed native checkpoint, not at receipt time. New steering supersedes an outstanding approval. Terminal, Files, Activity and Browser share Work selection; use Work/Run/Operation identities to inspect actual status, stdout, stderr and errors.

## Documents and attachments

Create documents independently, save immutable revisions, browse history and download content. Model document writes require exact content approval. Text/Markdown/PNG/JPEG uploads are validated and bound by immutable version/hash to a Work or steering command. Images have byte/pixel/decode deadlines; a non-vision model receives an explicit unavailable result. See [attachments](attachments.md).

## Computer and continuing work

Native commands have local OS authority and are not sandboxed. An isolated environment requires an owner-installed local engine, a pinned image digest and an explicit workspace. Rocky does not install engines, pull images automatically or fall back to host execution. See [environments](environments.md).

Optional `npm run setup -- browser` downloads the pinned Chromium. Browser profiles are clean and Rocky-owned unless explicitly shared. Snapshots include profile/environment/page identity and freshness. Taking control fences agent actions for that profile; release requires a fresh snapshot. Application origin restrictions are not proof of complete OS-level egress isolation. See [browser](browser.md).

[Routines](routines.md) use IANA timezones, cron/interval schedules, skip/coalesce-one and durable occurrence dedupe. Each occurrence creates an independent background Work. Sleeping devices do not promise execution. [Tracking](tracking.md) uses only an owner-configured, explicitly confirmed read-only MCP tool, bounded polls/follow-ups and cooldown. It never automatically merges, deploys or expands repository scope.

## Memory, Skills and Learning

Memory scopes are user/project/task; private reads need separate consent. Owner edits lock entries. Source changes or deletion invalidate related live context while retaining required checkpoints and operation evidence.

External `.agents/skills` sources are imported as fixed untrusted snapshots, reviewed and published by exact revision. Updates preserve source identity. Compare versions, roll back, deactivate or quarantine in Skills. Each Work freezes a catalog; actual loads are recorded. Skill prose grants no permissions.

Learning defaults to off. Propose requires scope consent, a reflection model, a fixed evaluation suite and budgets; each source Work must also permit reuse. Eligible work flows through reviewed evidence, restricted reflection, real candidates, complete-runtime evaluation and the Inbox. Editing invalidates evaluations. Publication requires a passing gate and exact human approval. Withdrawal clears related derivatives and isolates affected skills; it cannot recall data already delivered to a third-party model. See [Learning](learning.md).

## Data protection and limitations

Use [backup/restore](backup.md) after stopping the daemon. Restore requires a fresh empty directory, expires approvals, revokes grants and disables automation without replaying unknown effects. Backups contain private data and must be protected. External workspaces and environment credentials are not silently copied.

Windows concentrated verification covers the connected implementation, including real local fixture Works, candidate evaluation/publication, documents, attachments, owned browser profiles, restore and storage faults. Container Browser transport is unavailable; actual container-engine compatibility, Ubuntu Node-only, clean browser egress and live-provider acceptance remain unverified. Unresolved upstream dependency advisories keep the security gate open. See the implementation ledger and [security notes](../SECURITY.md). Fixture success never proves a real provider, website or platform passed.

If the daemon reports execution-storage degradation, repair the storage problem and restart it, then reconcile unknown effects. The UI retains the last confirmed state and does not convert a missing completion record into success.
