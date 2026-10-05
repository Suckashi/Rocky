# CI removal

2026-10-05: The owner explicitly requested removing CI to unblock development. This supersedes earlier mandatory CI instructions for Rocky (T-001 / R-043).

Disabled the hosted Verify workflow (374599322), removed main's required status checks, and deleted the local `.github/workflows/verify.yml`. Updated contribution/development guidance and removed the docs checker's dependency on that deleted workflow. Dependabot updates remain separate from CI verification.

Platform: Windows x64, Node 24.12.0. Live GitHub configuration commands, each exit 0:

- `gh workflow disable 374599322 --repo Suckashi/Rocky`
- `gh api --method DELETE repos/Suckashi/Rocky/branches/main/protection/required_status_checks`
- `gh api repos/Suckashi/Rocky/actions/workflows/374599322 --jq '.state'`: `disabled_manually`.
- `gh api repos/Suckashi/Rocky/branches/main/protection`: no required status checks; PR, admin enforcement, conversation resolution, and force-push/deletion restrictions retained.
- Queried the latest 100 Verify runs through the workflow runs API: no non-completed runs returned.

Windows/static: `npm run check:docs` exited 0 (38 tasks, 56 requirements, 70 acceptance entries, valid DAG, 162 local links).

Limitations: no application tests, Ubuntu execution, or acceptance promotion. Existing dependency findings remain unresolved. At initial verification, local changes had not yet been committed or pushed; hosted disabling and removal of required checks had already taken effect. Existing working-tree edits were preserved.
