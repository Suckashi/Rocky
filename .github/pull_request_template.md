## Summary

<!-- What does this change, and why? -->

## Checks

There is no hosted CI. Run the checks locally and report the real platform, command and
result. If a check was not run, say so.

| Platform | Command | Result |
| -------- | ------- | ------ |
|          |         |        |

- [ ] `npm run check` (types, lint, formatting, i18n, tests)
- [ ] UI changes: `npm run test:e2e`; delegation changes: `npm run test:e2e:jobs`
- [ ] Prompt, tool or agent-loop changes: `npm run eval -- --repeat 3`, no drop below the baseline
- [ ] Windows-specific changes: `scripts/verify-windows.ps1` on Windows

## Confirm

- [ ] No credentials, local databases, browser profiles or private data in Git
- [ ] New user-facing text is in the i18n catalogs (`zh-TW`, `en`)
- [ ] A change of architecture or approach has a short ADR in `docs/adr/`
- [ ] README changes update both `README.md` and `README.zh-TW.md`
