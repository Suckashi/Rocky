# Rocky 架構（重做版 V1）

> 狀態：依程式碼重寫，2026-10-08（分支 `claude/rocky-rebuild`）。這份文件描述**現在的程式實際怎麼做**；
> 往哪裡調整見最後一節與 ADR 0012。ADR 改變了這裡寫的東西時，要在同一個 commit 更新這份文件。

## 形狀

```
瀏覽器（React 19 + Vite，zh-TW / en，Roko）
   │  AG-UI over HTTP + SSE（CopilotKit 當傳輸與對話清單），只連 127.0.0.1，每個請求都要 token
   ▼
Rocky 程序（Node 24，單一程序；src/server/compose.ts 組裝全部元件）
 ├─ http/        Hono：安全 guard、一次性登入碼、各功能的 routes、CopilotKit 端點（RockyAgentRunner）
 ├─ agent/       Deep Agents 1.14.1（LangChain v1 + LangGraph）；gate-middleware 攔每一個工具呼叫
 ├─ effects/     動作關卡：政策 → 核准 → 通行證 → 執行器 → 操作紀錄、快照、還原、規則
 ├─ jobs/ external/   派工：OpenCode 走 ACP，在 git worktree 裡做；Rocky 自己 diff、跑檢查，套用要你按
 ├─ mcp/         MCP client（stdio 子程序或 HTTP）
 ├─ documents/   md、html、docx、xlsx、pptx、pdf 的讀、建、改（純 Node）
 ├─ memory/ skills/   Markdown 記憶檔、SKILL.md
 ├─ store/       node:sqlite：對話、執行、設定、操作紀錄、快照、規則、工作
 └─ platform/    資料夾位置、對外白名單（EgressGuard）、開瀏覽器
```

資料在 `%LOCALAPPDATA%\Rocky`（Windows），不進 Git、不送遙測。

## 技術層次（Deep Agents 與 LangChain 的關係）

```
Deep Agents   待辦清單、子代理、檔案工具、上下文壓縮（每個都是一個 middleware）
   │ 蓋在
LangChain v1  agent 迴圈、工具、middleware 掛勾點、模型介面（@langchain/openai）
   │ 蓋在
LangGraph     逐步執行
```

三者一起鎖版本、一起升級，升級後一起跑評測。Rocky 每一輪重新建立一次 agent，**沒有用 LangGraph 的 checkpointer 或
`interruptOn`**：等你核准時，工具呼叫在關卡裡等一個程序內的 Promise（`effects/gate.ts`），重開 Rocky 後不會接著跑，
未完成的動作標成「結果不明」。

## 動作關卡：一個獨立模組，兩道防線

1. **動作關卡是獨立模組**（`src/server/effects/`），不 import Deep Agents。依 `approvals.md` 的順序決定要不要問，
   核准時發一張綁定內容雜湊的通行證，並先寫「意圖」操作紀錄。Rocky 的 agent、子代理、OpenCode（ACP）、MCP、
   介面上的「還原」與「套用工作」都呼叫同一個關卡。
2. **第一道防線：工具入口**。LangChain v1 的 `wrapToolCall` middleware（`agent/gate-middleware.ts`）在每個工具執行前
   呼叫關卡；子代理另外掛同一個 middleware（Deep Agents 不會自動套用）。它也把每個工具結果截到 6 萬字，
   低於 Deep Agents 把大結果寫成檔案的門檻。
3. **第二道防線：執行器看通行證**（`effects/execute.ts`）。寫檔和執行指令只接受關卡發的通行證並比對雜湊。
   真正有作用的地方是**等待核准期間內容變了**：`write_file`、`edit_file`、`run_command` 在執行時重算內容，
   檔案被改過就拒絕；還原和套用工作會再比對你看到的雜湊。其他呼叫點比對的是同一個物件，等於自己比自己
   （ADR 0012 計畫改成單一的 `perform()`）。
