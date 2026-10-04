# Community template reference review — 2026-10-04

Scope: T-001 and T-036. Reviewed the official `anomalyco/opencode` repository at commit **907b3bc518fa48e90e8ec24dd327d13eee71c36c**, resolved through the GitHub API. This is documentation-pattern research; no upstream runtime, assets, automation, or prose was imported.

## Sources and decisions

| Source                                                                                                                              | Observation                                                                                  | Rocky decision                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [README](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/README.md)                             | Short product introduction, language links, installation, then deeper documentation          | Keep bilingual entry points and quick start prominent; collapse the source map and link to detailed development checks                                                |
| [Contributing](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/CONTRIBUTING.md)                 | Clear contribution scope, issue context, concise explanations, verification, and UI evidence | Describe suitable first contributions, discuss broad changes early, ask authors to understand and verify their work; small corrections can proceed directly           |
| [PR template](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/.github/pull_request_template.md) | Related issue, explanation, test evidence, and visual evidence have distinct places          | Use related work → change → verification → optional UI evidence, with a short review checklist                                                                        |
| [Issue forms](https://github.com/anomalyco/opencode/tree/907b3bc518fa48e90e8ec24dd327d13eee71c36c/.github/ISSUE_TEMPLATE)           | Structured bug context and duplicate checking for proposals                                  | Add a concise problem field, optional affected area/integration details, and proposal duplicate checking; offer an explicit Question form when disabling blank issues |

Rocky retains Node/npm, its own license, manual triage, and its existing permission model. No Discord route, published installer, release badge, automatic rejection, or inactivity bot is claimed. OpenCode's contribution guide mentions a question route, but the inspected template directory contained only bug, feature, and config files; Rocky's Question form is a new local addition.

The upstream [MIT license](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/LICENSE) was inspected. Rocky wording is newly authored; this is recorded as pattern adoption rather than copied licensed material.

## Verification scope

See [verification](evidence/2026-10-04/community-templates/verification.json). Local checks cover Markdown links, basic form structure/IDs, formatting, lint, source guard, and whitespace. GitHub rendering and hosted form submission remain untested until the repository exists. Product acceptance and runtime behavior are unchanged.
