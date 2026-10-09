# ADR 0021：防護測試（模型輸入 golden 檔與分層檢查）

- 日期：2026-10-09
- 狀態：已採用（ADR 0018「下一批」的測試項目）

## 決定

1. **模型看到什麼**：`tests/integration/agent-tools.test.ts` 的「what the model sees」用假模型跑一輪，
   把真正送出的系統提示和工具定義（名稱、說明、JSON schema）寫成 `tests/golden/` 裡的三個檔：
   Rocky（`rocky.md`）、規劃模式下的 Rocky（`rocky-plan-mode.md`）、研究子代理（`subagent.md`）。
   暫存資料夾換成 `<tmp>`、作業系統換成 `<os>`，Linux 與 Windows 得到同一份。
   改提示、改工具、升級 Deep Agents 或 LangChain 時，這些檔案的差異就是模型行為改變的地方：
   看過差異、跑過評測，再用 `npx vitest run -u` 更新。golden 檔不經過 Prettier。
2. **分層**：`tests/unit/layers.test.ts` 掃 `src` 的 import，檢查兩件事：
   - 每一部分只能 import 表上允許的部分。動作關卡（`effects`）與 `platform`、`memory`、`mcp`、`documents`
     不依賴 Rocky 的其他部分；`http` 與伺服器根目錄負責組裝，不受限；`web` 不 import 伺服器。
   - 每個 SDK 只出現在擁有它的部分：Deep Agents、LangChain 只在 `agent`；ACP SDK 在 `external`、`jobs`；
     MCP SDK 在 `mcp`；Hono 在 `http`；`cross-spawn` 在 `effects`。
     表照現在的程式訂；要多一條依賴，就得刻意改表。

## 從 golden 檔看到的現況

- 研究子代理的系統提示只有 Deep Agents 的一句預設文字，沒有 Rocky 的語言、專案等說明。
- 子代理拿到全部工具（`write_file`、`run_command`、`delegate_to_opencode` 等），但它是唯讀的，
  這些呼叫會被關卡擋下。可以只給它讀取工具，省 token 也少一次失敗的嘗試；這屬於行為改變，另外決定。

## 驗證

| 平台                     | 指令                                      | 結果                                |
| ------------------------ | ----------------------------------------- | ----------------------------------- |
| 雲端 Linux，Node 24.21.0 | `npm run check`                           | 通過，166 個測試，exit 0            |
| 同上                     | 刻意改一個字的系統提示、加一條違規 import | golden 與分層測試都失敗；還原後通過 |

- 沒有在 Windows 上跑過；Windows 路徑的處理只由 CI 驗證。
