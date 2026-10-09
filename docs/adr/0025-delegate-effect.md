# ADR 0025：派工是一種效果

- 日期：2026-10-09
- 狀態：已採用（ADR 0018「下一步」第二項的第二部分，接在 ADR 0024 之後）

## 背景

`delegate_to_opencode` 之前被當成一個名叫 `rocky/delegate_to_opencode` 的外部 MCP 動作。核准面板要從 MCP 參數裡
「認出」派工，才能顯示標題與任務；紀錄裡也只看得到 MCP；放行類別是 `external:mcp:rocky/delegate_to_opencode`。

## 決定

- `Effect` 多一種：`{ kind: 'delegate', agent: 'opencode', title, task }`（`src/shared/types.ts`）。
- 政策：派工是外部動作。「需要時才問」會問，放行類別是 `external:delegate:opencode`（「這個對話都允許」顯示
  「交給 opencode 的工作」）；「放手」直接放行；規劃模式下拒絕。和之前一樣，只是不再借 MCP 的名義。
- 核准面板、操作紀錄直接用這個效果顯示標題與任務；拿掉從 MCP 參數猜派工的程式。
- 舊紀錄裡的派工仍是 MCP 效果，照舊顯示成 MCP 動作。

## 驗證

| 平台                                            | 指令                                                                     | 結果                     |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ------------------------ |
| 雲端 Linux，Node 24.21.0                        | `npm run check`、`npm run build`                                         | 通過，172 個測試，exit 0 |
| 同上，OpenCode 1.18.34                          | `ROCKY_REQUIRE_OPENCODE=1 npx vitest run tests/integration/jobs.test.ts` | 5 個通過                 |
| 同上，Chromium 1194                             | `node scripts/e2e.ts`、`node scripts/e2e-jobs.ts`                        | 通過，exit 0             |
| 同上，Command Code `deepseek/deepseek-v4-flash` | `npm run eval -- --only delegate-to-opencode --repeat 3`                 | 3/3                      |

- 模型看到的工具沒變（golden 檔沒變），所以只跑了派工那一題，沒有跑完整評測。
- 沒有在 Windows 上跑過。
