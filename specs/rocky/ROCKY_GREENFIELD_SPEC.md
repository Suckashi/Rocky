# Rocky — 全新專案開發規格（Greenfield）

> **文件版本：2.0.0｜規劃日期：2026-10-02（Asia/Taipei）**  
> **產品方向：Local + Explicit Network｜Node / TypeScript-only｜MCP｜Permissive OSS**  
> **狀態：可交付 coding agent 的開發規格；不是已實作／已通過驗證的產品聲明。**

本文件 **v2.0.0 是規格版本**，不是 Rocky 應用程式版本。本文件完整取代《Apsis 2.0 大幅重構 Spec v1.0.0》；Rocky 是新的 Repo／產品，不是 Apsis 改名、升級或 fork。正式程式版本與 remote release/tag 由維護者另定。

> 2026-10-03 最新 UI 決策：OpenDots 是 Rocky 的主要 UI／UX 對照基準；Rocky 的原創設計集中在角色、名稱與必要的功能適配。 舊版與其衝突的全站配色、sidebar、閱讀區、卡片及間距值由本決策取代；產品與技術契約不變。

## 0. 如何使用這份規格

讀取順序：本章 → 第 1–5 章固定決策 → 與當前任務相關的契約章節 → 第 22–25 章任務／驗收。
配套 [implementation-plan.json](implementation-plan.json) 是任務依賴與驗收對照；[AGENT_START_HERE.md](AGENT_START_HERE.md) 是開工指令；[ROCKY_BOT_DESIGN_SPEC.md](ROCKY_BOT_DESIGN_SPEC.md) 定義新Bot設計；[DECISIONS.md](DECISIONS.md) 記錄本次取代的舊決策。
本文件為功能與行為的權威；配套文件不得默默放寬要求。

### 0.1 已定案，不要重新詢問或擴大研究

- 產品在使用者本機保存資料與管理工作，**允許明確配置的外部模型、MCP 與網站連線**。不是 Strict Offline。
- 不要 CopilotKit Intelligence、managed connector、雲端記憶、必要平台帳號與商業授權控制面。
- 第一版的核心和 Automatic Learning 都採 Node/TypeScript；**不引入 Python worker、GEPA、LangMem、DSPy 或 uv**。
- 主要 harness 採 **Deep Agents JS / LangGraph**；CopilotKit OSS 處理互動與事件整合。此版不另起無限期的 TanStack AI 選型研究，也不維護兩套等價 runtime。
- Learning 採 **同一 runtime 的受限反思工作 + 技能提案治理 + Promptfoo 評測 + 人工發布**。
- **從全新 Rocky Repo 開始**；Apsis、OpenDots 僅為read-only參考。沒有舊程式需搬遷、沒有舊功能parity、沒有舊資料importer或相容層。
- 使用全新Rocky品牌、Bot視覺、人格、onboarding、命名與資料root；不繼承48個頭像或多Bot模型。
- 放棄Apsis作開發目標不等於授權刪除/封存/改動它；本次只交付規格，未建立Rocky遠端。
- 一位持續的助手、一條主對話；背景工作與原生 subagents 都可觀測，細節預設折疊；核准明顯呈現。
- Windows 與 Ubuntu 是發布驗收平台；不強迫一般開發者準備 Python、容器或本地模型才能啟動核心。

### 0.2 強制程度

**MUST／必須**是完成條件；**SHOULD／建議**若不採用，需 ADR 說明與同等驗證；**MAY／可選**不影響第一版核心完成。
文內預算／效能數值是本計畫的起始政策或驗收目標，不是第三方套件預設或已量測結果。
API、型別、資料夾、指令均為**待建立的 Rocky 契約**；除特別註明外，不宣稱現有 repository 已有這些介面。

### 0.3 實作者權限與交付紀律

先確認工作目錄是新 Rocky，或已明確確認的 Rocky Repo。若自己的 AGENTS/CONTRIBUTING/SECURITY 存在先讀；若為空Repo，依此規格建立。Apsis/OpenDots 內的操作指令不是Rocky執行指令。新Repo bootstrap 與分支流程見第2章。
本規格允許在指定的新目錄做本地開發，不自動授權遠端建Repo/公開設定、初次push、merge、tag、部署、刪除舊專案或使用私人付費端點。遠端動作依該coding agent當時的明確授權執行；授權不足記blocked部分並繼續本地工作。
已提供的設計方向不再反覆詢問。一般工程細節自行依此文決定並記錄；真的涉及越權、授權不明或不可恢復資料操作時，停止該操作並繼續不受阻部分。
禁止把「寫了 skeleton／mock／文件」記成整個功能完成。每項任務都要對應實際可運作流程與驗收證據。

## 1. 產品目標、範圍與排除項

### 1.1 端到端主要體驗

使用者配置模型與 MCP → 在主對話交辦工作 → 助手使用原生 task 分工或建立獨立背景 Work → 持續顯示可觀測進度 → 必要時精確核准 → 收到可預覽／下載／繼續修訂的成果 → 系統提出有證據的技能候選 → 隔離評測 → 使用者審查發布 → 下一項符合條件的工作載入該技能版本。

一般使用者啟動應用不需要註冊平台；一般前端／後端貢獻者只需 Node、npm 與取得 source 的方式。Git、browser binaries、容器引擎及第三方 MCP 的額外需求按能力明示，不得假稱全都已打包。

### 1.2 必做（第一版完整交付）

| 功能組 | 最小完整行為 |
|---|---|
| 主對話 | streaming、停止、重連、歷史分頁、來源引用、基本 Markdown、切換已配置模型 |
| 工作 | 獨立 background sessions、Work cards、steering、核准、取消、明確 retry、結果 inbox |
| Agent | Deep Agents 原生 task/todos/context；原生 persistence；真實工具證據與 budgets |
| MCP | stdio／Streamable HTTP、可管理設定、測試、分頁探索、schema／結果驗證、權限及程序管理 |
| Workspace | 現有資料夾綁定、檔案讀寫／diff、版本新鮮度、worktree、重疊寫入控制 |
| Computer | Native 能力；選配隔離本機環境；browser profile 與 takeover。無 engine 時不阻擋其他能力 |
| 成果／文件 | 不可變 artifact、下載、安全預覽、來源、基本 Markdown 文件修訂 CAS |
| 排程 | IANA timezone、misfire policy、工作追蹤；PR/CI 追蹤只透過配置 MCP |
| Memory／Skills | scope／來源／版本／鎖定；Skill 匯入、catalog、原生按需載入 |
| Learning | off/propose、證據選取、受限提案、Promptfoo eval、review/publish/reject/quarantine/rollback/revoke |
| 工程 | 雙語、基本無障礙、Windows／Ubuntu CI、Node-only 安裝、小型 source repo、Rocky自身安全備份／還原與舊專案隔離 |

### 1.3 本版不做

**特別排除：**Apsis→Rocky資料遷移、舊API/env/schema相容、舊頭像匯入、上游功能parity、舊Repo改名／刪除／封存、fork或合併上游Git歷史。一般使用者明確選取的文件／通用SKILL.md匯入仍屬產品能力，不等於匯入Apsis資料庫。

多人租戶、組織權限、agent roster、Slack/Discord/LINE 入站服務、語音通話、托管 connectors、跨裝置雲端同步、雲端 worker、遠端部署控制、Kubernetes／Redis／Postgres、向量資料庫、模型訓練、本地模型自動下載、無審查的技能自動發布、完整 Notion clone、多人文件協作、任意 HTML embed、自動 merge/deploy、作業系統全能桌面控制、獨立桌面安裝包。

不得為這些排除項先建立空 package、空 API 或通用 plugin marketplace。僅在目前模組確實有替換需求時建立 adapter。

### 1.4 Local + Explicit Network 的可驗證定義

**本機掌控：**對話／工作／記憶／技能／評測／文件／設定保存在使用者指定的 data directory；使用本機 daemon 執行 queue。
**允許連線：**明確配置的模型 endpoint、MCP endpoints／其受託的外部操作、已核准的網站目的地、使用者主動啟動的依賴與 browser／image 下載。
**禁止隱藏連線：**telemetry、廣告／遠端字型、套件 update check、預設 grader／optimizer、備援模型、登入商業平台、未告知的資料同步。
**資料揭露：**本機保存不等於資料從不離機；對外模型所需訊息、工具結果與 learning evidence 可能外送，UI 必須指出用途、provider 與 scope。
**能力誠實：**Native Shell／自行配置的 host MCP 可以繞過 application HTTP client；沒有 OS 級限制時只標示 application-mediated policy，不宣稱完全 egress sandbox。

## 2. 全新 Repo 與參考使用策略

### 2.1 新的實作目標

產品與repository名稱均為 **Rocky**。候選owner為先前使用的 `Suckashi`，但本規格**未查證或建立 `Suckashi/Rocky`**；remote URL、可見性、名稱可用性不得虛構。npm workspace採private `@rocky/*`，不代表擁有公開npm scope。

本次交付只是Spec。Apsis的「捨棄」代表不再作實作目標，不是允許刪Repo、封存、改private、清資料或改branch protections。既有Apsis與其資料全部留在原處。

### 2.2 Bootstrap 的確切流程

1. 在新 `Rocky/` 目錄建立獨立Git root；不得把Apsis/OpenDots `.git`、tag、branch或整包source複製後改名。若當前位置是參考Repo，離開並建立sibling/new directory，不在來源Repo開重構分支。
2. 若Rocky已存在，先檢查本地內容與已連結remote是否正是使用者指定的新專案；不得reset/覆蓋未提交內容。只在確認的Rocky repo安全增量開發。
3. 空Repo可從本地 `feat/rocky-foundation` 初始化並提交；遠端尚無main時，首次seed/main建立及push需要maintainer明確授權。之後使用feature branch→PR→CI。不要套用「先有PR才能建立第一個commit」的不可執行前提，也不可借bootstrap繞過已存在的main保護。
4. 新寫Rocky的 `AGENTS.md`、`CONTRIBUTING.md`、`SECURITY.md`、`LICENSE`、`.gitignore`與CI；不要把參考Repo的repo ID、badge、ruleset ID、bot roster或歷史CHANGELOG照搬。
5. 產出 `docs/implementation/repository-manifest.json`，記錄本地root與實際commit、remote狀態/授權、規格版本；未建立remote明示未建立。遠端權限不足不阻斷本地P0。

### 2.3 參考專案不是 Rocky baseline

| 來源 | 固定的歷史參考 | 可以借鑑 | 不繼承 |
|---|---|---|---|
| Apsis | `0b03c634a69494ef768c027ba894dcb40390e621` [SRC-01] | 工作/核准/故障/背景結果的設計經驗 | codebase、Git歷史、API、資料庫、env、人格、全部功能或測試 |
| CopilotKit/OpenDots | `c2569bb6a13a22e565cf3eb791c62267d06babb1` [SRC-08] | 主要 UI／UX、展示元件／CSS／tokens、review、Computer ownership | 整份樣板、Intelligence、Dot roster、原美術或資料層 |
| OpenClaw治理參考 | P0按需確認 [SRC-21] | 提案/版本/審查/回滾思想 | 整套runtime、commercial服務、auto擴權 |

OpenDots UI SHA 已於2026-10-03取得原始碼並確認 MIT；其他 SHA 維持历史參考定位；Rocky不用追蹤Apsis進度、不做同步merge、不強制先跑上游tests。參考不可用時，記錄缺口，仍可依Rocky明確契約實作。

### 2.4 局部採用規則

預設採用設計模式和成熟套件，重新撰寫Rocky產品邊界。確有價值的局部程式碼可以引用，但先記錄目的、scope、upstream URL/commit/license、修改與替代選項，再以Rocky contract tests驗證。保留原授權與copyright；不要自稱完全獨立發明被引用的程式。

禁止整包搬入 `legacy/`、`vendor/apsis`、Git submodule或runtime dependency後「之後再拆」。`docs/implementation/reference-adoption.md` 只列 adopt-pattern / reuse-small-module / reject 與理由，不建立behavior-parity必做表。所有第一版範圍由Rocky的R/AT決定。

### 2.5 從第一天使用 Rocky namespace

| 項目 | 新契約 |
|---|---|
| display / repository | `Rocky` |
| first-party private packages | `@rocky/web`、`@rocky/daemon`、`@rocky/contracts` 等 |
| API | `/api/v1`；不沿用Apsis `/api/v2` 或 `/api/v3` |
| custom events | `rocky.work.updated`、`rocky.approval.required` 等 |
| env / data selector | `ROCKY_*`、`ROCKY_DATA_DIR`；不解析 `APSIS_DATA_DIR` fallback |
| MCP application extension | `x-rocky`，初始 `version: 1` |
| product store identity | `productId: "rocky"`；store各自version，與Spec版本無關 |
| skills evaluator | `RockyEvaluationProvider`，optimizer id `rocky-reflection` |
| UI storage/cookies/cache | `rocky.*`／`rocky_…`；session及credential不共用上游 |
| spec / evidence | `specs/rocky/`／`docs/implementation/` |

Repo原創程式初始使用Apache-2.0；此決策不授予第三方素材權利。新品牌與Bot的可執行細節見 [ROCKY_BOT_DESIGN_SPEC.md](ROCKY_BOT_DESIGN_SPEC.md)。

## 3. 強制需求登錄

以下ID為task/test/PR追蹤基礎。R-001～R-048保留可用ID但已按Greenfield語意修訂；R-049～R-056為新邊界與Bot設計。舊版同ID的驗收結果不能沿用。

