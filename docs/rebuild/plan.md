# Rocky 計畫與進度

> 2026-10-05 擁有者確認；2026-10-08 重建版合回 `main`（ADR 0014）。產品見 `product.md`，
> 架構見 `architecture.md`，核准見 `approvals.md`。

## 1. 技術棧

| 層         | 選擇                                                                                      | 備註                                          |
| ---------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| 執行環境   | Node 24 LTS、TypeScript、npm                                                              | 單一 package，不做 monorepo                   |
| 後端       | Hono + `@hono/node-server`                                                                | 照 OpenDots                                   |
| 前端       | React 19 + Vite + `@copilotkit/react-core` v2                                             | 照 OpenDots；不用 `react-ui` 現成元件         |
| UI 協定    | AG-UI 標準事件                                                                            | 待核准的事情放在 `STATE_SNAPSHOT`（ADR 0007） |
| 對話保存   | 自己寫 `RockyAgentRunner`（CopilotKit 的 `AgentRunner`）                                  | 存在本機 `node:sqlite`，不用 Intelligence     |
| Agent      | Deep Agents JS + LangGraph JS，在同一個程序裡執行                                         | 包成 AG-UI `AbstractAgent`（`RockyAgent`）    |
| 模型       | `@langchain/openai`（OpenAI、OpenAI 相容端點、Ollama 的 `/v1`）                           | 429 與網路錯誤最多重試 3 次                   |
| 外部 agent | `@agentclientprotocol/sdk` 1.x → `opencode acp`                                           | 只回 `allow_once` 或 `reject_once`            |
| MCP        | `@modelcontextprotocol/sdk` 1.x                                                           | stdio 與 HTTP                                 |
| 儲存       | `node:sqlite`（Node 內建，不需要編譯）＋檔案                                              |                                               |
| 文件       | markdown-it、docx、mammoth、exceljs、pptxgenjs、pptx-automizer、unpdf、pdf-lib + fontkit  | 預覽用 pdf.js + `@napi-rs/canvas`             |
| 測試       | Vitest（單元、整合）、`playwright-core` 驅動瀏覽器的端對端腳本（`scripts/e2e*.ts`）、評測 |                                               |
| CI         | 不跑雲端 CI（ADR 0014）：本機 `npm run check`；Windows 用 `scripts/verify-windows.ps1`    | 擁有者決定                                    |

## 2. 專案結構

```
/
├─ AGENTS.md  README.md  Start-Rocky.ps1
├─ package.json  package-lock.json  tsconfig.json  vite.config.ts
├─ src/
│  ├─ server/
│  │  ├─ start.ts  main.ts    入口（先關遙測再載入）、啟動與有時間上限的關機
│  │  ├─ compose.ts           組裝所有元件
│  │  ├─ http/                Hono app、安全檢查（token / Host / Origin）、routes/
│  │  ├─ effects/             判斷順序、核准、通行證、操作紀錄、快照、危險指令偵測、規則建議
│  │  ├─ agent/               Deep Agents 設定、工具、提示詞、RockyAgent、RockyAgentRunner
│  │  ├─ external/            ACP client、OpenCode、worktree
│  │  ├─ jobs/                背景工作佇列與紀錄
│  │  ├─ mcp/                 MCP client
│  │  ├─ documents/           md、html、docx、xlsx、pptx、pdf 的讀取、建立、編輯與預覽
│  │  ├─ memory/  skills/     記憶、技能
│  │  ├─ store/               node:sqlite、migration、設定
│  │  └─ platform/            資料夾位置、對外連線白名單、開瀏覽器
│  ├─ web/
│  │  ├─ main.tsx  App.tsx
│  │  ├─ i18n/                zh-TW.json、en.json
│  │  ├─ components/          Chat、ApprovalPanel、ToolCard、Roko、TurnChanges、PreviewPane…
│  │  ├─ pages/               首次設定、工作、設定、未登入
│  │  └─ styles/              tokens.css（顏色、字型、間距）、app.css
│  └─ shared/                 前後端共用的程式
├─ evals/                     評測任務、跑分程式、基線
├─ scripts/                   端對端測試、i18n 檢查、Windows 驗證
├─ tests/                     unit/、integration/、spikes/、fixtures/
├─ spikes/                    M0 的驗證腳本（s2-agent 的假模型伺服器仍被測試使用）
├─ assets/                    rocky/（標誌）、roko/（吉祥物）
└─ docs/                      rebuild/、adr/
```

## 3. 里程碑（都已完成）

