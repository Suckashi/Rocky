# MCP status tracking / MCP 狀態追蹤

Tracking is an explicit owner-authorized recurring read of one configured MCP tool with fixed arguments and pinned config/schema identity. Tool hints are not authorization. The owner must confirm that the chosen exact tool and arguments are read-only. Without a suitable connected tool, tracking is unsupported; Rocky never substitutes a direct account connector or shell command.

owner 必須明確確認唯讀工具、精確參數、查詢次數、間隔、觸發狀態與後續指令。MCP 回傳須有 structuredContent，或文字內容為 JSON；statusPath 指到一個有界字串。只有該狀態會進入 follow-up，不把 server 回傳文字當新權限。

Tracking includes foreground and background source Works. Matching status fingerprints do not create duplicate follow-ups. The default maximum is three follow-ups, with a cooldown; each is a new background Work using the source model revision, budget and workspace scope. All ordinary effect approvals remain. There is no automatic merge, deployment or repository-scope expansion. Follow-up model calls can incur costs and require enabling the subscription explicitly.

Subscriptions and polls persist before dispatch. Unknown or interrupted polls stop automatic polling until owner review/reconfiguration. Configuration/schema changes stop the pinned mapping. Pausing fences new queries and aborts an active query; cancellation does not imply the server did nothing. Pending follow-up submission uses a stable request ID so daemon restart cannot duplicate a Work.

Implementation and synthetic fixtures are present; no external account, real MCP status query or paid follow-up model has been used to validate this path yet.
