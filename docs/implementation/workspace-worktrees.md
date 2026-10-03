# Exact-approved native worktrees

Source 682b5c3fd2c2d6fc3765c4efed4cefa6d19cf7e0, Windows x64, Node24.12.0, fixture mode. T-017 remains in_progress.

## Implemented path

Root-only workspace_worktree accepts no model-supplied path/branch/command. WorkspaceWorktrees resolves the bound registered revision and prepares an application-owned sibling directory and codex/rocky branch from committed HEAD. The daemon binds source identity/configuration/HEAD, destination snapshot, Work/run/session, model revision and policy to exact consent. Native children cannot use this tool. The shared operation ledger authorizes and claims the target before dispatch; it does not infer completion from the stream.

After Git verifies the destination HEAD/branch, the daemon registers the generated root and persists a succeeded receipt. The source Workspace and current Work remain unchanged. The receipt records source/new workspace IDs, revisions, branch and HEAD. No read permission is inherited. Owner selects the new root for a future Work. Dirty/untracked source files are excluded. If Git succeeds but registration fails, outcome remains unknown, Work is blocked and the directory is retained for inspection; no automatic rollback/replay or deletion.

## Interface

The existing OpenDots PageReview-derived approval card displays destination, branch, HEAD and impact, using existing semantic tokens, card/action styles and snapshot/command adapter. No additional polling/runtime/service was added. Native tool description and approval explicitly explain scope and committed-only checkout. No new upstream source/assets were copied.

## Actual validation

[Machine-readable evidence](evidence/2026-10-04/workspace-worktrees/verification.json). Related26 tests pass; final native6 covers approve/reject/stale/child/cancel/post-Git registration failure. Six normal-daemon browser flows pass, including new worktree flow, MCP/data, native reads/writes and workspace browsing. Type/lint/build/format/diff pass. Browser fixture uses scripted provider responses but actual native runtime, daemon consent, local Git and filesystem effects; no fake product activity.

Screenshots: [1440](evidence/2026-10-04/workspace-worktrees/workspace-worktree-1440.png), [1280](evidence/2026-10-04/workspace-worktrees/workspace-worktree-1280.png), [390](evidence/2026-10-04/workspace-worktrees/workspace-worktree-390.png), [320](evidence/2026-10-04/workspace-worktrees/workspace-worktree-320.png), [320 scrolled actions](evidence/2026-10-04/workspace-worktrees/workspace-worktree-320-actions.png). Four widths have no full-page horizontal overflow; keyboard Enter confirms the effect, and mobile actions are in viewport after scrolling. Manually inspected1440/320/320-actions. These are functional adaptation screenshots, not a new matched upstream comparison.

## Remaining work

- Explicit root-only worktree tool implemented; background coding default/routing is not implemented
- Current Work retains source workspace and read scope; generated root must be selected for a future Work
- Main Git repository sources only; linked worktree sources, non-Git isolation and configured filters unsupported
- No automatic cleanup, branch deletion, merge, remote access or replay; full unknown reconciliation UI remains pending
- Windows fixture integration and Chromium148 evidence only; Ubuntu/live provider/full power-loss or hostile filesystem race proof not_run
- Worktree-specific dark/English matrix and fresh matching upstream comparison not_run; existing OpenDots-derived approval structure reused
- New workspace source linkage is in the immutable operation receipt; richer managed workspace metadata/library display remains pending

Full shell/artifact/Computer/Skills/Learning/backup/packaging and other V1 tasks remain open. All70 global AT unchanged; no remote action. Goal active.
