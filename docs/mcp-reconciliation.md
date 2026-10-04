# Operation receipts / 操作收據

MCP servers may implement an explicit, owner-configured read-only receipt resource. Set `receiptUriTemplate` in that server's `x-rocky.servers` entry, including `{operationId}` and `{intentHash}`. Rocky supplies these identities in the original tool request's `rocky/operation` metadata. This is a Rocky extension, not a claim that MCP request IDs provide idempotency.

對帳會固定原派送時的 server、設定版本與 URI template。使用者要求對帳後，Rocky 只呼叫該 server 的 `resources/read`，不重送原工具、不跟隨結果中的 URL。更換憑證、設定或帳號後不能直接沿用舊對帳授權；沒有 adapter 或無法確認時保留 unknown。

The resource returns exactly one text item at the requested URI, containing JSON:

```json
{
  "operationId": "original-run:original-call",
  "intentHash": "original-64-character-sha256",
  "outcome": "succeeded",
  "result": "serialized original tool result",
  "evidenceRef": "receipt-uuid",
  "observedAt": "2026-10-04T00:00:00.000Z"
}
```

`outcome` is `succeeded`, `failed_known_no_effect`, or `unknown`. Only `succeeded` includes a non-null `result`. Missing records never mean no effect. The identity/hash must match the original operation. The server must maintain durable, truthful effect receipts; an owner must not configure a generic resource or an untrusted self-assessment as a proof adapter. The resource is bounded and secret-containing receipts are refused.

Native 命令另以 Rocky data root 內的 checksum／identity 綁定收據保存程序結果；它先於 domain settlement 寫入，以便復原兩者之間的 crash window。沒有完整收據或命令部分執行時仍為 unknown。Exit 0 表示程序成功退出，不代表所有外部業務效果已被獨立驗證。These paths remain subject to concentrated fixture/live verification; implementation is not test evidence.
