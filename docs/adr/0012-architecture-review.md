# ADR 0012：架構檢查與「現在」階段

- 日期：2026-10-08
- 狀態：「現在」階段已採用；「下一步」「之後」待擁有者決定
- 程式：`src/server/external/worktree.ts`、`src/server/jobs/{apply,runner}.ts`、`src/server/compose.ts`、`src/server/main.ts`、
  `src/server/agent/{rocky-agent,gate-middleware,documents,to-agui}.ts`、`src/server/skills/store.ts`、`src/server/mcp/manager.ts`、
  `src/server/effects/{policy,types}.ts`、`evals/{gate,run}.ts`
- 測試：`tests/unit/{worktree,eval-gate,mcp-manager,skills,agent-history,agent-runner,success-criteria,documents}.test.ts`、
  `tests/integration/{agent-tools,jobs}.test.ts`

## 背景

擁有者要求對照 OpenCode（a697115）、Kimi CLI（9ab1286）、DeepSeek Harness（5badb15）、OpenDots（565bf78）重新檢查架構。
40 個代理只讀程式碼：7 個讀 Rocky、4 個讀參考專案、4 個架構師各提一個方向、3 個評審打分、20 個反向驗證關鍵說法。

結論：`src/` 只有 11,780 行，複雜度不在程式量，而在概念與暗中的連接。

- agent 層 1,801 行中約 890 行只為了接 Deep Agents、LangGraph、AG-UI、CopilotKit。
- 動作關卡要理解約 33 個概念，其中幾個沒有作用。
- 一段對話最多存在 6 個地方。
- lockfile 1,196 個套件中約 588 個只因 CopilotKit 而來。

四個方向的評分：先刪再說 24.5、自己寫迴圈 18.5、切清楚邊界 18.5、單一事件紀錄 14.5。
採用「先刪再說」為主，接上「切清楚邊界」的做法，不重寫。

## 決定（「現在」階段，已完成）

1. **修讀程式時找到的缺陷，每個先寫能重現的測試。**
   - 派工的變更以開工時的 commit 為準：`git diff --no-renames <base>`，先把新檔案登記為 intent-to-add；驗證與套用共用同一份清單。
     之前 OpenCode 在 worktree 裡 commit，成果會被當成「沒有變更」並刪掉；搬移檔案會被解析成專案根目錄的錯誤路徑。
   - 上次未完成的動作、工作、執行，改在程序拿到 port 之後才標成不明；第二個 Rocky 啟動失敗時不再改到正在跑的那個。
     中斷的執行會被關閉，不再每次啟動都重算。
   - 歷史裡被截斷的工具參數不再讓整個對話壞掉。
   - 工具結果統一截到 6 萬字，低於 Deep Agents 寫檔卸載的門檻；之前長文件、長輸出讓模型收到「無法儲存」的錯誤。
   - 技能檔案的路徑檢查改用關卡的 `classifyPath`，擋住連結、其他磁碟與 UNC 路徑。
   - MCP 同時連線時共用同一個伺服器程序。
   - 派工要不要跑測試，看開工時 commit 的 `package.json`；停止後不會再把任務送給 OpenCode。
2. **移除 spikes。** `spikes/` 與 `tests/spikes/` 刪除，程式留在 Git 歷史（1e54ec8）。假模型伺服器移到
   `tests/fixtures/`；CMap 中文 PDF、系統 `.ttc` 字型改測 `src`；工具測試的每個事件都檢查 AG-UI 1.0 schema。
   移除 `pptx-automizer`。沒有打 tag：AGENTS.md 規定打 tag 要擁有者同意。
3. **刪死碼。** 沒有任何地方產生的 `network` 效果、不會發生的 LangGraph 中斷處理、沒有呼叫者的函式與事件類型。
   「放手」的說明文字改成實話：目前和「需要時才問」相同。
4. **評測逐題把關**（`evals/gate.ts`）。某一題的通過率掉一半以上（3/3→1/3、2/3→0/3）就擋；較小的變動只提示。
   記錄每題的 token 用量；`--mode` 可以用其他核准模式跑；基線只存每題的數字，完整紀錄留在 `evals/results/`。
5. **文件跟程式一致。** `architecture.md` 依程式重寫，寫明沒有做的東西；`approvals.md` 更正 session 核准的範圍與「放手」的現況。

## 待擁有者決定

| 事項                                                                                        | 建議                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 「放手」改成 Kimi 的 yolo：只剩你的禁止規則                                                 | 採用，但「需要時才問」維持預設；附一份可編輯的預設禁止清單（force push、刪整個磁碟）；另建 `--mode hands-off` 的評測基線 |
| 「放手」下讀 `.env`                                                                         | 維持拒絕                                                                                                                 |
| 方案審查：刪掉改用文字問，或保留成一般提問卡                                                | 先刪掉沒有作用的「預先核准指令」，其餘等你決定                                                                           |
| 記憶不經過關卡（它是 Rocky 自己的資料）                                                     | 採用；代價是記憶的修改不能還原                                                                                           |
| 對話歷史改由伺服器保存時，舊對話遷移或重置                                                  | 待定                                                                                                                     |
| AGENTS.md：「ADR 推翻 architecture.md 時要在同一個 commit 更新它」                          | 採用                                                                                                                     |
| AGENTS.md：依賴方向（shared ← os、store ← effects ← tools… ← agent ← http），用 ESLint 檢查 | 採用，先 warn 再改 error                                                                                                 |

## 下一步與之後

- **下一步**（約 3 週）：每個工具在一個檔案裡帶著自己的效果；用 `perform()` 取代通行證（保留「等待期間內容變了就拒絕」）；
  模式與 session 核准（依你的決定）；`os/` 模組統一 spawn、子程序環境、路徑檢查；假的 ACP agent 讓派工在 CI 上跑；
  `jobs.project` 欄位取代 `projectFor`。
- **之後**（先量評測再決定）：伺服器保存對話歷史；自己的 SSE 取代 CopilotKit；自己的迴圈取代 Deep Agents（用開關做 A/B）；
  每輪的影子 git 快照，讓指令造成的檔案損壞也能還原。

## 驗證

| 平台                                            | 指令                                                                     | 結果                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| 雲端 Linux，Node 24.21.0，git 2.43              | `npm run check`                                                          | 見下方 commit 說明；每個修正先看到測試失敗再修 |
| 同上，OpenCode 1.18.34，假模型                  | `ROCKY_REQUIRE_OPENCODE=1 npx vitest run tests/integration/jobs.test.ts` | 3 個通過                                       |
| 同上，Command Code `deepseek/deepseek-v4-flash` | `npm run eval -- --repeat 3`                                             | 見下方                                         |

- **沒有在 Windows 上跑過。** worktree 的 junction、`git ls-files` 排除 `node_modules`、技能路徑在真實 Windows 上的行為，
  要等 Windows CI 與擁有者的電腦。
