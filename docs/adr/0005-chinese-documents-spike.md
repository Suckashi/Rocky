# ADR 0005：中文文件（S4 spike 結果）

- 日期：2026-10-05
- 狀態：已採用（Linux 與 Windows CI 都通過）
- 程式：`spikes/s4-documents/`；測試：`tests/spikes/s4-documents.test.ts`（在 `npm test` 裡，CI 會跑）

## 決定

照架構文件的函式庫做，再加上這些規則：

- **PDF 讀取**：unpdf，加上 `pdfjs-dist` 6.1.200（鎖定 unpdf 1.8.1 建置時用的版本），只用它的 `cmaps/`。
  Rocky 自己把 cmaps 的**檔案路徑**傳給 pdf.js（見發現 1）。
- **PDF 建立**：pdf-lib + fontkit，字型一律子集嵌入。Windows 內建的中文字型是 `.ttc`，Rocky 先抽出單一字型（`fonts.ts`）再嵌入。
- **docx／pptx 編輯**：直接改 OOXML，用 `@xmldom/xmldom` 解析，只改需要的 part，其餘 part 原封不動。取代文字時處理「一句話被拆成好幾個 run」的情況。
- **pptx 從範本產生**：pptx-automizer，一定開 `cleanup: true`（見發現 4）；讀投影片要照 `presentation.xml` 的順序，不能列舉 zip 裡的檔案。
- **xlsx**：exceljs，不寫公式的快取結果，設定 `fullCalcOnLoad`，讓 Excel 開檔時重算。
- **md／html**：用 UTF-8 解碼，保留原本的 BOM 和換行（CRLF）；不是 UTF-8 的檔案直接拒絕，不能默默變成亂碼。

## 驗證了什麼（13 個測試）

| 格式 | 內容                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| pdf  | 嵌入 CJK 子集字型建立 PDF，讀回文字完全一致（含標點、英數）                                                                        |
| pdf  | 非嵌入字型＋標準 CMap `UniCNS-UCS2-H` 的 PDF：有 cmaps 讀得出，沒有 cmaps 只得到空字串                                             |
| pdf  | 從系統 `.ttc` 抽出字型後可以嵌入（有系統 TTC 時才跑：Windows 的 `msjh.ttc`／`mingliu.ttc`，Linux 的文泉驛）                        |
| docx | 中文標題、粗體 run 讀成 Markdown；跨 run 取代後保留粗體，只有 `word/document.xml` 改變                                             |
| xlsx | 公式沒有快取結果、`fullCalcOnLoad="1"`；改儲存格後保留字型、底色、合併、欄寬、註解、資料驗證、條件式格式、凍結窗格；只改 2 個 part |
| pptx | 依簡報順序讀出中文；東亞字型 `a:ea` 有設定；就地跨 run 取代只改該張投影片；從範本產生的簡報不含範本的舊文字                        |
| md   | 記事本存的 BOM＋CRLF 檔案，改一行後 BOM 與 CRLF 都保留；Big5 檔案會被拒絕                                                          |
| html | markdown-it 把中文 Markdown 轉成 HTML，編碼往返不變                                                                                |

## 重要發現

