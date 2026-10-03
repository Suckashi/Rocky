# Rocky

A new local AI engineering partner. Node/TypeScript, explicitly configured networking, one Deep Agents runtime and a single assistant.

This is an independent greenfield implementation, not a fork or migration. The authoritative scope and task ledger are in `specs/rocky/`. See `docs/implementation/progress.md` for actual implementation and verification status.

Development: Node 24.12.0 / npm 11.6.4, `npm ci`, `npm run dev`. Build with `npm run build`, then `npm start`. P0 uses explicitly selected synthetic fixtures; no model account or paid request is needed. No remote repository or release is established by these instructions.

The collapsed **Model connections** panel can save, probe and select a configured endpoint for Work. Tools currently operate only on synthetic samples; see [connection setup and current limits](docs/implementation/model-connections.md).
