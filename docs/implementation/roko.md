# Roko integration and V1 continuation — 2026-10-04

Roko now renders in the existing Rocky conversation/welcome Presence and static
sidebar assistant entry. The app shell, composer, cards, colors and product name
remain the existing Rocky UI. The old avatar SVG and CSS motion were removed;
the product mark/favicon remain. No demo route, new runtime, dependency, model
call, pet database or gaze tracking was added.

## Implementation

- `assets/roko/roko-spritesheet.png` is the unchanged owner-supplied PNG. Its
  SHA-256 is `0d47eb7f7495849818b8285fee2df7722ba76a8e8f22145cb147817516cf0ef3`.
  One 3,057,640-byte source atlas is tracked. Build output is ignored. The runtime
  manifest preserves the supplied used columns and original provenance; artwork
  rights are separate from the Apache-2.0 source license, including in the package.
- `roko-animation.ts` derives source rectangles from the manifest. Fixed 192 × 208
  cells retain the jump height/baseline; each row uses its actual frame count.
  Timing is elapsed-time based at 8 FPS, an integration decision.
- `roko-sprite.tsx` draws with Canvas 2D, using one shared decoded image promise.
  It loads when visible, keeps a fixed aspect ratio, and pauses offscreen/hidden or
  under reduced motion. A failed image leaves readable Roko text without retries.
  Frame updates do not render the React conversation tree.
- Existing Work/run/session evidence drives Presence. Actual model request
  admission now emits a persisted `rocky.model.started` with request identity;
  tool/model end evidence retires that activity. Text distinguishes model response,
  tools, file reads and change review. Queues, approval, stale/offline and terminal
  states remain static. Background counts and approval controls remain independent.
- New confirmed foreground completion plays jumping once (625 ms), then idle.
  Existing event-sequence/run deduplication and snapshot watermarks suppress history.
  A WeakSet of feedback objects also suppresses presentation remount replay.
  SSE reconnect now refreshes the snapshot watermark before accepting live events.
  A newer failure/approval or disabled motion takes precedence over celebration.

## Concentrated Windows verification

Windows x64, Node 24.12.0, npm 11.6.4. Typecheck, lint, build and package guard
passed. Build retains the existing large-chunk warnings. Related unit/service
tests: 19 passed. The additional model-start persistence assertion passed in the
three configured-work tests. The new `npm run test:recovery` command passes all
34 persistence/worker/inbox/ledger/backup tests.

Browser coverage uses installed Chromium 1223 (compatibility override, not the
pinned-browser acceptance); the final focused run passed 9/9 tests. Actual daemon/loopback-provider tests cover approval,
artifact completion once, background attention and reconnect. Production UI with
explicit transport fixtures covers running, waiting approval, failed, replay,
reload, reconnect, reduced motion, user toggle, offscreen and synthetic hidden
visibility. A StrictMode component lifecycle fixture proves remount suppression;
an aborted image request proves fallback and one shared request. Desktop/light,
320px/dark, English, keyboard and 200% zoom were inspected in browser tests.

Initial fixture failures were corrected rather than attributed to the product:
the transport fixture omitted required conversation metadata, and the remount
fixture initially imported a CommonJS interop export incorrectly. Reports retain
these failures. This is focused verification, not a fresh whole-repository suite.
OS-native background-tab suspension, low-end device benchmarks, optional gaze,
Ubuntu browser and live provider acceptance are not established by this evidence.

## Continuing the existing V1 plan

The current plan already contains implemented Browser profiles, Routines,
Learning evaluation/Inbox and Backup paths. This pass continues T-034 with the
missing recovery command and required packaged Roko assets/provenance checks.
It also rechecks the previously unavailable Ubuntu environment using WSL 2 and
an isolated, checksum-verified official Node runtime. Ubuntu 24.04.5 x64 / WSL 2
passed all five no-Python steps (install, check, build, core tests, Learning), with
zero forbidden-tool attempts. Another clean Ubuntu copy passed 24 MCP tests and
one owned-process-tree test. T-002 and T-015 can now close their platform gaps;
AT-01/AT-04 record this as scoped fixture evidence, not bare-metal/desktop proof.
The initial Linux follow-up found that WSL had cleared `/tmp` after shutdown;
the successful MCP run uses a separate persistent user-cache copy.
No system Node, security software, browser
profile, remote repository or deployment setting was changed.

The refreshed registry audit still reports 7 high, 0 moderate, 0 critical entries.
Latest checked braces 3.0.3 and node-forge 1.4.0 do not resolve the recorded root
advisories. No dependency downgrade or gate waiver was applied. Container engine
and authorized live-endpoint acceptance remain unavailable. See the
[verification record](evidence/2026-10-04/roko/verification.json) for exact commands,
platforms, statuses and remaining gates.
