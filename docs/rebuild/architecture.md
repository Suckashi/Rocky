# Rocky 架構（V1）

> 2026-10-05 定案，2026-10-08 依實作更新。全 TypeScript、單一程序。原則：**能跟 OpenDots 一樣的就一樣，
> 只在關鍵處做 Rocky 的轉換**（本機儲存、核准權威、Deep Agents、ACP、文件）。各項決定的由來與驗證記在 `docs/adr/`。

## 形狀

```
瀏覽器 (React + Vite, zh-TW / en, Roko)
   │  HTTP + SSE，只連 127.0.0.1，每個請求都要驗證
   ▼
Rocky 程序 (Node 24, 單一程序)
 ├─ 對話：CopilotKit runtime + RockyAgentRunner，對話與事件存在 node:sqlite
 ├─ 動作關卡：政策 → 核准 → 通行證 → 執行 → 操作紀錄（見 approvals.md）
 ├─ 快照庫：寫入前後的內容定址備份，用來還原
 ├─ Agent：Deep Agents JS（同一程序內執行，鎖定版本）
 ├─ 模型層：@langchain/openai 的 ChatOpenAI（OpenAI 相容端點、OpenAI、Ollama 的 /v1）
 ├─ 背景工作：ACP client 啟動 OpenCode，一次一個、其他排隊（ADR 0012）
 ├─ MCP client：使用者設定的 stdio／HTTP server
 ├─ 文件工具：純 Node 函式庫（md、html、docx、xlsx、pptx、pdf）與版面預覽
 └─ 儲存：node:sqlite（內建，不需編譯）＋ 檔案（記憶、技能、快照、worktree）
```

程式位置：`src/server/`（`compose.ts` 組裝、`start.ts` 入口；`http/`、`effects/`、`agent/`、`external/`、`jobs/`、
`mcp/`、`documents/`、`memory/`、`skills/`、`store/`、`platform/`）、`src/web/`、`src/shared/`。

## 技術層次（Deep Agents 與 LangChain 的關係）

```
Deep Agents   待辦清單、子代理、檔案工具、上下文壓縮（每個都是一個 middleware）
   │ 蓋在
LangChain v1  agent 迴圈、工具、middleware 掛勾點、模型介面（@langchain/openai）
   │ 蓋在
LangGraph     逐步執行
```

只有一個 agent 執行環境，就是 Deep Agents。LangChain、LangGraph 是它底下的層，不是另一套框架；
三者一起鎖版本、一起升級，升級後一起跑評測。

## 動作關卡：一個獨立模組，兩道防線

業界做法（Claude Code、Codex、Kimi Code）都是把權限判斷做成獨立模組，在「工具執行前」這一個統一入口攔截；
最好的再加 OS 沙箱當最後保險。Rocky 在 Windows 原生、不需要管理員權限的前提下，這樣做：

1. **動作關卡是獨立模組**（`src/server/effects/`），不 import Deep Agents。
   - 介面只有一件事：「誰想做什麼」→ 依 `approvals.md` 的判斷順序決定 → 需要時問你 → 發一張綁定內容雜湊的**通行證** → 寫操作紀錄。
   - Rocky 的 agent、OpenCode（ACP）、MCP、介面上的「還原」與「套用」按鈕，都呼叫同一個關卡。
2. **第一道防線：工具入口**。用 LangChain v1 的 `wrapToolCall` middleware，在每一個工具執行前呼叫關卡；子代理掛同一個 middleware。新增的工具自動受管，未知工具當成對外動作。
3. **第二道防線：真正動手的函式要看通行證**。寫檔、執行指令的底層函式只接受關卡發的一次性通行證，並比對雜湊；任何繞過第一道防線的路徑都會在這裡失敗。這是 Windows 上沒有 OS 沙箱時的替代保險。
4. **等待核准在程序內進行**，不用 LangGraph interrupt 與 checkpointer：待核准的事情用 AG-UI `STATE_SNAPSHOT` 送到介面，
   使用者帶著看到的內容雜湊回覆。Rocky 在等待時重啟，那個動作不會執行，也不會自動重做（ADR 0007）。
5. **和 Deep Agents 的接點只有兩個薄轉接層**：關卡 middleware；檔案後端用「組合」包住 `FilesystemBackend`（讀取交給它，寫入改呼叫 Rocky 的寫檔函式），不用繼承。
6. **之後**：OS 沙箱（例如參考 Codex 的 Windows 沙箱）可以當第三層加上去，關卡的介面不變。

## 關鍵決策

