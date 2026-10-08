<div align="center">

<img src="assets/rocky/mark.svg" alt="Rocky" width="96" height="96" />

# Rocky

**只在你自己電腦上執行的 AI 工程夥伴，一個人、一台電腦。**

Rocky 陪你對話、在你的專案資料夾裡工作、讀寫 Office 文件，也能把較大的寫程式工作交給外部的
coding agent。它做的每一個改動都經過同一道核准關卡，而且都能還原。

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Node.js 24](https://img.shields.io/badge/node-24-339933.svg)
![Platform: Linux | Windows](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-lightgrey.svg)
![Status: V1](https://img.shields.io/badge/status-V1-orange.svg)

[English](README.md) · **繁體中文**

[功能](#功能) · [快速開始](#快速開始) · [運作方式](#運作方式) ·
[安全與隱私](#安全與隱私) · [開發](#開發) · [設計決策](docs/adr/)

</div>

---

## 功能

- **在你的專案裡工作。** 在你選的資料夾裡搜尋、讀檔、改檔、執行指令，改完自己跑測試確認。
  Rocky 會遵守專案的 `AGENTS.md`。
- **不煩人的核准。** 三種模式：每次問、需要時才問、放手。危險指令與專案外的動作在任何模式下都一定會問。
  核准綁定內容的雜湊，指令內容一變就會重問。
- **每個改動都能還原。** 每次寫檔前先存快照；每一輪結束時有一張卡片列出改了什麼，附「全部還原」按鈕。
  每個動作都留有操作紀錄。
- **方案審查。** 較大或模糊的任務，Rocky 會先提出 1～3 個方案，你選定後才開始。
- **文件是一等公民。** PDF、Word、Excel、PowerPoint、Markdown、HTML 都能讀成 Markdown，也能從 Markdown 建立；
  Word、Excel、PowerPoint 可以在保留格式的前提下直接編輯，中文往返不會壞。側欄可以預覽修改前後的版面。
- **派工給 [OpenCode](https://opencode.ai)。** 請 Rocky 把寫程式的工作交出去，它會在背景、在獨立的 Git worktree 裡進行；
  OpenCode 的每個動作都在 Rocky 這邊核准；Rocky 自己比對 diff、重跑測試，你再決定套用或捨棄。
- **可以擴充。** 用 Markdown 檔存的長期記憶、技能（含 `SKILL.md` 的資料夾），以及 MCP 伺服器（stdio 或 HTTP），
  每個 MCP 工具可以個別設定核准方式。
- **雙語介面。** 繁體中文（預設）與英文，吉祥物 Roko 會隨 Rocky 的狀態播放動畫。

## 快速開始

### 需求

- [Node.js 24](https://nodejs.org/) 與 [Git](https://git-scm.com/)
- 一個模型：任何 OpenAI 相容端點、OpenAI，或本機的 [Ollama](https://ollama.com/)
- 選用：要派工時需要 OpenCode（`npm install -g opencode-ai`）

不需要 C/C++ 編譯器、Python，也不需要 Microsoft Office。

### 安裝與啟動

```sh
git clone https://github.com/Suckashi/Rocky.git
cd Rocky
npm ci
npm start
```

Rocky 會印出一次性的登入網址，並在瀏覽器打開。

在 Windows 上也可以改用啟動腳本：第一次執行會安裝鎖定版本的依賴（`npm ci`）並啟動 Rocky；
Rocky 已經在執行時，會直接重新打開瀏覽器：

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-Rocky.ps1
```

Rocky 在 Linux 與 Windows 上驗證過；macOS 沒有測試過。

### 第一次使用

1. **選擇模型**：網址、模型名稱與 API key。API key 只存在你的電腦上。
2. **選擇專案資料夾**：Rocky 只在這個資料夾裡讀檔、改檔、執行指令。
3. 開始對話。Rocky 需要你決定時，核准面板會取代輸入框：按 `1`–`4` 選擇、`Enter` 確定、`Esc` 拒絕。

## 設定

設定都在 App 裡完成，另外有幾個環境變數：

| 變數                 | 預設值                                           | 用途                                    |
| -------------------- | ------------------------------------------------ | --------------------------------------- |
| `ROCKY_PORT`         | `4317`                                           | 本機連接埠（一律只綁 `127.0.0.1`）      |
| `ROCKY_DATA_DIR`     | `%LOCALAPPDATA%\Rocky` 或 `~/.local/share/rocky` | Rocky 存放資料的資料夾                  |
| `ROCKY_OPEN_BROWSER` | 開啟                                             | 設成 `0` 只印出登入網址，不打開瀏覽器   |
| `ROCKY_OPENCODE_BIN` | 從 `PATH` 尋找                                   | OpenCode 執行檔的路徑                   |
| `ROCKY_PDF_FONT`     | 系統的中日韓字型                                 | 建立 PDF 時使用的 `.ttf` 或 `.ttc` 字型 |

資料夾裡有對話、操作紀錄與快照（`rocky.sqlite`、`snapshots/`）、記憶（`memory/`）、技能（`skills/`）、
工作用的 worktree（`worktrees/`），以及 `secrets.json`（模型的 API key 與 MCP 設定）。這個資料夾不會在任何 Git 專案裡。

## 運作方式

```
瀏覽器（React，zh-TW / en）
   │  HTTP + SSE，只連 127.0.0.1，每個請求都要驗證
   ▼
Rocky（單一 Node.js 程序）
 ├─ Agent      Deep Agents + LangChain，OpenAI 相容模型
 ├─ 動作關卡   政策 → 核准 → 一次性通行證 → 執行 → 操作紀錄
 ├─ 快照       每個檔案改動前的內容定址備份
 ├─ 背景工作   透過 ACP 啟動 OpenCode，一個工作一個 Git worktree，依序排隊
 ├─ MCP client 你設定的 stdio／HTTP 伺服器
 ├─ 文件       處理 pdf、docx、xlsx、pptx、md、html 的純 Node 函式庫
 └─ 儲存       node:sqlite 加上資料夾裡的檔案
```

每個工具呼叫在執行前都要經過**動作關卡**，包括 OpenCode、MCP 與「還原」按鈕發出的動作。
真正寫檔、執行指令的函式只接受關卡針對那份內容發出的一次性通行證，所以沒有任何路徑能繞過關卡。
指令一律以參數陣列執行，不經過 shell。結果不明的動作絕不會自動重做。

每項設計的理由記在[架構決策紀錄（ADR）](docs/adr/)。

## 安全與隱私

- Rocky 只監聽 `127.0.0.1`，不要把它開放到網路上。
- 不送遙測；第三方套件在安裝與執行時的遙測都已關閉。
- Rocky 自己對外只連你設定的模型端點與 MCP 伺服器。使用 OpenCode 時，OpenCode 啟動會連 npm registry，
  也可能下載 ripgrep。
- Rocky 的存取權杖不會離開它的程序：瀏覽器用一次性登入碼登入。模型的 API key 不會顯示在介面上；
  OpenCode 會拿到它，用來呼叫模型。
- Rocky **沒有作業系統層級的沙箱**：核准過的指令以你的使用者權限執行。核准前請看清楚。

回報安全問題請見 [SECURITY.md](SECURITY.md)。

## 開發

```sh
npm ci
npm run check          # 型別檢查、lint、格式、i18n、單元與整合測試
npm run test:e2e       # 用腳本化的假模型，在真的瀏覽器裡跑端對端測試
npm run test:e2e:jobs  # 派工的端對端測試（需要 OpenCode）
npm run eval           # 用真實模型跑 31 個任務，和 evals/baseline.json 比較
```

端對端測試使用系統的 Edge，或 `ROCKY_E2E_BROWSER` 指定的瀏覽器。
改了提示詞、工具或 agent 迴圈後要跑 `npm run eval`；模型每次結果會有差異，看到退步時先用 `--repeat 3` 確認。

沒有雲端 CI。在 Windows 上，`scripts/verify-windows.ps1` 會一次跑完安裝、所有檢查、兩組瀏覽器測試與啟動腳本，
並把摘要寫到 `verify-results\`。

專案結構：

```
src/server/   Node.js 伺服器：agent、動作關卡、背景工作、文件、MCP、儲存
src/web/      React 介面與語系檔（zh-TW、en）
tests/        單元與整合測試（Vitest）
scripts/      瀏覽器端對端測試、i18n 檢查、Windows 驗證
evals/        評測任務與基線
docs/adr/     架構決策紀錄
```

## 專案狀態

Rocky V1 的功能已完成，在 Linux 上驗證過，Windows 上用 `scripts/verify-windows.ps1` 驗證過；macOS 沒有測試過。
目前還沒有正式發佈的安裝檔。已知限制：

- 沒有作業系統層級的沙箱，指令以你的權限執行。
- 派工只支援 OpenCode。
- 版面預覽由 Rocky 自己繪製，可能和 Office 實際開啟的樣子不同。
- 掃描的 PDF（只有圖片）讀不出文字。

## 參與開發

Rocky 由擁有者維護、供個人使用。修改程式前請先讀 [AGENTS.md](AGENTS.md)：所有介面文字都要放在語系檔、
檢查結果要誠實回報、換做法時要寫一份簡短的 ADR。

## 授權

Rocky 的原始碼採用 [Apache License 2.0](LICENSE)。
`assets/roko/` 裡的吉祥物 Roko 圖像**不在**這個授權範圍內，請見 [NOTICE](NOTICE) 與
[assets/roko/README.md](assets/roko/README.md)。
第三方的出處與授權列在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
