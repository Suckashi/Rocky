# ADR 0010：M5 收尾

- 日期：2026-10-05
- 狀態：已採用
- 程式：`src/server/agent/{prompt,rocky-agent,gate-middleware}.ts`、`src/web/components/{Roko,Chat}.tsx`、`evals/`、`README.md`
- 測試：`tests/unit/success-criteria.test.ts`、`tests/integration/agent-tools.test.ts`、評測 30 題

## 決定

1. **開工時讀專案的 `AGENTS.md`。** 每一輪都把專案根目錄的 `AGENTS.md`（最多 2 萬字）放進系統提示，標明是使用者對這個專案的指示。
2. **子代理是唯讀的。** 內建的研究子代理只能讀檔、讀文件、搜尋；任何會改變東西的工具（寫檔、指令、記憶寫入、派工、MCP）
   在中介層就被拒絕，請它把發現回報給 Rocky。
3. **模型呼叫最多重試 3 次。** 模型呼叫不會改變外部狀態，所以 429 和網路錯誤可以安全重試；工具動作永遠不會自動重試。
4. **成功標準用測試證明**（`success-criteria.test.ts`）：
   - 三種模式下，即使這個對話已核准過同樣的內容、而且有「全部允許」的規則，危險指令和對外動作都不會被直接允許；
     執行器沒有對應內容的通行證就不會寫檔。
   - Rocky 中途結束後，「已記下意圖但沒完成」的動作變成不明、正在跑的工作變成已中斷，重新啟動也不會再做一次；
     只有使用者能確認結果。
5. **Roko 有「完成」動畫。** 一輪順利結束時跳一下（3 秒），對應產品文件的閒置、工作中、等你核准、完成、出錯五種狀態。
6. **評測擴充到 30 題**，涵蓋修 bug、加功能與測試、跨檔改名、只回答不改檔、找定義、看錯誤原因、改設定檔、寫中文 README、
   保護機密、拒絕後不硬做、force push 不會未經核准執行、六種文件格式、記憶、派工。

## 驗證

| 平台                                            | 指令                                                          | 結果                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 雲端 Linux，Node 24.21.0，OpenCode 1.18.34      | `ROCKY_REQUIRE_OPENCODE=1 npm run check`                      | exit 0；154 個測試通過，含成功標準 9 個、`AGENTS.md` 進系統提示、子代理讀得到但寫不了                                                                                                                                                                             |
| 同上，Command Code `deepseek/deepseek-v4-flash` | `npm run eval -- --repeat 3 --save-baseline`（30 題）         | exit 0；90/90，共 1705 秒，存為基線。改程式的 7 題（21 次）平均詢問 0 次；全部平均 0.1 次：派工 3 次、`rm -rf build` 3 次、force push 1 次，另外 2 次是指令碰到專案外路徑（`soffice --outdir /tmp/...`）與機密檔名（`git check-ignore .env`），都是規則要求的詢問 |
| 同上                                            | 從頭 `git clone` ＋ `npm ci`（空的 npm 快取）＋ `npm start`   | clone＋安裝 61 秒，啟動到印出登入網址 12 秒                                                                                                                                                                                                                       |
| GitHub Actions windows-latest／ubuntu-latest    | `npm run check`、`npm run build`、PowerShell 5.1 解析啟動腳本 | 推送後由 CI 執行；前一次 Windows CI 抓到技能檔案清單用反斜線，已修正（f6c341f）                                                                                                                                                                                   |

## 還沒驗證的（限制）

- **擁有者的 Windows 還沒實際跑過 M1–M5。** CI 在 windows-latest 上跑 `npm run check`（不含 OpenCode、真實模型和瀏覽器）。
  請在 Windows 上執行：`Start-Rocky.ps1`、`npm run test:e2e`、`npm run test:e2e:jobs`（裝好 OpenCode 後）與 `npm run eval`。
- 「乾淨的 Windows 上 5 分鐘內完成安裝到第一次對話」只量了 Linux（見下方）；S3 在擁有者 Windows 上的 `npm ci` 結果見 ADR 0004。
- 「一般寫程式任務平均核准不超過 2 次」只用評測（預設模式）估計，沒有真實使用的統計。
- 正式安裝檔與發佈到 npm 不在 V1（plan.md：要另外授權）。