| ID | 項目 | 必須達成 |
|---|---|---|
| R-001 | Local + Explicit Network | 全部產品資料與工作控制在本機；只連使用者明確配置或核准的目的地；不把 Strict Offline 設為產品預設。 |
| R-002 | 不依賴商業平台 | 不要求 Intelligence、managed connectors、雲端資料庫、LangSmith Cloud、Promptfoo Cloud 帳號或 license key。 |
| R-003 | Node-only | 支援平台的核心、Learning、安裝及一般開發不得要求 Python、uv、pip、Rust、C++ 編譯工具。自選第三方 MCP／使用者專案依賴另行揭露。 |
| R-004 | 寬鬆開源 | 採 MIT／Apache-2.0 等允許清單；逐版檢查轉依賴及複製程式碼，保留 notices；不可僅檢查根 repo 授權。 |
| R-005 | 單一 Rocky 助手 | 新建一個持續的 Rocky 與主對話；背景 Work／原生 subagents 不是新永久人格，不建立 roster 或舊 avatar gallery。 |
| R-006 | 唯一主要 harness | 新版採 Deep Agents JS／LangGraph。普通、背景、Learning／eval 用同一套執行組裝；不並行加入 TanStack AI／Mastra／OpenClaw Agent loop。 |
| R-007 | 開源互動層 | 採 CopilotKit OSS／AG-UI，以 OpenDots 為主要 UI／UX 基準，允許授權展示元件與 CSS 重用，本地 persistence、授權和 queue 屬 Rocky。 |
| R-008 | 原生規劃與子代理 | 優先原生 task／todos／context／checkpointer；Rocky 只觀測與控管，不重建 planner 或第二套 subagent 引擎。 |
| R-009 | 背景獨立 | 背景工作有獨立 execution session、固定 workspace 與設定快照，返回 receipt 後主對話可繼續。 |
| R-010 | 冪等命令 | 提交、steering、核准、發佈、retry 都有穩定 requestId 與 canonical request hash；同 ID 不同內容回 409。 |
| R-011 | 精確控制 | stop／steer 綁 workId、runId、sessionId 與版本；過期目標回 409；不得停止不相關工作。 |
| R-012 | 斷線不取消 | HTTP／UI 訂閱結束不取消 daemon 中工作；顯式 stop／daemon shutdown 才改變執行。 |
| R-013 | 真實事件 | 所有顯示狀態來自持久化事件或可對帳快照；不虛構百分比、成功、子代理與驗證。 |
| R-014 | 子代理可見 | 顯示 assignment/status/current activity/result；預設折疊，不暴露 private reasoning 或未過濾工具秘密。 |
| R-015 | 統一 Tool Broker | 真實 workspace、shell、browser、MCP、publish 等副作用必經同一個伺服器授權與 ledger。 |
| R-016 | 強制重大核准 | critical／unknown 必須新核准；deny 優先；任何 auto／技能／subagent／schedule 不得繞過。 |
| R-017 | 目標新鮮度 | 核准綁定參數、設定版本、policy、環境、檔案 revision／browser snapshot；執行前重查。 |
| R-018 | 未知效果對帳 | 送出後結果不明記 unknown；不得藉 retry、重啓、checkpoint replay 或 fallback 自動重送。 |
| R-019 | MCP stdio＋HTTP | 由官方 SDK 管通訊；支援 stdio 與 Streamable HTTP；依鎖定 SDK 測試協定相容，不提供 Apsis config／API 相容層。 |
| R-020 | 程序與憑證隔離 | MCP 子程序的 env、cwd、生命週期、能力與退出處理明確；不能繼承所有 API keys。 |
| R-021 | MCP 不可信資料 | schema、annotations、resources、prompts 與工具內容均需驗證；不能提升權限或自動執行 resource links。 |
| R-022 | 模型連線控制 | 支援明確配置的公司 OpenAI-compatible、OpenAI／Anthropic、本機相容 endpoint；不從 Apsis 匯入連線；model key 僅後端。 |
| R-023 | 無隱藏 egress | 關閉 telemetry、update checks、預設 grader／optimizer provider；檢查 runtime、UI、worker；不靜默下載 runtime／模型。 |
| R-024 | 區分環境與身分 | assistant、workspace、environment、browser profile、run 為不同 entity；不得以 assistantId 讓所有工作共享 cookies。 |
| R-025 | 誠實隔離邊界 | Native mode 不是 OS sandbox；容器隔離與網路限制必須實測，不能只靠 prompt／MCP config 宣稱強制隔離。 |
| R-026 | Computer 安全接管 | 接管指定 profile／environment、暫停其 agent 輸入、交還後重取 snapshot；不得關閉所有工作的 browser。 |
| R-027 | Workspace 衝突控制 | canonical paths、symlink／junction、工作區租約、檔案 target locks；同 repo 背景修改優先 worktree。 |
| R-028 | 成果可驗證 | Artifact 指向不可變檔案快照與 hash；編輯文件用 revision CAS；只在真的產出後顯示成功。 |
| R-029 | 來源層分離 | Conversation／graph state／Memory／Knowledge／Skills 分開；不把全部歷史當成記憶或永久指令。 |
| R-030 | 技能凍結 | 已發布技能為 immutable revision；run 固定 catalog 和載入版本；撤銷可立即限制相關後續操作。 |
| R-031 | Learning 非必開 | 自動學習預設 off，經同意後 propose；手動 learn 可用；第一版不提供無審查自動發布。 |
| R-032 | Learning 只提案 | 反思工作只可讀已選證據、建立 candidate；不能改 active skills、policy、MCP config、測試斷言。 |
| R-033 | 證據與隱私 | 候選具來源、條件、失敗／修正、驗證證據；秘密先遮罩；排除 learning/eval 自我回饋與 private scope。 |
| R-034 | 評測整個工作 | Promptfoo 透過 Rocky TS provider 執行凍結 harness 與測試工具，不只評分最後回答文字。 |
| R-035 | 防資料洩漏評測 | 分 train／validation／final holdout，按 episode/project 分組；候選不能讀標準答案或改 evaluator；純文字自評不算能力證明。 |
| R-036 | 精確版本發布 | 核准 candidate hash／base revision／evaluation manifest；CAS 發布，修改即失效；可回滾與撤銷。 |
| R-037 | 資源可控 | 前景優先、背景有界、Learning 低優先；限制 model calls、tokens、wall time、工具輸出、候選數與磁碟。 |
| R-038 | 持久化責任清楚 | graph checkpoint、domain DB、artifact files 不假裝同一 transaction；outbox、ledger、reconciliation 有故障注入測試。 |
| R-039 | 新資料與舊專案隔離 | Rocky 使用全新 productId/schema/data namespace；不掃描、讀取、匯入或修改 Apsis／OpenDots 私有資料；一般 file/skill 明確匯入及 Rocky 自身備份另行定義。 |
| R-040 | Windows／Ubuntu | 核心與 Learning 必須兩平台通過；macOS／其他架構未測不可宣稱支援；不依賴 POSIX-only npm scripts。 |
| R-041 | 小型 repository | 只追蹤 source／lockfiles／小型合成 fixtures；不提交 node_modules、data、模型、browsers、container images、eval 原始私有證據。 |
| R-042 | 可查的進度與驗證 | 每項任務有 AC、tests、evidence；pending/skipped/failed 不得寫成 done；fixture/live evidence 分開。 |
| R-043 | 新 Repo 與安全交付 | Rocky 新建自己的 AGENTS／CONTRIBUTING／CI；不沿用參考 repo 的控制權限。首次 remote bootstrap 另需授權；之後 feature branch→PR→CI，不關保護、不擅自 merge/tag/deploy。 |
| R-044 | 無昂貴基礎設施 | 初版不要求 Redis、Postgres、K8s、遠端 worker、向量 DB、桌麵包裝或 OAuth broker。 |
| R-045 | 排程可追蹤 | 新建 timezone-aware routines；daemon 必須在線；missed runs 預設不補跑；PR follow-up 只透過已配置 MCP，涵蓋背景 context。 |
| R-046 | 本地 UI 安全 | Loopback、Host/Origin/CSRF、分離 artifact 執行 origin、內容限制；不可將 API key 或持續管理 token 送入前端。 |
| R-047 | 安裝能力分級 | Node 足以啟動核心及 Learning；browser binaries／container engine 是明示選配；缺少時 fail closed、不偷換 host 執行。 |
| R-048 | 版本與預算非硬猜 | P0 固定一組可重現套件／Node patch；未知模型 context 必須配置或取得可信 profile，不假設全部 256K。 |
| R-049 | 獨立新建 | Rocky 從新的目錄與獨立 Git root 開始；不得 rename/fork/snapshot 整個 Apsis 或 OpenDots 當骨架，不合併上游歷史、tags、branches。 |
| R-050 | 參考而非相容義務 | 只依 Rocky in-scope 需求驗收；不要求重做 Apsis 的全部功能、測試、格式或 importer；必要局部引用先記 decision/provenance/license，不把整個參考專案加為 dependency/submodule。 |
| R-051 | Rocky 一致命名 | 產品名與 Repo 名 Rocky；package scopes 為 private @rocky/*、API /api/v1、CUSTOM events rocky.*、env ROCKY_*、MCP extension x-rocky、productId rocky；不加 apsis 相容別名或預設路徑。 |
| R-052 | 新 Bot 視覺身份 | 依 ROCKY_BOT_DESIGN_SPEC.md 新建 Rocky avatar、mark、tokens、空狀態與工具／工作介面；不繼承 Apsis/OpenDots 頭像、logo 或 roster；OpenDots 展示 CSS 可依 MIT 重用。 |
| R-053 | Presence 真實且可存取 | Rocky 的姿態由可驗證的 per-work 狀態推導；連線狀態與工作狀態分開；主對話閒置時仍標示背景數量；失聯不假定停止，核准不假定成功，支援 reduced motion／鍵盤／螢幕閱讀器。 |
| R-054 | 人格不取代能力與權限 | Rocky 是溫暖直接的解題助手；不假裝電影中的真實角色、不頻繁角色扮演；persona 不能擴權、動態建立第二引擎、修改 evaluator/policy 或宣稱未驗證成功。 |
| R-055 | 素材來源與獨立品牌 | 程式與 Bot 素材分開記來源、作者、授權、hash、發布審核狀態；名稱/角色靈感不等於取得電影素材授權，不把未核實權利的素材列為 MIT/Apache。 |
| R-056 | 不處分舊專案 | 放棄 Apsis 代表停止以它為開發目標；本規格不授權刪除、封存、轉 private、rename 或修改 Apsis Repo／資料，亦不假設 Rocky 遠端已建立或名稱可用。 |

## 4. 技術選擇與相容性閘門

### 4.1 固定方向

| 層 | 選擇 | 不要做 |
|---|---|---|
| Node | Node 24 LTS、npm workspaces；P0 固定已驗證 patch/npm | 不因 Current major 更新就全面升版，不混 npm/pnpm/bun lockfiles |
| Frontend | React、TypeScript、Vite；CopilotKit OSS React SDK | 不依賴 Intelligence chat history／license；不綁 Next.js |
| API | Hono／Node HTTP 的薄邊界；以服務方法和 Zod schemas 為核心 | Routes 不執行模型 loop、不直接寫多個 stores |
| Runtime | Deep Agents JS + LangGraph 公開 API | 不自行做 planner、原生 task 替代、第二套 BuiltInAgent |
| Persistence | 本地 SQLite；domain 優先 Node built-in sqlite；graph 優先官方 SqliteSaver | 不要求 Redis/Postgres；不把 UI store 當 database |
| Integrations | 官方 MCP client；不同 SDK generation 只可透過受測 adapter | 不混 v1 import 與 v2 examples、不自手刻 JSON-RPC |
| Eval | Promptfoo trusted TS custom provider + data-only cases | 不讓 LLM 生成可執行 YAML hooks／JS evaluator |
| Learning | 同 runtime 的限權 job；自有 proposal registry，參考 Workshop | 不引入 OpenClaw/Mastra runtime，不帶 Python |
| Tests | Rocky新tests使用Vitest、React Testing Library、Playwright；必要Node APIs可直接測 | 不強制搬入參考Repo的測試或測試runner |
| UI documents | 基本 Markdown、safe preview；Tiptap 可在需要 visual editing 的模組使用 | 不把 office/PDF 轉換做成核心開機必要服務 |

Node 24 LTS、OSS／自管 persistence、原生 checkpointer、Promptfoo TS provider 均有官方支援資料；**這不等於上述套件任何版本的組合已經整合驗證**。[SRC-10][SRC-13][SRC-18][SRC-25][SRC-28]

### 4.2 P0 的 dependency-baseline.json

必須記錄 Node/npm 版本、OS/arch、所有直接套件的 exact version、lockfile hash、peer compatibility、license、native deps、所用公開 API、測試 commit/evidence。
拒絕使用 `latest`、未固定 git main、任意 `--legacy-peer-deps` 或強制忽略 engine mismatch 來假裝完成。
沒有證據的 API 先用已安裝型別和最小實驗確認；文件可能描述另一版本。不要把 SDK 尚未支援的 feature 寫成已完成。

### 4.3 Node-only 的隱藏相依檢查

「JS 套件」仍可能下載 native binary 或在 prebuilt 不存在時觸發需要 Python 的原始碼編譯。SQLite saver、Promptfoo 轉依賴和 image libraries 都必須檢查。
標準平台 `npm ci` 的成功不得依賴已安裝的 Python/compiler。P0 先測，最小替代順序：
1. 使用相容且有可驗證 prebuilt 的固定版本。
2. domain DB 用 Node built-in SQLite，避免新增 native bindings。
3. 若官方 graph saver 阻擋 Node-only，僅可依公開 `BaseCheckpointSaver` 實作／移植最小 SQLite adapter，完整測 `put/putWrites/getTuple/list` 與 serializer；寫 ADR，不另創一套 checkpoint 格式。
4. 若仍無可行 Node-only 路徑，該 gate 是明確 blocker；不偷偷安裝 Python，不降低 requirement，不把 prototype 標 release-ready。

**不需手動 Python**適用 Rocky 自帶功能；使用者自行選擇 Python MCP、Python 專案或外部工具時，顯示該選配能力的 prerequisite，不能自動下載 Python 解決。

### 4.4 授權／來源政策

允許直接選型優先 MIT、Apache-2.0；BSD-2-Clause、BSD-3-Clause、ISC、0BSD 等寬鬆授權需進清單。SQLite public-domain、字型／圖示／文件／模型權重分開登錄，不亂改標 MIT。
禁止把 commercial-only／source-available／限制用途的模組混入核心。轉依賴出現未准授權時停用該模組或替代，不以 root repo LICENSE 覆蓋。
複製 code 保存原 copyright、license、source URL、commit、修改說明到 `THIRD_PARTY_NOTICES.md`。
OS／browser／容器映像的組件授權另產 SBOM；不能聲稱整個作業系統映像都只有 MIT/Apache。此處是工程選用政策，不取代需要時的法律審查。

## 5. 架構、程序與模組責任

```text
apps/web  (React + CopilotKit OSS)
     │ local API + AG-UI event subscription
apps/daemon  (authoritative product state + command handling)
     ├─ Work / Conversation / Approval / Policy
     ├─ Model Connections + Network Client
     ├─ MCP Registry + Process/Connection Manager
     ├─ Workspace + Environment Manager
     ├─ Artifact / Document / Memory / Skill Registry
     ├─ Outbox / Inbox / Recovery / Routine Scheduler
     │
     ├─ apps/agent-worker  (Deep Agents; one resolved run capability)
     │      └─ Tool Broker RPC → daemon policy/ledger → tools/environment/MCP
     │
     └─ apps/eval-worker  (Promptfoo; trusted code + data-only suite)
            └─ Eval Work API → SAME Agent factory in evaluation mode

Local storage
     ├─ domain.sqlite + application settings
     ├─ graph-checkpoints.sqlite  (official graph state, separate owner)
     ├─ artifacts / documents / workspaces / profiles
     ├─ skills / proposals / learning evidence
     └─ redacted logs / bounded caches / manifests
```

### 5.1 唯一執行入口

所有持續工作先建 Work，再入 queue。CopilotKit Runtime/AG-UI gateway 只把命令與事件接過來，**不得再建立 CopilotKit BuiltInAgent/TanStack loop 做第二次模型執行**。
Learning job 使用 `runMode=reflection`、eval 使用 `runMode=evaluation`，仍同一 factory；角色與 capabilities 不同不等於不同 runtime。
原生 `task` 是同一 Run 內 ephemeral child，不建立可獨立排程的永久 Work。`start_background_work` 才建立獨立 Work；不提供會阻塞 parent 持有資源的同步 `wait_for_background_work`。

### 5.2 單 daemon、有限 worker

一個 data directory 只允許一個 daemon，持有可偵測 stale 的鎖；SQLite domain mutations 由 daemon 單 writer／transaction 管理。
Agent workers 透過型別化 IPC 呼叫 domain operations；不能自己直改 domain.sqlite、policy、credentials 或 skills published index。
Graph saver 可以由 worker 對其 session 使用獨立 logical namespace，但 daemon 仍需防同一 graph thread 同時兩個 active invocations；SQLite multi-connection locking 必須測試。
Worker 是故障／取消邊界，**不是 OS sandbox**。只有隔離執行環境才能聲稱有相應 OS-level 限制。

### 5.3 建議目錄（不要為未做能力建立空 package）

```text
apps/
  web/
  daemon/
  agent-worker/
  eval-worker/
packages/
  contracts/
  agent-runtime/
  work/
  policy/
  persistence/
  connections/       # model/network/credentials references
  mcp/
  environments/
  artifacts/
  memory/
  skills/
  learning/
  ui/
fixtures/
  mcp/                # Node/TS synthetic MCP servers
  models/             # deterministic streaming/tool-call fixtures, not weights
  learning/           # synthetic data-only examples
scripts/              # cross-platform Node scripts
specs/rocky/       # this spec + plan
docs/implementation/        # implementation evidence / ADRs
```

IPC message 要含 schemaVersion、requestId、run capability、sequence 和 payload；daemon 以已保存的 Run ownership 推導 actor/scope，不信任 LLM 或客戶端傳的 `actor=owner`、workspace path、credential reference。
Message 必須有限大小、backpressure、timeout、取消與錯誤關聯；不能將整個 raw model transcript 每 token 複製到所有 workers。

## 6. Domain model 與所有權

### 6.1 ID 與共通欄位

Opaque UUID/ULID 均可，但全專案一致。時間以 UTC ISO-8601 保存，schedule 另存 IANA timezone。
`revision` 用於 CAS；`sequence` 為 SQLite monotonically ordered event cursor，wire 使用 decimal string 避免 JS 大整數精度問題。
不要用目錄路徑、顯示名稱、模型名稱代替 entity identity。

### 6.2 Entity 最小欄位

| Entity | 必要資料與關聯 |
|---|---|
| Assistant | id、displayName="Rocky"、avatarAssetId、personaVersion、locale、defaultModelConnectionId、revision；預設恰一個，名稱不是identity |
| Conversation | id、assistantId、kind=main、activeExecutionSessionId、revision；是 UI 歷史，不等於 graph thread |
| ExecutionSession | id、conversationId、kind=main/background/reflection/evaluation、graphThreadId、workspaceId、generation、status |
| Work | id、requestId、intentHash、kind、origin、conversationId、executionSessionId、promptRef、parentWorkId、rootWorkId、retryOf、status、revision、completionRef |
| Run | id、workId、attempt、executionSessionId、workerId、status、resolvedConfigRef/hash、startedAt/endedAt、usage、failureReason |
| RunSegment | id、runId、segmentNo、checkpointRef；一個核准 resume 可有新串流 segment，不是新 Work |
| Operation | id、runId、logicalToolCallId、subagentId?、toolIdentity、argsHash、targetFingerprint、phase、effectOutcome、resultRef、timestamps |
| Approval | id、operationId、run/session/work IDs、intentFingerprint、argsRef、impact、decision、expiresAt、decisionRequestId、revision |
| Receipt | scope、requestId、intentHash、entityId、state、createdAt；submission/steering/decision 分別記錄 |
| Workspace | id、canonicalRoot、projectId?、worktreeRef?、trust、revision；不是一段自由字串 |
| Environment | id、kind=native/isolated、workspaceMounts、networkPolicyId、capabilities、status、revision |
| BrowserProfile | id、environmentId、accountLabel?、sharingPolicy、storageRef、lease、revision；cookie 不在公用 DTO |
| Artifact | id、workId/runId、manifestHash、files/checksums/mime/size、entry、verificationRefs、createdAt |
| Document | id、scope、contentBlobRef、revision、sourceConversation/work/artifact refs；可編輯版本，不覆寫舊 artifact |
| Memory | id、scope、content、revision、sourceRefs、locked、userEdited、status、createdAt/updatedAt |
| Skill | id、name、scope、sourceKind、activeRevision、status、owner、provenance |
| SkillRevision | skillId、revision、contentHash、manifestRef、parentRevision、evidenceRefs、evaluationRef、publishedAt |
| SkillProposal | id、baseSkillId/revision、candidateRevision、candidateHash、goal、scope、evidenceRefs、status、evaluationRefs |
| LearningEpisode | id、sourceRunId、boundarySequence、scope、redactedEvidenceRef、eligibility、retention、hash |
| EvalSuite / EvalRun | immutable suite/version/hash、splits、case groups、model/tool/policy snapshots、target skill hash、results/usage/verdict |
| Routine | id、promptRef、schedule/timezone、misfirePolicy、enabled、lastOccurrenceKey、target workspace/MCP mapping |
| TrackedWork | id、originWorkId/sessionId、MCP server/tool mapping、resourceId、fingerprint、maxFollowups、status |

Source attribution與 revisions 不是 UI 裝飾；是核准、復原、Learning 與 rollback 的正確性條件。

### 6.3 三層 state 權威

Graph saver 管 messages/tool graph state/checkpoints；Work Store 管 admission/lifecycle/receipts；Conversation/Artifact Store 管對使用者可見的歷史與成果。
AG-UI messages 是 projection，可重建；不可與 graph state 雙方互相最後寫入勝出。
完整 user input 只由 server 收件一次。正常下一輪對 graph 提交新的、未套用 messages，不把 UI 全歷史再 append 導致重複。
前端可有 pending optimistic UI，但必須有 durable receipt 對帳，不能自行決定 Work completed。

## 7. Work、Run 與 concurrency 契約

### 7.1 狀態機

```text
Work:
queued → waiting_resource → running ↔ waiting_approval
                               ├→ completed
                               ├→ failed
                               ├→ cancelled
                               └→ interrupted

blocked(needs_reconciliation) = 非執行中的阻擋狀態；確認未知效果後，
只能結案或顯式建立後續／retry Work，不自行轉回 running。

Approval: pending → approved | rejected | expired | superseded
Proposal: draft → evaluating → pending_review → published
                         └→ evaluation_failed / insufficient_evidence
          任一未發布版本可 rejected / quarantined；修改即新 candidateRevision。
```

`failed/cancelled/interrupted/completed` 為 terminal，不偷偷原地變回 running。Explicit retry 建新 Work/Run，保存 retryOf；背景工作建立新 session，不能假定上次外部動作完全沒發生。
`waiting_approval` 可以在同一存活工作以已驗證 checkpoint resume，產生新的 RunSegment。Graph 層 `RUN_FINISHED` 只可能代表此段 invocation 結束；不能直接推論 Work 完成或已核准。

### 7.2 Foreground、background 與 subagent

一個主 execution session 同時一個 active invocation；新的主訊息若與目前工作同目標可作 steering，否則入隊並顯示。
背景工作有獨立 session/workspace；`start_background_work` 回傳 workId/sessionId/queued status，不回傳虛構成果。
原生 task child 繼承 root 的 tool permission、model budgets、network grants、skill version snapshot；可縮權，不可擴權。
子代理結果與公開 activity 有穩定 subagentId；不把其 token stream 直接混到主 assistant answer。

### 7.3 起始 capacity policy（可設定、須有上下限）

主對話 admission 保留 1；持續背景工作預設最多 2；每 root 的 active native children 預設最多 2；Learning/eval 另有 1 個低優先序 slot。
Learning 不因為另有 worker 就不受 global model semaphore 限制。前景出現時，在安全邊界讓出未開始的低優先呼叫，不暴力取消已送出的寫入。
同 endpoint 的 rate limit 與 concurrency 共用；暫停／核准不計為 model execution slot，但 workspace reservation 依資源語意保留。

### 7.4 避免 workspace／parent-child 死鎖

先獲取 workspace reservation，再拿 execution slot；等 workspace 不持 model slot。
同一 root 的 native children 共用 root-owned workspace lease，檔案寫入另用 canonical target lock；不得每個 child 重拿不可重入 exclusive root lock。
獨立背景 Work 不同步等待與 parent 重疊的工作區鎖；預設新資料夾或 worktree。`start_background_work` 非同步返回是強制行為。
對多個資源統一排序鎖定；取消必須清理 waiter；lease owner 不可由客戶端任意傳入。

### 7.5 Steering

`POST .../steer` 收件產生穩定 receipt，含 target run/session/version。只有 graph invocation boundary 已套用才標 applied。
取消、terminal 或 target stale 時標 not_applied 並回傳原因。僅收件而未消費不算模型已接受。
不能把另一項背景工作的新要求注入主 thread；引用附件／檔案內容也必須在送入時核對 revision。

## 8. Persistence、checkpoint、事件與故障復原

### 8.1 原生 checkpoint，最少自製層

用官方公開 graph saver API 保存並恢復有效 execution state，不引入參考Repo的大型 normalize/rebuild。如果為了 Node-only 必須做 adapter，只替換 storage transport，不能重新發明 graph reducer。
優先在已證實支援的寫入模式下保存安全 checkpoint；原始 tool evidence 和已確認產品狀態另存。必要時使用同步 checkpoint durability，測量性能並記錄決定。
不要強迫所有 provider 256K context；設可信模型上限、輸出保留、tool/memory/skill budgets。摘要失敗保留上個可用 checkpoint，不靜默截斷最新指令。
官方 checkpoints／interrupts 有自身重入與持久化語意；不保證任意 API action 的 exactly-once。[SRC-16][SRC-17][SRC-18]

### 8.2 Operation ID 與 replay barrier

`operationId` 必須由已持久化 run identity、logical tool call 與必要序號解析；不可每次重入隨機再產一個。
同 operationId 已有 success result 時，恢復返回已保存結果，不再執行；內容 hash 不同視為衝突。
遠端 API 支援 idempotency key 時傳同一 key，但不能只因 MCP 通訊有 request ID 就聲稱有遠端冪等保障。

### 8.3 Outbox 與 inbox

Domain transaction 更新 Work／Operation 的同時寫 outbox record。完成訊息 ID = `work-result:<workId>`，ConversationStore 有 unique constraint。
Dispatcher 可以重試事件／訊息交付；**事件的 at-least-once delivery 不允許導致工具副作用再次執行**。
主 run 開始讀 pending completion inbox，記錄高水位 cursor；僅在這批內容已進入可恢復 checkpoint 後推進消費狀態。
Graph DB 和 domain DB 沒有跨庫 transaction；需有 inbox-delivery ledger/批次 ID，加 fault injection 防止先 ack 後存 checkpoint 的遺失窗口。
晚於 snapshot 的背景結果留下一輪。UI 只載最新 50 則／已有摘要，都不能使 completion 永久消失。

### 8.4 Crash 決策表

| crash 時點 | 復原行為 |
|---|---|
| Work 已入隊，worker 尚未拿到 | queued 可重新 admission，但有 durable command 去重 |
| intent prepared，尚未送出工具 | 不宣稱有副作用；依新工作／安全核准流程繼續 |
| 工具已送出，result 未寫入 | Operation effectOutcome=unknown；阻擋該目標的重送，要求對帳 |
| result/ledger 成功，graph 未 checkpoint | 以相同 operationId 返回已保存結果；不得重送工具 |
| Work 結束，完成訊息未入 Conversation | 重播 outbox，unique completion ID 消除重複 |
| waiting approval 時 daemon 重啓 | 舊 pending approval 過期；保留紀錄；不可沿用舊 fingerprint 自動執行 |
| 正式文件已 stage，registry 尚未 publish | 不公開；下次啟動清理／繼續受控提交，不能掛失效指標 |
| registry published，UI event 尚未送達 | 重新發 projection event，技能本體不重寫 |

本版 daemon crash 不自動恢復已進入外部工具執行的 active Work。確認狀態後顯式新建 continuation/retry Work。
可重用安全的資料／已確認摘要，但不能把舊版 pending graph control state 當正常下一輪直接重播。
主 UI conversation 不變；必要時換新的 execution-session generation 承接確認歷史，避免舊 pending tool_calls 汙染新 Run。

### 8.5 正常關閉

停止 admission → 通知 UI → 取消 worker／工具請求並等待有限 grace period → 未結案效果標 unknown → flush journals/outbox → 關閉 stores。
未啟動的 queued work 保留；不宣稱它在 daemon 關閉後仍會跑。超時終止程序樹；未能證明停止的外部／remote 作業記錄限制，不把取消等同 rollback。
## 9. API、AG-UI 與前端狀態契約

### 9.1 API 原則

Rocky本地產品 API 使用 `/api/v1`；CopilotKit adapter 可有專用 gateway path，但底層仍呼叫相同 application services。
所有 mutations 用 server-side schema 驗證、拒絕未支援欄位；設定與物件更新使用 `expectedRevision`。所有 response DTO 都先去除 secrets。
統一錯誤包含 `code`、對使用者的 `message`、可選 `retryable`、`requestId`、不含秘密的 `details`。400=格式、403=權限、404=不存在、409=版本／idempotency conflict、422=不支援能力、429=資源預算、503=設定／服務不可用。
同 requestId 重送相同 canonical payload 應回原 receipt/entity；不同 payload 一律 409。此規則適用重啟之後，不僅是記憶體 Promise map。

### 9.2 最小 endpoint 集（語意固定，命名若改須同時更新 contracts/tests）

| Method / path | 契約 |
|---|---|
| `GET /health`、`GET /capabilities` | 程序健康與 model/browser/container/learning 的 configured/available/verified 分離 |
| `GET /assistant` | 單一Rocky profile與personaVersion/avatarAssetId；不回傳secrets |
| `GET /conversation` | 主對話 id、目前 session generation、最新 messages、cursor |
| `GET /conversation/messages?before=&limit=` | 穩定 sequence 分頁；預設 50、上限 100 |
| `POST /conversation/messages` | `{requestId,text,attachmentRefs?,expectedSessionId}`；建立主 Work 或回 steering/queued receipt |
| `POST /works` | `{requestId,prompt,kind:"background",workspaceId?,contextRefs?}`；202＋work/session receipt |
| `GET /works?cursor=&status=`、`GET /works/:id` | Work summaries／details；不把整個 graph raw state 當 public DTO |
| `GET /receipts/:requestId?scope=` | response 不明時先查 authoritative receipt |
| `POST /works/:id/steer` | target run/session/revision＋requestId＋text |
| `POST /works/:id/stop` | target run/session/revision＋requestId；取消單一 Work |
| `POST /works/:id/retry` | 新 requestId、確認的 effect reconciliation refs；回新 Work，永不重啟 terminal ID |
| `POST /approvals/:id/decision` | requestId、expectedRevision、intentFingerprint、approve/reject；由後端判定有效性 |
| `GET /events?after=` | 持久化 SSE（或 adapter 同等機制）；不可由 fetch abort 取消 Work |
| `GET /snapshot?after=` | 包含高水位 cursor 的一致 public projection，處理保留期外重連 |
| `GET/POST/PATCH /model-connections` | schema、revision、credential refs；提供各 connection test operation |
| `GET/PUT /mcp/config`、`POST /mcp/:id/test` | JSON/config revision、安全診斷；禁止以 test 暗中執行未知工具 |
| `GET /mcp/:id/tools?cursor=` | 分頁工具 metadata；只列允許 scope |
| `GET/POST /workspaces` | explicit workspace registration／canonical path approval |
| `GET /environments`、`POST /environments/:id/actions` | owner-only start/stop/capability administration |
| `POST /browser-profiles/:id/control` | requestId、take/release、profileRevision；agent 不可呼叫 owner command |
| `GET /artifacts/:id`、`GET /artifacts/:id/files/:fileId` | manifest與受控下載，不接受 arbitrary host path |
| `GET/POST/PATCH /documents` | Markdown content、expectedRevision、source refs；格式限額 |
| `GET/POST/PATCH /memories` | scope、revision、lock、provenance；人工與模型 actor 由伺服器識別 |
| `GET /skills`、`POST /skills/import` | 匯入前 trust/license/provenance 預覽；只建立新的本地 snapshot |
| `GET /learning/episodes`、`POST /learning/jobs` | 只在選定證據／scope 下啟動；requestId 必填 |
| `GET /skill-proposals`、`POST /skill-proposals/:id/evaluate` | 受限 candidate 與 immutable eval suite |
| `POST /skill-proposals/:id/decision` | hash/revision/evalManifestHash＋approve/reject/quarantine |
| `POST /skills/:id/rollback`、`POST /skills/:id/revoke` | owner action、exact revision 與理由；記錄 audit |
| `GET/POST/PATCH /routines`、`GET /tracked-work` | timezone-aware 設定；target MCP mapping 顯式保存 |

Rocky附件上傳為明確新功能，採本機檔案及純文字/Markdown/PNG/JPEG基線；必須 server-side 限額、hash、MIME 判定、scan／解壓限制；只回 attachmentRef，不能接受 arbitrary raw file path 作為已授權引用。

### 9.3 事件存儲格式與 AG-UI 映射

Rocky 內部 public event envelope（**不是擅自擴充標準 AG-UI 根 schema**）：

```ts
type PublicEvent = {
  schemaVersion: 1;
  id: string;
  sequence: string;
  timestamp: string;
  workId?: string;
  runId?: string;
  segmentId?: string;
  executionSessionId?: string;
  subagentId?: string;
  payload:
    | { kind: 'agui'; event: AgUiEvent }
    | { kind: 'domain'; name: string; data: unknown };
};
```

`AgUiEvent` 必須來自鎖定版本的官方 schemas；上方只定義 Rocky envelope。對 CopilotKit SDK 傳輸時 adapter 輸出標準 AG-UI 事件；domain payload 用正式 CUSTOM event，例如 `rocky.work.updated`、`rocky.approval.required`、`rocky.artifact.published`、`rocky.subagent.updated`。
Text/Tool/State events 使用官方 event types，不讓 UI 依名稱猜 runtime internals。[SRC-12]

DB event 和 SSE id 有一致序號；事件先持久化才對外發送。Token chunks 可短暫批次合併後持久化，不必每 token 一個 SQL transaction；未持久化的 partial 在 crash 後清楚標示未確認。
SDK render projections 和產品 views 共用 stable IDs，不各自維持一份互相更新的聊天權威來源。

### 9.4 UI 行為

主畫面：對話、composer、簡短 Work status；背景工作抽屜與核准卡。依任務可打開 Computer／文件預覽，不把所有 panel 永久同時展開。
Work 詳情：公開 commentary、原生 todos、subagent assignment/status/activity/result、工具證據、變更／測試／成果；raw IDs 和 JSON 在最深層。
角色活動由Work/Run/Operation/Approval的已確認事件驅動；heartbeat只表示程序存活，不表示工具前進。60秒沒有可觀測進度顯示stale並停止忙碌動畫；失聯是同步狀態，不等於daemon停止。
核准等待顯示 operation、實際工作位置、args/diff、外部目的地與影響，不只顯示一句「允許嗎」。
重新創作 Rocky 品牌與角色，不沿用上游品牌素材或48-avatar選擇；展示布局與互動以 OpenDots 為主基準。依Bot設計規格實作；所有固定UI文字支援繁中/英文，模型原文不自動翻譯。
公開摘要可以展開；不顯示／保存供應商私有 reasoning blocks 為工作內容，也不要求模型吐 raw chain-of-thought。
完成驗證看真結果；HTTP 200、graph invocation ended、tool response arrived，都不是任務成功的充分條件。

### 9.5 Rocky Bot 專屬契約

[ROCKY_BOT_DESIGN_SPEC.md](ROCKY_BOT_DESIGN_SPEC.md) 是視覺與人格的專章，不是第二套runtime規格。`RockyAvatar`與`RockyPresence`接收經server狀態投影的資料；persona、avatar、display name不改變grants或tool capabilities。主對話idle時仍顯示背景工作數與pending approvals；斷線顯示最後確認時間。新視覺資產交付與狀態機測試列T-037/T-038及AT-62～AT-70。

## 10. Tool Broker、Policy 與核准

### 10.1 統一執行管線

```text
resolve owned Run context
 → validate schema / current tool registry
 → normalize canonical target / hash exact intent
 → policy decision (deny first)
 → persist operation prepared
 → request exact consent when required
 → acquire target lock / validate final target & policy
 → persist authorized / dispatch intent
 → execute bounded adapter
 → persist outcome + evidence
 → emit result / update graph
```

ledger 的 `phase`（prepared/authorized/dispatched/settled）和 `effectOutcome`（not_executed/succeeded/failed_known_no_effect/unknown）分開；工具拋 error 不代表沒有外部效果。
工具輸出過大應卸載成有 hash/reference 的私有 scratch，按頁讀取；文字／圖片／structured content 保留類型，不一律 stringify 丟失 vision 證據。

### 10.2 權限分類起始政策

| 類別 | 例子 | 行為 |
|---|---|---|
| denied | 不在 scope 的目錄、撤銷 MCP、讀他人的 profile、修改 policy | 一律拒絕，不提供用另一工具繞過的 fallback |
| known_read | 明確限定的 workspace read／已信任映射的只讀資訊工具 | 設定與資料 scope 都允許才自動執行 |
| local_new | 在授權 workspace 建立新的普通檔案／候選 draft | 可依模式允許，但執行時 target 已存在則重新分類 |
| critical | 改既有檔案、destructive command、敏感設定、持續指令／技能發布、外部寫入 | 必須 fresh approval；可一次核准精確 batch patch，不可無限概括 |
| unknown | 任意 shell script、未信任 MCP effect、帶登入的 browser 操作、未知 URL 副作用 | fresh approval 或拒絕；模型風險分數不得把 unknown 升成 read |

原生 filesystem backend 只准寫該 run 的 scratch；真實 workspace、published skills／memory storage 和 host execute 必須經 Broker。
若接官方 filesystem/sandbox backends，必須在公開 backend/tool seam 掛 policy 或限制其 mount；禁止「把 broker 工具加上去」卻保留另一組無守衛的 execute/write_file。
Native `execute` 不得直接通 host；提供單一受控 Shell 能力。Reflection mode 更不能因預設 general-purpose subagent 帶 tools 而繞過限制。

### 10.3 核准指紋

至少綁：run/work/session、tool server/config/schema revision、完整正規化參數、workspace/environment、canonical target identity/revision、network policy、browser profile/snapshot、當時 policy revision。
Secrets 不直接顯示，但 fingerprint 可包含不可回推出秘密的 credential version ID。核准不等於把 secret 複製進前端。
核准後重查，目標不同產生 superseded approval；不使用舊批准。Critical 不可 remember forever；user `Send` 只授權 exact draft submission。
等待人工決定時不要長時間佔 SQL transaction／model slot。需要防多個程序修改時用專用 target lease 並在 dispatch 前重查，不能聲稱完全防外部 OS race。

### 10.4 不可取消／remote jobs

AbortSignal 只能中止本地等待，不保證遠端工作已停止。能 cancel 的 adapter 回傳取消證據；不能確認時 Operation=unknown／remote_pending，UI 說明。
沒有可確認的 remote idempotency key 或狀態查詢，不自動 retry mutating calls。Read retries 也必須 bounded 並遵守取消與設定撤銷。

## 11. Model、Network 與 credentials

### 11.1 ModelConnection

保存 provider type、baseUrl、modelId、credentialRef、capabilities（stream/tools/vision/structured）、contextWindowTokens、maxOutputTokens、proxy/CA policy、revision。
新建 OpenAI-compatible／OpenAI／Anthropic／Ollama-compatible 連線支援；未知模型不要硬套供應商預設 URL 或 256K。
省略 endpoint 僅對已明確選擇的官方 provider 有可見預設；custom/公司模型必填，測試不能偷偷改到公網 provider。
probe 只發無敏感資料的 nonce，分別驗證文字、stream、tool-call roundtrip、取消、可選 vision。通過 probe 不代表長任務已可靠。

### 11.2 Explicit Network Policy

model endpoints、MCP endpoints、網站瀏覽、測試／learning 各有目的與 scope。設定一個模型，不代表開放任意網路或其他 provider。
URL 必須 canonicalize、拒絕內嵌帳密；redirect 重新核對目的地，不跨 origin 轉送 Authorization。
預設禁 loopback/private/cloud-metadata 探測；**使用者明確配置的公司內網／本機模型/MCP 可以例外允許指定 host/IP/port**，不能一律擋掉符合目標的內網 API。
網站的頂層 navigation 和 subresources 分開記錄；可以明確授權 public-web read scope，但仍不得由網頁內容擴張內網存取或外部寫入能力。
處理 DNS rebind、URL encoding、IPv4/IPv6 與重新解析；無 OS enforcement 的 Native tools 不宣稱所有封包都經此 client。

### 11.3 Proxy／CA／Windows

model、MCP 與 child env 可以選擇各自的代理策略，支援 HTTPS_PROXY/HTTP_PROXY 與 NO_PROXY 大小寫／host patterns，並以測試固定解析結果。
不可改全域 npm proxy、系統 proxy、DNS 或 TLS 來完成安裝。企業 CA 使用明確配置的受信憑證，不使用 `NODE_TLS_REJECT_UNAUTHORIZED=0`。
Windows `npx.cmd`／shell invocation 的解析交由被測 process adapter；不能把任意 args 串成命令列。對 `.cmd` 必要 wrapper 特別測 quoting，禁止不可信 shell interpolation。
標準自帶 MCP fixtures 以 `process.execPath` + JS entry 啟動。bun 是使用者可選的 launch command，不是 Rocky 必須依賴。

### 11.4 Secrets 與本地 auth

核心使用 environment credential references；可選本地 secrets file 需 OS 權限限制與明確未加密警告，不作跨平台 keychain 必要依賴。
不把 keys 放 query string、localStorage、model prompt、eval config、Git 或 browser request body。未另明示前，不在瀏覽器直接向模型供應商發請求。
Daemon loopback 預設；Host/Origin/CSRF 與 owner session 均須檢查。設定 change、stop、approval 不得被跨站頁面直接 POST。
一般遠端／LAN 公開 hosting 不在本版驗收；不因綁 `0.0.0.0` 就宣稱安全支援多使用者。

### 11.5 外部套件無隱藏流量

在載入相關 SDK 前設定並確認：

```dotenv
COPILOTKIT_TELEMETRY_DISABLED=true
PROMPTFOO_DISABLE_TELEMETRY=1
PROMPTFOO_DISABLE_UPDATE=1
```

這些旗標來自官方文件；仍需網路觀測檢查 browser、runtime、CLI/worker 是否遵守。[SRC-11][SRC-27]
不自動載入使用者 home 的 Promptfoo cloud login／預設 provider 設定；以 Rocky-owned config/cache namespace 運行。
LangSmith／OTel remote exporters／SDK 類似 tracing 只在使用者另行配置才可啟用；本版預設本地 redacted logs。

## 12. MCP Registry 與通訊

### 12.1 Config 是 Rocky 的格式，不是 MCP 協定規定

例子（所有 servers 預設 disabled，示例 URL 不可用；各 path 必須由使用者實際設定）：

```json
{
  "mcpServers": {
    "local-tools": {
      "command": "node",
      "args": ["./mcp-tools/dist/index.js"],
      "env": {"LOG_LEVEL": "warn"},
      "enabled": false
    },
    "company-tools": {
      "url": "https://mcp.example.invalid/mcp",
      "enabled": false
    }
  },
  "x-rocky": {
    "version": 1,
    "servers": {
      "local-tools": {
        "transport": "stdio",
        "envAllowlist": ["PATH", "SystemRoot", "TEMP", "TMP"],
        "startupTimeoutMs": 30000,
        "toolTimeoutMs": 60000
      },
      "company-tools": {
        "transport": "streamable-http",
        "bearerTokenEnvVar": "ROCKY_COMPANY_MCP_TOKEN",
        "networkPolicyId": "company-mcp"
      }
    }
  }
}
```

必須有 discriminated schema：stdio=`command+args`、HTTP=`url`，拒絕混雜欄位。相對 executable arguments／cwd 的基準固定為 config directory 或經核准 workspace，文件寫清楚；不做 shell-style arbitrary variable expansion。
`env` 不可被模型修改；secret refs 單獨保存。HTTP secret header 支援依受控 references 注入，不要求 plaintext key 出現在 JSON。
config更新用hash/revision和atomic replacement，失敗不重置空白。初始mcpServers為空，僅接受Rocky schema；帶上游app extension回明確validation error，不做Apsis importer。

### 12.2 Server lifecycle

狀態至少 `disabled / configured / starting / ready / failed / stopping`；configured 不等於 connected，更不等於 verified。
stdio stdout 僅協定，stderr bounded redacted 診斷；超量／非協定輸出停止並告知。SDK 自己的 negotiation／request IDs 不手寫。
程序重啟只恢復連線，不重送未知副作用工具。tool list 分頁完整讀取；schema changes 更新 registry revision 並使適用 approvals 失效。
remote credentials/OAuth 如 server 要求，用官方 client 公開 auth 能力及明確使用者互動；本版不架 OAuth broker，不繞過瀏覽器授權。不支援的流程回 unsupported，而非要求 managed connector。
以鎖定 SDK 的能力支持現在及現有需用 server protocol；MCP SDK v2 與既有 v1 server 不能憑名稱推論相容。[SRC-19]

### 12.3 Tool discovery 與 schema

registry key=`serverId + originalToolName`，model-facing alias 安全編碼且保留反向對照。不以 serverInfo.name 當唯一 identity。
預設目錄為短 metadata；用原生動態 tools 能力或受控 `mcp_discover`／`mcp_call` adapter 按需揭露 schema；只留一種被測策略，禁止同時一份 dynamic 與一份 bypass generic dispatcher。
無論外層 schema 如何，執行時對完整原工具 JSON Schema 驗證。Prompt/model 無法指定另一個未授權 server／schema 版本。
`readOnlyHint`、tool description、resource links、返回頁面全部是不可信資料。MCP prompt 只能明確插入為 task data，不變成 system policy。External schema refs 不可任意 fetch。[SRC-20]
未實作的 sampling／elicitation／server callback 等能力預設關閉並在 capabilities 誠實宣告，禁止讓 MCP server 偷開另一模型或追加權限。

### 12.4 外部帳號整合只走 MCP

PR、CI、文件服務、行事曆等 product integration 透過使用者選擇的 MCP server/tool mappings。不可新加入 `GitHubConnector`／Composio／managed Channels 當捷徑。
Rocky 內部 file、work、approval、skill、artifact operations 不必繞 MCP；模型 endpoint 也不算 connector。Native shell 不是產品用來偷偷繞 MCP 連帳號 API 的 integration 路徑。
對自選 MCP 的實際網路、帳號權限與第三方 runtime 需求如實揭露，不承諾所有 MCP 都 Node-only 或被 Rocky OS-sandboxed。

## 13. Workspace、Git 與 Computer

### 13.1 檔案範圍與 worktree

Workspace registration 由 owner 明確選定 canonical root；檢查 realpath、Windows junction/UNC/case、absolute path、traversal、symlink。
新建檔採可判定的 exclusive creation；existing write 需要 revision。避免「先 exists 再 write」並行繞過重大核准。
新背景 coding Work 預設建立 branch/worktree；不可自動 `git reset --hard`、clean、刪分支或覆蓋未提交修改。若無 Git，只提供明確隔離目錄與 diff，不能假稱 worktree。
Scratch、技能目錄、系統 data 與真實 project 分離；host tools 不能因路徑在 workspace 內就讀到 symlink 指向的秘密。

### 13.2 Environment adapters

`NativeEnvironment` 提供新建的受控本機能力，UI 說明執行於使用者 OS 權限；`IsolatedEnvironment` 提供本機容器能力。
OpenBot 只作受限 supervisor/computer adapter 參考，不導入它的 agent loop。固定來源版本／image digest，檢查 licence與 Node-only 主流程。[SRC-09]
容器引擎不是 core prerequisite；缺少時顯示 unavailable。可選 Podman 或 Docker-compatible engine，必須先有實際相容證據，不能標 Docker API compatible 就跳過 smoke test。
如 Docker Desktop 有獨立商業條款，不能把它列為免費 OSS 核心的必要條件。Engine/VM/browser 為外部部署 prerequisites，單獨說明。

### 13.3 Environment 權限與掛載

只掛載該工作需要的 root，禁掛整個 home、Rocky secrets/domain DB 或 container socket；agent container 不拿 supervisor master credential。
允許 tools 與 network 明確分離。需證明的 egress policy 沒有 enforcement 時標 application_only／unverified，不顯示 enforced。
server 回傳 computer URL 要比對 owned environment identity／容器名稱／可允許 endpoint，不任意代理 server 提供的 URL。
Container service unavailable 就中止該能力，不默默落回主機。停止 container 不刪持久 volumes；reset/cleanup 為額外 owner approval。

### 13.4 Browser ownership

BrowserProfile 和 work tabs 分離。預設工作使用獨立乾淨 profile；登入 profile 可明確共享，但同一 profile 的 mutating browser activity 必須序列化並在 UI 顯示共用帳號範圍。
每次 snapshot 有 profileId、environmentId、pageId、url、navigationRevision、snapshotId、capturedAt。元素操作要引用有效 snapshot。
Takeover owner request → 停止該 profile 新 agent input → 完成／界定已送出的操作 → 人工控制 → release → 必須 fresh snapshot 後才可繼續。
只影響指定 profile，不關閉全域 browser context。舊畫面／舊元素標籤不能沿用到批准後的另一頁。
截圖 preview 標示 capture time／stale；可以輪詢，不聲稱 video stream。歷史工具卡若顯示「目前畫面」，不能誤作當時操作證據。

## 14. Documents、Artifacts、Memory 與 Skills

### 14.1 Artifacts／Documents

Artifact 是 immutable snapshot，至少含每檔 SHA-256、MIME、size、entry point、來源 Work/Run、確認的測試與工具證據。先寫 temporary/staging，校驗成功後 atomic publish registry。
workspace 檔案後續變更不改舊 artifact。Document 是可修訂內容，按 revision CAS 建新版本；下載／對外分享不直接暴露 host path。
HTML/JS 預覽採隔離 origin 或 opaque sandbox frame，不能同時給不受信任內容 script＋same-origin 權限。預設不連網，無法存取 daemon cookie/storage/API。需要互動程式時由 sandbox verification，不在主 UI 執行。
基本 Markdown 編輯與 source mode 足夠本版；進階 Tiptap 可復用開源，但不能吞掉不支援語法或覆寫使用者草稿。
Rocky第一版只強制Markdown/純文字文件及PNG/JPEG附件/預覽、不可變檔案下載與受限HTML成果預覽。PDF/DOCX/XLSX解析匯出不因Apsis曾有就成為parity要求；需另列明確需求才加入Node adapter。不引入Python converter。

### 14.2 Memory／Knowledge

Memory 保存少量有 scope 的事實／偏好，Knowledge 是文件與來源；History 是歷史，graph summary 是執行狀態。不要四者塞成同一段 system prompt。
scope 至少 user/project/task，manual locked／userEdited 條目禁止模型覆寫。model 的 `remember/update` 經伺服器 permission、revision 與必要核准；不是直接 filesystem write。
SQLite FTS/substring 先完成中英搜尋，配明確 token budget 與來源 ID；缺少證據或矛盾不自動當成真事實。
刪除 memory/episode 後清理索引、cache、對應引用；標記衍生技能需重查，不能聲稱能撤回已送往第三方模型的資料。

### 14.3 Skill package

使用 Agent Skills `SKILL.md` 的標準 frontmatter/name/description 作可攜格式；Rocky-specific approval/eval/provenance 放旁邊 manifest，不污染通用格式。[SRC-15]

```text
skills/
  published/<skillId>/<revision>/
    SKILL.md
    references/
    scripts/              # optional; per-use runtime policy applies
    manifest.json
  proposals/<proposalId>/<candidateRevision>/
    SKILL.md
    diff.json
    evidence.json
    evaluation-summary.json
```

manifest 包含 content hashes、scope、source type、upstream license/reference、requiredCapabilities、baseRevision、evidenceRefs、evaluationRefs。
候選、inactive、quarantined 不能進正常 Agent skill discovery。Published 目錄對 runtime 唯讀；registry pointer 是唯一 active revision 權威。
Global `~/.agents/skills`／project `.agents/skills` 是外部來源；首次 discovery 只列出待信任 items，使用時導入固定 snapshot/hash 並保留來源，不直接讓 runtime 動態讀尚未審查的可變檔案。
衝突名稱用 scope/id 去重；手動來源不能被 Learning 自動改寫。Skill 檔案內容是程序性提示，不得被視為額外授權。

### 14.4 Skill loading

優先原生 Deep Agents progressive skills；registry 提供只讀 scope view/目錄 backend。不要同時保留第二套會把全部 skills 拼到 prompt 的 loader。
Run 開始凍結 catalog version，實際 load 記錄 skill/revision/hash。每個 run 可記錄 not_used／loaded／outcome，但不能把一起出現當因果改善。
普通發布只影響新工作；security revoke 對後續 tool calls/load 立即生效，並通知使用中工作。不能撤回已完成副作用。
## 15. Automatic Learning：完整的受控閉環

### 15.1 模式與角色

`off`：不自動讀取工作產生學習；使用者仍可選取一段已完成工作手動提出技能。
`propose`：經 owner 同意後，對指定 scopes 的合格事件自動提出 candidate、在預算內測試並放入 Inbox。
**本版沒有自動寫入 active SKILL 的 auto 模式，也沒有學習後直接擴權。**
Reflection 使用Rocky同一套 Agent factory，但 system role、input view、budget 和 tools 受限；可讀的不是全資料庫，而是已審查的 LearningEpisode 與允許的既有 skill revisions。

### 15.2 Episode 選取

合格觸發：明確使用者修正、成功修復可重複的失敗、有可驗證成果的多步任務、使用者明示「把這個流程學成技能」。
排除：純閒聊、只稱成功無工具證據、private/incognito/禁止學習 scope、取消且無可驗證結論、learning/eval 本身產生的 runs、來源條款不許重用的內容。
去重 key 至少 `sourceRunId + terminalBoundarySequence + learningPolicyRevision`；普通原生 subagent 不能觸發另外十份重複 episode。
Episode 保存目標、限制、使用者修正、observed tools、驗證結果、失敗與有效修復、上下文前提、來源版本。非必要內容不存第二份；sensitive 資料先遮罩再外送。

### 15.3 Reflection capability

允許：`read_learning_episode`、`read_skill_revision`、`list_allowed_skills`、`propose_skill_create`、`propose_skill_patch`、`mark_no_learning`。
禁止：host execute、普通 MCP、任意 URL、任意 workspace、write active memory、write published skills、修改 policy／evaluation suite、提交外部 actions。
Subagents 如需要分析，只繼承以上集合；native scratch 寫入限定私有臨時目錄。不能留一個預設 general-purpose child 可用原本全部 tools。
反思無可重用結論時可回 `no_learning`，不要求每次必產一個技能，避免技能膨脹。

### 15.4 Proposal schema（產品契約）

```ts
type SkillCandidate = {
  proposalId: string;
  candidateRevision: number;
  base: { skillId: string; revision: string; contentHash: string } | null;
  scope: { kind: 'user' | 'project'; projectId?: string };
  name: string;
  description: string;
  goal: string;
  preconditions: string[];
  triggers: string[];
  steps: string[];
  stopConditions: string[];
  verification: string[];
  evidenceRefs: string[];
  requiredCapabilities: string[];
  files: Array<{ path: string; blobRef: string; sha256: string }>;
  knownLimitations: string[];
};
```

候選是資料，paths 只能是 skill package 相對路徑；禁止 `..`、symlink、absolute paths、覆寫 Rocky 設定。
必須指出何時適用／不適用。例如 Windows MCP 啟動經驗不能變成對所有 OS 的永久建議。
新 evidence 只是可追溯資料，不能被引用成「因此可以永久跳過核准」。
修改既有技能優先 typed delta／unified diff 及 base hash；完整重寫須有理由與保留原有效行為的 eval。

### 15.5 評測管線

```text
candidate hash frozen
 → static checks / secret scan / capability checks
 → train evaluation (可回饋 generator)
 → validation (用於選擇 candidate，不是最終未知 test)
 → selected candidate frozen
 → final holdout (不回饋 generator 反覆調整)
 → verdict + exact evaluation manifest
 → human review
 → publish CAS
```

需要比較：無技能 baseline、現在 published skill（若有）、候選版本。固定相同 model endpoint/config、tools/schema、environment fixture、policy、seed（provider 支援時）、case versions、budgets。
複製相同內容成三個 case 不算三份獨立證據；按 task family、episode/project 分組避免 train/test 穿越。
起始完整驗證集目標至少 12 個獨立案例（6 train / 3 validation / 3 final holdout），包含至少一個不應觸發技能的負面案例。少於此數可執行開發評測，但結論標 `insufficient_evidence`，不可聲稱普遍改善。
對特定狹窄技能若需要不同數量，suite owner 必須事先在版本化設定定義最低資料和理由，不能候選失敗後臨時降低門檻。

### 15.6 Promptfoo 的定位

自帶的 trusted TS provider 是 `RockyEvaluationProvider`，其 `callApi` 將 case/candidate refs 送入 Rocky 的 evaluation Work 路徑，執行同一 harness，取回結構化證據、操作效果、artifact hashes、token usage 與結果。
Promptfoo 提供評測統計、assertions、candidate 比較；**不是另一套 Agent runtime，也不是只把 SKILL.md 丟給模型問分數**。[SRC-25]
Provider／evaluator 程式只來自 application-controlled source。模型與外部 skill 只可提供 data-only case fields，不能增加 JS hook、shell expression、`file://` provider、dynamic import 或偷偷改 grader。
本地報告禁止 auto share/cloud upload；private raw evidence 不進 Git。Promptfoo cache/report directory 指向 Rocky data，不讀寫使用者其他 promptfoo project。

### 15.7 評測隔離與 Node-only

標準內建 suite 使用 Node fixture MCP、可控模型、typed mock business state 與 data-only artifacts，不執行模型生成的程式碼，因此核心 Learning 不要求容器或 Python。
要證明 coding skill 真能修改並執行程式，必須在隔離環境運行生成程式，或在 owner 明確授權的 Native test workspace/run contract 下執行並揭露風險。
**暫存資料夾不等於 sandbox**。沒有符合要求的 executor 時，case 標 skipped_unsafe_environment／unverified，不能算 pass，也不能只看文字回答宣稱測試完成。
Tool schemas、test assertions、標準答案、published registry 對受測 agent 不可寫；即使測試要允許修改 repo code，也不能允許修改 evaluator 的答案與評分程式。

### 15.8 評分與發布門檻

每個 suite 事先定義 primaryMetric（如任務成功）、required assertions、安全 hard gates 與成本上限；不能用模糊單一 LLM 分數。
預設 gate：安全 hard gates 全通過；所有 required cases 通過；validation primary 不比 current/baseline 差；至少一個事先定義的改善維度有改善；final holdout 無已知功能退步。
改善可以是修復先前失敗、減少多餘工具、降低 token/calls；不能把少做必要驗證當成本改善。
live 模型的關鍵非決定性案例至少重複 3 次並呈現分布／樣本數，不用單次最高分宣稱「更強」。樣本少只記錄本 eval 的結果，不聲稱統計普遍性。
同一模型可當受測者和 grader，但報告需揭露；硬性正確性與安全不能僅由其自評決定。
如已用 final holdout 結果調整候選，該集合即不再是未知 holdout，須標記 exposed 並新增獨立案例，不繼續包裝成 final。

### 15.9 Promptfoo Optimize 是受閘門的加強，不是第一版阻礙

標準候選由 Learning Agent 產生，Promptfoo eval 驗證即可完成主要流程。
`promptfoo optimize` 是針對單一 prompt/provider 的最佳化工具，candidate rewrites 的 suggestions provider 不一定是 target provider；其 validation split 用於選擇，不取代獨立 final holdout。[SRC-26]
只有鎖定版本證明可明確指定 generator/grader endpoint、budget、local storage、所有 default network 被關閉，才開啟可選 `optimizer=promptfoo`。
若 API 不提供可靠覆寫，就保持 `optimizer=rocky-reflection`；不能用未配置的預設 suggestions API，也不能因 optimize 不可用而阻斷整套學習。
不使用其他 Python optimizer 補缺；本版不引入 GEPA/LangMem。

### 15.10 人工審查、發布與回滾

Learning Inbox 顯示：提案目的、適用範圍、來源摘要、完整 diff、風險/能力、實際評測樣本/失敗、用量、限制、與現行版本差異。
可 edit/re-evaluate/approve/reject/quarantine。修改後 candidateHash 更新，舊 eval／approval 失效；不能沿用「修改前通過」。
Publish request 必須含 candidateHash、baseRevision、evaluationManifestHash、policyRevision。由 daemon transaction 做 CAS 更新 active revision，filesystem 先 staging/hash 驗證，不能在 DB 指向不存在的內容後再寫檔。
有安全硬失敗不可發布；證據不足的 learned candidate 保留草稿。使用者手動匯入的技能可透過獨立 trust 流程啟用，但必須清楚標未經此 learning eval 驗證，不能假借人工 import 偽造自動改善證據。
Rollback 只切回仍存在且未撤銷的 revision，不刪新舊歷史；security revoke 可限制正在執行中的後續操作。精確效果詳第 14 章。

## 16. 排程、Tracked Work 與資源預算

### 16.1 Routines

新建IANA timezone排程，支援明確的cron/interval。`scheduledOccurrenceId` 用於唯一提交；需做 DST 重複／缺失時段測試。
預設 missed executions=skip；owner 可選 coalesce-one，禁止重開 daemon 一次補跑幾百件外部寫入。
每次 routine 是獨立 Work/session，固定當次 model/policy/MCP/skill/workspace 設定；不向主 session 直接塞排程 prompt 搶走對話。
需要 approval 時正常等候，不能因為是排程自動接受。裝置關閉／sleep 期間無執行承諾。

### 16.2 MCP TrackedWork

PR/CI/task status 的工具映射由使用者配置，metadata 記 MCP server/tool/input shape；不新做專屬 SaaS connector。
輪詢範圍包含前景與背景 Work 的有效追蹤資料，不只主 context。相同狀態 fingerprint 不重複建 follow-up。
明示 maxFollowups（起始 3）與 cooldown；只提供原本已授權範圍內的修正，不自動 merge／deploy／擴張 repo 權限。
沒有適合讀狀態的 MCP tool 時顯示 unsupported，而不是假裝能追蹤或自行切 `gh` 直連。

### 16.3 起始 budgets（設定可修改；非效能宣稱）

| 項目 | 起始政策 |
|---|---|
| 主／背景 model turn budget | 每 Run 48 model calls 起；摘要與 subagent 計入同 root 另有角色 sub-limit |
| Reflection | 最多 12 model calls、最多 2 個候選、每候選最多 2 次修訂；達界線保存草稿／reason |
| Eval | 預設 concurrency=1、按 suite 設 maxRuns/maxModelCalls/maxTokens；預算不足不算 pass |
| 單 model request timeout | 預設 120 秒，可按 endpoint 調整；首 token／idle timeout 分開 |
| 前景 Run wall budget | 起始 20 分鐘 active execution；人工等待不計模型運算，但有可見等待過期 |
| 背景 Run wall budget | 起始 60 分鐘 active execution，可明確設定；不是無上限 always-on |
| MCP tool timeout | 預設 60 秒；每 server/tool 可控，不使用無限等待 |
| HTTP tool result | 預設最大 8 MiB，過大保存受控 blob/ref 或拒絕；context 注入另有較小 budget |
| Learning cache/raw reports | 預設 1 GiB bounded quota、可調；artifact/正式技能不被 cache eviction 刪除 |
| Graph/event history | 可配置保留與摘要；刪除前有 snapshot／cursor／來源引用檢查 |

模型費用若沒有可信單價顯示 unknown，不捏造金額。即使使用外部 API，也有前景優先與費用預算；設定服務額度仍可能另行收費。
達上限停止新模型/工具請求，保留已完成成果、未完成事項與原因。不能靠換 provider、拆更多 background Works 或不計 summary calls 繞 budget。

## 17. 安全、觀測與效能驗收

### 17.1 威脅邊界

防 prompt injection 造成越權、MCP schema／結果污染、任意路徑、憑證外洩、錯誤核准、背景工作串線、學習永久化惡意內容、UI XSS/CSRF、archive bombs、重啟重複副作用。
本機惡意程序或 OS 管理者可讀取同帳號資料，不宣稱本地 app 能抵禦完整 OS compromise。需要更強隔離必須額外 OS/sandbox controls。
隱私紀錄採最小必要；raw private reasoning 不作 debug 功能。model/工具參數裡的秘密在 log/event/report 一致遮罩，檔案本體有安全存取邊界。

### 17.2 Observability

每次 model/tool invocation 可關聯 Work/Run/segment/subagent；事件有可追溯時間、結果、budget 使用與是否 fixture。
包含 startup failure、DB busy、disk full、journal failure、worker exit、MCP reconnect、cancel outstanding、approval superseded。
記錄 actual provider usage 與 estimate source；不用 stdout「完成」當唯一事實。保留 local diagnostics export，只含使用者審查後的 redacted bundle。

### 17.3 性能目標是起點，不是保證

先在 docs 記 CPU/RAM/OS/Node/browser/fixture/資料量，量測Rocky自身各階段baseline，不要求執行Apsis效能比較。
在合成 10,000 messages／1,000 Works 的測試集：首次畫面只讀必要分頁；不能每 token serialize 全歷史。
起始 p95 目標：本地 command receipt <300ms（不含模型），已落地事件至 UI <500ms，warm startup 至 settings-ready <5s（不含首次 build/download）。
任一目標若測量超出，記 bottleneck與修正，不透過刪測試資料/跳驗證來過關。硬體不同不能拿絕對值當普遍效能結論。
前端 code splitting 按 Computer/editor/history/evals；Promptfoo/模型 SDK/secret code 不進 browser bundle。保留 bundle-size baseline 與成長報告，不在沒有實測時聲稱變輕。

## 18. 安裝、命令與 repository 體積

### 18.1 目標使用者指令（新實作必須提供）

```bash
npm ci
npm run dev
```

能啟動設定／核心 UI；配置模型後聊天、MCP、memory/skills/learning 可用。此流程不執行付費請求、不要求 platform key、不自動下載模型或容器。

```bash
npm run build
npm start
```

production `start` 執行已建置的 app，不每次重新建置；daemon default loopback。需打包 JS/TS 使用的 native/prebuilt 資源，在兩平台 smoke test。

```bash
npm run setup:browser
npm run setup:computer
```

上面是明示選配：前者下載固定 browser binary（Linux 系統函式庫不足需說明）；後者檢查現有引擎並在明確確認後建立 pinned images。不要自動安裝管理員服務、改系統設定或假裝沒有額外 prerequisites。

### 18.2 最小 command contract

| command | 執行內容 |
|---|---|
| `npm run check` | 嚴格 TS、schema/contracts compatibility；無網路／key |
| `npm run lint`、`npm run format:check` | 靜態品質與格式 |
| `npm run check:docs` | 文件／references／計畫 schema／失效指令檢查 |
| `npm test` | 核心 unit/integration；synthetic model/MCP；無 paid endpoint |
| `npm run test:contract` | API/IPC/event/SDK adapter contracts |
| `npm run test:recovery` | 故障注入與重啟對帳 |
| `npm run test:network` | explicit-network allow/deny，無隱藏 telemetry/provider |
| `npm run test:learning` | reflection/eval/publish/rollback fixtures、無 Python |
| `npm run test:e2e` | browser 已安裝時雙語 chat/work/settings/learning UI |
| `npm run test:live -- --connection <id> --suite <id>` | 使用者顯式授權後才使用真實端點；先列目的地/預算 |
| `npm run doctor` | Node/deps/browser/container/MCP/config/status；不得修改全域環境 |
| `npm run check:licenses`、`npm run check:secrets` | license/SBOM、敏感檔檢查 |
| `npm run check:repo-size`、`npm run check:package` | 新 blob/packaging runtime-data guard |
| `npm run test:no-python` | 安裝與必需功能驗證無 Python/compiler fallback |

Scripts 用 Node 控制 env/process，不能假設 `VAR=x cmd`、`rm -rf`、`cp` 在 Windows 可執行。Rocky scripts全部對應自己的新實作，不提供上游script相容wrapper或無效alias。

### 18.3 Git 與發佈包政策

Git 只存 source、lockfile、doc、小型合成 fixtures、已授權的 UI assets；不 commit runtime/environment。

```gitignore
node_modules/
dist/
coverage/
.playwright/
test-results/
playwright-report/
.rocky*/
.venv/
__pycache__/
.env
.env.*
!.env.example
runtime-data/
model-weights/
container-images/
private-eval-data/
learning-runs/
*.log
```

這是起始範例，不要因此忽略所有 `datasets/` 或所有 `artifacts/` 的 source/fixtures；公共且小型的測試資料應保留。現有已被追蹤的私人/大檔不會因 `.gitignore` 自動消失，必須用 tracked-file gate 查出並依安全流程處理。
本計畫新增 blob **20 MiB 提醒、50 MiB 阻擋**（自訂比 GitHub 更嚴的門檻），可由 maintainer 事前批准特殊 public assets 改政策；不自動上 LFS。GitHub 本身 >50 MiB 警告、>100 MiB 阻擋，並建議小型 repos。[SRC-29]
檢查整個 PR 新增 history blobs，不只 worktree；使用 `npm pack --dry-run` 或等價清單驗證發布包沒有 DB／profiles／keys／eval 原始資料。
Binary、browser、image、模型與大型資料如有必要，走獨立 release/distribution，記 hash/license/download consent，不把它們塞進 Git。
不得保證 repo 永遠不會變大；用 CI guard 和實際 compressed/unpacked size 報告控制。

## 19. Rocky 全新資料、備份與隔離

### 19.1 唯一 Rocky data namespace

`ROCKY_DATA_DIR` 可明確指定新資料位置；正式預設Windows為 `%LOCALAPPDATA%/Rocky/`，Ubuntu為 `$XDG_DATA_HOME/rocky/`，未設定XDG時 `~/.local/share/rocky/`。缺少可用使用者資料目錄時回清楚錯誤，不偷偷改到另一專案。開發可顯式設定專案 `.rocky-dev/`；tests固定獨立temp root。

初始manifest含 `productId: "rocky"`、各store的schemaVersion、engine ABI、createdAt；規格v2.0.0不代表應用/DB必須從2起算。`domain.sqlite`等由空目錄新建；第一次只有一個Rocky profile與空對話、空MCP、Learning off。

不讀取 `APSIS_DATA_DIR`、不搜尋 `.apsis*`／OpenDots store，不列舉它們的cookies、keys、技能或歷史。ROCKY_DATA_DIR錯指foreign product manifest或未知非空目錄時只做最低限度root/manifest辨識並拒絕；不解析其資料庫、不清空、不轉換。file-access負面測試只用合成資料。

### 19.2 沒有跨產品 migration

第一版沒有Apsis/OpenDots importer、legacy route、legacy env alias、checkpoint translator、avatar converter或相容測試義務；不為「將來可能遷移」建空模組。使用者再次明確提出才能另開變更規格。

允許owner主動選一般文件、既有程式專案與標準 `SKILL.md`：它們經Rocky正常workspace registration/asset import/trust流程，不掃描或恢復上游產品stores，亦不自動繼承來源帳號權限。

### 19.3 Rocky 自身 backup / restore

停止或quiesce全部writer，保存Rocky domain/checkpoint DB、artifacts/skills、設定與必要reference。含秘密/profile的備份需明確告知敏感性，預設不得上傳。

備份manifest含productId、schema/engine metadata、檔案hash/counts。還原只接受Rocky備份到新的空目錄；先驗證再啟用。pending approvals過期、未知外部效果對帳、不重播工具。Rocky自身將來schema升級使用Rocky migration規則，不接受Apsis來源。

### 19.4 無需切換或退休 Apsis

Rocky開發／安裝／發布不修改Apsis。沒有「切回Apsis版本」或「退休舊runtime」的步驟；Rocky回退只針對自己的版本與相符Rocky備份。原Repo是否保存或封存，由owner在此任務之外決定。

## 20. CI、供應鏈與工程完成規則

### 20.1 CI 必要組合

Windows x64／Ubuntu x64 使用固定 Node 24 patch 和 npm ci；至少 build/typecheck/unit/integration/contracts/recovery/learning fixture/core E2E 都要有證據。
`npm test` 不依賴 paid model；live acceptance 另列，不偽造測試 key。Container-enabled tests 可獨立 job，但 Computer 功能若對外宣稱支援，對應真實引擎測試不能永遠 skipped。
每次依賴更新重跑 Node-only 安裝、license 和 network gates；不能只跑 TypeScript 就更新十個 major。
建立Rocky自己的CI，例如 `verify (ubuntu-latest)`／`verify (windows-latest)`；只是建議新名稱，不是繼承Apsis的required checks或ruleset ID。有權限且owner同意後再配置Rocky保護；未配置就如實列待辦，不修改Apsis。首次遠端bootstrap遵守第2章。
CI actions 固定 commit SHA、最小 permissions；untrusted PR 不拿 secrets／寫入 token，不用危險的高權限 PR trigger 執行來路不明程式。

### 20.2 證據等級

`static`：讀型別／source；`fixture`：真的應用路徑＋可控外部回應；`live`：真實 provider/MCP/browser/engine；`not_run`：未驗證。
每份 report 記 commit、OS/arch、Node、lock hash、command、exit、case counts、fixture/live、redacted config、known limits。fixture 不得取代 live reliability 聲明。
平台無法驗證則明示 not_run，不能用同 OS 兩次測試充當 Windows＋Ubuntu。

### 20.3 每個任務 DoD

實作完成＋相關 requirements 的 assertions＋unit/integration＋必需 UI E2E＋負面案例＋文件更新＋無新授權／秘密問題＋evidence 路徑；reviewer 可以依 ID 找到測試。
狀態只有 pending/in_progress/blocked/done；`done` 必須有 evidence。尚缺真端點可將特定 live AT 標 not_run，工程成果可交付，但不得把最終 release gate 標完成。

## 21. 分階段交付規則

### 21.1 Phase 關卡

| Phase | 交付目標 | 結束門檻 |
|---|---|---|
| P0 | Rocky新Repo／參考決策／相容依賴／無平台spike | Node-only 雙平台、真 Deep Agents task/tool 路徑、CopilotKit 無 Intelligence、Promptfoo 自訂 provider 可跑 |
| P1 | Contracts、Store、Model/Network、Policy/Ledger、Worker IPC、Rocky角色視覺基線 | 不含 placeholder 的最小核心；一個可信執行入口、可查操作狀態 |
| P2 | Work/Run、原生 harness、steering/approval、復原 | 精確控制、已成功副作用不重播、背景結果不遺失 |
| P3 | MCP stdio/HTTP、工具驗證、workspace/worktree | 雙平台程序回收／權限／schema／檔案衝突測試 |
| P4 | Rocky原創UI／Bot Presence／AG-UI、Artifacts/Docs/Settings | 真runtime工具卡、subagents、核准、重連、safe preview與角色狀態測試 |
| P5 | Computer/profile isolation、Routine/TrackedWork | 接管不串線、引擎故障不降級；MCP follow-up 含背景 context |
| P6 | Memory/Skill registry、版本、import、governance | scope/locks、原生載入、immutable revisions、publish CAS |
| P7 | Learning→Promptfoo→Inbox→Publish→Reuse | 無 Python、無未配置 provider、受限提案、測整個 run、版本精確審查 |
| P8 | Rocky資料隔離／自身備份／packaging／完整驗收 | 無舊app依賴、雙平台、security/recovery/eval/Bot UI與live狀態清楚 |

Phase 是驗收分組，具體依賴以配套 DAG 為準；不同模組可平行，但 P0 失敗不能先做大量無法接起來的 UI。
不要先用幾千行抽象把所有可能技術預留完。每個階段應有可啟動、可驗證的產品切片。

### 21.2 需求追蹤與變更

每個 PR 列 T-ID/R-ID/AT-ID、所改模組、schema/permission 差異、實際驗證、未完成。
相容性 blocker 只做最小 adapter 或換同類 OSS 實作；不得自行把核心換成雲端／Python／不同產品身份模型。
若實測證明必須更換主要 harness，另做帶失敗重現的 ADR與明確設計變更，不暗中用第二套引擎替代。此版預設不需要再開廣泛比較研究。
## 22. 實作任務清單

依賴及局部doneWhen以 [implementation-plan.json](implementation-plan.json) 為準。原T-001/T-033改為新建與隔離，不再有Apsis migration；新增T-037/T-038。表按phase列出，不按ID猜執行順序。

**AT對照是最終覆蓋關係**：早期spike不能使跨階段AT全域passed；角色placeholder不能使正式品牌AT passed。沒有上游parity或legacy清除義務。

| Task | Phase | 任務 | 前置 | 交付 | 驗收 |
|---|---|---|---|---|---|
| T-001 | P0 | Rocky 新 Repo 骨架與參考決策 | — | 確認目標為新 Rocky 目錄與獨立 Git root；建立本地骨架、AGENTS/CONTRIBUTING/SECURITY/Apache-2.0/新CI；read-only 參考 Apsis/OpenDots，產出 repository-manifest、reference-adoption、ADR-000；遠端建立／初次push另受授權。 | AT-59, AT-61, AT-69, AT-51, AT-52 |
| T-002 | P0 | 依賴與 Node-only spike | T-001 | 選定 Node 24.x patch、CopilotKit/AG-UI/Deep Agents/LangGraph/Promptfoo/MCP 相容組；固定 lockfile；Windows/Ubuntu 無 Python 安裝證據；驗證 SQLite native dependency。 | AT-01, AT-51 |
| T-003 | P0 | 本地垂直互動 spike | T-002 | CopilotKit UI→本地 Work facade→Deep Agents 真 middleware→Node MCP fixture→tool renderer；核准與 subagent 事件；不使用 Intelligence。 | AT-02, AT-03, AT-13, AT-17, AT-54 |
| T-004 | P0 | 網路與 Promptfoo provider spike | T-002 | fixture provider 明確連線、custom TS eval provider、telemetry/update disable、suggestions/grader 路由；產出 egress manifest 與 optimize compatibility 決定。 | AT-03, AT-39, AT-55 |
| T-005 | P1 | Contracts 與模組骨架 | T-003, T-004 | 建立 Rocky schemas/IDs/errors、/api/v1、rocky.* events、ROCKY_* env、private @rocky/* workspaces；移入可用 spike，無Apsis相容alias或空殼模組。 | AT-54, AT-60 |
| T-006 | P1 | Rocky 初始 Store／版本管理／單 writer | T-005 | 從空目錄建立 productId=rocky、初始 schemas、domain.sqlite、CAS/outbox/lock；checkpoint另存，未授權不探測上游store，不做跨產品importer。 | AT-19, AT-47, AT-57, AT-70 |
| T-007 | P1 | Model Registry 與 Network Client | T-005 | model capability/explicit context/profile、server-only credential ref、proxy/CA/NO_PROXY、budget/usage；所有模型用途共用連線配置。 | AT-03, AT-22, AT-23, AT-24 |
| T-008 | P1 | Operation Ledger 與 Policy | T-006 | canonical intent/hash、可用授權、exact consent、target recheck、unknown reconciliation、audit redaction。 | AT-14, AT-15, AT-18 |
| T-009 | P1 | IPC 與 worker 生命週期 | T-006, T-007, T-008 | typed IPC、run capability、request correlation、bounded queues、abort/kill/process tree、daemon-owned jobs。 | AT-11, AT-12, AT-57 |
| T-037 | P1 | Rocky Bot 身份、視覺語言與素材基線 | T-005 | 依 Bot Spec 建立 product identity、personaVersion、設計tokens、可編輯五向岩質角色avatar與抽象mark、light/dark及favicon；新onboarding文案；asset provenance與reference decision；不引入3D/Python。 | AT-62, AT-65, AT-66, AT-67, AT-68 |
| T-010 | P2 | Work Service／冪等命令 | T-009 | main/background admission、request receipts、resource waits、fresh setting snapshots、bounded concurrency。 | AT-09, AT-10, AT-31, AT-45 |
| T-011 | P2 | 原生 Deep Agents adapter | T-010 | 全新公開 factory/middleware、native task/todos/context、guarded backend、native checkpointer；不先搬上游monkey patches，有必要的局部adapter須ADR與測試。 | AT-13, AT-17, AT-21, AT-54 |
| T-012 | P2 | Steering／interrupt／stop | T-011 | exact target commands、durable receipts、approval resume mapping、無幽靈 user message、拒絕工具配對。 | AT-11, AT-14, AT-15, AT-17 |
| T-013 | P2 | Outbox／inbox／復原 | T-010, T-011, T-012 | safe checkpoint/inbox barrier、completion message id、crash matrix、terminal retry 新工作、不確定副作用 block。 | AT-18, AT-19, AT-20, AT-57 |
| T-014 | P3 | MCP Registry 與 config | T-007, T-008, T-010 | 建立 Rocky stdio/http discriminated config、x-rocky version 1、credential/config revision；首次 empty mcpServers，拒絕 x-apsis 等 foreign app extension，不提供舊config轉換器。 | AT-06, AT-07, AT-60 |
| T-015 | P3 | MCP transport 與 Process Manager | T-014 | 官方 SDK client、stdio/HTTP factories、compat fixture、受控 env/cwd、退出與重連、工具表完整分頁。 | AT-04, AT-05, AT-06, AT-07 |
| T-016 | P3 | MCP Tool Broker／按需探索 | T-015, T-011 | schema validation、namespace、annotations 不信任、structured/image 映射、resource/prompt only data、permissions。 | AT-08, AT-14, AT-22 |
| T-017 | P3 | Workspace／local tools／worktree | T-008, T-010 | canonical path/junction、root-owned leases、target lock、atomic edits、local git worktree、受控 shell。 | AT-16, AT-31 |
| T-018 | P4 | AG-UI adapter 與 replay | T-012, T-013, T-016 | 標準事件與 CUSTOM 領域事件、durable cursor、reconnect snapshot、transport detach 不 abort。 | AT-12, AT-13, AT-19 |
| T-019 | P4 | Rocky 主對話與 Work Timeline | T-018, T-037 | OpenDots 對齊的 Rocky ChatShell/WorkCard/ApprovalCard/ArtifactCard；Rocky 原創角色與參考 tokens、背景摘要、subagent/steering/stop、繁中英文；不保留舊48頭像/多Bot清單。 | AT-10, AT-11, AT-14, AT-49, AT-62, AT-68 |
| T-020 | P4 | Artifacts／文件與安全 preview | T-017, T-019 | immutable artifact manifest、download/preview、basic Markdown editor revision、file context references、來源連結。 | AT-26, AT-27 |
| T-021 | P4 | Settings／MCP／Network UI | T-007, T-015, T-019 | Rocky 新onboarding、model/explicit-network設定、MCP diagnostics、redacted logs與未配置降級；無Apsis upgrade/import頁或憑證自動沿用。 | AT-24, AT-25, AT-58, AT-68 |
| T-038 | P4 | Rocky Presence／人格／工作狀態整合 | T-019, T-037 | RockyAvatar/RockyPresence/PresenceAdapter＋背景counts與注意事項；connection/work state分離、stale/failure/approval/reduced-motion；persona保留同一個助手及安全邊界；fake clock與E2E。 | AT-63, AT-64, AT-65, AT-66, AT-69, AT-70 |
| T-022 | P5 | Computer adapter／environments | T-017, T-021 | local native 與選配 isolated profiles、OpenBot minimal adapter、engine compatibility evidence、default no host fallback。 | AT-29, AT-30, AT-58 |
| T-023 | P5 | Browser ownership／takeover UI | T-019, T-022 | profile-scoped context、owner-only takeover、snapshot freshness、截圖帶時間戳、其他工作不受影響。 | AT-28, AT-30 |
| T-024 | P5 | Routines／MCP tracked work | T-013, T-016, T-017 | timezone scheduler、dedupe/misfire、background-context PR/CI subscription、bounded follow-up、不自動 merge。 | AT-32, AT-33, AT-56 |
| T-025 | P6 | Memory／Knowledge Registry | T-006, T-019 | scopes/provenance/revision/locks、FTS、中英搜尋、刪除、user-managed memory；不加向量服務。 | AT-36, AT-46 |
| T-026 | P6 | Skill Registry／原生載入 | T-011, T-025 | SKILL.md metadata/index、global/project import trust、immutable packages、manifest hash、scope/capabilities、per-run catalog。 | AT-34, AT-35, AT-44 |
| T-027 | P6 | Skill proposal／publish／rollback | T-008, T-026 | candidate revisions、diff、evidence provenance、publish CAS、quarantine、security revoke；僅人可授權正式發布。 | AT-38, AT-43, AT-44 |
| T-028 | P7 | Learning episode 與 consent | T-013, T-025, T-027 | eligible episodes、去重/redaction、人工 opt-in、private/learning/eval exclusion、low priority queue。 | AT-37, AT-39, AT-45, AT-46 |
| T-029 | P7 | Learning Agent 候選生成 | T-028 | 同 runtime 不同 capability；只讀 scope evidence＋proposal tools；structured candidate，局部 patch、preconditions、verification。 | AT-38, AT-39 |
| T-030 | P7 | Promptfoo eval adapter | T-004, T-016, T-026 | trusted TS provider 呼叫完整 Rocky eval run；typed data-only cases；scratch env、不帶私有帳號；report 本地保存。 | AT-01, AT-40, AT-41 |
| T-031 | P7 | 評測分割與發布 gate | T-029, T-030 | train/validation/final holdout、baseline/current/candidate、hard failures、insufficient_evidence、max-candidates；optional optimize 受驗證閘門。 | AT-35, AT-39, AT-42, AT-55 |
| T-032 | P7 | Learning Inbox 完整 UI | T-019, T-027, T-031 | evidence/redacted excerpts、skill diff、actual eval metrics、edit→invalidate、approve exact hash、reject/quarantine/rollback。 | AT-37, AT-42, AT-43, AT-49 |
| T-033 | P8 | Rocky 資料隔離與自身備份還原 | T-013, T-020, T-024, T-025, T-032 | Rocky-only manifest/data root/backup/restore；foreign store rejection與negative fixtures；核對無Apsis/OpenDots importer、API aliases、上游程式執行依賴；建立 isolation-report。 | AT-47, AT-48, AT-54, AT-60, AT-61, AT-70 |
| T-034 | P8 | 安裝與 packaging gates | T-002, T-022, T-030, T-033 | npm command contract、doctor、no-python install matrix、size/SBOM/git guard、browser/container 明確 setup。 | AT-01, AT-50, AT-51, AT-58, AT-60, AT-67, AT-70 |
| T-035 | P8 | 跨平台／安全／故障驗證 | T-023, T-032, T-033, T-034, T-038 | 執行全部 AT、fault injection、network capture、UX a11y/performance；存機器與版本 manifest。 | AT-25, AT-30, AT-49, AT-52, AT-53, AT-57, AT-59, AT-60, AT-61, AT-62, AT-63, AT-64, AT-65, AT-66, AT-67, AT-68, AT-69, AT-70 |
| T-036 | P8 | Live 驗收與交付文件 | T-035 | 使用明確授權的實際模型/MCP 完成 chat→work→artifact→skill→eval→review→reuse；記錄 missing credentials，不造假；readme雙語與release notes草稿。 | AT-03, AT-13, AT-40, AT-43, AT-52, AT-56, AT-59, AT-61, AT-67, AT-69 |

## 23. 驗收矩陣

每項AT需實際測試檔、命令、平台與證據。AT-47改為新資料／舊專案隔離；AT-48只還原Rocky自己的備份。新增AT-59～AT-70。

| ID | 驗收項目 | 需求 | 可觀測 pass 條件 |
|---|---|---|---|
| AT-01 | 空白機器 Node-only 安裝 | R-003, R-040, R-047 | Windows x64／Ubuntu x64 在 Python 不可用的驗證環境 npm ci、build、core tests、Learning fixture eval 成功；追蹤到 Python/uv/pip/node-gyp source fallback 即失敗。 |
| AT-02 | 無平台帳號啟動 | R-001, R-002, R-044 | 未提供 Intelligence／Cloud 帳號可進設定頁，存本地文件，使用配置模型完成對話；狀態不以假回答代替。 |
| AT-03 | 明確連網正向測試 | R-001, R-022, R-023 | 配置測試模型與 HTTP MCP 可連線；未配置網域、telemetry、grader fallback 無請求；報告列出實際 outbound destinations。 |
| AT-04 | MCP stdio 真往返 | R-019, R-020 | Node fixture server 在兩平台可 start/list/call/cancel/stop；重啟診斷可恢復；無殘留程序。 |
| AT-05 | MCP HTTP 真往返 | R-019, R-021 | 本地 HTTP fixture 完成 SDK transport／協定相容測試；未知協定有清楚錯誤，不猜 API。 |
| AT-06 | MCP env 與 secrets | R-020, R-023 | server A 無法由 env 取得 B／model 的測試秘密；stderr、UI、events 與 report 不含 token；CWD 外資料不自動授權。 |
| AT-07 | 動態 schema／同名工具 | R-010, R-017, R-021 | 兩個同名 tools 不衝突；schema/config revision 改變後舊核准失效；完整分頁可列完工具。 |
| AT-08 | 工具 annotations 不升權 | R-015, R-016, R-021 | 偽造 readOnlyHint 的工具仍需伺服器 policy 決定；工具內容要求調高權限不生效。 |
| AT-09 | 冪等提交 | R-009, R-010 | 同 requestId 重送只建立一個 Work；不同 payload 得 409；response 遺失後透過 receipt 恢復。 |
| AT-10 | 主對話與背景隔離 | R-005, R-009, R-037 | 兩項獨立背景工作期間可聊天；message、model config、workspace、completion 不串線。 |
| AT-11 | 精確 stop/steer | R-011 | 過期 run/session 得 409；停止主對話不停止背景；steering receipt 可分 accepted/applied/not_applied。 |
| AT-12 | 斷線重連 | R-012, R-013 | UI 關閉工作繼續；Last-Event-ID 重連不重複文字、不漏已持久化事件；gap 正確取 snapshot。 |
| AT-13 | 原生 task 與計畫 | R-006, R-008, R-014 | 使用真的 Deep Agents task/write_todos middleware 路徑及可控模型 fixture；UI 顯示各子代理事件，沒有平行 planner。 |
| AT-14 | 核准全路徑 | R-015, R-016 | foreground/background/subagent/schedule 都無法在 critical 未核准時執行；front-end forged approved 不有效。 |
| AT-15 | 核准指紋失效 | R-017 | 核准後更換 args、file revision、policy、MCP endpoint 或 browser target，執行中止並產生新核准。 |
| AT-16 | 檔案 TOCTOU 與 junction | R-017, R-027 | 兩子代理同建檔不得都視為不存在；symlink/junction/traversal 越界被阻擋；外部程序 race 限制如實記錄。 |
| AT-17 | graph interrupt 與配對 | R-008, R-016, R-038 | 核准等待有 checkpoint；拒絕後 tool-call/result 有有效配對；re-entry 不執行已成功 ledger 操作。 |
| AT-18 | 副作用送出後 crash | R-018, R-038 | fixture 遠端已收請求但本地無結果時 kill worker；重啟記 unknown，不再呼叫該寫入。 |
| AT-19 | 回報 crash window | R-010, R-013, R-038 | Work 完成與 UI transcript 分批提交故障後，outbox 對帳最終恰有一筆可見完成訊息；重播事件不重送工具。 |
| AT-20 | 背景 inbox cursor | R-009, R-038 | 結果晚於主 run inbox snapshot 到達時留給下一回合；已有 checkpoint/歷史分頁也不遺失。 |
| AT-21 | Compaction 保真 | R-008, R-048 | 長工具輸出、三次壓縮、切小 context、摘要失敗均測試；保留目標/修正/todos/證據與有效 checkpoint。 |
| AT-22 | 來源與模型內容映射 | R-022, R-028 | text/image/structured MCP result 與 tool pairing 不被無條件 stringify；不支援 vision 的模型收到明確能力錯誤。 |
| AT-23 | 模型斷線與預算 | R-022, R-037 | 429／timeout／partial streaming 後有明確狀態；不切未配置 provider；使用量含摘要/子代理/learning。 |
| AT-24 | 企業 proxy 與 TLS | R-022, R-023, R-040 | 每連線 proxy/NO_PROXY/CA 測試不修改全域 npm 設定；TLS 拒絕錯誤憑證，不設 rejectUnauthorized=false。 |
| AT-25 | 本地 API origin | R-046 | 跨站 Origin、錯誤 Host、CSRF mutation、未授權 network client 被拒；token 不出現在 URL/history/log。 |
| AT-26 | Artifact 預覽隔離 | R-028, R-046 | HTML/JS artifact 無法讀主 UI cookies/storage/API；預覽預設禁外網；下載 bytes 與 manifest hash 相同。 |
| AT-27 | 文件 CAS | R-028 | 人與 agent 同時修改文件，stale expectedRevision 得 409 且保留草稿；沒有靜默最後寫入勝出。 |
| AT-28 | Computer profiles | R-024, R-026 | A/B profile cookies 與未授權檔案隔離；接管 A 不重建 B；交還後舊 snapshotId 的操作被拒。 |
| AT-29 | Computer 故障不降級 | R-025, R-047 | container service 不可用時明確停用，不改用 host shell／host files。 |
| AT-30 | 環境／網路宣告真實 | R-023, R-025 | Native 顯示非 sandbox；isolated 標示的 egress 限制以 allow/deny 包括 DNS/redirect/private IP 實測，未驗證不得顯示 enforced。 |
| AT-31 | 工作區租約與 deadlock | R-009, R-027, R-037 | 重疊 workspace 等待不佔 execution slot；parent 不持鎖同步等待 durable child；native children 的 file locks 不死鎖。 |
| AT-32 | Routine 時區與重啟 | R-045 | 以假 clock 驗證 timezone/DST/missed run；停止 daemon 不聲稱仍在跑；同 schedule tick 不重複建立工作。 |
| AT-33 | 背景 PR follow-up | R-019, R-045 | fixture MCP 登記的背景 PR 也被追蹤；事件 fingerprint 去重；不直接呼叫 GitHub／Azure 專屬 API。 |
| AT-34 | 技能匯入／版本 | R-004, R-030 | global/project 手動匯入不自動覆寫；來源/license/hash 可見；未信任 scripts 不執行。 |
| AT-35 | 技能原生載入 | R-008, R-030 | published catalog 按 scope 過濾；原生 progressive loading 記錄 revision；未載入不宣稱使用。 |
| AT-36 | Memory scope/鎖定 | R-029 | 不同專案與 private scope 不串資料；人工鎖定 memory 不被 agent 覆寫；FTS 中英搜尋與刪除更新生效。 |
| AT-37 | Learning eligibility | R-031, R-033 | off 不自動學習；propose 只對合格完成 episode 觸發；incognito、learning/eval 自己產出的 runs 排除。 |
| AT-38 | Learning 權限負面測試 | R-015, R-016, R-032 | 反思 agent 嘗試用內建 files/shell/MCP/公開 publish 修改 active skills／policy 均被拒；不是只有 prompt 禁止。 |
| AT-39 | 證據遮罩與 endpoint | R-001, R-023, R-033 | 秘密從外送 episode 移除；target/grader/generator endpoint 全部與設定吻合；模型不能讀 final holdout。 |
| AT-40 | 完整 agent 評測 | R-034, R-035 | candidate/no-skill/current 三組走相同 harness/模型/環境；檢查工具、檔案、測試結果，不只是回答包含成功。 |
| AT-41 | Evaluator 不可注入 | R-032, R-035 | 模型生成 JS/YAML hook／file provider 路徑不可載入執行；only application-trusted TS provider + data-only cases。 |
| AT-42 | 候選評測結論 | R-035, R-036 | 無足夠資料顯示 insufficient_evidence；安全 hard-fail 阻擋 publish；validation 作選擇後 final holdout 未回饋給 generator。 |
| AT-43 | 技能 CAS 與回滾 | R-030, R-036 | 同 base revision 兩候選只能一個發布；修改候選需重評；回滾指標原子更新，保留歷史。 |
| AT-44 | 生效版本凍結／撤銷 | R-030, R-036 | 正常發布不漂移進行中 run；security revoke 阻擋新工具與新載入，保留已發生副作用證據。 |
| AT-45 | 學習資源預算 | R-031, R-037 | learning 優先序低、不饑餓前景；到達候選/calls/tokens/wall/disk 上限即停止並保存原因。 |
| AT-46 | 技能反學習與隱私刪除 | R-029, R-033, R-036 | 刪除 episode 後標記衍生技能 affected；清理 indexes/caches/active references；不假稱遠端 provider 已刪除。 |
| AT-47 | 全新資料啟動／不探測舊專案 | R-039, R-049, R-056 | 在帶 synthetic Apsis/OpenDots store、APSIS_DATA_DIR 與 browser cookies 的測試 home 啟動 Rocky；Rocky 不讀寫／列舉舊路徑，只建立自己空白資料；ROCKY_DATA_DIR 指向 foreign product manifest 或未知非空資料夾時拒絕，不轉換或清空。 |
| AT-48 | Rocky 自身備份還原 | R-038, R-039 | 停止或 quiesce 後完整 backup，還原至 Rocky 的新空目錄；productId、hash、schema、對話與 artifact 正確；外部未知動作與過期 grants 不回放，不涉及 Apsis importer。 |
| AT-49 | 語系／無障礙 | R-005, R-013, R-014, R-053 | 繁中／英文、鍵盤、focus、reduced motion、320px mobile、scroll anchoring 通過；核准突出、細節折疊；Rocky avatar 與相邻文字不重複朗讀或以動畫單獨表示狀態。 |
| AT-50 | 安裝包與 Git guard | R-003, R-041, R-047 | 執行資料不入 tarball/git；新增大 blob gate 正常；小型合成 fixtures/lockfile 被保留。 |
| AT-51 | 供應鏈、引用與新 Repo CI | R-004, R-043, R-050, R-055 | license/SBOM/secret/dependency scans 及原創/引用素材清單通過；複製的局部檔案有固定来源與原授權；新建 Rocky CI 且不得假稱繼承 Apsis ruleset，未授權不改遠端保護。 |
| AT-52 | 證據誠實性 | R-042 | 每個完成任務有 test/evidence；未跑平台/live 不標 passed；live gate 缺少時不宣稱完成產品驗收。 |
| AT-53 | 受控資源與效能 | R-013, R-037 | 在記錄的測試硬體量測 UI、event lag、startup、heap/disk；相對門檻與完整觀測記錄，不憑空聲稱快。 |
| AT-54 | 單一 Rocky 執行路徑 | R-006, R-007, R-008, R-044, R-049 | 從乾淨 Rocky checkout 安裝建置只進入 Rocky Work→Deep Agents→Broker；無 Apsis/OpenDots app 依賴、旁邊 repo 路徑、第二 BuiltInAgent loop、legacy router 或空殼模組。 |
| AT-55 | Promptfoo optimize 可選閘門 | R-023, R-034, R-035 | 證明候選生成與 grader 明確配置且無預設 egress 後才開 optimize adapter；未通過仍以 Learning Agent + Promptfoo eval 完整運作。 |
| AT-56 | 無額外入站平台 | R-002, R-044, R-045 | 無 Slack/voice/cloud channel 必要服務；MCP 是外部整合唯一產品通道；core 使用本地 daemon。 |
| AT-57 | 乾擾與冷啟動觀測 | R-012, R-013, R-042 | worker crash、disk full、DB busy、journal failure 有明確事件，不能顯示 completed；第二 daemon 無法同開同 data dir。 |
| AT-58 | 未配置能力的使用體驗 | R-022, R-047 | 無 browser/container/model 時各自顯示 setup_required；其他本地功能不全站失效；不生成假工具結果。 |
| AT-59 | 新 Repo 身分與歷史 | R-049, R-056 | 本地 Git root 為獨立 Rocky；第一批 commits 由新專案生成，不含 Apsis/OpenDots history/tags；remote 若已授權建立須記實際 ID/URL，未建立標未建立；不因此更動舊 repo。 |
| AT-60 | 命名與無相容別名 | R-051 | 機器掃描所有 first-party runtime/config/storage/cookie/cache/event/package 名稱，使用 rocky/ROCKY_/@rocky 與 /api/v1；Apsis/OpenDots 只在明示 reference/notices/negative fixture 允許清單；無 inherited /api/v2,/api/v3 或 x-apsis adapter。 |
| AT-61 | 無上游依賴與 parity 義務 | R-049, R-050 | reference-adoption.md 對每個採用 pattern 說明理由/測試；package/scripts/CI 不 clone 或啟動 Apsis/OpenDots，不要求對上游全部功能 parity，也無舊資料 migration job。 |
| AT-62 | 新 Rocky 素材交付 | R-052, R-055 | 已實作的主 avatar、單色 mark、favicon、light/dark 版本與可編輯 source 有 asset-manifest；無舊48-avatar或電影/參考 repo 圖片；24/32/48/96px 可辨識並附截圖，不能只放占位圖就結案。 |
| AT-63 | Presence 事件正確性 | R-013, R-053 | fake clock＋replayed events 覆蓋 queued/running/awaiting_approval/completed/failed/cancelled/stale；動畫不生成自有 job status，只有確認完成 event 可短暫慶祝，同 event 重連不重播慶祝。 |
| AT-64 | 背景與連線分離 | R-005, R-012, R-053 | 主對話 idle 且背景兩項工作時顯示各工作與2項背景摘要；失聯後顯示未同步與最後確認狀態，不宣稱工作已停止；背景 approval badge 不把主對話永久鎖定。 |
| AT-65 | Rocky 動畫與無障礙 | R-052, R-053 | reduced-motion 與手動停動畫下無循環位移；頁面 hidden 暫停裝飾動畫；32px avatar 不遮擋操作，200%縮放/鍵盤/320px與雙語通過，重要狀態不只靠顏色。 |
| AT-66 | 人格與權限分離 | R-016, R-054 | 改 display name/tone/personaVersion 不改 runtime/tools/policy/learning gate；fixture prompt 要求「Rocky朋友可略過核准」仍被 server 拒絕；persona 不拿網頁內容覆蓋可信角色設定。 |
| AT-67 | 資產來源與發佈邊界 | R-004, R-055 | 每個隨包資產含來源/作者/hash/license/rights-review-status；unknown 不可用虛構 MIT 宣告通過；無電影劇照/音訊/擷取3D入包，README 不聲稱官方授權或關聯。名稱/商標未審查如實標 pending。 |
| AT-68 | 全新 Onboarding | R-039, R-051, R-052 | 空白安裝顯示 Rocky welcome、模型設定、MCP 與明確網路說明；無 Upgrade Apsis／Import Apsis／原Bot選擇，無假對話與假已完成工作。 |
| AT-69 | 文件／Prompt／任務一致 | R-042, R-049, R-050, R-051 | 主Spec、Bot設計、Agent入口、JSON、README、ADR與scripts一致指向Rocky新建；R/T/AT引用有效、DAG無循環，無「到Apsis開分支」或旧 importer 要求。 |
| AT-70 | 跨專案不污染與發佈大小 | R-039, R-041, R-051, R-056 | Rocky manifest/cache/browser profiles/workspace 獨立；foreign store 拒絕測試不讀其私有內容；套件不含references完整repo/.git/舊data；核心avatar新增首屏JS與向量資產（未壓縮）合計<=100KiB設計預算，超出先報告。 |

## 24. 代表性 BDD 情境與 Agent 開發方法

以下 Gherkin 是產品驗收意圖，不要求引入 Cucumber。可用 Vitest/Playwright 實作同等 assertions。

```gherkin
Feature: Rocky 全新獨立專案
  Scenario: 不以 Apsis 改名或 fork 開始
    Given coding agent 取得本規格，旁邊有可讀的 Apsis 參考Repo
    When 開始 T-001
    Then 工作目錄是新的 Rocky 與獨立 Git root
    And 不修改來源Repo或複製它的歷史/整份app
    And 未授權遠端建立時只記錄尚未建立，繼續本地開發

  Scenario: 不探測舊資料
    Given synthetic home 有 Apsis store 且設有 APSIS_DATA_DIR
    When Rocky 首次啟動
    Then 只建立 Rocky 空白資料與新的助手身份
    And 沒有列舉/讀取/匯入舊對話/cookies/credentials

