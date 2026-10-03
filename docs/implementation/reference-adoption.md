# Reference decisions

| Reference                                                   | Decision           | Reason / verification                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apsis historical `0b03c634a69494ef768c027ba894dcb40390e621` | adopt-pattern      | Use the specification's lessons about truthful status, precise approvals and unknown outcomes. No source inspected or copied; upstream license not revalidated. Rocky tests own its behavior.                                |
| OpenDots `c2569bb6a13a22e565cf3eb791c62267d06babb1`         | reuse-presentation | Primary UI/UX reference. Effective style.css/editor.css adapted; MIT confirmed and full notice preserved. No brand assets, API, polling, persistence or runtime copied. See uiux-opendots-alignment.md and browser evidence. |
| Both application baselines                                  | reject             | No history, database, settings, avatar, migration, compatibility or feature-parity obligation.                                                                                                                               |

Any future small-module reuse requires a verified fixed source and license, original notices, rationale and Rocky contract tests before copying.
