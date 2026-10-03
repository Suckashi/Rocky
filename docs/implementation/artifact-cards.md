# Conversation artifact delivery cards

Source e1e3b62f68e5af31340af3df860cb73645c091b4. T-019/T-020 remain in_progress.

WorkArtifacts shows daemon-published immutable results immediately beside the originating Work answer. Card title/file and Open/Download actions stay visible; it does not infer work completion or test success from publication. Shared useRockyProjection bootstraps artifact metadata and applies existing rocky.artifact.published events. Library receives the same collection instead of loading another artifact state. No card creates requests, polling or event sources.

Opening a card selects the existing ResultPane preview. Compact pane Escape returns focus to the actual card opener; sidebar launches still return to the mobile drawer button. Metadata refresh no longer invalidates pending preview requests; unmount retains stale-response protection.

Compared OpenDots fixedSHA c2569bb6a13a22e565cf3eb791c62267d06babb1 PageReviewCard.tsx and style.css lines3707 onward. Adapted16px radius,14px/18px header/footer,18px/22px body,20px title and9px action radius; existing Rocky semantic colors support the common theme structure. Review controls become confirmed-result actions. MIT attribution updated; no upstream service/persistence imported.

[Verification](evidence/2026-10-04/artifact-cards/verification.json):7 normal-daemon browser flows pass. Native delivery card opens actual preview, closes with focus return and survives reload. Four widths have no full-page horizontal overflow; desktop1440 and320 screenshot inspected. Type/lint/build/format/diff pass. Existing startup proxy/SQLite/chunk-size warnings remain. An initial test-edit script syntax error made no file change; corrected before the new assertions ran.

Screenshots: [1440](evidence/2026-10-04/artifact-cards/artifact-card-1440.png), [1280](evidence/2026-10-04/artifact-cards/artifact-card-1280.png), [390](evidence/2026-10-04/artifact-cards/artifact-card-390.png), [320](evidence/2026-10-04/artifact-cards/artifact-card-320.png). Desktop capture may show confirmed artifact while Work completion event is still arriving; this is intentional independent state, not fabricated success.

## Remaining

- Artifact initial list retains existing200-item cap; older paginated history may need artifact pagination; not yet complete library/history scope
- Initial artifact load participates in projection bootstrap: a failed/corrupt library response shows reconnect error rather than claiming an empty successful list; independent degraded loading remains follow-up
- Chinese light four-width checks only; this new card dark/English matrix and matched upstream before/reference/after not_run
- Fixed upstream PageReviewCard metrics adapted; static source comparison and after screenshots are not full high-fidelity acceptance
- PNG/JPEG artifacts, document tools/context references, remaining V1 modules and all70 global AT remain incomplete/not_run

Goal active; no remote action.
