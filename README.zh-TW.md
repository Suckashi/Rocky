# Rocky

在本機工作的 AI 工程夥伴：透過對話交辦工作，掌握工具權限，查看實際執行結果。

[English](README.md) · [操作指南](docs/user-guide.zh-TW.md) · [文件索引](docs/README.md) · [參與開發](CONTRIBUTING.md)

Rocky 將對話、工作紀錄、核准、文件、記憶與技能保存在你的電腦。你選擇模型端點、MCP 伺服器與可存取的工作區。一般工作、原生子任務和 Learning 評測共用單一 Deep Agents 執行路徑。

**目前為開發預覽版（`0.1.0-dev.0`）。** V1 主要流程已接通，已有 Windows fixture 與瀏覽器測試證據；跨平台、安全和真實外部服務驗收仍有缺口。請先閱讀[路線圖與已知限制](docs/ROADMAP.md)。目前沒有穩定發布版或代管服務。

## 可以做什麼

- 與持續存在的 Rocky 助手對話，查看背景工作、工具結果、核准與停止狀態。
- 連接自己的模型和 MCP，授予明確的工作區範圍，審查檔案與命令操作。
- 建立文件、查看不可變版本、附加文字與圖片、預覽產出成果。
- 使用有範圍的記憶與版本化技能；Learning 預設關閉，候選須經評測與人工發布。
- 設定例行工作和 MCP 追蹤、查看專屬瀏覽器工作階段、備份 Rocky 的本機資料。

Native 命令使用目前作業系統帳號的權限，並非 sandbox。容器隔離需要另外設定與驗證。模型請求與所設定的外部服務可能產生費用。

## 快速開始

需要 **Node.js 24.12.0**、**npm 11.6.4**；參與開發或使用 worktree 時也需要 Git。下載或 clone 原始碼後，在專案根目錄執行：

```sh
npm ci
npm run build
npm run doctor
npm start
```

開啟 **http://127.0.0.1:3211**。先在 Settings 設定模型連線，再選擇第一個 Work 使用的工作區與權限。憑證透過環境變數名稱引用，請勿寫入版本控制中的檔案。模型設定、資料位置與核准流程見[操作指南](docs/user-guide.zh-TW.md)。

核心安裝與標準 Learning fixture 僅需 Node/npm。需要瀏覽器功能時，另外執行下載：

```sh
npm run setup -- browser
```

容器引擎由使用者自行安裝。Rocky 不安裝系統服務，也不會在隔離執行失敗時自動改成本機執行。

## 本機開發

```sh
npm ci
npm run dev
```

開發介面位於 **http://127.0.0.1:3210**，daemon 使用 3211，資料預設放在 Git 忽略的 `.rocky-dev/`。開發版與建置版共用 daemon port，請分開啟動。

檢查命令、除錯前提與測試模式見[開發指南](docs/development.md)。想提出修改時，先閱讀[貢獻指南](CONTRIBUTING.md)。

## 專案結構

<details>
<summary>原始碼目錄與職責</summary>

| 目錄                                                 | 用途                               |
| ---------------------------------------------------- | ---------------------------------- |
| [`apps/web/`](apps/web/)                             | React/Vite 對話介面與設定          |
| [`apps/daemon/`](apps/daemon/)                       | 本機 API、持久化、核准與操作權限   |
| [`apps/agent-worker/`](apps/agent-worker/)           | Agent 子程序與 daemon IPC          |
| [`packages/agent-runtime/`](packages/agent-runtime/) | Deep Agents 組裝、模型與工具介接   |
| [`packages/contracts/`](packages/contracts/)         | 共用 DTO、事件和 IPC 驗證契約      |
| [`tests/`](tests/)、[`fixtures/`](fixtures/)         | 單元、整合、瀏覽器與確定性服務測試 |
| [`scripts/`](scripts/)                               | 開發、驗證、設定與打包命令         |
| [`docs/`](docs/README.md)                            | 操作指南、架構、決策與驗證紀錄     |
| [`specs/rocky/`](specs/rocky/README.md)              | 產品契約與任務／驗收計畫           |
| [`assets/rocky/`](assets/rocky/README.md)            | 可編輯素材與來源紀錄               |

新增模組前請閱讀[架構與檔案放置原則](docs/architecture.md)。執行資料、瀏覽器 profile、建置產物與私人診斷不進 Git。

</details>

## 貢獻與支援

開發流程採分支 → PR → CI，詳見[貢獻指南](CONTRIBUTING.md)。問題回報見[支援說明](SUPPORT.md)，漏洞回報與安全限制見[安全政策](SECURITY.md)，社群互動遵循[行為準則](CODE_OF_CONDUCT.md)。歡迎使用繁體中文或英文回報。

## 授權與來源

Rocky 原創程式採 [Apache-2.0](LICENSE)。OpenDots 展示程式的改寫保留 MIT 聲明，見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 與 [NOTICE](NOTICE)。Rocky 是具有獨立資料與 runtime 的專案，引用不表示官方關聯。素材來源及尚待完成的名稱／角色／商標審查列於[素材清單](assets/rocky/asset-manifest.json)。