4. **和 Deep Agents 的接點**：關卡 middleware；檔案後端用組合包住 `FilesystemBackend`（`virtualMode: true`），
   讀取、搜尋交給它，寫入改走 Rocky 的執行器；Deep Agents 的 shell（`execute`）和 `delete` 用 harness profile 拿掉，
   換成 Rocky 的 `run_command`。
5. **還沒有 OS 沙箱**：指令以你的使用者權限執行。

## 關鍵決策（與實際做法）

| 決策            | 現在的做法                                                                                                                                                               | 理由／舊 Rocky 的教訓                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 程序模型        | 單一 Node 程序；外部 agent 和 MCP server 是子程序                                                                                                                        | 舊版的 IPC 造成逾時、錯誤被壓平                           |
| Agent 框架      | Deep Agents JS + LangGraph，鎖定版本；權限判斷一律在動作關卡                                                                                                             | 現成的待辦、子代理、壓縮；ADR 0001 記錄了接縫的代價       |
| 模型            | 只接 OpenAI 相容端點（`@langchain/openai`，最多重試 3 次）；不接 Anthropic 格式（ADR 0002）                                                                              | 舊版自寫 adapter 讓快取失效、429 不重試                   |
| 外部 agent      | ACP（`@agentclientprotocol/sdk`），只回 `allow_once` / `reject_once`；worktree 的變更以開工時的 commit 為準（`git diff --no-renames <base>`）                            | 「一律允許」留在 Rocky；Rocky 自己 diff 和跑檢查          |
| 指令            | 用 argv 陣列執行，不經 shell 字串（cross-spawn 處理 `.cmd`）；規則以 argv token 比對，會拆開 `sh -c`、`cmd /c`、`powershell -Command`；取消時用 `taskkill /T` 結束行程樹 | 比對字串很容易被繞過                                      |
| 操作紀錄        | 執行前寫意圖，執行後寫結果；結果只有成功、失敗、不明；程序拿到 port 之後才把上次未完成的標成不明                                                                         | 不明的動作永遠不自動重做                                  |
| 本機安全        | token 存在只有使用者能讀的檔案；瀏覽器用一次性登入碼換 HttpOnly cookie；檢查 Host、Origin、Sec-Fetch-Site；子程序拿不到 token                                            | 舊版的 token 不需驗證就拿得到                             |
| 遮蔽            | 只用在日誌和 UI 顯示                                                                                                                                                     | 舊版的遮蔽器把 `[REDACTED]` 寫回了程式碼                  |
| 記憶與搜尋      | 記憶是 Markdown 檔，用 grep 搜尋（中文沒問題）；**沒有** SQLite FTS5                                                                                                     | 多到載不完時再補搜尋工具                                  |
| 文件            | md：markdown-it；docx：docx + mammoth + OOXML 直接編輯；xlsx：exceljs；pptx：pptxgenjs + OOXML 編輯；pdf：unpdf（pdfjs-dist 提供 CJK CMaps）讀、pdf-lib + fontkit 建     | 沒有 Office；PDF 由 Rocky 直接產生，**沒有**用 Edge 轉檔  |
| UI 框架         | React 19 + Vite，自己的 design tokens                                                                                                                                    | 不 import OpenDots 的 CSS                                 |
| UI 與後端的協定 | CopilotKit（`useAgent`、`useThreads`）+ AG-UI 標準事件；`RockyAgentRunner` 把對話存在本機 SQLite；核准面板、工具卡是 Rocky 自己的元件，決定送到 Rocky 的核准 API         | 不用 CopilotKit Intelligence 雲端                         |
| 多語系          | 介面文字都在 `zh-TW`、`en` 語系檔；`check-i18n` 檢查兩邊 key 一致、元件裡沒有寫死的字串                                                                                  | 舊 Rocky 的畫面中英混雜                                   |
| HTTP 伺服器     | Hono + `@hono/node-server`                                                                                                                                               | 照 OpenDots 的 composition root、單一 guard、有期限的關機 |

