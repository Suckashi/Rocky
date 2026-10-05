# Rocky 開工計畫

> 2026-10-05 擁有者確認。分支：`claude/rocky-rebuild`。產品見 `product.md`，架構見 `architecture.md`，
> 核准見 `approvals.md`。

## 1. 技術棧

| 層         | 選擇                                                                                                               | 備註                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 執行環境   | Node 24 LTS、TypeScript、npm                                                                                       | 單一 package，不做 monorepo                   |
| 後端       | Hono + `@hono/node-server`                                                                                         | 照 OpenDots                                   |
| 前端       | React 19 + Vite + `@copilotkit/react-core` v2                                                                      | 照 OpenDots；不用 `react-ui` 現成元件         |
| UI 協定    | AG-UI 標準事件                                                                                                     | 核准、操作紀錄用少量自訂事件                  |
| 對話保存   | 自己寫 `RockyAgentRunner`（繼承 CopilotKit 的 `AgentRunner`）                                                      | 存在本機，不用 Intelligence                   |
| Agent      | Deep Agents JS + LangGraph JS，在同一個程序裡執行                                                                  | 包成 AG-UI `AbstractAgent`（`RockyAgent`）    |
| 模型       | `@langchain/openai`（也用來接 OpenAI 相容端點）、`@langchain/ollama`                                               | 有 prompt caching，429 會重試                 |
| 外部 agent | `@agentclientprotocol/sdk` 1.x → `opencode acp`                                                                    | 只回 `allow_once` 或 `reject_once`            |
| MCP        | `@modelcontextprotocol/sdk`（v1 或 v2 在 spike 時決定）                                                            |                                               |
| 儲存       | `node:sqlite`（Node 內建，不需要編譯）＋檔案                                                                       | 中文搜尋：FTS5 trigram，兩個字以下補用 LIKE   |
| 文件       | markdown-it、docx、mammoth、exceljs、pptxgenjs、pptx-automizer、unpdf、pdf-lib + fontkit、Playwright 呼叫系統 Edge | LibreOffice 為選配                            |
| 編輯器     | Tiptap                                                                                                             | 照 OpenDots                                   |
| 測試       | Vitest（單元、整合）、Playwright（端對端）、評測任務集                                                             |                                               |
| CI         | GitHub Actions：`windows-latest` 和 `ubuntu-latest`                                                                | 讓 Windows 上的結果是真的跑出來的，不是推測的 |

## 2. 專案結構

```
/                      ← 新程式碼放在分支根目錄
├─ AGENTS.md
├─ package.json  package-lock.json  tsconfig.json  vite.config.ts
├─ src/
│  ├─ server/
│  │  ├─ main.ts              組裝所有元件、啟動、有時間上限的關機
│  │  ├─ http/                Hono app、安全檢查（token / Host / Origin）、routes/
│  │  ├─ work/                Work 服務與狀態機（Rocky 是唯一權威）
│  │  ├─ effects/             判斷順序、核准、操作紀錄、快照、危險指令偵測
│  │  ├─ agent/               Deep Agents 設定、tools/、提示詞、RockyAgent、RockyAgentRunner
│  │  ├─ models/              各家模型的設定
│  │  ├─ acp/                 ACP client、OpenCode、worktree
│  │  ├─ mcp/                 MCP client
│  │  ├─ documents/           md、html、docx、xlsx、pptx、pdf
│  │  ├─ knowledge/           記憶、技能
│  │  ├─ store/               node:sqlite、migration
│  │  └─ platform/            Windows：用 argv 啟動子程序、Job Object、路徑與 junction 處理
│  ├─ web/
│  │  ├─ main.tsx  App.tsx
│  │  ├─ i18n/                zh-TW.json、en.json
│  │  ├─ components/          Chat、ApprovalPanel、ToolCard、Roko、TurnChanges…
│  │  ├─ pages/               首次啟動、對話、工作詳情、設定、文件庫
│  │  └─ styles/tokens.css    所有顏色、字型、間距都在這裡
│  └─ shared/                 前後端共用的 zod schema 與型別
├─ evals/                     評測任務與跑分程式
├─ tests/                     unit/、integration/、e2e/
├─ spikes/                    第一週的驗證腳本與結果（之後刪除）
├─ assets/roko/
└─ docs/                      rebuild/、adr/
```

## 3. 里程碑

