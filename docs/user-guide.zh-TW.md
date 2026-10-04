# Rocky 操作指南

Rocky 在本機保存工作、核准、文件、記憶、技能與學習資料，模型與 MCP 連線由你明確配置。核心及標準 Learning fixture 不需要 Python、容器或商業平台帳號。

## 安裝與啟動

使用 Node 24.12.0／npm 11.6.4。在原始碼目錄執行 `npm ci`、`npm run build`、`npm run doctor`，再執行 `npm start`，開啟 `http://127.0.0.1:3211`。開發用 `npm run dev` 的 UI 位於 3210。doctor 只讀 metadata，會呈現實際已保存的設定數量與缺少憑證參照，不呼叫模型、不啟動瀏覽器、不修改設定。

正式資料預設在 Windows `%LOCALAPPDATA%/Rocky` 或 Linux `$XDG_DATA_HOME/rocky`（未設定時 `~/.local/share/rocky`）。可在啟動程序的環境設定 `ROCKY_DATA_DIR` 為 Rocky 自己的空目錄。開發預設 `.rocky-dev`。不支援未知非空目錄、其他產品 manifest 或比此版本更新的 schema；請保留原目錄，不用刪資料解決錯誤。

預建本地套件若已附 `dist`，解開後可用 `npm ci --omit=dev --omit=optional` 安裝執行依賴，再 `npm start`。原始碼版建置需要開發依賴。Node/npm 版本及實際套件安裝仍須通過平台驗證，不能用這份說明取代 Ubuntu 證據。

## 模型、工作與核准

在設定選擇 provider、精確 endpoint、model ID、context window 與輸出上限。秘密只填程序環境變數的名稱參照，實際值留在 daemon 環境。proxy／CA 以連線為單位配置；不改系統 DNS／proxy／TLS。Probe 會真的呼叫指定端點並可能計費。沒有可信單價時，費用保持 unknown；可分別設定呼叫、token 與費用預算。

送出前選定 workspace、讀取授權、可選的隔離環境與 browser origins／已明確共用的 profile。工作和原生子工作共用 root 預算及權限邊界。核准卡顯示確切工具、參數與目標；拒絕後不會自動換工具繞過。取消不保證撤回已發生的外部效果。遇到 unknown，先查看回條並使用對帳；沒有可信觀察來源時會維持 unknown。

在工作修正中送出 Steering 會等到下一個原生 checkpoint 邊界才套用；「收件」不是「已套用」。等待核准時的新修正會使舊核准失效。Terminal、Files、Activity 與 Browser 應選到同一個 Work，透過 Work／Run／Operation ID 查閱真實狀態、stdout、stderr 與錯誤。

## 文件與附件

文件可獨立建立、保存版本、載入歷史與下載；模型寫入也需核准確切內容。附件接受文字、Markdown、PNG、JPEG，先驗證後保存，再以版本／hash 綁定工作或修正。圖片有像素、容量及解碼時間限制；不支援 vision 的模型不會收到假的視覺判讀。[附件限制](attachments.md)。

## Computer、持續工作

Native 命令具有本機 OS 權限，不是 sandbox。隔離執行必須選定本機容器 engine、固定 image digest 與 workspace；不會自動安裝或拉取 image，也不會在 unavailable 時退回主機。[環境說明](environments.md)。

可用 `npm run setup -- browser` 明確下載目前釘選的 Chromium。Browser 預設使用乾淨的 Rocky profile，snapshot 會標示 profile/page/environment、時間與失效狀態；接管只影響該 profile，交還後需新 snapshot。應用層 origin 限制不等於 OS 層的完整 egress 證明。[Browser 說明](browser.md)。

Routines 支援 IANA 時區、cron／interval、skip／coalesce-one、獨立背景 Work 與發生次數去重；裝置睡眠期間不承諾執行。Tracking 只呼叫你配置並確認為唯讀的 MCP 工具，有查詢上限、follow-up 上限與 cooldown，不自動 merge／deploy。[排程](routines.md)、[追蹤](tracking.md)。

## Memory、Skills 與 Learning

Memory 分成個人、專案與 task scope，private 讀取須另外同意，人工修改會鎖定。更新或刪除來源會使相關執行上下文失效；保留必要 checkpoint 與操作證據，不代表仍可當成有效記憶載入。

外部 `.agents/skills` 先匯入固定未信任快照，再逐版審查。新版更新既有 source identity，不另建一串重複技能。可查看版本差異、發布、回滾、停用或隔離。每項工作凍結 catalog，只有實際載入才會記錄使用；技能文字不授予工具權限。

Learning 預設 off。propose 必須設定 scope、反思模型、評測集與預算，每個來源工作也要允許重用。合格工作會形成 episode、受限反思、實體候選、完整 runtime 評測，再進入 Inbox。候選修改使舊評測失效；只有 gate 通過且你核准精確版本才發布。來源撤回會清除對應衍生資料並隔離 affected skills，不能撤回第三方模型已收到的內容。[完整 Learning 說明](learning.md)。

## 保護資料與目前限制

停止 daemon 後使用 [Rocky 備份／還原](backup.md)。還原只接受新的空目錄，核准過期、grants 撤銷、排程與自動學習停用，未知效果不回放。備份包含私密資料，請自行保護其存放位置；外部 workspace 與環境變數憑證不會被偷偷納入。

本輪已完成接線並執行 Windows 集中驗證，包含本地 fixture Work、候選評測／發布、文件、附件、專屬 Browser profile、還原與儲存故障。容器 Browser transport 仍明確 unavailable；實際容器引擎、Ubuntu Node-only、乾淨 browser egress 與 live provider 尚未驗證。上游依賴告警仍使安全 gate 未通過。請查看 implementation ledger 與[安全說明](../SECURITY.md)，勿用 fixture 成功推論真實模型、網站或平台必然可用。

daemon 若回報執行儲存降級，請先修復儲存問題並重啟，再對帳未知副作用。UI 保留最後確認狀態，不會把未保存完成紀錄的工作當成成功。
