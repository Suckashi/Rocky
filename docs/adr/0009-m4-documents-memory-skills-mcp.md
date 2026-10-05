# ADR 0009：M4 文件、記憶、技能、MCP

- 日期：2026-10-05
- 狀態：已採用
- 程式：`src/server/documents/`、`src/server/memory/`、`src/server/skills/`、`src/server/mcp/`、`src/server/agent/{documents,memory,skills,mcp}.ts`
- 測試：`tests/unit/{documents,memory,skills}.test.ts`、`tests/integration/agent-tools.test.ts`（文件、記憶、MCP）、評測 4 題

## 決定

### 文件（沿用 S4，ADR 0005）

1. **三個工具**：`read_document`（六種格式轉成 Markdown）、`create_document`（從 Markdown 建立，格式看副檔名）、
   `edit_document`（docx／pptx 跨 run 取代文字，xlsx 改儲存格或取代文字，md／html 保留 BOM 與換行）。PDF 只能讀和建立，不能編輯。
2. **核准綁定實際的位元組。** 建立和編輯在關卡判斷前就產生完整檔案；寫檔效果帶 base64 內容與轉成 Markdown 的預覽。
   核准面板比對前後的 Markdown，工具寫入的就是核准的那份位元組（docx 等格式每次產生都含時間，不能重算）。
   快照存原始位元組，所以還原、套用工作也能處理二進位檔。
3. docx 讀取走 mammoth 轉 HTML，再由 Rocky 轉成 Markdown，保留表格（S4 發現 3）。
   pptx 照 `presentation.xml` 的順序讀（S4 發現 4）。xlsx 寫公式不寫快取結果，開檔重算。
4. **PDF 字型**：`ROCKY_PDF_FONT`，否則找系統字型（Windows 正黑體／細明體、Linux 文泉驛），從 `.ttc` 抽出單一字型並快取。
   PDF 讀不到文字時，工具明講「可能是掃描檔或字型問題」，不當成成功。
5. 修正 S4 的 `replaceAcrossRuns`：取代後的文字如果又包含搜尋字（「上線」→「正式上線」）會無限迴圈。

### 記憶

6. 一條記憶是 `<資料夾>/memory/` 裡的一個 Markdown 檔（第一行 `# 標題`）。`remember`／`forget` 是寫檔效果，
   以記憶資料夾為根目錄判斷：預設模式下新增與更新不用問，**刪除原本就有的記憶算對外動作，一定問**。
   每次寫入都有操作紀錄和快照，對話裡的變更卡可以還原；設定頁也能刪除（同樣經過關卡）。
7. 系統提示只列出記憶標題；`search_memory` 用中文二字組＋英文單字比對，標題的分數加倍。沒有專案資料夾時也能用。

### 技能

8. 技能是使用者手動放進 `<資料夾>/skills/<名稱>/` 的資料夾，`SKILL.md` 開頭寫 `name` 和 `description`。
   系統提示只列名稱與說明，`load_skill` 需要時才讀全文或資料夾裡的其他文字檔（不能讀到資料夾外）。技能只是文字，不帶任何權限，讀取不經過關卡。

### MCP

9. 使用者在設定頁加入 stdio 或 HTTP 伺服器。設定（可能含 token 的環境變數和標頭）存在 `0600` 的 `secrets.json`，
   API 回傳時只顯示遮罩。stdio 伺服器只拿到 MCP SDK 的最小安全環境變數加上使用者設定的變數，Rocky 的 token 不會傳過去；
   HTTP 伺服器的網址加進對外白名單。新增依賴 `@modelcontextprotocol/sdk` 1.32.1（原本就在依賴樹裡）。
10. **每次呼叫都經過關卡。** MCP 工具預設是對外動作，任何模式都會問；使用者可以把個別工具標成「唯讀」（照模式判斷，
    「每次問」模式仍然會問），或「關閉」（直接拒絕）。工具結束後由中介層收尾操作紀錄。

## 驗證

| 平台                                            | 指令                                                                     | 結果                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 雲端 Linux，Node 24.21.0，OpenCode 1.18.34      | `ROCKY_REQUIRE_OPENCODE=1 npm run check`                                 | exit 0；143 個測試通過。六種格式的中文往返（docx 只改 `word/document.xml`、pptx 只改被改的投影片、xlsx 公式開檔重算、md 保留 BOM＋CRLF、Big5 被拒絕）      |
| 同上                                            | 整合測試（假模型）                                                       | 建立 docx 要核准實際位元組、編輯前後的 Markdown diff、二進位還原；記憶新增、中文搜尋、刪除要問、可還原；MCP 預設要問、唯讀不問、關閉直接拒絕、token 不外洩 |
| 同上，Command Code `deepseek/deepseek-v4-flash` | `npm run eval -- --repeat 3 --save-baseline`（13 題，含文件與記憶 4 題） | exit 0；39/39，共 771 秒，存為新基線。文件題都用了 `read_document`／`edit_document`／`create_document`；記憶寫入沒有詢問                                   |
| 同上，Chromium 141                              | `npm run test:e2e`                                                       | exit 0；13 項通過                                                                                                                                          |
| GitHub Actions windows-latest／ubuntu-latest    | `npm run check`                                                          | 推送後由 CI 執行                                                                                                                                           |

## 還沒驗證的（限制）

- **沒有在 Windows 上跑過 M4。** 系統字型路徑、stdio MCP 伺服器的 `.cmd` 啟動（SDK 用 cross-spawn）要擁有者確認。
- 沒有用 Office 實際開檔目測，也沒有用真實 Office 產生的複雜檔案測試（ADR 0005 的限制仍在）。
- 文件預覽只有文字 diff，沒有版面預覽。
- 二進位內容整份存在操作紀錄裡（base64），大檔案會讓資料庫變大。
- 記憶搜尋是關鍵字比對，不是語意搜尋（向量 RAG 不在 V1 範圍）。
- MCP 只測了本機 stdio 伺服器；HTTP 伺服器、OAuth 登入都沒測。
