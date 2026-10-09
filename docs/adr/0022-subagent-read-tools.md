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

見 PR。
