# ADR 0032：外部代理出錯，只影響那個工作

- 日期：2026-10-12
- 狀態：已採用（架構審查剩下的「現在做」，第三個 PR）

## 背景

- **OpenCode 啟動失敗會讓 Rocky 結束。** 執行檔不存在或不能執行（ENOENT、EACCES）時，Node 對子行程發出 `error`
  事件，沒有人接，整個 Rocky 跟著結束，進行中的對話也一起中斷。Windows 上 `taskkill` 啟動失敗也一樣。
- **停止不一定停得下來。** 停止工作只送 `session/cancel`，然後等 OpenCode 回答。OpenCode 沒有回應（還在啟動、卡住）
  時，工作一直停在「進行中」，佇列裡後面的工作也不會開始。
- **關閉時不等工作。** 關閉 Rocky 時只發出停止，不等 OpenCode 結束，工作在下次啟動時被標成「中斷」。終端機視窗
  直接關掉（SIGHUP）時，連這一步都沒有。
- **留下的子行程。** OpenCode 自己結束後，它啟動的指令（例如測試伺服器）還在跑。Windows 上一般的 kill 只結束
  OpenCode 本身。

## 決定

1. 子行程的 `error` 和結束都由 `AcpAgent` 接住：等待中的請求（initialize、newSession、prompt）在行程結束、最後的輸出
   讀完後失敗，工作標成「失敗」並附上原因；Rocky 繼續執行。寫入已結束的行程（EPIPE）也一樣。`taskkill` 啟動失敗只被
   忽略，關閉仍有期限。
2. 停止工作時先送 `session/cancel`；兩秒內沒結束就關閉 OpenCode，等待中的請求跟著失敗，工作標成「已停止」。計時器
   在觸發時才看目前的 OpenCode，所以在 OpenCode 還在啟動時停止也有效；在建立 worktree 時就停止的，不會啟動 OpenCode。
   已核准、OpenCode 沒回報結果的動作，不論工作怎麼結束，都記成「結果不明」。
3. 關閉 Rocky 時，`JobRunner.close()` 不再開始新工作（新的派工回答 `shutting-down`），排隊的工作留到下次啟動標成
   「中斷」，進行中的 OpenCode 不等兩秒直接關閉，記下「已停止」再結束，在 8 秒的關閉期限內完成。終端機關閉
   （SIGHUP）也走同樣的關閉流程。
4. 關閉 OpenCode：先關掉輸入，再結束整個行程樹（Windows 用 `taskkill /T`，其他系統先 SIGTERM，再結束它的行程群組）。
   在 Linux 和 macOS 上，OpenCode 一結束，還留在它行程群組裡的行程就一起結束。
5. 佇列啟動下一個工作時出錯，記在伺服器紀錄裡，不會變成未處理的 rejection。

## 限制

- Windows 上 OpenCode 自己結束後，它啟動的行程不會被結束（沒有 job object）。
- 不檢查 OpenCode 的版本。
- 被停止或失敗的工作不做 Rocky 自己的驗證，結果裡沒有改動清單；worktree 還在，可以捨棄。

## 驗證

Cloud Linux、Node 24.21.0、OpenCode 1.18.34：`npm run check`、真的 OpenCode 的整合測試和 `npm run test:e2e:jobs`
都 exit 0（287 個測試，jobs e2e 10 步）。新測試用不存在、不能執行、不回應、忽略 SIGTERM 的假 OpenCode，以及很慢的 checkout。每個修正
單獨拿掉後都有測試失敗；「請求在行程的輸出讀完後才失敗」這一項沒有測試能區分。沒在 Windows 上跑。
