# ADR 0015：刪除 `docs/rebuild/` 設計文件

- 日期：2026-10-08
- 狀態：已採用

## 決定

擁有者決定刪除 `docs/rebuild/` 的四份文件（`product.md`、`architecture.md`、`approvals.md`、`plan.md`）。
V1 已完成，這些文件和程式容易對不上，維護成本高於用處。之後 Rocky 怎麼做的只記在 ADR，換做法時寫新的 ADR。

## 影響

- `AGENTS.md`、`README.md`、`SECURITY.md` 與程式註解改為指向 ADR（核准規則見 ADR 0007、0011；成功標準見 ADR 0010）。
- 舊 ADR 裡提到 `approvals.md`、`product.md`、`architecture.md`、`plan.md` 的地方不改寫；那些文件最後一版在 commit `7a869ed`。
- 核准判斷順序的權威是程式本身（`src/server/effects/policy.ts`）與它的測試。
