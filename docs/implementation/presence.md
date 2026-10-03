# Rocky confirmed-state presence

Source 3d49ea33c52966c58b893e6bd128f49805c13ef7. T-038 in_progress.

Pure deriveRockyPresence reads authoritative Work/event projections. Latest main Work state stays independent from normal background running/queued/approval/attention counts; evaluation records excluded. Failure/cancel/interruption/blocked/completed labels remain distinct. A connection interruption freezes motion without rewriting Work state. Progress must match Work/run and an explicit model/tool/subagent progress event; heartbeat is excluded. Evidence older than60seconds stops working motion.

RockyPresence uses the original50px avatar and existing compact header geometry. Working motion translates1px over3seconds; reduced motion, manual preference or hidden tab disables it. Preference is localStorage-backed with session fallback. A single5second visible-tab clock refreshes staleness; hidden tabs stop it. No per-card timers, remote asset or new domain authority. Historical completed records remain static. Replaced old header CSS is removed.

[Verification](evidence/2026-10-04/presence/verification.json):6 pure/projection tests and1 real daemon browser flow pass. Deterministic clock covers60second boundary, heartbeat exclusion, run mismatch, independent counts, terminal states and motion flags. Browser verifies pending approval, completed status, keyboard preference, reload persistence, reduced motion and existing four-width native artifact flow. Type/lint/build/format/diff pass; existing build-size/SQLite/startup warnings remain.

Screenshots: [1440](evidence/2026-10-04/presence/artifact-card-1440.png), [1280](evidence/2026-10-04/presence/artifact-card-1280.png), [390](evidence/2026-10-04/presence/artifact-card-390.png), [320](evidence/2026-10-04/presence/artifact-card-320.png).320 inspected. These are after-only functional evidence, not fresh upstream parity comparison.

## Remaining

- T-038 partial: one-time live completion feedback/de-duplication and connection last-confirmed timestamp remain unimplemented
- Background counts are visible, but direct navigation to each background attention record remains pending
- Resource-waiting detail is not yet distinguished from queued state
- Hidden/reduced flags tested in pure function; actual hidden-tab lifecycle and complete motion timing/browser matrix not_run
- No progress evidence renders a conservative no-recent-progress state; with evidence, stale threshold is60seconds and UI clock samples every5seconds while visible
- Cold/warm/avatar bundle measurement, English/dark/24px matrix and matched OpenDots comparison pending
- No Learning capability-improvement claim, new runtime/job/status database or global acceptance pass

All70 global AT remain not_run. Goal active; no remote actions.

## Completion feedback and sync freshness (05f77122594122b0be2eb3c9fb2933b4dc00af68)

Snapshot cursor seeds the event watermark; completed Run identities seed suppression. Fresh matching main normal completed Work events can trigger one600ms2% scale response. Replayed/older events, repeated completed-run updates, background/evaluation work and unsuccessful states do not. Suppressed motion is consumed, not queued for later. Last-confirmed sync records receipt of validated snapshot/event independently from progress evidence. Browser offline closes the stream and preserves last state/time; online resnapshots.

7 pure/projection tests and focused browser1 pass. Browser observed new completion animation count1, history reload0, offline timestamp with unchanged Work status and online reconnect0. Initial offline test exposed delayed SSE error; browser network events now handle it. Type/lint/build/format/diff pass. [Evidence](evidence/2026-10-04/presence-feedback.json). Completion/freshness gaps in the earlier section are superseded; remaining background/resource/performance/full-platform scope stays open.

## Background navigation (1f1dac70310d3253147d79aa7bccf1aefee459d0)

Background counts now expand a bounded list of actual running/queued/approval/attention records. Keyboard/pointer selection reveals the exact normal Work from existing projection, focuses its article and scrolls the transcript to it. Selection closes the summary; foreground presence is unchanged. Historical background records excluded from initial visible history can be revealed without creating another conversation or mutating domain state. No polling/event source added.

Focused browser1 and full production-path8 pass (44.2s). A real daemon background Work fails against an explicit failing fixture provider; reload, four widths, keyboard navigation, correct failure label and unchanged foreground are verified. Type/lint/build/format/diff pass. [Verification](evidence/2026-10-04/background-presence/verification.json).

Screenshots: [1440](evidence/2026-10-04/background-presence/background-presence-1440.png), [1280](evidence/2026-10-04/background-presence/background-presence-1280.png), [390](evidence/2026-10-04/background-presence/background-presence-390.png), [320](evidence/2026-10-04/background-presence/background-presence-320.png).320 inspected. These are functional after captures, not full upstream comparison.

T-038 remains in_progress for resource waiting, performance and remaining browser matrix. All70 global AT unchanged.
