# ADR 0020：機密檔與 OpenCode 的安全小修

- 日期：2026-10-09
- 狀態：已採用（ADR 0018「下一批」的安全項目）

## 決定

1. **OpenCode 的伺服器密碼**：`opencode acp` 會在 127.0.0.1 的隨機埠開 HTTP 伺服器，沒有密碼時任何本機程式都能操作它。
   Rocky 每次啟動 OpenCode 都給一組新的隨機 `OPENCODE_SERVER_PASSWORD`（`src/server/external/opencode.ts`）。
2. **OpenCode 讀機密檔要問**：之前 Rocky 的 OpenCode 設定 `read: allow` 蓋掉了 OpenCode 自己的 `.env` 詢問，
   放手模式下 OpenCode 可以直接讀 `.env`。現在設定裡列出跟 Rocky 一樣的機密檔清單（`*.env`、金鑰、`.ssh` 等），讀之前問。
   OpenCode 問的時候沒有附上路徑，所以沒有路徑的讀檔請求，Rocky 一律當成讀機密檔（`secret: true`），任何模式都會問。
3. **搜尋略過機密檔**：`grep` 的結果拿掉機密檔，除非使用者核准的就是搜尋那個機密路徑。
4. **讀檔的通行證當場關閉**：讀檔拿到的通行證之前從來沒被用掉，一直留在記憶體裡；
   核准過的讀機密檔紀錄也沒有結束，重新啟動後會變成「結果不明」。現在讀檔跟其他自己動作的工具一樣，
   通行證當場關閉，紀錄在工具結束後寫上成功或失敗。

## 限制

- OpenCode 不說是哪個檔，核准面板只能寫「想讀取一個機密檔」。
- OpenCode 自己的 `grep`、`glob` 仍然直接放行；它用 ripgrep，預設略過隱藏檔與 `.gitignore` 裡的檔案，
  但不在其中的金鑰檔（例如沒被忽略的 `server.key`）可能出現在結果裡。

## 驗證

| 平台                     | 指令                                                                     | 結果                     |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------ |
| 雲端 Linux，Node 24.21.0 | `npm run check`、`npm run build`                                         | 通過，160 個測試，exit 0 |
| 同上，OpenCode 1.18.34   | `ROCKY_REQUIRE_OPENCODE=1 npx vitest run tests/integration/jobs.test.ts` | 5 個通過                 |
| 同上，Chromium 1194      | `node scripts/e2e.ts`、`node scripts/e2e-jobs.ts`                        | 通過，exit 0             |

- 新測試在拿掉修正時會失敗：OpenCode 讀 `.env` 的內容送到了模型；`grep` 結果含金鑰檔；讀機密檔的紀錄沒有結束。
- 沒有在 Windows 上跑過。
