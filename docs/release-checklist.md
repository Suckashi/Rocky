# GitHub bootstrap and release checklist

This is a maintainer checklist, not evidence that any remote action happened. The project currently has no configured Git remote. Keep preview-source publication separate from a verified product release.

## Prepare the source snapshot

- [ ] Review `git status` and the complete diff, including untracked files and prior development changes.
- [ ] Run relevant development checks and record exact results in `docs/implementation/`.
- [ ] Build, then run `npm run check:package` to inspect current files, historical blobs, and the npm dry-run inventory. Pattern scanning is not a complete secrets review; inspect live diagnostics and public screenshots separately.
- [ ] Confirm LICENSE, NOTICE, THIRD_PARTY_NOTICES, lockfile, source attribution, and asset provenance are included.
- [ ] Confirm README languages, CHANGELOG, security limitations, and task evidence agree. Do not convert failed or unrun gates into passed statuses.
- [ ] Review the staged snapshot and create a local commit. Do not rewrite history or delete local data to hide findings.

## Create the repository after owner authorization

- [ ] Confirm the GitHub account/organization, repository name, visibility, and first-push authorization.
- [ ] Create an empty repository without a generated README/license/gitignore so local history remains authoritative.
- [ ] Set the actual remote; add `repository`, `homepage`, and `bugs` metadata using that verified URL. Do not invent links before creation.
- [ ] Push the approved bootstrap revision and establish the default branch. Record the remote URL and exact commit.
- [ ] Enable private vulnerability reporting and confirm its reporting route. Update the Security policy with the concrete route; establish a private conduct contact too.
- [ ] Run Verify on both Windows and Ubuntu and inspect the separate dependency-audit result. Unresolved gates must remain visible.
- [ ] Require PRs, fresh successful checks, and resolved conversations for the default branch; block force pushes and deletion. Select check names from actual GitHub runs.
- [ ] Review Actions permissions and artifact contents/retention. CI artifacts must contain only synthetic test diagnostics.
- [ ] Add the project description and topics. Add CI badges only after the real workflow URL exists.

## Release separately

- [ ] Close required acceptance gates in the [roadmap](ROADMAP.md), including platform and live evidence.
- [ ] Review the dependency audit, source and bundled notices, and asset distribution rights.
- [ ] Verify the exact release source/package on supported platforms, including install, start, stop, and backup/restore.
- [ ] Finalize version and CHANGELOG with supported environments, limitations, and reproducible commands.
- [ ] Obtain explicit authorization for merge, tag, release publication, or deployment. Record actual outcomes.

`package.json` is intentionally private; source publication does not authorize publishing an npm package. There is no automatic release or deployment workflow.