**文件寫過但沒有做的**：Tiptap 文件編輯器、用系統 Edge 把 HTML 轉 PDF、SQLite FTS5 中文搜尋、Windows Job Object、
自己的 node:sqlite checkpointer、「探索者」「審查者」子代理。需要時另寫 ADR 再做。

### 從 OpenDots 借什麼（MIT，出處記在 `THIRD_PARTY_NOTICES.md`）

| 借                                                             | 不借                                            |
| -------------------------------------------------------------- | ----------------------------------------------- |
| 版面：左側 rail、側欄、對話欄、右側面板，以及斷點              | CopilotKit Intelligence 雲端對話、Slack、語音   |
| 工具卡：用人話的動詞標籤；沒完成就顯示「已中斷」，絕不顯示成功 | Docker 電腦服務、遠端 owner token、多使用者欄位 |
| 審查卡：決定後保留成操作紀錄、「核准前不會有任何變更」         | 由瀏覽器執行副作用                              |
| `Mascot` 元件模式（依狀態切換）→ Roko 的動畫                   | 輪詢迴圈、`window.prompt`、單檔巨型 `App.tsx`   |
| API guard、有期限的關機                                        | TanStack AI（模型層用 LangChain provider）      |

## Deep Agents 能力對照（deepagents 1.14.1）

原則：**能用 Deep Agents 原本的就用；只在「會改變外部世界」的那一刻接上 Rocky 的動作關卡。**

| Deep Agents 能力                                                         | Rocky 怎麼用      | 說明                                                                                                              |
| ------------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| 待辦清單（`write_todos`）                                                | ✅ 照用           | 明確加上 `todoListMiddleware()`（非 Codex 模型預設沒有）                                                          |
| 子代理（`task`）                                                         | ✅ 一個，唯讀     | 內建通用子代理，掛上關卡 middleware；任何會改變東西的工具都被拒絕，請它把發現回報給 Rocky                         |
| 檔案工具（`ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`） | ✅ 照用，只換寫入 | 用組合包住 `FilesystemBackend`（`virtualMode: true`）；寫入走 Rocky 的執行器                                      |
| Shell（`execute`）、`delete`                                             | 🔁 拿掉           | harness profile 排除；改用 `run_command`                                                                          |
| 上下文壓縮                                                               | ✅ 照用           |                                                                                                                   |
| 大結果卸載（超過約 8 萬字寫成檔案）                                      | 🔁 用截斷取代     | 寫入沒有通行證會失敗，所以 Rocky 在 middleware 把結果截到 6 萬字                                                  |
| 記憶、技能 middleware                                                    | 🔁 自己的         | 記憶（`memory/`）、技能（`skills/`）是 Rocky 自己的工具與提示；專案的 `AGENTS.md` 每輪放進系統提示（最多 2 萬字） |
| 人工介入（`interruptOn`）、Checkpointer                                  | ❌ 不用           | 核准在關卡裡等待；歷史由 `RockyAgentRunner` 存在 SQLite                                                           |
| 非同步子代理、雲端沙箱                                                   | ❌ 不用           | 需要遠端服務                                                                                                      |

## 往哪裡調整（ADR 0012）

2026-10-08 對照 OpenCode、Kimi CLI、DeepSeek Harness、OpenDots 檢查後的結論：程式量不大（`src/` 約 1.17 萬行），
複雜度在概念與暗中的連接。方向是**先減法、再收斂邊界，最後用評測數字決定要不要換掉框架**，不重寫。

目標的依賴方向（之後用 ESLint `no-restricted-imports` 檢查）：

```
shared ← os, store ← effects ← tools, jobs, external, documents, memory, skills, mcp ← agent ← http ← compose/main
web 只 import shared 的型別；每個第三方 SDK 只在一個資料夾裡被 import。
```

階段與待你決定的事項見 `docs/adr/0012-architecture-review.md`。
