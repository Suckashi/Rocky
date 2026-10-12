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
- 不使用網路字型（維持 `tokens.css` 原本的做法），只在字型清單前面加上 Windows 的 Segoe UI Variable。

## 驗證（雲端 Linux，Node 24.21.0，Playwright 的 Chromium）

- `npm run check`：通過（30 個測試檔，327 通過、5 略過）。
- `npm run test:e2e`：40 項全部通過。改版前在同一環境跑過一次，第 23 項（簡報的變更卡 diff）逾時；
  改版後通過，無法確定是改版修好還是時序偶發。
- `npm run test:e2e:jobs`：沒有執行，這台機器沒有安裝 OpenCode。
- 沒有在 Windows 上看過實際畫面。
