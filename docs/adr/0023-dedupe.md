# ADR 0023：合併重複

- 日期：2026-10-09
- 狀態：已採用（ADR 0018「下一批」的最後一項）

## 決定

1. **前後端共用型別**：`Actor`、`Effect`、`Mode`、`PlanOption`、`Locale`、`Provider`、`Outcome`、
   `ReceiptDecision`、`JobStatus` 原本在伺服器與 `src/web/api.ts` 各寫一份，要手動保持一致。現在只寫在
   `src/shared/types.ts`，兩邊匯入；和 `Mode` 一模一樣的 `ApprovalMode` 刪掉。分層測試允許每一部分 import `shared`。
   API 回傳的記錄（`Receipt`、`PendingApproval`、`Job`）仍各自定義：前端看到的是 JSON 形狀，欄位與伺服器不同。
2. **route 的請求本文**：14 個 route 重複 `schema.safeParse(await c.req.json().catch(...))`，改成 `readBody(c, schema)`
   （`src/server/http/body.ts`）。
3. **關卡**：8 個分支各自寫「記一筆拒絕紀錄、回傳不允許」，3 個分支各自寫「記一筆紀錄、發通行證」，
   改成 `refuse()` 與 `permit()`。給模型的訊息一字未改（golden 測試確認）。
4. **測試骨架**：5 個地方各自組出 Rocky、寫一個帶 token 的 `call()`，改用 `tests/fixtures/rocky.ts`。

## 不做的

- 評測與 e2e 腳本各有自己的組裝方式（要真實模型、瀏覽器），沒有併進測試骨架。

## 驗證

| 平台                     | 指令                                                                     | 結果                     |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------ |
| 雲端 Linux，Node 24.21.0 | `npm run check`、`npm run build`                                         | 通過，168 個測試，exit 0 |
| 同上，OpenCode 1.18.34   | `ROCKY_REQUIRE_OPENCODE=1 npx vitest run tests/integration/jobs.test.ts` | 5 個通過                 |
| 同上，Chromium 1194      | `node scripts/e2e.ts`、`node scripts/e2e-jobs.ts`                        | 通過，exit 0             |

- 行為不變：golden 檔（模型看到的提示與工具）沒有變，所以沒有跑評測。
- 沒有在 Windows 上跑過。
