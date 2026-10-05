# ADR 0006：M1 本機伺服器與對話

- 日期：2026-10-05
- 狀態：已採用
- 程式：`src/server/`、`src/web/`；測試：`tests/unit/`、`tests/integration/`、`scripts/e2e.ts`

## 決定

1. **登入用一次性登入碼，不把 token 交給瀏覽器程序。** API token 存在資料夾裡只有使用者能讀的 `api-token`，
   只在 Rocky 程序的記憶體裡使用。啟動時印出並打開 `/?code=…`（2 分鐘內有效、只能用一次），
   換成 `HttpOnly`、`SameSite=Strict` 的 cookie 後轉址把碼拿掉。瀏覽器也是 Rocky 啟動的程序，所以拿不到 token。
   啟動腳本已在執行時，用 token 檔呼叫 `POST /api/login-code` 拿新的網址。
2. **每個 `/api` 呼叫都要驗證**（cookie 或 Bearer），另外檢查 Host 必須是 `127.0.0.1:<port>` 或 `localhost:<port>`（防 DNS rebinding）、
   Origin 必須是自己、拒絕 `sec-fetch-site: cross-site`、寫入必須是 JSON、限制大小。CSP 只允許 `'self'`。
3. **對外連線白名單。** Rocky 程序的 `fetch` 只放行 loopback 與使用者設定或測試過的模型端點，其他一律拒絕並記錄。
4. **遙測要在載入前關掉。** CopilotKit 在 import 時就建立遙測物件並讀取設定，所以入口是 `src/server/start.ts`：
   先設定 `COPILOTKIT_TELEMETRY_DISABLED`、`DO_NOT_TRACK`、關閉 LangSmith tracing，再動態載入 `main.ts`。
   CopilotKit 安裝時的 Scarf 統計由 `package.json` 的 `scarfSettings` 關閉（ADR 0004）。
5. **對話存在本機。** `RockyAgentRunner` 實作 CopilotKit 的 `AgentRunner` 與本機對話端點，資料在 `node:sqlite`。
   每一輪先記成 `unknown`，結束才改成 `succeeded` 或 `failed`（含 `RUN_ERROR`、被停止）；程序中途結束就留在 `unknown`。
   runtime 的「清除所有對話」端點不做事，刪除只能一個一個來。
6. **API key 只寫不讀。** 存在資料夾裡 `0600` 的 `secrets.json`，不進資料庫，API 只回傳「有沒有設定」。
   Windows 上目前靠 `%LOCALAPPDATA%` 的預設權限；之後考慮 DPAPI。
7. **M1 只能對話。** Deep Agents 的檔案、指令、子代理工具用 harness profile 藏起來，等 M2 接上動作關卡再打開。
8. **介面文字都在語系檔。** `check:i18n` 除了比對兩個語系的 key，也用 TypeScript 解析器找元件裡寫死的文字與 `aria-label`／`alt`／`placeholder`／`title`。
9. **Windows 啟動腳本 `Start-Rocky.ps1`** 存成 UTF-8 加 BOM：沒有 BOM 時 Windows PowerShell 5.1 會用 ANSI 讀檔，中文會壞。CI 在 Windows 用 PowerShell 5.1 解析它。

## 驗證

| 平台                                         | 指令                                                          | 結果                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 雲端 Linux，Node 24.21.0                     | `npm run check`                                               | exit 0；52 個測試通過（S1 的 9 個因沒有 OpenCode 而 skipped）                                   |
| 雲端 Linux，Node 24.21.0，Chromium 141       | `npm run test:e2e`（假模型）                                  | 7 項通過：首次設定、中文對話與 Markdown、命名、重新整理後的歷史、切英文、未登入分頁、無頁面錯誤 |
| 雲端 Linux，Node 24.21.0                     | 伺服器＋Command Code `deepseek/deepseek-v4-flash`             | 透過 `/api/copilotkit` 串流出繁體中文回覆，5.3 秒，有用量；日誌與串流沒有金鑰                   |
| GitHub Actions windows-latest／ubuntu-latest | `npm run check`、`npm run build`、PowerShell 5.1 解析啟動腳本 | 推送後由 CI 執行                                                                                |

## 還沒驗證的（限制）

- **還沒在擁有者的 Windows 上 `Start-Rocky.ps1` 真正啟動、打開 Edge 聊天過。** CI 只解析腳本、建置與跑單元測試。
- 端對端測試只在 Linux 的 Chromium 跑過；Windows 的 Edge 要擁有者執行 `npm run test:e2e`。
- 前端主程式包約 2.1 MB（CopilotKit 帶進程式碼高亮等套件），還沒拆分。
- 刪除對話用瀏覽器內建的確認對話框，之後換成介面內的確認。
