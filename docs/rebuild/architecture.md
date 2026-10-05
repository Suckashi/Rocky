# Rocky 架構（重做版 V1）

> 狀態：草稿，2026-10-05。選定方案：A，全 TypeScript、單一程序。原則：**能跟 OpenDots 一樣的就一樣，只在關鍵處做 Rocky 的轉換**（本機儲存、核准權威、Deep Agents、ACP、文件）。

## 形狀

```
瀏覽器 (React + Vite, zh-TW / en, Roko)
   │  HTTP + SSE，只連 127.0.0.1，每個請求都要 token
   ▼
Rocky 程序 (Node 24, 單一程序)
 ├─ Work 服務：對話、背景工作、狀態機（Rocky 是唯一權威）
 ├─ 動作關卡：政策 → 核准 → 執行 → 操作紀錄（見 approvals.md）
 ├─ 快照庫：T1 寫入前的內容定址備份，用來還原
 ├─ Agent：Deep Agents JS（同一程序內執行，鎖定版本）
 ├─ 模型層：OpenAI 相容 / OpenAI / Anthropic / Ollama（官方 SDK，有快取與重試）
 ├─ ACP client：啟動 OpenCode（之後是 Codex、Claude Code、Kimi）
 ├─ MCP client：使用者設定的 server
 ├─ 文件工具：純 Node 函式庫，加上用系統 Edge 轉 PDF
 └─ 儲存：node:sqlite（內建，不需編譯）＋ 檔案（記憶、技能、快照）
```

## 技術層次（Deep Agents 與 LangChain 的關係）

```
Deep Agents   待辦清單、子代理、檔案工具、上下文壓縮（每個都是一個 middleware）
   │ 蓋在
LangChain v1  agent 迴圈、工具、middleware 掛勾點、模型介面（@langchain/openai 等）
   │ 蓋在
LangGraph     逐步執行、暫停、中斷後接著跑（checkpointer）
```

只有一個 agent 執行環境，就是 Deep Agents。LangChain、LangGraph 是它底下的層，不是另一套框架；
三者一起鎖版本、一起升級，升級後一起跑評測。

## 動作關卡：一個獨立模組，兩道防線

業界做法（Claude Code、Codex、Kimi Code）都是把權限判斷做成獨立模組，在「工具執行前」這一個統一入口攔截；
最好的再加 OS 沙箱當最後保險。Rocky 在 Windows 原生、不需要管理員權限的前提下，這樣做：

1. **動作關卡是獨立模組**（`src/server/effects/`），不 import Deep Agents。
   - 介面只有一件事：「誰想做什麼」→ 依 `approvals.md` 的判斷順序決定 → 需要時問你 → 發一張綁定內容雜湊的**通行證** → 寫操作紀錄。
   - Rocky 的 agent、OpenCode（ACP）、MCP、介面上的「還原」按鈕，都呼叫同一個關卡。
2. **第一道防線：工具入口**。用 LangChain v1 的 `wrapToolCall` middleware，在每一個工具執行前呼叫關卡；子代理掛同一個 middleware。新增的工具自動受管。
3. **第二道防線：真正動手的函式要看通行證**。寫檔、執行指令、呼叫 MCP 的底層函式只接受關卡發的通行證，並比對雜湊；任何繞過第一道防線的路徑都會在這裡失敗。這是 Windows 上沒有 OS 沙箱時的替代保險。
4. **和 Deep Agents 的接點只有兩個薄轉接層**：關卡 middleware；檔案後端用「組合」包住 `FilesystemBackend`（讀取交給它，寫入改呼叫 Rocky 的寫檔函式），不用繼承。
5. **之後**：OS 沙箱（例如參考 Codex 的 Windows 沙箱）可以當第三層加上去，關卡的介面不變。

## 關鍵決策

