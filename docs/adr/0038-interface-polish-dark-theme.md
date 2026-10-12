# ADR 0038：介面質感：深色主題跟隨系統、動態與對比原則

- 日期：2026-10-12
- 狀態：採用

## 背景

介面只有一套亮色、沒有 hover 與轉場回饋；窄視窗會把對話列表整個藏起來，找不到；送出鈕因為
`.icon-button.primary` 也吃到 `button.primary` 的左右 16px padding，箭頭被擠成一個點。

## 決定

- **顏色、陰影、動態全部是 `tokens.css` 的 token。** 亮色沿用 owner 設計稿的值；深色用
  `prefers-color-scheme: dark` 跟隨系統，不加設定開關。Roko 眼睛的琥珀色（`--accent`）只用在狀態光暈，
  不用在文字上。
- **對比至少 WCAG AA（4.5:1）。** 亮暗兩套的文字／底色組合都算過；為了過線，亮色 `--warn` 從
  `#c27a1a` 調深為 `#9e5e0d`，並新增 `--on-warn` 給警告底上的文字。
- **動態只做進場與狀態回饋**（訊息浮現、核准面板彈出、Roko 狀態光暈），都用 token 的時間與曲線；
  `prefers-reduced-motion: reduce` 時全部縮成 1ms。
- **窄視窗（≤720px）的對話／工作列表改成從側欄打開的抽屜**，Esc 或點旁邊關閉。
- 空白對話給三個開場建議，點了只填進輸入框，不會自動送出。程式碼區塊有複製鈕。設定頁在寬視窗有
  跟著捲動的目錄。
- **Roko 的視線跟著游標**：idle／揮手時用素材裡 16 個方向的注視影格轉向滑鼠或觸控筆（觸控不觸發），
  停 2.5 秒回到原本動畫；工作中、等待、失敗的狀態動畫不會被打斷。
- 核准選項改成一般清單裡的按鈕（焦點本來就在按鈕上，`listbox/option` 角色不正確）；工具卡從
  `<details>` 改成有 `aria-expanded` 的切換按鈕，「預覽」不再包在 `<summary>` 裡。
- 全域快捷鍵：`Ctrl/⌘+Shift+O` 開新對話，在欄位外按 `/` 回到輸入框（以 `aria-keyshortcuts` 標示）。
- 伺服器對 `/assets/*`（Vite 以內容雜湊命名）回 `Cache-Control: public, max-age=31536000, immutable`；
  `/assets/` 下找不到的檔案回 404，不再退回 index.html，以免頁面被當成腳本永久快取。
- 不拆 CopilotKit：主程式約 2.2 MB，多半是 `@copilotkit/react-core/v2` 的 provider 連帶引用的
  聊天介面（KaTeX、mermaid、a2ui），只改 import 路徑拆不掉；要拆得換掉或修改依賴，留給另一個決定。
- 不使用網路字型（維持 `tokens.css` 原本的做法），只在字型清單前面加上 Windows 的 Segoe UI Variable。

## 驗證（雲端 Linux，Node 24.21.0，Playwright 的 Chromium）

- `npm run check`：通過（30 個測試檔，327 通過、5 略過）。
- `npm run test:e2e`：35 項全部通過。改版前在同一環境跑過一次，第 23 項（簡報的變更卡 diff）逾時；
  改版後通過，無法確定是改版修好還是時序偶發。
- 用 Awwwards 的評分面向當檢查清單（設計、易用性、創意、內容，加上 Developer Award 的語意、
  無障礙、響應式）。可量測的門檻與結果：
  - axe-core 4.10.3（WCAG 2.0/2.1/2.2 A、AA 與 best-practice）：亮暗、桌機／平板／手機共 27 個畫面，0 項違規
    （第一次跑是 8 類）。
  - 文字與底色對比：亮暗兩套都 ≥ 4.5:1。
  - 320、390、768、1024、1920px 寬：頁面沒有水平捲動。
  - 鍵盤 Tab 的焦點外框看得到。
  - 載入（Playwright 的 Chromium，本機伺服器，5 次中位數）：不降速 FCP 176 ms、LCP 264 ms、TBT 21 ms；
    CPU 降速 4 倍 FCP 680 ms、LCP 772 ms、TBT 314 ms（超過 200 ms，Rocky 只在桌機執行）。
  - 對照 Webby Apps & Software 的項目（內容、結構與導覽、視覺設計含包容性、功能、互動性、創新、整體體驗）
    逐項補強：設定目錄與窄視窗抽屜（導覽）、深色與 AA 對比（視覺與包容）、快捷鍵（互動）、Roko 視線（創新）。
  - 這些是自我檢查，不是評審結果；Roko 圖（3 MB）依 owner 的紀錄保持原檔。
- `npm run test:e2e:jobs`：沒有執行，這台機器沒有安裝 OpenCode。
- 沒有在 Windows 上看過實際畫面。
