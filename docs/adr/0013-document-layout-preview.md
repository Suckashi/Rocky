# ADR 0013：文件版面預覽

- 日期：2026-10-06
- 狀態：已採用（補上 ADR 0009 列的限制「文件預覽只有文字 diff」）
- 程式：`src/server/documents/preview.ts`、`src/server/http/routes/approvals.ts`、`src/web/components/DocumentPreview.tsx`
- 測試：`tests/unit/document-preview.test.ts`、`tests/integration/agent-tools.test.ts`（document tools）、`scripts/e2e.ts`

## 決定

1. **兩種看法。** 文件（六種格式）的改動旁邊有「文字差異／版面預覽」切換：文字差異是原本的 Markdown diff，版面預覽顯示文件長什麼樣子，
   有「修改前／修改後」兩個版本。出現在核准面板（還沒寫入前）和「這輪改了 N 個檔案」的變更卡。
2. **伺服器把文件轉成一頁 HTML。** PDF 每頁用 pdf.js 畫成圖片（`@napi-rs/canvas`，預先編譯好、不需要編譯器）；Word 用 mammoth 轉 HTML；
   Excel 畫成有欄名列號的表格，保留粗體、顏色、底色、對齊、欄寬與合併儲存格；PowerPoint 依投影片尺寸，把文字框、圖片、表格放在原本的位置
   （位置沿用版面配置與母片的預留位置），有項目符號與編號；Markdown 轉 HTML；HTML 檔照原樣。最多 10 頁／10 張投影片、每張工作表 200 列 40 欄。
3. **預覽不能做任何事。** 顯示在 `sandbox=""` 的 iframe 裡：不能執行程式、不能開新視窗、不能送出表單；頁面自帶
   `default-src 'none'; img-src data:; style-src 'unsafe-inline'`，不會連網路，也不會連回 Rocky 自己的 API。HTML 檔裡的 `<script>` 和
   `meta refresh` 會先移除。
4. **內容就是核准要綁定的那份。** 核准面板的「修改後」直接從待核准效果裡的位元組產生，「修改前」讀目前的檔案；變更卡從快照產生。
   預覽只用來看，不改變任何雜湊或內容。
5. **變更卡也比對文件文字。** 以前二進位文件在變更卡只寫「不是文字檔」；現在轉成 Markdown 再比對（30 MB 以下）。
6. **預覽抓到的錯誤一起修。** Rocky 建立的 pptx，表格前的段落會被放到表格後面並重疊，改成照 Markdown 順序由上往下排；
   建立的 PDF 若字型沒有「•」，項目符號改用「-」（原本會變成方框）。
7. **新依賴：** `@napi-rs/canvas` 1.0.10 本來就是 pdfjs-dist 的選用依賴、已在 lockfile，現在明確列出並固定版本，避免某個平台少裝而沒有 PDF 預覽。

## 參考

擁有者提到 Kimi Code 與 DeepSeek Harness 的 Web 版本預覽做得不錯。這一版沒有參考它們的程式碼；DeepSeek Harness 的
`dsh-web-preview` 外掛（公開說明）是在對話旁開一個可拖拉寬度的預覽側欄，之後若改成側欄可以參考這個做法。

## 驗證

| 平台                                       | 指令                                     | 結果                                                                                                                                |
| ------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 雲端 Linux，Node 24.21.0，OpenCode 1.18.34 | `ROCKY_REQUIRE_OPENCODE=1 npm run check` | exit 0；170 個測試通過，含六種格式的預覽、PDF 超過 10 頁只顯示 10 頁、HTML 的 script 與 refresh 被移除、pptx 表格不再重疊、預覽 API |
| 同上，Chromium 141                         | `npm run test:e2e`                       | exit 0；24 項，含核准面板在寫入前顯示投影片版面、變更卡的文字差異與版面預覽，沒有頁面錯誤                                           |
| 同上                                       | `npm run test:e2e:jobs`                  | exit 0；9 項（核准面板改過，背景工作的核准仍正常）                                                                                  |

## 還沒驗證的（限制）

- Word 預覽走 mammoth，只保留結構（標題、粗體、清單、表格、圖片），沒有原本的字型、頁面大小與頁首頁尾，不是逐頁版面。
- PowerPoint 只畫文字框、圖片與表格；圖表、SmartArt、背景圖、主題色與群組內的位置換算都沒有處理。
- Excel 不套用數字格式（日期、千分位照原值顯示），不畫圖表與框線樣式。
- 沒有用 Edge 或 Office 轉檔，所以和實際開啟的樣子可能不同。
- 背景工作頁的 diff 還沒有版面預覽。
- Windows 上的實際畫面（中文字型、`@napi-rs/canvas` 的 Windows 版）待擁有者確認。
