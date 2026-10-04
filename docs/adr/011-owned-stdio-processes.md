# Owned MCP stdio processes

Status: implemented in working tree; verification pending.

The pinned MCP SDK 1.32.0 exposes a stdio PID but no public child-process handle or detached-process option. Rocky needs its existing process-tree termination boundary to own that handle. `OwnedStdioTransport` uses Node spawn and the SDK's public `ReadBuffer`, `serializeMessage`, `Transport` and `JSONRPCMessage` contracts. The SDK still owns MCP protocol handling, discovery, calls and cancellation; this does not add an Agent runtime.

Spawn uses an explicit environment, cwd, literal argv, hidden Windows processes and a POSIX process group. Shell wrappers are rejected; configure a direct executable (for example Node with a script argument). Stop requests tree termination and waits for observed process exit. Failed shutdown is reported as unconfirmed, never as successful cleanup. A new connection must not be mistaken for reconciliation of an earlier external effect.

Native execution cannot contain a process that deliberately detaches or escapes its process group. Unexpected parent exit and daemon crash can leave descendant state unconfirmed. This is not an OS sandbox or evidence that all orphan cases pass. Windows/Ubuntu process-tree fixtures and restart cases remain scheduled for concentrated verification.