| 決策            | 選擇                                                                                                                                                                                                                                                                                                                                                                                                                  | 理由／舊 Rocky 的教訓                                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 程序模型        | 單一 Node 程序，不拆 worker、不自己寫 IPC                                                                                                                                                                                                                                                                                                                                                                             | 舊版的 IPC 造成逾時、錯誤被壓平、快取失效                                                                                                                                                                         |
| Agent 框架      | Deep Agents JS + LangGraph，鎖定版本，每次升級都重跑評測                                                                                                                                                                                                                                                                                                                                                              | 有子代理、上下文壓縮；但它只負責規劃，**權限判斷一律在動作關卡**                                                                                                                                                  |
| 模型            | 用 LangChain 官方 provider 套件（`@langchain/openai`），不自己寫 adapter；只走 OpenAI 格式（ADR 0002）                                                                                                                                                                                                                                                                                                                | 舊版自寫的 adapter 讓快取失效、429 不重試                                                                                                                                                                         |
| 外部 agent      | ACP（`@agentclientprotocol/sdk` 1.x），只回 `allow_once` / `reject_once`                                                                                                                                                                                                                                                                                                                                              | 「一律允許」的規則留在 Rocky；外部 agent 在 worktree 裡工作，Rocky 用 diff 對帳                                                                                                                                   |
| 指令規則        | 以 argv token 比對；禁止優先於允許；不經 shell 直接傳 argv（`cross-spawn` 處理 Windows 的 `.cmd`）；逾時或停止時結束整個程序樹（Windows 用 `taskkill /T /F`）                                                                                                                                                                                                                                                         | 比對字串很容易被繞過                                                                                                                                                                                              |
| 核准綁定        | 核准時記錄內容雜湊（工具 + 正規化 argv 或檔案內容 + cwd），執行前重算                                                                                                                                                                                                                                                                                                                                                 | 內容一變就重問                                                                                                                                                                                                    |
| 操作紀錄        | 執行前先寫意圖操作紀錄，執行後寫結果；逾時、程序被殺、斷線都算 unknown                                                                                                                                                                                                                                                                                                                                                | unknown 永遠不自動重做                                                                                                                                                                                            |
| 本機安全        | token 存在只有使用者能讀的檔案，瀏覽器用一次性登入碼換 cookie；檢查 Host 和 Origin；子程序的環境變數裡不放 token；對外連線白名單                                                                                                                                                                                                                                                                                      | 舊版的 token 不需驗證就拿得到                                                                                                                                                                                     |
| 遮蔽            | 只用在日誌和 UI 顯示                                                                                                                                                                                                                                                                                                                                                                                                  | 舊版的遮蔽器把 `[REDACTED]` 寫回了程式碼                                                                                                                                                                          |
| 中文搜尋        | 記憶搜尋用中文二字組＋英文單字比對（ADR 0009）；檔案搜尋用 Deep Agents 的 `grep`                                                                                                                                                                                                                                                                                                                                      | 舊版 FTS5 查不到中文                                                                                                                                                                                              |
| 文件            | md：markdown-it；docx：docx + mammoth + OOXML 直接編輯；xlsx：exceljs（開檔時重算）；pptx：pptxgenjs + pptx-automizer；pdf：unpdf（附 CJK cmaps）+ pdf-lib + fontkit；預覽：pdf.js + `@napi-rs/canvas`                                                                                                                                                                                                                | 沒有 Office，也不需要 LibreOffice                                                                                                                                                                                 |
| 資料位置        | `%LOCALAPPDATA%\Rocky`（Windows）、`~/.local/share/rocky`                                                                                                                                                                                                                                                                                                                                                             | 不進 Git、不送遙測                                                                                                                                                                                                |
| UI 框架         | React 19 + Vite（與 OpenDots 相同），用自己的 design tokens（`src/web/styles/tokens.css`）                                                                                                                                                                                                                                                                                                                            | 不 import OpenDots 的 CSS                                                                                                                                                                                         |
| UI 與後端的協定 | **照 OpenDots：CopilotKit（`@copilotkit/react-core` v2 + `@copilotkit/runtime`）+ AG-UI**。關鍵轉換：不用 Intelligence 雲端，自己實作 `RockyAgentRunner`（CopilotKit 的 `AgentRunner`：`run`、`connect`、`isRunning`、`stop`），對話與事件存在 `node:sqlite`；工具與狀態送 AG-UI 標準事件（`TOOL_CALL_*`、`STATE_*`），不用 `CUSTOM` 事件比對名稱；核准的決定送到 Rocky 的核准 API，由 Rocky 綁雜湊、寫操作紀錄、執行 | 跟 OpenDots 一致，就能直接沿用它的對話與工具卡元件。官方的 `@copilotkit/sqlite-runner` 依賴 `better-sqlite3`，在 Windows 上有原生編譯風險，所以不用它。舊 Rocky 也用 CopilotKit，但只用到 `CUSTOM` 事件，這次修正 |
| 多語系          | 所有介面文字放在語系檔（`zh-TW`、`en`），設定頁切換並記住；日期、數字用 `Intl` 格式化；`npm run check` 檢查兩邊的 key 一致、元件裡沒有寫死的字串                                                                                                                                                                                                                                                                      | 舊 Rocky 的 i18n 只做一半，畫面中英混雜                                                                                                                                                                           |
| HTTP 伺服器     | Hono + `@hono/node-server`（與 OpenDots 相同）                                                                                                                                                                                                                                                                                                                                                                        | 小、型別好；照 OpenDots 的 composition root、依功能分的 route 模組、單一安全 guard、有期限的優雅關機                                                                                                              |