| 里程碑                 | 內容                                                                               | 完成的樣子                                             |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **M0 驗證**（第 1 週） | 四個 spike；專案骨架；Windows 與 Ubuntu 的 CI                                      | spike 結果寫進 ADR；CI 綠燈                            |
| **M1 能對話**          | 伺服器與安全檢查、介面外殼、Roko、i18n、跟模型串流對話、對話存在本機               | 在 Windows 上 `npm start`，打開瀏覽器就能和 Roko 聊天  |
| **M2 能做事**          | Rocky 的工具（搜尋、讀檔、局部編輯、跑指令）、核准管線、操作紀錄、快照、評測第一版 | 能修一個真實的 bug；評測訂出基線                       |
| **M3 能派工**          | ACP 接 OpenCode、worktree、Rocky 自己驗證、工作詳情頁                              | 在 Windows 上派 OpenCode 修 bug，核准全部在 Rocky 處理 |
| **M4 能處理文件**      | 六種文件格式、記憶、技能、MCP                                                      | 六種格式的中文往返測試都通過                           |
| **M5 收尾**            | 安裝流程、首次啟動、英文語系補齊、細修介面                                         | 符合 `product.md` 的成功標準                           |

## 4. 第一批工作（M0）

1. **S1 OpenCode ACP**：在 Windows 上跑 `opencode acp`。驗證權限請求、diff、取消、續接；萬一原生 Windows 不穩，驗證透過 WSL 跑的備案。
2. **S2 Deep Agents + 模型**：在同一個程序裡接 Ollama 和 OpenAI 相容端點。驗證工具呼叫、串流、interrupt、快取用量回報，並把串流轉成 AG-UI 事件。
3. **S3 安裝不需要編譯**：在 Windows 上 `npm ci`，確認所有依賴（包含 `node:sqlite`、文件函式庫、`playwright-core`）都不需要原生編譯。
4. **S4 中文文件**：中文 PDF 擷取；中文 docx、xlsx、pptx 的往返。
5. **骨架**：package.json、tsconfig、ESLint、Prettier、Vitest、CI。

S1 和 S3 需要在 Windows 上實際跑。CI 的 Windows runner 可以先跑一輪；OpenCode 的登入和真實使用，還是要在你的電腦上確認。

## 5. 已確認的決定（2026-10-05）

- 技術棧：照第 1 節。
- 舊程式碼：從這個分支刪除，新程式碼放在根目錄；舊 Rocky 保留在 `main` 與 git 歷史，需要參考時開一個 `main` 的 worktree。
- V1 安裝：`git clone` 加 PowerShell 啟動腳本（第一次執行自動 `npm ci`）；正式安裝檔或發佈到 npm 留到 M5，且要另外授權。
- CI：GitHub Actions，在 `windows-latest` 與 `ubuntu-latest` 上跑。

## 6. 依賴升級

- 不用 Dependabot 自動開 PR；漏洞通知靠 GitHub repo 設定裡的 Dependabot alerts。
- 每個里程碑結束時手動升級一次。Deep Agents、LangChain、LangGraph 一起升，升完跑測試與評測再合併。
- TypeScript 暫時停在 6.0.x：typescript-eslint 8.71 只支援到 TypeScript 6.0。

## 7. 進度

- 2026-10-05：骨架與 Windows／Ubuntu CI 完成。S2（agent 執行路徑）以假模型驗證完成，見 `docs/adr/0001-agent-runtime-spike.md`；真實模型待擁有者在 Windows 上跑 `spikes/s2-agent/live.ts`。
- 2026-10-05：S2 真實模型驗證（雲端 Linux，Command Code，`deepseek/deepseek-v4-flash`，OpenAI 格式）：工具呼叫、寫檔前暫停、拒絕後換做法、中文、用量與快取 token 都通過；Anthropic 格式因方案不含 Claude 模型未驗證。見 ADR 0001。
- 2026-10-05：擁有者決定只用 OpenAI 相容的第三方端點，Anthropic 格式先不採用，移除 `@langchain/anthropic`。見 ADR 0002。
- 2026-10-05：S1（OpenCode ACP）：原生 Windows 可行，不需要 WSL 備案。核准、拒絕、取消、續接、worktree 對帳都在 Windows 與 Ubuntu CI 上以假模型通過；真實模型在雲端 Linux 修 bug 加跑測試成功。見 ADR 0003。
- 2026-10-05：S3（安裝不需要編譯）：計畫中的完整依賴在 Linux 上 `npm ci` 不需要編譯、只連 npm；CopilotKit 帶有安裝遙測（Scarf），已在 `package.json` 關閉。Windows 待擁有者執行。見 ADR 0004。
