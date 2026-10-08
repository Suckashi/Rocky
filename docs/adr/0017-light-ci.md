# ADR 0017：輕量 CI

- 日期：2026-10-08
- 狀態：已採用（取代 ADR 0014 決定 1「不跑雲端 CI」）

## 決定

GitHub Actions（`.github/workflows/ci.yml`）在 Windows 與 Ubuntu 上平行跑 `npm ci`、`npm run check`、`npm run build`，
Windows 另外用 PowerShell 5.1 解析 `Start-Rocky.ps1` 與 `scripts/verify-windows.ps1`（並確認是 UTF-8 加 BOM）。目標是 2～5 分鐘。

- 觸發：PR 到 `main`、推到 `main`、手動。只改 `*.md` 或 `docs/**` 時不跑；同一個 PR 有新的推送時取消舊的。
- 不設成必過檢查，紅燈只提醒、不擋合併；每個 job 10 分鐘逾時；權限只有讀取；action 鎖定 commit SHA。
- 不放進 CI：瀏覽器 e2e（太久）、OpenCode 派工測試（要安裝 OpenCode）、評測（要真實模型與金鑰）、Dependabot 自動 PR。

## 原因

擁有者要同時支援 Linux 與 Windows，而開發多在 Linux 上進行。只在 Windows 才會壞的錯誤（例如 ADR 0013 的規則反斜線）
在 Linux 上抓不到；之前的 CI 正是靠 Windows runner 發現它。公開 repo 的 Actions 不用錢。

## 影響

- README、`README.zh-TW.md` 與 PR 範本改寫成「CI 跑 check 與打包，其他檢查在本機」。
- `scripts/verify-windows.ps1` 照舊，用來涵蓋 CI 不跑的部分（啟動腳本實際執行、e2e、OpenCode、評測）。