### 從 OpenDots 借什麼（MIT，出處記在 `THIRD_PARTY_NOTICES.md`）

| 借                                                             | 不借                                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 版面：左側 rail、側欄、對話欄、右側面板，以及斷點              | CopilotKit Intelligence 雲端對話、Slack、語音                                                 |
| 工具卡：用人話的動詞標籤；沒完成就顯示「已中斷」，絕不顯示成功 | Docker 電腦服務、遠端 owner token、多使用者欄位                                               |
| 審查卡：決定後保留成操作紀錄、「核准前不會有任何變更」         | 由瀏覽器執行副作用                                                                            |
| `Mascot` 元件模式（依狀態切換）→ 換成 Roko 的 spritesheet 動畫 | 輪詢迴圈、`window.prompt`、單檔巨型 `App.tsx`                                                 |
| 首次使用的設定流程                                             | TanStack AI（模型層改用 LangChain provider，透過 CopilotKit 的 LangGraph 整合接 Deep Agents） |

## Deep Agents 能力對照（deepagents 1.14.1）

原則：**能用 Deep Agents 原本的就用；只在「會改變外部世界」的那一刻接上 Rocky 的動作關卡。**

| Deep Agents 能力                                                         | Rocky 怎麼用      | 說明                                                                                                                                                              |
| ------------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 待辦清單（`write_todos`）                                                | ✅ 照用           | 明確加上 `todoListMiddleware()`（ADR 0001 發現 2）                                                                                                                |
| 子代理（`task`，隔離上下文）                                             | ✅ 改成唯讀       | 只有一個研究用子代理，掛同一個關卡 middleware；會改變東西的工具一律拒絕，由 Rocky 動手（ADR 0010）                                                                |
| 分叉子代理、非同步子代理                                                 | ❌ 不用           | 背景工作由 Rocky 的工作佇列負責（ADR 0012）                                                                                                                       |
| 檔案工具（`ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`） | ✅ 照用，只換寫入 | 用「組合」包住 `FilesystemBackend`（`virtualMode: true`）：讀取、搜尋、路徑與 symlink 檢查交給它；寫入改呼叫 Rocky 的寫檔函式（要有通行證、會存快照、寫操作紀錄） |
| Shell 執行（`execute`）、`delete`                                        | 🔁 換成自己的     | 用 harness profile 拿掉；改用 `run_command`：拆成參數陣列 → 過動作關卡 → 不經 shell 執行 → 寫操作紀錄                                                             |
| 人工介入（`interruptOn`）與 Checkpointer                                 | ❌ 不用           | 核准在程序內等待（ADR 0007）；對話歷史由 `RockyAgentRunner` 存在 `node:sqlite`                                                                                    |
| 上下文壓縮、大結果卸載                                                   | ✅ 照用           | 沿用 Deep Agents 預設，Rocky 沒有另外設定                                                                                                                         |
| 專案說明（`AGENTS.md`）                                                  | 🔁 換成自己的     | 每一輪把專案根目錄的 `AGENTS.md`（最多 2 萬字）放進系統提示（ADR 0010）                                                                                           |
| 長期記憶、技能                                                           | 🔁 換成自己的     | Rocky 自己的 `remember`／`forget`／`search_memory` 與 `load_skill` 工具；記憶寫入走關卡、有快照可撤銷；技能只是文字，不帶任何權限（ADR 0009）                     |
| Harness profile                                                          | ✅ 一定要設定     | Rocky 自己提供系統提示詞；1.14.1 起不認得的模型拿到的是空 profile                                                                                                 |
| 雲端沙箱（LangSmith Sandbox、ContextHub）                                | ❌ 不用           | 雲端服務                                                                                                                                                          |
