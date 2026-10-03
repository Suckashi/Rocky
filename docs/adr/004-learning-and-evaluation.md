# ADR-004: Trusted full-path fixture evaluation

Accepted 2026-10-03.

RockyEvaluationProvider invokes WorkService and the same createRockyAgent factory used by the UI. Its data-only input schema permits only fixture transport and approve/reject case decisions. The trusted suite can approve synthetic effects only; no arbitrary file provider, YAML hook or generated evaluator is loaded.

Promptfoo 0.120.0 runs four development cases across the two MCP transports and two approval outcomes. Assertions check actual operation counts and child completion. This is not the 12-case learning publication suite, a learned skill, or evidence of model improvement.

Target generation uses a configured loopback fixture. Grading is a local trusted assertion; suggestions/generator are disabled. Optimize remains disabled (optimizer=rocky-reflection). Promptfoo config/cache are under Rocky's evaluation directory; telemetry, update, cloud share, remote redteam and template environment access are disabled before import.

Observed exception: Promptfoo 0.120.0 attempts a telemetry-disabled event to `https://r.promptfoo.app/` even with its telemetry flag disabled. The dedicated evaluation process installs an exact-endpoint Fetch guard before importing Promptfoo. The attempt is denied before network dispatch and recorded; Node HTTP diagnostics observe only loopback fixture traffic. This is a process boundary, not an OS sandbox. Browser egress remains a separate failing gate because of host AdGuard injection.
