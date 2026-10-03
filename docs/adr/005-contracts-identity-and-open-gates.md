# ADR-005: Continue local P1 with explicit open P0 gates

Accepted 2026-10-03. The user explicitly instructed: resolve the blockers if possible; otherwise continue implementing features. This authorizes local downstream development while preserving the failed/unrun gates. It does not authorize remote creation, push, deployment, installing WSL, disabling AdGuard, or marking P0 passed.

T-005 uses strict Zod Work/Approval/error/identity schemas and a Rocky public event envelope. AG-UI payloads validate against the pinned official schema; domain payload names belong to rocky.*. Sequence cursors stay decimal strings through SQLite and JavaScript, including values above the safe-integer limit. IPC has a bounded wire schema; it has no active worker transport or authorization broker yet (T-009).

GET /api/v1/snapshot reads works, the latest 500 evidence events and the high-water cursor in one transaction. The UI installs that snapshot before subscribing to later events. SSE reconnect prefers Last-Event-ID over the original URL cursor. The client deduplicates event IDs and refuses older Work revisions. This is not the full conversation history/outbox/retention implementation.

Only Rocky's own P0 event records are upgraded transactionally to payload envelopes. Missing old runMode is recorded as unknown, rather than inventing whether an old run was evaluation or normal. Old missing executionSessionId uses its existing runId as the original isolated session identity. Foreign product roots remain refused. A newer database version fails closed and releases its lock.

T-037 introduces original editable five-limb stone SVG geometry, a smaller mark, monochrome mark and favicon. No external illustration, upstream code or film media was copied. A stable assistant UUID lives in Rocky's store; persona 1.0.0 is trusted application text and does not change tool grants. Existing synthetic-only onboarding stays explicit in both languages. Assets remain static until T-038; no unsupported success or busy animation is shown.

The local visual baseline has actual 24/32/48/96px, light/dark, mobile, reduced-motion and zoom render evidence. Rights review remains pending and user approval of final art is not claimed. Text-token contrast checks cover selected pairs, not every accessibility criterion. Avatar source plus the entire app entry and tokens is below the 100KiB incremental-source bound; local cold/warm resource timings are recorded, without claiming a low-end-device benchmark.
