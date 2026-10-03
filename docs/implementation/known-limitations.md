# Known limitations and next gates

- Ubuntu: not run. No WSL/container engine is available on this host; remote creation/push is not authorized. CI YAML exists but has not executed remotely. T-002 and P0 cannot be marked complete.
- Strict browser egress test fails on this Windows host: AdGuard injects local.adguard.org requests. Functional browser test passes independently. No exception was added to the egress assertion, and no OS security setting was changed.
- Pinned Playwright Chromium 1243 download timed out. Browser checks used the existing Chromium 1223 executable via ROCKY_TEST_BROWSER; this does not validate the pinned download/install.
- Promptfoo 0.120.0 attempts an external telemetry-disabled event despite its disable flag. The evaluation command now blocks that request before Fetch dispatch and records it. HTTP/Undici diagnostics observe only configured loopback requests after the guard. This is not OS-level egress enforcement.
- Node built-in SQLite reports its experimental warning in this Node version.
- CopilotKit's initial UI bundle remains large; final bundle budgets/optimization are not claimed. T-037 original vector baseline is implemented; brand distribution rights review and T-038 presence remain pending.
- Only synthetic models/MCP effects are supported by the current app. The UI is not a general-purpose live assistant yet. No API credentials, external business service, browser automation capability or paid model has been validated.
- Four evaluation cases validate integration, not learned-skill quality. Learning is off; no proposals, published skills or claimed improvement exist.
- The executor has no worker boundary or full conversation/inbox-checkpoint implementation. T-006 now has a domain outbox, deduplicated completion results and completion-result pagination. Do not expose it beyond loopback.
- No remote repository, visibility configuration, first push, protections, merge, tag or deployment has been performed.

Next: run the locked clean-copy installation/build/evaluation on Ubuntu and the strict browser network test in a clean browser environment. The user has explicitly authorized local feature development while these gates remain open. T-005, T-006 and T-037 now have local completion evidence; proceed with T-007 model/network configuration. WSL installation was deferred by the user. Do not mark P0 passed.
