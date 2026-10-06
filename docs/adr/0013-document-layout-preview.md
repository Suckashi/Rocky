# ADR 0013：文件版面預覽

- 日期：2026-10-06
- 狀態：已採用（補上 ADR 0009 列的限制「文件預覽只有文字 diff」）
- 程式：`src/server/documents/preview.ts`、`src/server/http/routes/{preview,approvals}.ts`、`src/web/components/{PreviewPane,DocumentPreview}.tsx`
- 測試：`tests/unit/document-preview.test.ts`、`tests/integration/agent-tools.test.ts`（document tools）、`scripts/e2e.ts`

## 決定

1. **預覽在對話旁邊的側欄。** 文件改動旁邊有「版面預覽」按鈕（核准面板、「這輪改了 N 個檔案」的變更卡），文字差異照樣留在原處；
   側欄打開後核准選項仍然看得到。側欄可以切換「修改前／修改後／並排」，拖拉左邊界（或用左右方向鍵）調整寬度，記在這台瀏覽器。
   工具卡（建立、編輯、讀取文件或檔案）有「預覽」，對話裡用程式碼格式寫出的檔名（例如 `報告.docx`）也可以點開。
   側欄頂端有小 Roko。視窗較窄時側欄浮在右邊。
2. **伺服器把文件轉成一頁 HTML。** PDF 每頁用 pdf.js 畫成圖片（`@napi-rs/canvas`，預先編譯好、不需要編譯器）；Word 用 mammoth 轉 HTML；
   Excel 畫成有欄名列號的表格，保留粗體、顏色、底色、對齊、欄寬與合併儲存格；PowerPoint 依投影片尺寸，把文字框、圖片、表格放在原本的位置
   （位置沿用版面配置與母片的預留位置），有項目符號與編號；Markdown 轉 HTML；HTML 檔照原樣；側欄打開的其他檔案：圖片直接顯示、UTF-8 文字檔加行號。最多 10 頁／10 張投影片、每張工作表 200 列 40 欄。
3. **預覽不能做任何事。** 顯示在 `sandbox=""` 的 iframe 裡：不能執行程式、不能開新視窗、不能送出表單；頁面自帶
   `default-src 'none'; img-src data:; style-src 'unsafe-inline'`，不會連網路，也不會連回 Rocky 自己的 API。HTML 檔裡的 `<script>` 和
   `meta refresh` 會先移除。
4. **只看專案裡的檔案。** 側欄開檔（`GET /api/files/preview`）的路徑和 Rocky 的工具一樣以專案為根，專案外與機密檔（`.env` 等）一律拒絕；只是看，不留操作紀錄。
5. **內容就是核准要綁定的那份。** 核准面板的「修改後」直接從待核准效果裡的位元組產生，「修改前」讀目前的檔案；變更卡從快照產生。
   預覽只用來看，不改變任何雜湊或內容。
6. **變更卡也比對文件文字。** 以前二進位文件在變更卡只寫「不是文字檔」；現在轉成 Markdown 再比對（30 MB 以下）。
7. **預覽抓到的錯誤一起修。** Rocky 建立的 pptx，表格前的段落會被放到表格後面並重疊，改成照 Markdown 順序由上往下排；
   建立的 PDF 的項目符號原本是「•」字元，很多中文字型沒有這個字而變成方框，改成直接畫小圓點。
8. **新依賴：** `@napi-rs/canvas` 1.0.10 本來就是 pdfjs-dist 的選用依賴、已在 lockfile，現在明確列出並固定版本，避免某個平台少裝而沒有 PDF 預覽。

## 參考

擁有者提到 Kimi Code 與 DeepSeek Harness 的 Web 版本預覽做得不錯。側欄的做法參考 DeepSeek Harness `dsh-web-preview` 外掛的公開說明
（對話旁的預覽側欄、可拖拉寬度、連結與檔名可以在側欄打開）；沒有使用它們的程式碼。Kimi 的 docx／pptx 預覽查不到具體資料。

## CI 修正（同一批）

Windows CI 從「永久規則」那次起一直失敗：設定頁的規則用 POSIX 規則拆字，把 `C:\tools\node.exe` 的反斜線當跳脫字元吃掉，
規則永遠對不上，測試在等核准時逾時（30 秒）。這也是真的產品錯誤：Windows 使用者輸入含路徑的規則會失效。規則現在保留反斜線；
方案（`propose_plan`）的指令字串在 Windows 上也一樣。Ubuntu CI 在上一版失敗是新的預覽測試沒有指定測試字型（CI 沒有中文字型）。
先前回報「CI 在 Ubuntu 與 Windows 都綠」是錯的：Windows 從 975e018 起就是紅的。

## 驗證

| 平台                                            | 指令                                                                            | 結果                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 雲端 Linux，Node 24.21.0，OpenCode 1.18.34      | `ROCKY_REQUIRE_OPENCODE=1 npm run check`                                        | exit 0；172 個測試通過，含六種格式的預覽、圖片與文字檔、側欄開檔拒絕 `.env` 與專案外、反斜線路徑的規則、PDF 項目符號是圖形                                                           |
| 同上，Chromium 141                              | `npm run test:e2e`                                                              | exit 0；26 項，含側欄在寫入前顯示投影片且核准選項仍可見、拖拉變寬、從工具卡開檔、修改前後並排、關閉側欄                                                                              |
| 同上                                            | `npm run test:e2e:jobs`                                                         | exit 0；9 項                                                                                                                                                                         |
| 同上，Command Code `deepseek/deepseek-v4-flash` | `npm run eval -- --repeat 3`（31 題）                                           | 第一版與側欄版各跑一次，都是 93/93，基線 0.989，沒有退步                                                                                                                             |
| GitHub Actions windows-latest／ubuntu-latest    | `npm run check`、`npm run build`、Windows PowerShell 5.1 解析 `Start-Rocky.ps1` | run 44（`ea725a9`）兩個平台都通過；Windows 從 975e018 起第一次全綠。另把測試逾時從 5 秒改成 30 秒：Windows 冷啟動時第一次畫 PDF 和第一個 agent 測試超過 5 秒（本機約 1 秒和 0.3 秒） |

## 還沒驗證的（限制）

- Word 預覽走 mammoth，只保留結構（標題、粗體、清單、表格、圖片），沒有原本的字型、頁面大小與頁首頁尾，不是逐頁版面。
- PowerPoint 只畫文字框、圖片與表格；圖表、SmartArt、背景圖、主題色與群組內的位置換算都沒有處理。
- Excel 不套用數字格式（日期、千分位照原值顯示），不畫圖表與框線樣式。
- 沒有用 Edge 或 Office 轉檔，所以和實際開啟的樣子可能不同。
- 背景工作頁的 diff 還沒有版面預覽（工作的核准面板有）。對話中只有程式碼格式的檔名可以點，一般文字裡的檔名不行。
- Windows 上的實際畫面（中文字型、`@napi-rs/canvas` 的 Windows 版）待擁有者確認。