1. **unpdf 預設的 CMap 路徑在 Node 上無效。** 它把 `file://...` 網址字串交給 pdf.js，而 pdf.js 的 Node 讀取器直接 `fs.readFile` 那個字串，所以讀不到；
   而且 unpdf 只在有安裝 `pdfjs-dist` 時才會設定 cmaps。Windows CI 的日誌也看得到它的預設值讀 `file:///D:/.../UniCNS-UCS2-H.bcmap` 失敗。結果是：**舊系統產生、字型沒有嵌入的中文 PDF 會被讀成空字串，只印一行警告**。
   Rocky 傳一般的檔案路徑就沒問題，但 pdf.js 要求路徑以 `/` 結尾：Windows 上要把 `\` 換成 `/`（CI 第一次在 Windows 就是因此失敗）。讀出空字串時，介面要提示「可能是掃描檔或缺字型」，不能當成成功。
2. **pdf-lib + fontkit 不能嵌入 `.ttc`**（會丟出 `createSubset is not a function`）。Windows 的正黑體、細明體都是 `.ttc`。
   抽出單一字型約 60 行程式；一個 11 MB 的 TTC 抽出、嵌入、存檔約 170 ms。也可以選擇隨 Rocky 附一份 Noto Sans TC（OFL）。
3. **mammoth 轉 Markdown 會丟掉表格結構**（每格變成一段文字），而且 `convertToMarkdown` 已不建議使用。M4 改成先轉 HTML，再由 Rocky 轉成 Markdown 表格。
4. **pptx-automizer 預設會把被移除的投影片留在檔案裡**：投影片從清單拿掉了，但 `slideN.xml` 還在 zip 裡，**範本的舊內容會跟著交出去**。
   `cleanup: true` 會清掉。讀取時也必須照 `presentation.xml` 的順序，否則會讀到這些殘留的投影片。
5. **pptxgenjs 把東亞字型的 charset 寫成 `-122`（GB2312，簡體）**，不是繁體的 Big5（136）。PowerPoint 通常仍會用指定的字型，但 M4 要確認，必要時修正 XML。
6. exceljs 改檔會重寫它認得的 part；它不支援的內容（圖表、樞紐分析表）**很可能會遺失**。這次只測了 exceljs 自己產生的檔案，真實的 Excel 檔要在 M4 用擁有者的檔案測試，不支援的就改成直接改 XML。
7. **嵌入大型系統字型很慢，而且時間不穩。** 在 Windows runner 上，從 `msjh.ttc` 抽字型、子集化、存檔，一次 0.8 秒、另一次超過 5 秒（CI 因此逾時一次）。
   M4 建立 PDF 時要在背景做，或快取已抽出的字型，不能卡住對話。
8. pdf.js 會轉移傳給它的 `Uint8Array`（呼叫之後長度變成 0），所以要先複製一份再交給它。
9. 型別定義和執行時不一致：pptxgenjs 在 NodeNext 下的 default 匯出、mammoth 的 `convertToMarkdown`、exceljs 的 `conditionalFormattings`，都要做型別轉換。

## 新增的依賴

markdown-it、docx、mammoth、exceljs、pptxgenjs、pptx-automizer、unpdf、pdf-lib、@pdf-lib/fontkit（架構文件既定）；
`pdfjs-dist` 6.1.200（CJK cmaps；它選裝的 `@napi-rs/canvas` 是預先編好的，可以留給 M4 做 PDF 預覽）；
`jszip`、`@xmldom/xmldom`（直接編輯 OOXML，原本就是依賴樹裡的套件）。

## 執行紀錄

| 平台                          | 指令            | 結果                                                                                                               |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| 雲端 Linux，Node 24.21.0      | `npm run check` | exit 0；S4 13 個測試通過（系統 TTC 用文泉驛正黑）                                                                  |
| GitHub Actions windows-latest | `npm run check` | 第一次失敗：CMap 路徑以 `\` 結尾（發現 1）；修正後通過（run 37319818674），S4 13 個全過，含系統 TTC 測試（818 ms） |
| GitHub Actions ubuntu-latest  | `npm run check` | 通過（run 37319818674）                                                                                            |

## 還沒驗證的（限制）

- 沒有用真實 Office 產生的檔案測試（擁有者的電腦上沒有 Office；可以用網路上的範例檔或擁有者手上的檔案）。
- 掃描的 PDF（只有圖片）讀不出文字；OCR 不在 V1 範圍。
- Big5 等舊編碼的文字檔目前直接拒絕；要不要支援，到 M4 再決定。
- 沒有在 PowerPoint／Word／Excel 裡開檔目測（沒有 Office）。
