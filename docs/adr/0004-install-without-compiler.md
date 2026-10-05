# ADR 0004：安裝不需要編譯（S3 spike 結果）

- 日期：2026-10-05
- 狀態：Linux 已驗證；**Windows 待擁有者執行**（CI 不跑這個重的檢查）
- 程式：`spikes/s3-install/`

## 決定

計畫中的依賴（目前的依賴，加上 M1–M4 要用的 Hono、React、Vite 8、CopilotKit 1.77、Tiptap 3、markdown-it、docx、mammoth、
exceljs、pptxgenjs、pptx-automizer、unpdf、pdf-lib + fontkit、playwright-core、MCP SDK、`@langchain/ollama`）照用，不需要換掉任何一個。
Rocky 的 `package.json` 一律設定 `"scarfSettings": { "enabled": false }`。

## 驗證了什麼（雲端 Linux，Node 24.21.0，npm 11.19.0）

| 項目                                                                                     | 結果                                                                             |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 空快取 `npm ci`：1516 個套件                                                             | ✅ exit 0，53.9 秒，`node_modules` 705 MiB                                       |
| 沒有 `binding.gyp`、沒有在安裝時編譯的 `.node`、輸出沒有 node-gyp／prebuild／cmake       | ✅                                                                               |
| 原生模組只有預先編好的平台套件                                                           | ✅ `@rolldown/binding-*`（Vite 8）、`lightningcss-*`                             |
| 有 install script 的套件                                                                 | `@scarf/scarf`（見發現 1）、`fsevents`（只在 macOS 安裝）                        |
| 安裝時對外只連 `registry.npmjs.org`（install script 也經過記錄代理）                     | ✅                                                                               |
| 反向對照：拿掉 `scarfSettings` 時檢查會失敗                                              | ✅ 抓到 `scarf.sh`                                                               |
| `node:sqlite` FTS5 trigram 中文搜尋，兩個字的查詢用 LIKE 補                              | ✅ SQLite 3.53.4                                                                 |
| 34 個套件都能 import；Vite 打包 React（rolldown + lightningcss）；Hono 在 127.0.0.1 回應 | ✅                                                                               |
| docx → mammoth 中文、exceljs 中文工作表與公式、pptxgenjs、pdf-lib → unpdf                | ✅                                                                               |
| playwright-core 把中文 HTML 轉 PDF，再用 unpdf 讀回中文                                  | ✅ 用 Playwright 內建的 Chromium 141（這台沒有 Edge）；系統 Edge 待 Windows 驗證 |

## 重要發現

1. **CopilotKit 帶有安裝遙測。** `@copilotkit/react-core` 和 `@copilotkit/runtime` 依賴 `@scarf/scarf`，而且預設開啟（`defaultOptIn: true`）：
   安裝時會把平台、Node 版本與依賴資訊送到 `scarf.sh`。根目錄 `package.json` 的 `scarfSettings.enabled = false` 可以關掉（也認 `SCARF_ANALYTICS=false`、`DO_NOT_TRACK=1`）。
   Rocky 違反「不送遙測」的風險就在這裡，所以已經先加進根目錄的 `package.json`。Scarf 有頻率限制（`/tmp` 下的歷史檔），檢查時要用新的暫存資料夾才每次都看得到。
2. **npm 11.19 仍會執行沒有核准的 install script**，只會警告（`allowScripts`）。之後 npm 改成預設封鎖時，要在 `package.json` 明確列出允許的套件。
3. **安裝很大**：705 MiB，大部分來自 CopilotKit 帶進來的套件（mermaid、streamdown、lucide、openai、`@ai-sdk/*`）。第一次 `npm ci` 要有心理準備；M1 加入 CopilotKit 時再看能不能少裝一些。
4. **`npm audit`**：
   - Rocky 目前的依賴有 4 個 high，全部來自 `deepagents` → `fast-glob` → `micromatch` → `braces`；npm 給的「修法」是把 `deepagents` 降到 0.0.2，不可行。
   - 完整計畫依賴有 15 個（7 moderate、8 high），另外來自 `pptxgenjs`（`image-size`）、`exceljs`（`uuid`）、CopilotKit 帶進來的 `@ai-sdk/*` 與 `undici`。
   - 都是阻斷服務類，影響的是處理不受信任輸入的路徑。依計畫在里程碑結束時一起升級，必要時用 `overrides`。
5. 這次也修了 S1 的主機記錄代理：CONNECT 之後立刻送出的資料會被丟掉。另外，跑子程序不能用 `spawnSync`，否則同一個程序裡的代理會被卡住。

## 執行紀錄

| 平台                     | 指令                                                   | 結果                              |
| ------------------------ | ------------------------------------------------------ | --------------------------------- |
| 雲端 Linux，Node 24.21.0 | `ROCKY_S3_FRESH_CACHE=1 node install-check.ts`         | exit 0；只連 `registry.npmjs.org` |
| 雲端 Linux，Node 24.21.0 | 拿掉 `scarfSettings` 後 `node install-check.ts`        | exit 1（預期）；抓到 `scarf.sh`   |
| 雲端 Linux，Node 24.21.0 | `ROCKY_S3_BROWSER=<Playwright Chromium> node smoke.ts` | exit 0；10 項全部通過             |
| 雲端 Linux，Node 24.21.0 | `node smoke.ts`（沒有 Edge）                           | Edge 一項標為 skipped，其餘通過   |

## 還沒驗證的（限制）

- **還沒在 Windows 上跑。** 這正是 S3 的重點：請照 `spikes/s3-install/README.md` 在你的電腦上跑兩個腳本並貼回報告。
  Windows 上會改用 `@rolldown/binding-win32-x64-msvc` 與 `lightningcss-win32-x64-msvc`，Edge 一項沒有 Edge 時會直接失敗，不會跳過。
- 沒測 `pptx-automizer` 的實際編輯（需要範本檔，屬於 S4）。
- 中文 PDF 的字型嵌入（pdf-lib + fontkit + CJK 字型）屬於 S4。