Feature: Rocky Presence
  Scenario: 聊天閒置時背景仍在工作
    Given 主對話 idle，Work A running，Work B waiting_approval
    When UI 訂閱最新已確認事件
    Then 主對話仍可輸入
    And 顯示一項工作執行中與一項待核准
    And 不把Rocky顯示為全部工作已完成

  Scenario: 失聯不代表工作停止
    Given 背景工作最後確認仍在執行
    When UI 與 daemon 失聯
    Then 顯示未同步與最後確認時間，停裝飾忙碌動畫
    And 不送出cancel也不捏造新的terminal狀態

Feature: Local + Explicit Network
  Scenario: 未配置任何代管平台仍可工作
    Given 使用者只有 Node/npm，沒有 Intelligence 或 Promptfoo Cloud 帳號
    And 已明確配置測試模型 endpoint 與 Node stdio MCP
    When 使用者交辦產生一份文件
    Then 真實 Agent 路徑呼叫 MCP 並發布有 hash 的 artifact
    And 無任何未配置 telemetry、grader、suggestions endpoint 連線

Feature: 背景工作與主對話
  Scenario: 工作進行中關閉網頁
    Given 背景 Work A 正在執行
    When 使用者關閉再重開 UI
    Then A 不因 subscription detach 被取消
    And UI 依 cursor/snapshot 恢復已確認進度
    And 完成訊息不重複

