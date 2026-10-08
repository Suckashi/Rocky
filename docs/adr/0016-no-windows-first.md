# ADR 0016：不再以 Windows 優先

- 日期：2026-10-08
- 狀態：已採用（取代先前「Windows 優先」的定位）

## 決定

擁有者表示 Rocky 不需要以 Windows 優先。Rocky 同等支援 Linux 與 Windows：`AGENTS.md`、`README.md` 拿掉
「Windows first」，README 的安裝步驟改成通用的 `npm ci`、`npm start`，`Start-Rocky.ps1` 是 Windows 上的選用啟動方式。

## 影響

- `Start-Rocky.ps1` 與 `scripts/verify-windows.ps1` 保留；Windows 相關的處理（`.cmd`、`taskkill`、路徑）照舊。
- macOS 沒有測試過，README 寫明。
- 舊 ADR 裡以 Windows 為主的說法是當時的紀錄，不改寫。
