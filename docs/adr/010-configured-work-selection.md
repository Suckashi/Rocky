# ADR-010: explicit configured model Work selection

Status: implemented and verified with local HTTP protocol fixtures.

A submission selects either fixture mode with no model reference, or configured mode with an exact connection ID/revision. Both the HTTP Work API and CopilotKit facade validate this contract. The daemon checks the configuration before persisting a new Work, and again when acquiring model leases. Replaying an existing submission ID returns the existing Work without another provider request.

The Work record pins its model choice. Store CAS prevents changing execution identity, mode or model selection during later updates. Approval fingerprints include configured model selection; the daemon rechecks the connection before accepting a pending approval and before any tool dispatch. A changed connection cannot continue an old synthetic write approval. The owner can stop the stale work and start another with the new revision.

Root and child models use the same registry selection, root budget and native factory. The fixture path remains available. Startup now tracks resources before handing them to an active Work, so partial model acquisition cleans up the MCP client and any acquired model lease. Shutdown records cancellation before aborting model leases, waits for resource cleanup and leaves unknown usage reserved.

The UI requires explicit selection and a send action. Selecting or saving alone sends no model request. It announces the chosen model and possible provider charges. Tools remain confined to synthetic samples; this does not enable real file access, a production MCP catalog or multi-turn conversation memory. Capability reporting now exposes the configured runtime route, while provider verification remains separate.

User authorization received during this work permits reading the needed Apsis model endpoint/credential for live validation. This is a narrow credential-use authorization, not permission to change Apsis or import its full settings/data. No production credential was read or live endpoint called in this implementation slice.