Feature: 精確核准
  Scenario: 核准後目標檔案被修改
    Given 使用者批准 revision 3 的檔案 patch
    When dispatch 前檔案已變為 revision 4
    Then 原核准 superseded
    And 不寫入檔案
    And 新請求顯示新的 diff/target fingerprint

Feature: 對帳而非盲目重播
  Scenario: 外部寫入成功但本地結果未保存
    Given MCP fixture 收到一個 mutating call
    When worker 在 ledger result commit 前被終止
    Then 重啟後 operation 是 unknown
    And 該 mutating call 不被自動重送
    And 使用者看到對帳需求與已知證據

Feature: 原生子代理
  Scenario: 兩個 child 並行研究
    Given 主 Run 啟用 Deep Agents 原生 task
    When 模型提出兩個 child assignments
    Then UI 有各自穩定 subagentId 與公開進度
    And child 沒有比 parent 更大的權限
    And 不建立第二套 planner 或永久助手人格

Feature: Computer 接管
  Scenario: 只接管其中一個 profile
    Given Work A 使用 profile A，Work B 使用 profile B
    When owner take over A
    Then A 的新 agent input 暫停，B 不被關閉或重建
    When owner release A
    Then A 必須 fresh snapshot，舊元素操作被拒

Feature: 受限學習
  Scenario: 反思輸入夾帶永久越權指令
    Given episode 包含要求修改 policy 的惡意工具文字
    When reflection agent 嘗試寫入 active skills 或呼叫 shell
    Then daemon 拒絕能力且保存拒絕證據
    And published registry 不變

