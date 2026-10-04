# Contributing to Rocky

Bug reports, documentation corrections, focused tests, and implementation contributions are welcome in English or Traditional Chinese. Read the [Code of Conduct](CODE_OF_CONDUCT.md) and [Security policy](SECURITY.md) before posting.

## Choose a contribution

Reproducible bug fixes, clearer setup instructions, missing edge-case tests, accessibility fixes, and platform-specific corrections are useful starting points. Check current work before implementing the same behavior again.

For a new product feature, broad UI change, or change to approval/runtime semantics, open a proposal first and agree on its scope with a maintainer. Small documentation corrections and focused fixes can go directly to a PR with enough context to review. External contributors do not need to understand every internal task ID before reporting a problem.

Use the Bug report, Feature request, or Question form in GitHub Issues. Search for related reports and add useful details to an existing issue when possible. Maintainers review reports manually; this repository has no automated rejection or inactivity-closure policy.

## Start here

1. Read the [README](README.md), [architecture](docs/architecture.md), and [development guide](docs/development.md).
2. Check the [roadmap](docs/ROADMAP.md) and existing issues before starting a large change. Describe the problem and proposed scope in an issue first.
3. Use Node **24.12.0** and npm **11.6.4**. Run `npm ci`; keep exact dependency versions and commit lockfile changes together with manifest changes.
4. Create a focused branch from the repository's current default branch. After GitHub bootstrap, submit a pull request against that default branch.

The project uses npm workspaces. Core installation must not require Python or a native compiler fallback. The detailed agent entry point is [AGENTS.md](AGENTS.md); product contracts live in [specs/rocky](specs/rocky/README.md).

## Keep changes reviewable

- Keep one problem per PR. Include a concrete before/after description and screenshots for visible UI changes.
- Place shared validation in `packages/contracts`, execution assembly in `packages/agent-runtime`, authority and persistence in `apps/daemon`, and presentation in `apps/web`.
- Keep one Deep Agents runtime. Native child tasks are ephemeral; daemon Work is the durable authority.
- Do not infer successful effects from stream termination, process exit, or frontend state. Preserve exact approvals and unknown-outcome handling.
- Keep credentials, local stores, browser profiles, user content, and private diagnostics out of commits and issue attachments.
- Preserve third-party attribution. Explain dependency additions and update the license inventory when the lockfile changes.

See [file placement](docs/architecture.md#file-placement) for details. Do not reorganize unrelated runtime modules as part of a documentation or bug-fix PR.

## Verify your change

Run the relevant checks in the [development guide](docs/development.md). The usual baseline is:

```sh
npm run check
npm run check:docs
npm run lint
npm run format:check
npm test
npm run build
```

Use focused tests during development and include browser evidence for changed user flows. Record the actual platform, mode (`static`, `fixture`, or `live`), command, exit code, and limitations in `docs/implementation/`. Update the existing task/acceptance evidence in `specs/rocky/implementation-plan.json` when changing its covered behavior; a typo fix does not require inventing a new task.

Never mark unrun acceptance as passed. Windows results do not establish Ubuntu support, and fixture results do not establish live-provider acceptance. An existing failing security gate must remain visible; do not lower thresholds or disable checks to obtain a green PR.

## Review and merge

Use a short PR title with a change type and optional area, for example `fix(daemon): retain unknown command outcomes` or `docs: clarify browser setup`. Common types are `fix`, `feat`, `docs`, `test`, `refactor`, and `chore`.

Link the issue or agreed proposal so the reviewer can see the intended scope. Explain the behavior and how to reproduce the result. UI changes need comparable before/after captures; other changes need a reproducible test or command. Keep the PR description short and put detailed reports behind links.

AI-assisted contributions are welcome. The contributor remains responsible for reviewing every changed file, understanding the result, checking attribution, and running the reported checks. State any uncertainty explicitly. Do not submit raw agent transcripts, invented test results, or summaries you have not verified.

Use branch → PR → CI → maintainer merge. Remote setup, branch protection, releases, tags, and deployment are maintainer actions. The repository's CI definitions do not prove those settings are enabled or that a run passed. Required checks must finish successfully at the revision being merged; reviewers should resolve discussion threads before merge.

Contributions are submitted under the project's existing [Apache-2.0 license](LICENSE). Retain any third-party notices applicable to contributed code. This project currently has no separate CLA process.
