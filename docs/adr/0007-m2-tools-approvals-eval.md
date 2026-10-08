# ADR 0007：M2 工具、核准管線、操作紀錄與評測

- 日期：2026-10-05
- 狀態：已採用
- 程式：`src/server/effects/`、`src/server/agent/`、`src/web/components/`、`evals/`
- 測試：`tests/unit/effects-*.test.ts`、`tests/integration/agent-tools.test.ts`、`scripts/e2e.ts`、`npm run eval`

## 決定

1. **一個動作關卡（`effects/gate.ts`）。** 判斷順序照 `approvals.md`：禁止規則 → 危險指令（語法分析，拆 4 層包裝）→
   機密檔與受保護路徑 → 對外動作 → 本對話已核准（同一個雜湊）→ 允許規則 → 模式。
   每個工具呼叫都先經過 `wrapToolCall` middleware（Rocky 與子 agent 都掛）；未知工具一律當成對外動作。
2. **第二道防線是通行證。** 關卡核准後發出只能用一次、綁定內容雜湊的通行證；寫檔與執行指令的 `Executor`
   只接受通行證，雜湊不符就拒絕並把那筆紀錄標成沒執行。通行證用 `AsyncLocalStorage` 從 middleware 傳到工具。
3. **核准在程序內等待，不用 LangGraph interrupt＋checkpointer。** 待核准的事情透過 AG-UI `STATE_SNAPSHOT`
   （`{mode, pendingApprovals}`）送到介面，使用者用 `POST /api/approvals/:id` 帶上看到的內容雜湊回覆；
   雜湊不同就當成拒絕。理由：少一套 checkpoint 狀態要和操作紀錄對齊。代價：Rocky 在等待時重啟，
   這一輪會留在 `unknown`，那個動作不會被執行，也不會自動重做（`markInterrupted`）。
4. **操作紀錄先寫意圖再寫結果。** 結果只有成功、失敗、不明，或因拒絕而沒執行。寫檔中途出錯記成不明；
   指令逾時或被停止記成不明。不明的動作在介面上有「我看過了，成功了」與「沒成功，再做一次」；
   後者只是把請求放回輸入框，重新走一次核准。
5. **快照依內容雜湊存放**，每次寫檔前後各存一份。「全部還原」也走同一個關卡：介面先顯示還原計畫，
   使用者按確定就是核准，綁定計畫的雜湊；伺服器重新計算，檔案在這之間變過就拒絕。
6. **指令只用參數陣列**，用 `cross-spawn` 處理 Windows 的 `.cmd`，不經 shell；子程序拿不到 `ROCKY_*` 環境變數；
   輸出只留最後 64 KB；逾時或停止時結束整個程序樹（Windows 用 `taskkill /T /F`，其他平台用 process group）。
7. **檔案工具用虛擬路徑**（`/` 是專案根目錄，沿用 Deep Agents 的 `FilesystemBackend` virtual mode），
   指令用真實路徑。評測發現模型會把 `/build` 傳給 `rm -rf`，所以提示詞明講指令的路徑要相對於 cwd；
   關卡也會把專案外的路徑當成對外動作來問。
8. **被停止的一輪留下沒有結果的工具呼叫**時，下一輪送給模型的歷史會補一個「已中斷、結果不明」的工具結果，
   否則 OpenAI 相容端點會拒絕整段歷史。
9. **評測第一版（`evals/`）。** 8 個真實小任務，透過 Rocky 自己的伺服器、工具與關卡執行，事後檢查磁碟與操作紀錄；
   核准請求一律自動拒絕並計數。需要真實模型，不放進 CI。`--repeat N` 讓分數穩定；
   `evals/baseline.json` 是基線，同一個模型分數低於基線時 `npm run eval` 以 exit 1 結束。

## 驗證

| 平台                                         | 指令                                                                  | 結果                                                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 雲端 Linux，Node 24.21.0                     | `npm run check`                                                       | exit 0；114 個測試通過（S1 的 9 個因沒有 OpenCode 而 skipped）                                                                                                  |
| 雲端 Linux，Node 24.21.0，Chromium 141       | `npm run test:e2e`（假模型）                                          | exit 0；13 項通過，新增：預設模式、核准面板取代輸入框並先顯示 diff、按 1 允許後才寫檔、工具卡與本輪變更卡、全部還原、按 4 拒絕並說明原因傳給模型                |
| 雲端 Linux，Node 24.21.0                     | `npm run eval`，Command Code `deepseek/deepseek-v4-flash`（第一次）   | 7/8；`respect-rejection` 那次模型沒有嘗試刪除。另外三次單跑發現模型用 `rm -rf /build`（虛擬路徑），關卡以危險指令詢問並被拒絕，沒有刪到東西                     |
| 雲端 Linux，Node 24.21.0                     | 提示詞補上指令路徑規則後 `npm run eval -- --repeat 3 --save-baseline` | exit 0；24/24，共 449 秒；3 個修 bug 任務（含跨檔案、emoji 截斷）都由 Rocky 讀碼、改檔、最後跑測試（`npm test` 或 `node --test`）確認，測試檔未被修改。存為基線 |
| GitHub Actions windows-latest／ubuntu-latest | `npm run check`、`npm run build`                                      | 推送後由 CI 執行                                                                                                                                                |

## 還沒驗證的（限制）

- **沒有在 Windows 上跑過。** `.cmd` 包裝、`taskkill /T`、反斜線與 junction 的路徑判斷都有單元測試，
  但真正的執行要擁有者在 Windows 上跑 `npm run check`、`npm run test:e2e` 與 `npm run eval`。
- 程序樹用 `taskkill /T` 結束，不是 Job Object；子程序自己脫離父程序時可能留下來。
- 評測只有 8 題（產品目標約 30 題），只用一個便宜模型訂基線。
- 「永久規則」目前只有儲存與判斷，還沒有設定頁的介面；「Plan 審查」留到之後。

## 後續（2026-10-08 檢查）

- 限制裡的「永久規則還沒有設定頁」與「Plan 審查留到之後」已由 ADR 0011 補上。
- Windows：見 ADR 0014，擁有者 2026-10-07 跑過 `verify-windows.ps1`（含 `npm run check` 與 e2e），完整摘要沒有貼回。