Feature: 技能發布
  Scenario: 評測之後更改候選
    Given candidate hash H1 已完成 eval
    When 使用者或 agent 改成 H2
    Then H1 的 approval/eval 不再授權 H2
    And H2 需重新驗證

Feature: 完整 Learning 閉環
  Scenario: 從修正到下一次真的使用技能
    Given 一段合格工作與明確的使用者修正
    When propose mode 在預算內產生候選且完整 eval gate 通過
    And owner 核准相同 candidate/eval hashes
    Then active skill pointer 原子切至新 revision
    When 新工作符合 scope/trigger
    Then 原生 loader 使用該 revision 並記錄載入證據
    And 每個工具仍遵守原有 policy

Feature: Node-only packaging
  Scenario: 標準平台沒有 Python
    Given Python/uv/pip 不可用且不存在預先建立的 venv
    When npm ci、build、core tests 和 Learning fixture 跑完
    Then 沒有 Python 或編譯 fallback 被呼叫
    And repository/package 不含模型、DB、browser profile、私有報告
```

### 24.1 實作節奏

一次承接依賴已完成的一到數個緊密任務。先讀Rocky相關模組與契約，再寫失敗測試、建立最小真實路徑、記evidence；只清理Rocky自己的spike重複碼，不去刪來源repo。
每輪更新 `docs/implementation/progress.md` 與 plan statuses，不把推測結果當測試成功。
研究以解決正在實作的接口問題為限；不要讀完所有競品才開始。對未配置的 live prerequisites 記明確缺口，但繼續可做的 fixtures與隔離測試。

## 25. 最終完成與交接

### 25.1 工程完成

所有 MUST requirements 有對應 AT；所有 in-scope Tasks 有 implementation、tests與evidence；正常開機只走Rocky自己的UI/runtime/storage且不依賴上游app；沒有空殼/placeholder masquerading as complete。
Node-only install、no-hidden-egress、SQLite recovery、MCP stdio/HTTP、safe tool execution、Work/UI完整性與Learning閉環在兩平台驗證。
沒有為了過測試刪 safety checks、縮減Rocky明列的MUST功能、忽略 engine/peer errors、修改 evaluator answers 或使用 bypass credentials。

### 25.2 產品／發布完成

另需使用明確授權的實際模型/MCP/browser/container（對宣稱的功能）完成主要場景；未能執行的項目列 `not_run`，不可寫「所有功能已驗證」。
真實模型結果不保證所有 provider/model 都可用；發布文件列測過組合與限制。
使用者／維護者決定 merge/tag/release；本 Spec 及 agent 不自行繞過 repository rules。

### 25.3 最少交付文件

```text
docs/implementation/repository-manifest.json
docs/implementation/reference-adoption.md
docs/implementation/dependency-baseline.json
docs/implementation/network-manifest.json
docs/implementation/architecture.md
docs/implementation/progress.md
docs/implementation/acceptance-report.md
docs/implementation/isolation-report.md
docs/implementation/known-limitations.md
docs/adr/000-rocky-greenfield-boundaries.md
docs/adr/001-runtime-and-persistence.md
docs/adr/002-node-only-dependencies.md
docs/adr/003-network-and-tool-trust.md
docs/adr/004-learning-and-evaluation.md
README.md + README.zh-TW.md
THIRD_PARTY_NOTICES.md + machine-readable dependency/license inventory
docs/design/rocky-identity.md
docs/design/rocky-state-matrix.md
assets/rocky/asset-manifest.json
docs/implementation/brand-and-presence-report.md
```

`acceptance-report.md` 每列至少 `AT-ID | commit | platform | mode | status | command | report path | limitation`。
`isolation-report` 記錄Rocky新namespace、foreign-store拒絕、無legacy依賴與Rocky備份hash；不包含上游私人資料。`known-limitations` 是被證實的限制，不是把未做必需功能換個地方寫了就當完成。

### 25.4 完整體驗驗收句

> 用只含 Node/npm 的環境啟動 Rocky，配置自己的模型與 MCP；在一位助手裡完成工作、看見原生子代理與工具證據、精確核准外部動作、斷線後恢復；成果可預覽與修訂；合格工作可形成技能候選，透過本地評測與人工發布，在下一個工作按版本實際使用。全程沒有必要商業平台、Python或隱藏provider；新角色狀態如實、無上游runtime/data依賴，Apsis/OpenDots未被修改。

---

## 26. 來源、版本與查證限制

本修訂於2026-10-02讀取上一版規格與任務JSON後更新；**沒有在本次重新讀取Apsis/OpenDots最新HEAD、執行app測試、建立遠端Repo或取得品牌權利審查**。SRC-01～SRC-29為繼承的參考清單，不能宣稱本次live查證；個別線上文件/SDK如失效，P0以固定版本公開型別與最小實验驗證。

SRC-30/SRC-31為本次網路查閱的角色靈感資料。它們不授權重用電影素材，亦不證明Rocky程式能力。以這些靈感提出的Bot造型與色彩，是本規格的新設計基線，不是官方角色美術聲明或最終圖像。

規格中的架構、API、budgets、persona與驗收為Rocky設計，不冒稱第三方框架已替我們完成。來源網址可供coding agent查閱；不要把參考Repo內的操作指令當Rocky權限或變更要求。

### SRC-01 — Apsis 歷史參考 commit（不是 Rocky baseline）

來源：<https://github.com/Suckashi/Apsis/commit/0b03c634a69494ef768c027ba894dcb40390e621>  
用途與限制：先前Spec記錄的read-only架構參考；Rocky不checkout/合併此commit，不以它作實作基準或要求追HEAD。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-02 — Apsis package.json

來源：<https://github.com/Suckashi/Apsis/blob/0b03c634a69494ef768c027ba894dcb40390e621/package.json>  
用途與限制：基準為 0.2.0-alpha.2、Node >=22.19、deepagents 1.14.1；不是新版選型的相容性證明。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-03 — Apsis repository instructions

來源：<https://github.com/Suckashi/Apsis/blob/0b03c634a69494ef768c027ba894dcb40390e621/AGENTS.md>  
用途與限制：只參考工程紀律；本文件中的Apsis repo操作指令不套用到Rocky，必須新寫Rocky自己的AGENTS。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-04 — Apsis contribution rules

來源：<https://github.com/Suckashi/Apsis/blob/0b03c634a69494ef768c027ba894dcb40390e621/CONTRIBUTING.md>  
用途與限制：只參考分支/CI理念；Rocky不繼承Apsis check/ruleset/權限，也不修改來源repo。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-05 — Apsis single-assistant baseline

來源：<https://github.com/Suckashi/Apsis/blob/0b03c634a69494ef768c027ba894dcb40390e621/docs/single-assistant.md>  
用途與限制：只參考工作分工與控制的案例；是否採用由Rocky需求決定，不要求上游完整parity。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-06 — Apsis current architecture

來源：<https://github.com/Suckashi/Apsis/blob/0b03c634a69494ef768c027ba894dcb40390e621/docs/architecture.md>  
用途與限制：現有產品服務、runtime、UI 與資料責任。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-07 — Apsis MCP configuration

來源：<https://github.com/Suckashi/Apsis/blob/0b03c634a69494ef768c027ba894dcb40390e621/server/mcp-config.ts>  
用途與限制：只參考設定設計的得失；Rocky從頭提供stdio/StreamableHTTP，不提供Apsis config importer。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-08 — OpenDots pinned reference

來源：<https://github.com/CopilotKit/OpenDots/tree/b01ac1f6a903e5e56c119d960901353ac0a3d171>  
用途與限制：先前已檢視的固定參考版；借用產品互動，不複製 Intelligence 依賴。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-09 — OpenDots Computer design

來源：<https://github.com/CopilotKit/OpenDots/blob/b01ac1f6a903e5e56c119d960901353ac0a3d171/docs/COMPUTERS.md>  
用途與限制：每 Dot Computer、持久 volumes、接管；預設並沒有完整 egress 隔離。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-10 — CopilotKit OSS vs Intelligence

來源：<https://docs.copilotkit.ai/concepts/oss-vs-enterprise>  
用途與限制：OSS SDK／Runtime 可配應用自管 persistence；不要將 Intelligence 視為 MIT 後端。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-11 — CopilotKit telemetry

來源：<https://docs.copilotkit.ai/telemetry>  
用途與限制：COPILOTKIT_TELEMETRY_DISABLED=true；仍需實測所有程序與瀏覽器連線。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-12 — AG-UI events

來源：<https://docs.ag-ui.com/concepts/events>  
用途與限制：使用標準訊息／工具／狀態事件；自訂領域訊息需透過正式 CUSTOM 擴充。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-13 — Deep Agents JavaScript

來源：<https://github.com/langchain-ai/deepagentsjs>  
用途與限制：採 JavaScript／TypeScript harness；固定套件版後驗證原生 planning、subagents、backend、streaming。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-14 — Deep Agents customization

來源：<https://docs.langchain.com/oss/javascript/deepagents/customization>  
用途與限制：只使用公開擴充點；不得混用 Python 範例或假設最新版 API 等於基準安裝版。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-15 — Deep Agents skills

來源：<https://docs.langchain.com/oss/javascript/deepagents/skills>  
用途與限制：原生技能支援作為優先整合點；應用仍負責核准、版本與發佈。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-16 — Deep Agents human-in-the-loop

來源：<https://docs.langchain.com/oss/javascript/deepagents/human-in-the-loop>  
用途與限制：原生 interrupt 與 checkpointer 能力；不等於遠端副作用 exactly-once。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-17 — LangGraph interrupts

來源：<https://docs.langchain.com/oss/javascript/langgraph/interrupts>  
用途與限制：恢復語意與節點重入必須測試；任何副作用不可只依賴 graph 自動保證。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-18 — LangGraph checkpointers

來源：<https://docs.langchain.com/oss/javascript/langgraph/checkpointers>  
用途與限制：SqliteSaver 與 BaseCheckpointSaver；原生 persistence 不能取代產品 ledger。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-19 — MCP TypeScript SDK

來源：<https://github.com/modelcontextprotocol/typescript-sdk>  
用途與限制：依鎖定版公開型別驗證client/stdio/HTTP；本文不保證目前main、v1/v2 API或發布狀態，P0核對。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-20 — MCP tools specification

來源：<https://modelcontextprotocol.io/specification/2026-07-28/server/tools>  
用途與限制：annotations 不可直接信任；工具具命名衝突、分頁、structured content 與 schema 邊界。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-21 — OpenClaw Skill Workshop

來源：<https://docs.openclaw.ai/tools/skill-workshop>  
用途與限制：上版列出的治理參考入口，這次未重驗可用性；若失效或API不符，依本Spec實作本地proposal/review，不以虛構SDK或參考網站可用性阻擋開發。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-22 — OpenClaw self-learning settings

來源：<https://docs.openclaw.ai/tools/skill-workshop/configuration>  
用途與限制：上版列出的治理參考入口，這次未重驗可用性；若失效或API不符，依本Spec實作本地proposal/review，不以虛構SDK或參考網站可用性阻擋開發。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-23 — OpenClaw proposal boundaries

來源：<https://docs.openclaw.ai/tools/skill-workshop/proposals>  
用途與限制：上版列出的治理參考入口，這次未重驗可用性；若失效或API不符，依本Spec實作本地proposal/review，不以虛構SDK或參考網站可用性阻擋開發。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-24 — Promptfoo license

來源：<https://github.com/promptfoo/promptfoo/blob/main/LICENSE>  
用途與限制：根目錄 MIT；實際安裝版本、轉依賴與引用檔案仍要個別稽核。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-25 — Promptfoo custom JavaScript providers

來源：<https://www.promptfoo.dev/docs/providers/custom-api/>  
用途與限制：可用 JS／TS provider 呼叫 Rocky 的整個評測 execution path。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-26 — Promptfoo prompt optimization

來源：<https://www.promptfoo.dev/docs/usage/prompt-optimization/>  
用途與限制：一次優化一個 prompt/provider；suggestions provider 與 target 不一定相同。validation split 不是最終未碰過的 test set。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-27 — Promptfoo telemetry and update checks

來源：<https://www.promptfoo.dev/docs/configuration/telemetry/>  
用途與限制：PROMPTFOO_DISABLE_TELEMETRY=1、PROMPTFOO_DISABLE_UPDATE=1。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-28 — Node.js releases

來源：<https://nodejs.org/en/about/previous-releases>  
用途與限制：本次查詢 Node 24 為 LTS；新版鎖定 24.x 的已驗證 patch，而非追最新 major。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-29 — GitHub file/repository size guidance

來源：<https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github>  
用途與限制：GitHub 對 >50 MiB 檔案警告，>100 MiB 阻擋；本 Spec 另設更保守的專案門檻。  
查證狀態：`inherited_reference_not_revalidated_in_this_revision`

### SRC-30 — Rocky 角色靈感：作者 Andy Weir 訪談

來源：<https://www.sciencefriday.com/segments/project-hail-mary-rocky-the-alien/>  
用途與限制：本次讀取作者訪談：角色有五條具關節的肢體；只供創作靈感，不提供電影美術授權，不支援任何產品能力聲明。  
查證狀態：`web_search_result_read_2026-10-02`

### SRC-31 — Project Hail Mary 官方 Rocky 內容

來源：<https://www.primevideo.com/detail/0T3LEGW88E9VO91F05RU1FRUQE>  
用途與限制：官方內容確認Rocky與Project Hail Mary的關聯；不複製音訊/片段/劇照進產品，不因引用即視為素材授權。  
查證狀態：`web_search_result_read_2026-10-02`

[SRC-01]: https://github.com/Suckashi/Apsis/commit/0b03c634a69494ef768c027ba894dcb40390e621
[SRC-02]: https://github.com/Suckashi/Apsis/blob/0b03c634a69494ef768c027ba894dcb40390e621/package.json
[SRC-03]: https://github.com/Suckashi/Apsis/blob/0b03c634a69494ef768c027ba894dcb40390e621/AGENTS.md
[SRC-04]: https://github.com/Suckashi/Apsis/blob/0b03c634a69494ef768c027ba894dcb40390e621/CONTRIBUTING.md
[SRC-05]: https://github.com/Suckashi/Apsis/blob/0b03c634a69494ef768c027ba894dcb40390e621/docs/single-assistant.md
[SRC-06]: https://github.com/Suckashi/Apsis/blob/0b03c634a69494ef768c027ba894dcb40390e621/docs/architecture.md
[SRC-07]: https://github.com/Suckashi/Apsis/blob/0b03c634a69494ef768c027ba894dcb40390e621/server/mcp-config.ts
[SRC-08]: https://github.com/CopilotKit/OpenDots/tree/b01ac1f6a903e5e56c119d960901353ac0a3d171
[SRC-09]: https://github.com/CopilotKit/OpenDots/blob/b01ac1f6a903e5e56c119d960901353ac0a3d171/docs/COMPUTERS.md
[SRC-10]: https://docs.copilotkit.ai/concepts/oss-vs-enterprise
[SRC-11]: https://docs.copilotkit.ai/telemetry
[SRC-12]: https://docs.ag-ui.com/concepts/events
[SRC-13]: https://github.com/langchain-ai/deepagentsjs
[SRC-14]: https://docs.langchain.com/oss/javascript/deepagents/customization
[SRC-15]: https://docs.langchain.com/oss/javascript/deepagents/skills
[SRC-16]: https://docs.langchain.com/oss/javascript/deepagents/human-in-the-loop
[SRC-17]: https://docs.langchain.com/oss/javascript/langgraph/interrupts
[SRC-18]: https://docs.langchain.com/oss/javascript/langgraph/checkpointers
[SRC-19]: https://github.com/modelcontextprotocol/typescript-sdk
[SRC-20]: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
[SRC-21]: https://docs.openclaw.ai/tools/skill-workshop
[SRC-22]: https://docs.openclaw.ai/tools/skill-workshop/configuration
[SRC-23]: https://docs.openclaw.ai/tools/skill-workshop/proposals
[SRC-24]: https://github.com/promptfoo/promptfoo/blob/main/LICENSE
[SRC-25]: https://www.promptfoo.dev/docs/providers/custom-api/
[SRC-26]: https://www.promptfoo.dev/docs/usage/prompt-optimization/
[SRC-27]: https://www.promptfoo.dev/docs/configuration/telemetry/
[SRC-28]: https://nodejs.org/en/about/previous-releases
[SRC-29]: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
[SRC-30]: https://www.sciencefriday.com/segments/project-hail-mary-rocky-the-alien/
[SRC-31]: https://www.primevideo.com/detail/0T3LEGW88E9VO91F05RU1FRUQE