| 決策 | 選擇 | 理由／舊 Rocky 的教訓 |
|---|---|---|
| 程序模型 | 單一 Node 程序，不拆 worker、不自己寫 IPC | 舊版的 IPC 造成逾時、錯誤被壓平、快取失效 |
| Agent 框架 | Deep Agents JS + LangGraph，鎖定版本，每次升級都重跑評測 | 有 checkpoint、interrupt、子代理、上下文壓縮；但它只負責規劃，**權限判斷一律在動作關卡**，checkpoint 不能當副作用的真相 |
| 模型 | 用 LangChain 官方 provider 套件，不自己寫 adapter | 舊版自寫的 adapter 讓快取失效、429 不重試 |
| 外部 agent | ACP（`@agentclientprotocol/sdk` 1.x），只回 `allow_once` / `reject_once` | 「一律允許」的規則留在 Rocky；外部 agent 在 worktree 裡工作，Rocky 用 diff 對帳 |
| 指令規則 | 以 argv token 比對；禁止優先於允許；Windows 上不經 shell 直接傳 argv；用 Job Object 管住行程樹 | 比對字串很容易被繞過 |
| 核准綁定 | 核准時記錄內容雜湊（工具 + 正規化 argv 或 diff + cwd），執行前重算 | 內容一變就重問 |
| 操作紀錄 | 執行前先寫意圖操作紀錄，執行後寫結果；逾時、程序被殺、斷線都算 unknown | unknown 永遠不自動重做 |
| 本機安全 | token 存在只有使用者能讀的檔案；檢查 Host 和 Origin；子程序的環境變數裡不放 token | 舊版的 token 不需驗證就拿得到 |
| 遮蔽 | 只用在日誌和 UI 顯示 | 舊版的遮蔽器把 `[REDACTED]` 寫回了程式碼 |
| 中文搜尋 | SQLite FTS5 trigram 索引，兩個字以下的查詢補用 LIKE；附中文召回測試 | 舊版 FTS5 查不到中文 |
| 文件 | md：markdown-it；docx：docx + mammoth + OOXML 直接編輯；xlsx：exceljs（開檔時重算）；pptx：pptxgenjs + pptx-automizer；pdf：unpdf（附 CJK cmaps）+ pdf-lib + fontkit；HTML 轉 PDF：Playwright 呼叫系統 Edge | 沒有 Office；LibreOffice 是選配 |
| 資料位置 | `%LOCALAPPDATA%\Rocky`（Windows） | 不進 Git、不送遙測 |
| UI 框架 | React 19 + Vite（與 OpenDots 相同），用自己的 design tokens | 不 import OpenDots 的 CSS |
| UI 與後端的協定 | **照 OpenDots：CopilotKit（`@copilotkit/react-core` v2 + `@copilotkit/runtime`）+ AG-UI**。關鍵轉換：不用 Intelligence 雲端，自己實作 `RockyAgentRunner`（CopilotKit 的 `AgentRunner` 抽象類別只有 `run`、`connect`、`isRunning`、`stop`），對話與事件存在 Rocky 的 `node:sqlite`；工具與狀態一律送 AG-UI 標準事件（`TOOL_CALL_*`、`STATE_*`），不用 `CUSTOM` 事件比對名稱；核准卡由 CopilotKit 渲染，但決定送到 Rocky 的核准 API，由 Rocky 綁雜湊、寫操作紀錄、執行 | 跟 OpenDots 一致，就能直接沿用它的對話與工具卡元件。官方的 `@copilotkit/sqlite-runner` 依賴 `better-sqlite3`，在 Windows 上有原生編譯風險，所以不用它。舊 Rocky 也用 CopilotKit，但只用到 `CUSTOM` 事件，這次修正 |
| 多語系 | 所有介面文字放在語系檔（`zh-TW`、`en`），設定頁切換並記住；日期、數字用 `Intl` 格式化；CI 檢查兩邊的 key 一致、元件裡沒有寫死的字串 | 舊 Rocky 的 i18n 只做一半，畫面中英混雜 |
| HTTP 伺服器 | Hono + `@hono/node-server`（與 OpenDots 相同） | 小、型別好；照 OpenDots 的 composition root、依功能分的 route 模組、單一安全 guard、有期限的優雅關機 |
| 文件編輯器 | Tiptap（與 OpenDots 相同）編輯 Markdown 文件，附原始碼模式 | 借用 OpenDots 的自動儲存、修訂版本檢查（防止舊內容覆蓋新內容） |

### 從 OpenDots 借什麼（MIT，出處記在 `THIRD_PARTY_NOTICES.md`）

| 借 | 不借 |
|---|---|
| 版面：左側 rail、側欄、對話欄、右側面板，以及斷點 | CopilotKit Intelligence 雲端對話、Slack、語音 |
| 工具卡：用人話的動詞標籤；沒完成就顯示「已中斷」，絕不顯示成功 | Docker 電腦服務、遠端 owner token、多使用者欄位 |
| 審查卡：決定後保留成操作紀錄、「核准前不會有任何變更」 | 由瀏覽器執行副作用 |
| `Mascot` 元件模式（依狀態切換）→ 換成 Roko 的 spritesheet 動畫 | 輪詢迴圈、`window.prompt`、單檔巨型 `App.tsx` |
| Spaces／文件庫的格狀與清單頁、首次使用卡加範例提示 | TanStack AI（模型層改用 LangChain provider，透過 CopilotKit 的 LangGraph 整合接 Deep Agents） |

