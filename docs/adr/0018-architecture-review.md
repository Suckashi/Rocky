# ADR 0018：架構檢查與第一批修正

- 日期：2026-10-08
- 狀態：第一批修正已採用（分支 `claude/rocky-fixes`）；後續調整待擁有者決定
- 程式：`src/server/external/worktree.ts`、`src/server/jobs/{apply,runner,store}.ts`、`src/server/{compose,main}.ts`、
  `src/server/agent/{rocky-agent,gate-middleware,documents,to-agui}.ts`、`src/server/skills/store.ts`、`src/server/mcp/manager.ts`、
  `src/server/effects/{policy,types}.ts`、`evals/{gate,run}.ts`
- 測試：`tests/unit/{worktree,eval-gate,mcp-manager,skills,agent-history,agent-runner,success-criteria,documents}.test.ts`、
  `tests/integration/{agent-tools,jobs}.test.ts`

## 背景

擁有者要求對照 OpenCode、Kimi CLI、DeepSeek Harness、OpenDots，檢查架構是否太複雜。每次檢查用 40 個代理只讀程式碼：
7 個讀 Rocky、4 個讀參考專案、4 個架構師、3 個評審、20 個反向驗證。第一次檢查讀到的是落後 `main` 325 個 commit 的舊分支，
找到的程式問題逐一確認在 `main` 上仍然存在後，搬到以 `main` 為基底的新分支，再對新分支重跑一次檢查。

結論：`src/` 13,329 行（server 8,978、web 4,272），不需要重寫。多出來的複雜度集中在四處：

- 只在「每次問」才有作用的核准機制（session 核准、允許規則、安全清單、規則建議、方案預先核准），約 400 行，加上約 400 行測試；
  「放手」和「需要時才問」目前判斷完全相同。
- agent 層 1,815 行中約 800 行只為了接 Deep Agents、LangGraph、AG-UI、CopilotKit。
- 同一份狀態存在好幾處：對話存三份（`threads.messages`、`runs.events`、模型實際用的瀏覽器那份），核准狀態五處，前端四個輪詢。
- 複製貼上：16 段相同的 route 驗證、4 份 SSE 測試骨架、約 140 行手抄到前端的型別（已經不一致）。

四個方向的評分（兩次一致）：先刪再說 25.5、切清楚邊界 18.5、自己寫迴圈 15.5、單一事件紀錄 13.5。

## 決定（已完成）

1. 派工的變更以開工時的 commit 為準（`git diff --no-renames <base>`），驗證與套用共用同一份清單。之前 OpenCode 在 worktree 裡
   commit，成果會被當成「沒有變更」並刪掉；搬移檔案會被解析成專案根目錄的錯誤路徑。
2. 上次未完成的動作、工作、執行，改在程序拿到 port 之後才標成不明。
3. 歷史裡被截斷的工具參數不再讓整個對話壞掉。
4. 工具結果統一截到 6 萬字，低於 Deep Agents 寫檔卸載的門檻（之前長文件、長輸出讓模型收到錯誤而不是內容）。
5. 技能檔案的路徑檢查改用 `classifyPath`，擋住連結、其他磁碟與 UNC 路徑。
6. MCP 同時連線時共用同一個伺服器程序。
7. 派工要不要跑測試，看開工時 commit 的 `package.json`；停止後不會再把任務送給 OpenCode。
8. 刪死碼：`network` 效果、不會發生的 LangGraph 中斷處理、沒有呼叫者的函式；移除 `pptx-automizer`。
9. 評測逐題把關（`evals/gate.ts`）：某一題通過率掉一半以上就擋；記錄每題 token；`--mode` 選核准模式。
10. CMap 中文 PDF、系統 `.ttc` 字型的測試改測 `src`；工具測試的每個事件都檢查 AG-UI 1.0 schema。

## 待擁有者決定

- 核准模式：「放手」要不要變成只剩禁止規則與讀機密檔才問（Kimi 式）；要不要保留「每次問」。
- 「這個對話都允許」改成依類別放行；「一律允許」改成從核准面板直接存成指令前綴規則，取代規則建議。
- 讀機密檔從拒絕改成詢問與否。
- 方案審查改成一般提問，或移除。
- 這些決定另寫一份 ADR，再重寫政策核心。

## 下一批（不需要改變行為的部分）

- 文件與註解跟程式一致（README 的 Windows 驗證說法、瀏覽器 cookie 的說法）。
- 每次啟動 OpenCode 給一組隨機的 `OPENCODE_SERVER_PASSWORD`；OpenCode 設定裡讀 `*.env` 改成詢問；grep 結果過濾掉機密檔。
- 共用的測試骨架、route 驗證輔助函式、前後端共用型別、記錄模型看到的系統提示與工具清單的 golden 測試、分層檢查測試。

## 驗證

| 平台                                            | 指令                                                                     | 結果                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| 雲端 Linux，Node 24.21.0，git 2.43              | `npm run check`、`npm run build`                                         | 通過，157 個測試；每個修正先看到測試失敗再修            |
| 同上，OpenCode 1.18.34，假模型                  | `ROCKY_REQUIRE_OPENCODE=1 npx vitest run tests/integration/jobs.test.ts` | 4 個通過                                                |
| 同上，Command Code `deepseek/deepseek-v4-flash` | `npm run eval -- --repeat 3`                                             | 93/93，沒有任何一題退步（前一份基線 92/93）；存為新基線 |

- **沒有在 Windows 上跑過。** 新分支不會自動觸發 CI（只在 PR 或推到 `main` 時跑），手動觸發被拒（403）。
