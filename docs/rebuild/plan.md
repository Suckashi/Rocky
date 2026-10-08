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
│  │  ├─ compose.ts main.ts   組裝所有元件；啟動、有時間上限的關機
│  │  ├─ http/                Hono app、安全檢查（token / Host / Origin）、routes/
│  │  ├─ effects/             判斷順序、核准、操作紀錄、快照、危險指令偵測
│  │  ├─ agent/               Deep Agents 設定、tools/、提示詞、RockyAgent、RockyAgentRunner
│  │  ├─ jobs/ external/      派工：ACP client、OpenCode、worktree、套用
│  │  ├─ mcp/                 MCP client
│  │  ├─ documents/           md、html、docx、xlsx、pptx、pdf
│  │  ├─ memory/ skills/      記憶、技能
│  │  ├─ store/               node:sqlite、migration
│  │  └─ platform/            資料夾位置、對外白名單、開瀏覽器
│  ├─ web/
│  │  ├─ main.tsx  App.tsx
│  │  ├─ i18n/                zh-TW.json、en.json
│  │  ├─ components/          Chat、ApprovalPanel、ToolCard、Roko、TurnChanges…
│  │  ├─ pages/               首次啟動、對話、工作詳情、設定、文件庫
│  │  └─ styles/tokens.css    所有顏色、字型、間距都在這裡
│  └─ shared/                 前後端共用的 zod schema 與型別
├─ evals/                     評測任務與跑分程式
├─ tests/                     unit/、integration/、e2e/
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
- 2026-10-05：S3（安裝不需要編譯）：計畫中的完整依賴在 Linux 上 `npm ci` 不需要編譯、只連 npm；CopilotKit 帶有安裝遙測（Scarf），已在 `package.json` 關閉。Windows 11 上擁有者執行兩個腳本都是 exit 0（擁有者回報）。見 ADR 0004。
- 2026-10-05：S4（中文文件）：六種格式的中文往返測試都通過，已放進 `npm test`。發現 unpdf 讀不到靠 CMap 的中文 PDF、`.ttc` 不能直接嵌入、pptx-automizer 會留下舊投影片，都已有對策。見 ADR 0005。
- 2026-10-05：M0 收尾。S1、S2 的 Windows 真實模型驗證（`live.ts`）由擁有者決定先跳過，待補；開始 M1。
- 2026-10-05：M1（能對話）：本機伺服器與安全檢查、對話存在 `node:sqlite`、CopilotKit runtime 接 Deep Agents、繁中／英文介面與 Roko、首次設定與設定頁、`Start-Rocky.ps1`。Linux 上用假模型的瀏覽器端對端測試與真實模型都通過；Windows 上的實際啟動待擁有者確認。見 ADR 0006。
- 2026-10-05：M2（能做事）：動作關卡、通行證、操作紀錄、快照與還原、Rocky 的讀檔／搜尋／編輯／指令工具、核准面板與三種模式、評測第一版。真實模型（`deepseek/deepseek-v4-flash`）修好 3 個真實小 bug，評測基線 24/24。Windows 上的執行待擁有者確認。見 ADR 0007。
- 2026-10-05：M3（能派工）：ACP 接 OpenCode、每個工作一個 git worktree、權限請求走 Rocky 的關卡、Rocky 自己對帳 diff 並跑測試、工作頁（時間軸、diff、套用、捨棄、還原）。真實模型派工修 bug 通過；評測 9 題基線 26/27。Windows 上待擁有者確認。見 ADR 0008。
- 2026-10-05：M4（能處理文件）：六種格式的讀取、建立與保留格式的編輯（核准綁定實際位元組）、Markdown 記憶（中文搜尋、可撤銷）、`SKILL.md` 技能、MCP（stdio／HTTP，每個工具可設定核准）。評測加到 13 題。Windows 上待擁有者確認。見 ADR 0009。
- 2026-10-05：M5（收尾）：讀專案 `AGENTS.md`、唯讀子代理、成功標準的自動化測試、Roko 完成動畫、評測 30 題（基線 90/90）、README。V1 功能在 Linux 與 Windows CI 上完成；擁有者 Windows 上的實際使用（啟動、瀏覽器 e2e、OpenCode、評測）待確認。見 ADR 0010。
- 2026-10-06：設定頁新增「永久規則」：允許／禁止的指令開頭（最後的 `*` 代表任意參數），隨時看得到、可以移除；允許規則不會放行危險指令與對外動作，「允許所有指令」不能新增。補上 ADR 0007 列的限制。
- 2026-10-06：Roko 的規則建議：同一類指令被你核准 2 次以上（30 天內、因模式而問、不危險、不碰專案外、沒被規則涵蓋）時，在對話與設定頁建議「指令開頭 + `*`」的允許規則；只取程式加子指令（至少兩個字，`node *` 這類太寬的不建議）。按「設為永久規則」才會新增，「不用了」之後不再建議。
- 2026-10-06：方案審查：`propose_plan` 讓模型在較大或模糊的任務先提出 1～3 個方案；選定後只有列出的指令免問。評測加一題（`plan-before-refactor`），原有 30 題沒有退步。見 ADR 0011。
