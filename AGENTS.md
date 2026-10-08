# Rocky engineering rules

Rocky is a single-user AI engineering partner that runs on the owner's own computer
(Windows first). How it is built is described in `docs/rebuild/` and `docs/adr/`; anything
not listed below can change. Record a change of architecture or approach in a short ADR.

- Credentials, local databases, browser profiles and private evidence stay out of Git.
- Report honestly: state the real platform, command, exit code and limitations. Never mark a
  failing or unrun check as passed, and never fabricate Windows or live-model results.
- Roko, the mascot, appears in the UI. Every user-facing string goes through the i18n
  catalogs (Traditional Chinese by default, English alongside); no hardcoded UI text.
- No push to main, merge into main, tag, new repository, visibility change or deployment
  without the owner's explicit approval.
