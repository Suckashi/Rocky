# ADR 0008：M3 派工給 OpenCode

- 日期：2026-10-05
- 狀態：已採用
- 程式：`src/server/external/`、`src/server/jobs/`、`src/server/agent/delegate.ts`、`src/web/pages/JobsPage.tsx`
- 測試：`tests/integration/jobs.test.ts`（真的 `opencode acp`＋假模型；沒裝 OpenCode 時跳過）、`scripts/e2e-jobs.ts`、評測 `delegate-to-opencode`

## 決定

1. **由你指定才派工。** Rocky 有 `delegate_to_opencode` 工具，說明裡寫明只在你要求時使用。開始一個工作算對外動作，所以一定先問，
   核准面板寫成「Rocky 想把工作交給 OpenCode：…」並顯示交代的內容。
2. **一個工作一個 worktree。** 從專案的 HEAD 開一個 `rocky/job-…` 分支，worktree 放在 Rocky 的資料夾（`<data>/worktrees/<job>`），
   不放在專案裡。專案有還沒 commit 的改動時，工作不會包含它們，結果會提醒。
   專案的 `node_modules` 用 junction 連進 worktree，讓測試能跑；這個連結不算改動，刪 worktree 前會先拆掉，不會沿著連結刪到專案。
3. **OpenCode 的每個權限請求都走 Rocky 的關卡**（ADR 0003 的啟動方式與設定）。改檔對應成寫檔效果（完整新內容），指令對應成
   `sh -c <指令>`，其他（一次改多個檔、抓網頁、它自己的工具）都當成對外動作。判斷時以 worktree 為根目錄，所以在
   「需要時才問」模式下，worktree 裡的改檔和一般指令不用問，危險指令和對外動作照樣問。只回 `allow_once`／`reject_once`。
4. **拒絕的原因會傳回去。** OpenCode 被拒絕後會結束這一輪；Rocky 把「使用者拒絕了，原因：…，換個做法」當成下一個 prompt，最多 3 次。
5. **Rocky 自己驗證。** OpenCode 停下後，Rocky 用 git 看 worktree 改了哪些檔案，每個檔案都必須等於 Rocky 最後核准的內容；
   接著 Rocky 自己跑 `npm test`（同樣經過關卡）。全部符合是「已驗證」，否則是「有問題」。OpenCode 沒回報結果的動作記成不明。
6. **套用前不會動到專案。** 工作頁顯示驗證、測試輸出、diff 和時間軸。「套用到專案」先列出計畫，你確認的是計畫的內容雜湊；
   每個檔案都是經過關卡的寫檔，有快照，記在 `apply:<job>` 底下，可以整批還原。「捨棄」會刪掉 worktree 和分支。
7. **（已由 ADR 0012 取代：工作改在背景排隊。）工作跟著對話這一輪走。** 派工時 Rocky 等工作做完再回報，核准出現在同一個對話的核准面板；停止這一輪就會取消工作。
   Rocky 重啟時正在跑的工作標成「已中斷」，不會自動重跑。
8. **自己動手的工具也有完整紀錄。** 經過關卡、但不是由 Rocky 的執行器執行的工具（派工、之後的 MCP），由中介層在工具結束後把紀錄收尾：
   成功、失敗，或丟出錯誤時記成不明。

## 驗證

| 平台                                                                        | 指令                                                 | 結果                                                                                                                                        |
| --------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 雲端 Linux，Node 24.21.0，OpenCode 1.18.34                                  | `ROCKY_REQUIRE_OPENCODE=1 npm run check`             | exit 0；126 個測試通過（含 S1 的 9 個與 jobs 的 3 個）                                                                                      |
| 同上，Chromium 141                                                          | `npm run test:e2e:jobs`（假模型＋真的 OpenCode）     | exit 0；核准派工、OpenCode 在 worktree 修 bug 而專案不變、工作頁顯示驗證與 Rocky 自己跑的 `npm test`、套用後專案改好                        |
| 同上，Command Code `deepseek/deepseek-v4-flash`（Rocky 與 OpenCode 都用它） | `npm run eval -- --only delegate-to-opencode`        | 通過，44 秒：Rocky 先自己讀碼、跑測試，再派工；OpenCode 改 `src/stats.js`、跑 `npm test`；Rocky 驗證一致並重跑測試通過；只問了 1 次（派工） |
| 同上                                                                        | `npm run eval -- --repeat 3 --save-baseline`（9 題） | exit 0；26/27 = 0.963，存為新基線。唯一失敗是 `respect-rejection` 有一次模型沒有嘗試刪除（沒問就放棄）；`delegate-to-opencode` 3 次都通過   |
| GitHub Actions windows-latest／ubuntu-latest                                | `npm run check`                                      | 推送後由 CI 執行（CI 不裝 OpenCode，jobs 測試會跳過）                                                                                       |

## 還沒驗證的（限制）

- **沒有在 Windows 上跑過 M3。** junction、`taskkill /T`、OpenCode 的 Windows 版本與 `.cmd` 解析都要擁有者確認。
- OpenCode 需要模型的 API key，它跑的指令也讀得到這個環境變數（Rocky 自己的 API token 不會傳過去）。
- OpenCode 不是完全離線（ADR 0003 發現 5）：每次啟動會連 `registry.npmjs.org`，沒有 `rg` 時會下載 ripgrep。工作頁有說明。
- 只驗證了 OpenCode；ACP 這一層是通用的，但其他 agent 沒測。
- 驗證只比對文字檔；二進位檔的改動會被列為不一致。
- 工作在對話這一輪裡同步執行，還不能在背景排隊多個工作。

## 後續（2026-10-08 檢查）

- 限制裡的「工作在對話這一輪裡同步執行」已由 ADR 0012 取代（背景排隊）。
