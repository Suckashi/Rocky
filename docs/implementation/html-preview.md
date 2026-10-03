# Restricted HTML artifact preview

Source cf53d927ce311aba5c8c4f83dfff8d0468f3d768. Windows x64 / Node24.12.0 / fixture. T-020 remains in_progress.

Daemon parse5 parser applies a bounded HTML/attribute allowlist without a browser or resource fetching. It removes scripts, active embeds, navigation and foreign namespaces; generated CSP denies scripts, connections, frames, fonts and external images. Inline styles and strict data PNG/JPEG images remain available. The results pane renders the generated document in an empty-sandbox, no-referrer srcDoc iframe with opaque origin. Source toggle and immutable raw download remain available. Existing event adapter, result-pane geometry and neutral OpenDots-derived tokens are reused; no new polling/runtime.

The test follows a real local native workspace write, exact approval, artifact publication and preview. A scripted model supplies fixture content; file/database/HTTP effects are real. Hostile markup cannot execute or navigate. Privileged frame probes confirm parent DOM, cookie, localStorage and daemon fetch denial. A local canary receives no preview requests; a positive control proves it reachable. Original source/download bytes match.

[Verification](evidence/2026-10-04/html-preview/verification.json): related8 tests and normal-daemon7 browser flows pass; type/lint/build/licenses/format/diff pass. Browser captures four widths without full-page horizontal overflow; desktop1440 and mobile320 images were manually inspected.

Screenshots: [1440](evidence/2026-10-04/html-preview/html-preview-1440.png), [1280](evidence/2026-10-04/html-preview/html-preview-1280.png), [390](evidence/2026-10-04/html-preview/html-preview-390.png), [320](evidence/2026-10-04/html-preview/html-preview-320.png). These are after-only functional captures, not a new matched upstream comparison.

## Limits and remaining work

- Restricted static HTML only: scripts, navigation, forms, SVG/MathML, external resources and interactive applications are deliberately unsupported; original download is unchanged
- Local loopback canary and opaque-frame capability probes passed; this is not the full host-wide egress matrix or live external-service evidence
- Capability probes use privileged browser automation inside the frame; artifact scripts were removed and script execution disabled, not granted automation privileges
- Four Chinese light widths inspected; HTML-specific dark/English and matched upstream reference/before/after comparison remain not_run
- Escape verified with focus in host controls; key events inside opaque iframe do not bubble to the parent, so user must return focus to host controls to use host shortcuts
- PNG/JPEG artifact publication/preview, native artifact/document tools, file-context references and remaining T-020/V1 scope are incomplete
- Ubuntu/live model/release acceptance not_run; global AT26/27 and all70 acceptance statuses unchanged

Original HTML may differ from restricted rendering. This is an explicit Rocky permission adaptation, not a full interactive OpenDots page renderer. No remote actions; Goal stays active.