## 先驗證再定案（第一週的 spike）

1. OpenCode 在原生 Windows 上跑 `opencode acp`：核准請求、diff、取消、續接。
2. Deep Agents JS 在同一程序裡接 Ollama 和 OpenAI 相容端點：工具呼叫、串流、interrupt、快取用量回報。
3. 在 Windows 上 `npm ci` 確認沒有任何原生編譯（node:sqlite、exceljs、pdf-lib、playwright-core）。
4. 中文 PDF 擷取、中文 docx／xlsx 往返。

## Deep Agents 能力對照（deepagents 1.14.1）

原則：**能用 Deep Agents 原本的就用；只在「會改變外部世界」的那一刻接上 Rocky 的動作關卡。**

| Deep Agents 能力 | Rocky 怎麼用 | 說明 |
|---|---|---|
| 待辦清單（`write_todos`） | ✅ 照用 | 工作詳情頁和對話裡顯示成勾選清單 |
| 子代理（`task`，隔離上下文） | ✅ 照用 | 內建通用子代理，另外定義「探索者」（唯讀搜尋）和「審查者」（驗證成果）；讀取可以平行跑，同一時間只有一個寫手 |
| 分叉子代理（`ForkedSubAgent`） | ✅ 選用 | 繼承主對話的上下文；適合「接著做」的小任務 |
| 非同步子代理（`AsyncSubAgent`） | ❌ 不用 | 需要遠端的 Agent Protocol 伺服器；背景工作改由 Rocky 的 Work 服務負責 |
| 檔案工具（`ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`） | ✅ 照用，只換寫入 | 用「組合」包住 `FilesystemBackend`（`virtualMode: true`）：讀取、搜尋、路徑與 symlink 檢查交給它；寫入改呼叫 Rocky 的寫檔函式（要有關卡發的通行證、會存快照、寫操作紀錄）。權限判斷在關卡 middleware，不在後端 |
| Shell 執行（`LocalShellBackend` 的 `execute`） | 🔁 換成自己的（很薄） | 原本收一整串 shell 字串、沒有核准點、不處理 Windows 的 `.cmd`、PowerShell 與子行程樹，套件文件自己標了安全警告。改用 `run_command`：拆成參數陣列 → 過動作關卡 → 用 Job Object 執行 → 寫操作紀錄 |
| 檔案權限（`permissions`，只有 allow/deny） | ✅ 保留當硬擋 | 用來硬擋機密檔（`.env*`、SSH 金鑰、憑證）；是否要問、留操作紀錄，仍由動作關卡決定 |
| 人工介入（`interruptOn`） | ✅ 當作「暫停機制」 | 動作關卡決定要問你時，用 interrupt 讓 agent 停下來等；要不要問，由動作關卡決定，不是 Deep Agents |
| 上下文壓縮（summarization，約 85% 時觸發） | ✅ 照用 | 修掉舊 Rocky 的兩個問題：token 數用模型實際回報的值，不用估算；上下文超過上限的錯誤要原樣往上傳，壓縮才觸發得了 |
| 大結果卸載（超過 2 萬 token 存成檔案） | ✅ 照用 | 存在本機的工作資料夾 |
| 技能（`SKILL.md`） | ✅ 照用 | 平常只載入名稱和說明，需要時才載入全文；技能不帶任何權限 |
| 專案說明（memory middleware 讀 `AGENTS.md`） | ✅ 照用 | 開工時讀專案的 `AGENTS.md` |
| 長期記憶（`createMemoryMiddleware`、記憶檔） | ✅ 照用 | 記憶是 Markdown 檔，`grep` 搜尋中文沒問題；寫入走上面改造過的檔案工具，自動有快照、操作紀錄、可撤銷。記憶多到載不完時，再補一個搜尋工具 |
| Harness profile（每種模型的基礎提示詞） | ✅ 一定要設定 | 1.14.1 起，不認得的模型拿到的是空 profile，等於沒有任何寫程式指引；要註冊 Rocky 自己的 profile |
| 修補懸空工具呼叫（patch tool calls） | ✅ 照用 | 預設就有 |
| 結構化回覆（`responseFormat`） | ✅ 選用 | 讓子代理回傳固定格式的結果 |
| Checkpointer | 🔁 換成自己的 | 官方的 `@langchain/langgraph-checkpoint-sqlite` 依賴 `better-sqlite3`（需要原生編譯），所以改用 `node:sqlite` 自己實作。它只用來「中斷後接著跑」，不能當成動作有沒有發生的依據 |
| 雲端沙箱（LangSmith Sandbox、ContextHub） | ❌ 不用 | 雲端服務 |
