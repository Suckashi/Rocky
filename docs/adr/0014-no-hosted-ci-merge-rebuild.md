# ADR 0014：移除雲端 CI，重建版合回 main

- 日期：2026-10-08
- 狀態：已採用（取代 `docs/rebuild/plan.md` 原本「GitHub Actions 跑 Windows 與 Ubuntu」的決定）

## 決定

1. **不跑雲端 CI。** 擁有者先在 `main` 移除了自動 CI，重建分支也一樣刪掉 `.github/workflows/ci.yml`。
   檢查改在本機做：推送前跑 `npm run check`；改到介面時加跑 `npm run test:e2e`（與 `test:e2e:jobs`）；
   Windows 上用 `scripts/verify-windows.ps1` 一次跑完並產生摘要。改到提示詞、工具或 agent 迴圈時照舊跑評測（AGENTS.md）。
2. **只維護新版。** 重建版透過 PR 合回 `main`，取代舊 Rocky。舊程式碼（含 `main` 上的介面改版 PR #16）不移植，
   只留在 git 歷史（`87963aa` 之前），需要參考時開那個 commit 的 worktree。

## 影響

- 雲端 CI 這幾天抓到過 Windows 的規則反斜線錯誤與 Ubuntu 缺測試字型；之後這類問題要靠本機與 `verify-windows.ps1` 發現。
  PowerShell 5.1 解析腳本的檢查也隨 CI 一起移除，改由 `verify-windows.ps1` 實際執行 `Start-Rocky.ps1` 來涵蓋。
- 依 commit `447421b` 的說明，擁有者 2026-10-07 在 Windows 上跑 `verify-windows.ps1`，修了三個問題（完整摘要尚未貼回）：中文檔名的檔案用 `rmSync`
  刪除會讓 Node 24.12 直接結束程序、對話載入中按 Enter 訊息被丟掉、規則測試的 `C:\Program Files` 有空格。
