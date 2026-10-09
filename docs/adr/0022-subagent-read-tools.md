# ADR 0022：研究子代理只拿讀取工具，並有自己的提示

- 日期：2026-10-09
- 狀態：已採用

## 背景

ADR 0021 的 golden 檔顯示：Deep Agents 把 Rocky 的每個工具都給了研究子代理（`write_file`、`run_command`、
`delegate_to_opencode` 等），它的系統提示也只有 Deep Agents 的一句通用文字。子代理是唯讀的，
寫入的呼叫都會被關卡擋下，所以這些工具只是讓模型白花 token、多一次失敗的嘗試。

## 決定

1. 子代理的關卡中介層（`createGateMiddleware(run, 'subagent')`）在每次呼叫模型前，把工具清單過濾成
   `SUBAGENT_TOOLS`：`ls`、`read_file`、`glob`、`grep`、`read_document`、`search_memory`、`load_skill`。
   關卡照樣擋下任何非讀取的動作，過濾只是讓模型看不到它不能用的工具。
2. 子代理有自己的系統提示（`subagentPrompt`）：專案資料夾、作業系統、只能讀、報告給 Rocky（附路徑、
   說找不到什麼、保持簡短）。不放語言規則與 AGENTS.md：報告是給 Rocky 看的，Rocky 自己有這兩樣。
3. 評測加一題 `research-with-subagent`：之前沒有任何一題會用到子代理（31 題 × 3 次的紀錄裡 `task` 一次都沒出現）。

## 影響

- 子代理收到的提示加工具定義從約 13.2k 字元降到約 6.4k（`tests/golden/subagent.md`）。
- 唯讀的 MCP 工具也不給子代理：關卡本來就只讓子代理做 `read` 類動作，MCP 呼叫一律被擋。

## 驗證

| 平台                                            | 指令                                                                   | 結果                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| 雲端 Linux，Node 24.21.0                        | `npm run check`                                                        | 通過，168 個測試，exit 0                                     |
| 同上，Command Code `deepseek/deepseek-v4-flash` | `npm run eval -- --repeat 3`（新題目加入前的 31 題）                   | 90/93，沒有題目退步（exit 0）                                |
| 同上                                            | `npm run eval -- --only research-with-subagent --repeat 5`，這次的程式 | 5/5，平均 32.7 秒                                            |
| 同上                                            | 同一題，子代理改回 main 的程式                                         | 5/5，平均 39.7 秒；有一次子代理呼叫 `run_command` 被關卡擋下 |

- 完整評測的 3 次失敗：`fix-emoji-truncate` 一次供應商 400；`delegate-to-opencode` 一次 OpenCode 沒有改檔；
  `respect-rejection` 一次模型沒有嘗試刪除（ADR 0020 那次也是 2/3）。這三題都沒有用到子代理。
- 各 5 次的樣本太小，時間差只能當參考，不能說變快。
- 沒有在 Windows 上跑過。
