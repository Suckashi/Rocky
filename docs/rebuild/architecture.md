# Rocky 架構（重做版 V1）

> 狀態：草稿，2026-10-05。選定方案：A，全 TypeScript、單一程序。

## 形狀

```
瀏覽器 (React + Vite, 繁中, Roko)
   │  HTTP + SSE，只連 127.0.0.1，每個請求都要 token
   ▼
Rocky 程序 (Node 24, 單一程序)
 ├─ Work 服務：對話、背景工作、狀態機（Rocky 是唯一權威）
 ├─ 效果管線：政策 → 核准 → 執行 → 收據（T0–T3）
 ├─ 快照庫：T1 寫入前的內容定址備份，用來還原
 ├─ Agent：Deep Agents JS（同一程序內執行，鎖定版本）
 ├─ 模型層：OpenAI 相容 / OpenAI / Anthropic / Ollama（官方 SDK，有快取與重試）
 ├─ ACP client：啟動 OpenCode（之後是 Codex、Claude Code、Kimi）
 ├─ MCP client：使用者設定的 server
 ├─ 文件工具：純 Node 函式庫，加上用系統 Edge 轉 PDF
 └─ 儲存：node:sqlite（內建，不需編譯）＋ 檔案（記憶、技能、快照）
```

## 關鍵決策

| 決策 | 選擇 | 理由／舊 Rocky 的教訓 |
|---|---|---|
| 程序模型 | 單一 Node 程序，不拆 worker、不自己寫 IPC | 舊版的 IPC 造成逾時、錯誤被壓平、快取失效 |
| Agent 框架 | Deep Agents JS + LangGraph，鎖定版本，每次升級都重跑評測 | 有 checkpoint、interrupt、子代理、上下文壓縮；但它只負責規劃，**權限判斷一律在效果管線**，checkpoint 不能當副作用的真相 |
| 模型 | 用 LangChain 官方 provider 套件，不自己寫 adapter | 舊版自寫的 adapter 讓快取失效、429 不重試 |
| 外部 agent | ACP（`@agentclientprotocol/sdk` 1.x），只回 `allow_once` / `reject_once` | 「一律允許」的規則留在 Rocky；外部 agent 在 worktree 裡工作，Rocky 用 diff 對帳 |
| 指令規則 | 以 argv token 比對；禁止優先於允許；Windows 上不經 shell 直接傳 argv；用 Job Object 管住行程樹 | 比對字串很容易被繞過 |
| 核准綁定 | 核准時記錄內容雜湊（工具 + 正規化 argv 或 diff + cwd），執行前重算 | 內容一變就重問 |
| 收據 | 執行前先寫意圖收據，執行後寫結果；逾時、程序被殺、斷線都算 unknown | unknown 永遠不自動重做 |
| 本機安全 | token 存在只有使用者能讀的檔案；檢查 Host 和 Origin；子程序的環境變數裡不放 token | 舊版的 token 不需驗證就拿得到 |
| 遮蔽 | 只用在日誌和 UI 顯示 | 舊版的遮蔽器把 `[REDACTED]` 寫回了程式碼 |
| 中文搜尋 | SQLite FTS5 trigram 索引，兩個字以下的查詢補用 LIKE；附中文召回測試 | 舊版 FTS5 查不到中文 |
| 文件 | md：markdown-it；docx：docx + mammoth + OOXML 直接編輯；xlsx：exceljs（開檔時重算）；pptx：pptxgenjs + pptx-automizer；pdf：unpdf（附 CJK cmaps）+ pdf-lib + fontkit；HTML 轉 PDF：Playwright 呼叫系統 Edge | 沒有 Office；LibreOffice 是選配 |
| 資料位置 | `%LOCALAPPDATA%\Rocky`（Windows） | 不進 Git、不送遙測 |
| UI 框架 | React 19 + Vite（與 OpenDots 相同），用自己的 design tokens | 不 import OpenDots 的 CSS |
| UI 與後端的協定 | 事件格式採 **AG-UI** 標準事件（`TEXT_MESSAGE_*`、`TOOL_CALL_*`、`STATE_*`），核准與收據用少量自訂事件；**V1 不用 CopilotKit runtime 和 react-core** | 時間軸、核准、收據都由 Rocky 存在本機並可重播；CopilotKit 的對話紀錄預設放在雲端 Intelligence 服務，而且 `useHumanInTheLoop` 讓核准在瀏覽器端完成，兩者都和「Rocky 是唯一權威」衝突。舊 Rocky 用了 CopilotKit，結果只用到 `CUSTOM` 事件，UI 只能靠名稱比對 |
| HTTP 伺服器 | Hono + `@hono/node-server`（與 OpenDots 相同） | 小、型別好；照 OpenDots 的 composition root、依功能分的 route 模組、單一安全 guard、有期限的優雅關機 |
| 文件編輯器 | Tiptap（與 OpenDots 相同）編輯 Markdown 文件，附原始碼模式 | 借用 OpenDots 的自動儲存、修訂版本檢查（防止舊內容覆蓋新內容） |

### 從 OpenDots 借什麼（MIT，出處記在 `THIRD_PARTY_NOTICES.md`）

| 借 | 不借 |
|---|---|
| 版面：左側 rail、側欄、對話欄、右側面板，以及斷點 | CopilotKit Intelligence 雲端對話、Slack、語音 |
| 工具卡：用人話的動詞標籤；沒完成就顯示「已中斷」，絕不顯示成功 | Docker 電腦服務、遠端 owner token、多使用者欄位 |
| 審查卡：決定後保留成收據、「核准前不會有任何變更」 | 由瀏覽器執行副作用 |
| `Mascot` 元件模式（依狀態切換）→ 換成 Roko 的 spritesheet 動畫 | 輪詢迴圈、`window.prompt`、單檔巨型 `App.tsx` |
| Spaces／文件庫的格狀與清單頁、首次使用卡加範例提示 | TanStack AI（模型層改用 LangChain provider） |

## 先驗證再定案（第一週的 spike）

1. OpenCode 在原生 Windows 上跑 `opencode acp`：核准請求、diff、取消、續接。
2. Deep Agents JS 在同一程序裡接 Ollama 和 OpenAI 相容端點：工具呼叫、串流、interrupt、快取用量回報。
3. 在 Windows 上 `npm ci` 確認沒有任何原生編譯（node:sqlite、exceljs、pdf-lib、playwright-core）。
4. 中文 PDF 擷取、中文 docx／xlsx 往返。
