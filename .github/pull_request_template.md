## 摘要

<!-- 這個 PR 改了什麼、為什麼。 -->

## 檢查

沒有雲端 CI，請在本機跑，並照實填寫平台、指令與結果（沒跑的就寫沒跑）。

| 平台 | 指令 | 結果 |
| ---- | ---- | ---- |
|      |      |      |

- [ ] `npm run check`（型別、lint、格式、i18n、測試）
- [ ] 改到介面：`npm run test:e2e`；改到派工：`npm run test:e2e:jobs`
- [ ] 改到提示詞、工具或 agent 迴圈：`npm run eval -- --repeat 3`，沒有低於基線
- [ ] 改到 Windows 相關的部分：在 Windows 上跑 `scripts/verify-windows.ps1`

## 確認

- [ ] 沒有憑證、本機資料庫、瀏覽器設定檔或私人資料進 Git
- [ ] 新的介面文字都放在語系檔（`zh-TW`、`en`）
- [ ] 換了架構或做法時，有寫一份簡短的 ADR（`docs/adr/`）
- [ ] README 有改時，`README.md` 與 `README.zh-TW.md` 一起更新