| 里程碑            | 內容                                                                               | 完成的樣子                                             |
| ----------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **M0 驗證**       | 四個 spike；專案骨架                                                               | spike 結果寫進 ADR 0001–0005                           |
| **M1 能對話**     | 伺服器與安全檢查、介面外殼、Roko、i18n、跟模型串流對話、對話存在本機               | 在 Windows 上 `npm start`，打開瀏覽器就能和 Roko 聊天  |
| **M2 能做事**     | Rocky 的工具（搜尋、讀檔、局部編輯、跑指令）、核准管線、操作紀錄、快照、評測第一版 | 能修一個真實的 bug；評測訂出基線                       |
| **M3 能派工**     | ACP 接 OpenCode、worktree、Rocky 自己驗證、工作詳情頁                              | 在 Windows 上派 OpenCode 修 bug，核准全部在 Rocky 處理 |
| **M4 能處理文件** | 六種文件格式、記憶、技能、MCP                                                      | 六種格式的中文往返測試都通過                           |
| **M5 收尾**       | 安裝流程、首次啟動、英文語系補齊、細修介面                                         | 符合 `product.md` 的成功標準                           |

## 4. 已確認的決定（2026-10-05）

- 舊程式碼：新程式碼放在根目錄；舊 Rocky 只留在 git 歷史（`87963aa` 之前），需要參考時開那個 commit 的 worktree。
- V1 安裝：`git clone` 加 PowerShell 啟動腳本（第一次執行自動 `npm ci`）；正式安裝檔或發佈到 npm 不在 V1，要另外授權。
- CI：（2026-10-08 移除，見 ADR 0014。）原本是 GitHub Actions，在 `windows-latest` 與 `ubuntu-latest` 上跑。

## 5. 依賴升級

- 不用 Dependabot 自動開 PR；漏洞通知靠 GitHub repo 設定裡的 Dependabot alerts。
- 每個里程碑結束時手動升級一次。Deep Agents、LangChain、LangGraph 一起升，升完跑測試與評測再合併。
- TypeScript 暫時停在 6.0.x：typescript-eslint 8.71 只支援到 TypeScript 6.0。

## 6. 進度

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
- 2026-10-06：工作在背景排隊：派工後這一輪馬上結束，OpenCode 一次跑一個、其他排隊；核准在工作頁、左側顯示等你的件數；可以停止；重啟不自動再跑；`check_jobs` 讓 Rocky 在你問時查狀態。評測 31 題 93/93。見 ADR 0012。
- 2026-10-06：文件版面預覽：核准面板與變更卡可以切換「文字差異／版面預覽」，看修改前後的樣子（PDF 頁面圖、Word、Excel 表格、PowerPoint 投影片、Markdown、HTML），在不能執行程式也不能連網的框裡顯示；順便修好 pptx 表格重疊與 PDF 項目符號。見 ADR 0013。
- 2026-10-06：預覽改成對話旁的側欄（可拖拉寬度、修改前／後並排、從工具卡與對話裡的檔名打開）；修好 Windows CI 一直失敗的原因（規則裡的反斜線路徑被吃掉）與 Ubuntu 的測試字型。見 ADR 0013。
- 2026-10-06：Windows 驗證腳本 `scripts/verify-windows.ps1`（擁有者在自己的電腦上跑，貼回摘要）；對話裡的背景工作卡片（完成結果、套用、瀏覽器通知）。見 ADR 0012 後續。
- 2026-10-08：依 commit `447421b` 的說明，擁有者在 Windows 上跑了 `verify-windows.ps1` 並修了三個 Windows 問題（中文檔名刪除會讓 Rocky 當掉、載入中按 Enter 訊息被丟掉、規則測試的路徑空格）。移除雲端 CI，開 PR 把重建版合回 `main`，之後只維護新版。見 ADR 0014。
- 2026-10-08：`AGENTS.md` 只留四條（憑證不進 Git、誠實回報、Roko 與 i18n、main 的 Git 規則）；其餘做法放在 `docs/rebuild/` 與 ADR，換做法時寫 ADR。安全設計仍記在 `architecture.md` 與 `approvals.md`。
- 2026-10-08：整理文件：`architecture.md`、`plan.md`、`product.md`、`approvals.md` 依實際程式更新（拿掉沒有實作的 Tiptap、FTS5、Job Object、Edge 轉 PDF、checkpointer、`@langchain/ollama`，專案結構照現況）；README 的 clone 改成 `main`；修正 `THIRD_PARTY_NOTICES.md` 與素材說明裡指向不存在檔案的內容。ADR 是當時的紀錄，不改寫。
