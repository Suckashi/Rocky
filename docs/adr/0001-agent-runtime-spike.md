# ADR 0001：Agent 執行路徑（S2 spike 結果）

- 日期：2026-10-05
- 狀態：已採用（真實模型已在雲端 Linux 用 Command Code 驗證；Windows 待確認；Anthropic 格式不採用，見 ADR 0002）
- 程式：`spikes/s2-agent/`；測試：`tests/spikes/s2-agent.test.ts`

## 決定

Rocky 的 agent 以這條路徑執行，M1 起照此實作：

Deep Agents 1.14.1（在 Rocky 程序內）→ `@langchain/openai` 的 `ChatOpenAI`（OpenAI 相容端點，例如 Command Code、Ollama 的 `/v1`）
→ 動作關卡 middleware（`wrapToolCall`，用 LangGraph `interrupt` 暫停）→ 轉成 AG-UI 1.0 事件。

## 驗證了什麼（假模型，真實 client）

在 127.0.0.1 架一個回傳預先寫好內容的 OpenAI 相容伺服器，Rocky 端用真正的 `ChatOpenAI` 連它。

| 項目                                                              | 結果                                   |
| ----------------------------------------------------------------- | -------------------------------------- |
| 文字與工具呼叫逐段串流，轉成 AG-UI 事件                           | ✅ 全部通過 `@ag-ui/core/schemas` 驗證 |
| 寫檔前暫停，核准前硬碟上沒有檔案                                  | ✅                                     |
| 同一輪平行兩個寫檔：兩個核准一起出現，核准後各寫一次              | ✅                                     |
| 拒絕：檔案沒建立，模型收到原因並換做法，這輪正常結束              | ✅                                     |
| 恢復時，同一批中已自動執行的指令不會被重做                        | ✅（恢復前後都是 1 次）                |
| 子代理：開始、結果、結束事件都有；子代理的寫檔也要核准            | ✅（見發現 1）                         |
| 快取 token 用量回報（`cachedInputTokens`）                        | ✅                                     |
| 整個執行過程沒有任何對外網路請求                                  | ✅                                     |
| 核准用 AG-UI 原生的 `RUN_FINISHED` interrupt 結果，不需要自訂事件 | ✅                                     |

## 重要發現

1. **傳給 `createDeepAgent` 的 middleware 不會套用到內建的通用子代理。** 第一次執行時，子代理沒有經過關卡就直接寫檔。
   做法：一律自己定義 `{ ...GENERAL_PURPOSE_SUBAGENT, middleware: [gate] }`，每個自訂子代理也都掛上關卡；
   另外第二道防線（底層寫入只認通行證）一定要做，不能只靠 middleware。
2. **除了 Codex 系列以外，Deep Agents 預設沒有系統提示詞，也沒有待辦清單工具。** 主 agent 送給模型的請求連 system 訊息都沒有。
   做法：Rocky 自己提供基礎提示詞（`systemPrompt`），並明確加上 `todoListMiddleware()`。
3. **子代理的核准請求會被回報兩次**（子圖一次、父圖一次），要依 `toolCallId` 合併。
4. **`task` 工具的結果只出現在 `updates` 串流**，不在 `messages` 串流；轉換器兩邊都要接。
5. **恢復時，被暫停的那個工具會從頭重跑。** 關卡一定要在任何副作用之前就暫停；`task` 重跑時，子代理會從自己的檢查點接著跑，不會重做已完成的寫檔。
6. 工具清單裡有 `delete`，不在「沒有副作用」清單裡，所以預設會被關卡攔下。未知工具一律當成有副作用。
7. `langchain` 的 `todoListMiddleware` 型別在 `exactOptionalPropertyTypes` 下不相容，暫時用型別轉換。

## 真實模型驗證（Command Code）

2026-10-05 在雲端 Linux 以 `spikes/s2-agent/live.ts` 連 Command Code Provider API（`https://api.commandcode.ai/provider/v1`）。
任務是預設任務：在 /notes.md 寫三行繁體中文待辦事項，讀回確認。核准一律由 `ROCKY_S2_AUTO_APPROVE` **自動回答**，不是人按的。
依擁有者要求只用便宜的模型。

| 項目                                     | 結果                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /models`                            | ✅ HTTP 200，列出 Claude、GPT、DeepSeek、Qwen 等模型                                    |
| 工具呼叫（`deepseek/deepseek-v4-flash`） | ✅ `ls` → `write_file` → `read_file`，參數格式正確，一次就成功，不需要換模型            |
| 寫檔前暫停                               | ✅ 關卡在 `write_file` 前 interrupt，當時 `/notes.md on disk before approval: no`       |
| 中文內容                                 | ✅ 硬碟上的檔案是三行正確的繁體中文，讀回後模型回報一致                                 |
| 用量回報                                 | ✅ 每次模型呼叫都有 `usage_metadata`（串流也有）                                        |
| 快取 token                               | ✅ OpenAI 格式回報 `cache_read`（自動快取，不需要 `cache_control`）；不回報 cache write |
| 拒絕（`reject-first`）                   | ✅ 模型收到原因後改成直接在回覆列出內容，沒有重試寫檔，硬碟上沒有檔案                   |
| 聯絡過的主機                             | ✅ 只有 `api.commandcode.ai`                                                            |
| Anthropic 格式（`ChatAnthropic`）        | ❌ 沒跑成：方案不含 Claude 模型（見發現 9）；之後不採用，程式已移除（ADR 0002）         |

8. **雲端環境的 Node 要設 `NODE_USE_ENV_PROXY=1`。** Node 內建的 fetch 不讀 `HTTPS_PROXY`，直接連線會被環境的出口白名單擋（403）。
   這只和雲端容器有關；擁有者的 Windows 直接連線不需要。
9. **Command Code 的 `/provider/v1/messages` 只接受 Claude 模型**，其他模型回 400 並指向 `/chat/completions`。
   目前方案用 Claude Haiku 4.5 回 `403 MODEL_NOT_IN_PLAN`（需要 Pro 以上或按量計費），所以 prompt caching 的 cache read/write 還沒在 Anthropic 格式上驗證。
   Deep Agents 偵測到 `ChatAnthropic` 時會自動加上 `anthropicPromptCachingMiddleware` 與系統提示詞的 cache breakpoint。
   擁有者不使用含 Claude 的方案，因此 Anthropic 格式不採用，`@langchain/anthropic` 與 `live.ts` 的 anthropic 分支已移除（ADR 0002）。
10. 拒絕原因會原封不動傳給模型，模型依原因換做法；工具結果的 `status: 'error'` 加上中文原因就足夠，不需要另外的訊息格式。

## 執行紀錄

| 平台                                         | 指令                                                                         | 結果                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 雲端 Linux，Node 24.21.0                     | `npm run check`（含 S2 的 9 個測試）                                         | exit 0；13 個測試通過                                                                                                         |
| 雲端 Linux，Node 24.21.0                     | `node spikes/s2-agent/live.ts`（指向假伺服器，自動回答 y）                   | exit 0；3 次核准、3 個檔案、只連到 127.0.0.1                                                                                  |
| GitHub Actions windows-latest／ubuntu-latest | `npm run check`                                                              | 推送後由 CI 執行                                                                                                              |
| 雲端 Linux，Node 24.21.0                     | `live.ts`，openai，`deepseek/deepseek-v4-flash`，`AUTO_APPROVE=1`            | exit 0；15.6 s；`ls`、`write_file:allowed`、`read_file`；input 22499、output 712、cache read 16512；只連到 api.commandcode.ai |
| 雲端 Linux，Node 24.21.0                     | `live.ts`，openai，`deepseek/deepseek-v4-flash`，`AUTO_APPROVE=reject-first` | exit 0；9.2 s；`write_file:rejected`，沒有檔案；input 11082、output 415、cache read 10752                                     |
| 雲端 Linux，Node 24.21.0                     | `live.ts`，anthropic，`claude-haiku-4-5-20251001`                            | exit 1；`403 MODEL_NOT_IN_PLAN`                                                                                               |
| 雲端 Linux，Node 24.21.0                     | `live.ts`，anthropic，`deepseek/deepseek-v4-flash`                           | exit 1；400，`/messages` 只支援 Claude 模型                                                                                   |

## 還沒驗證的（限制）

- **Windows 上的真實模型驗證先跳過**（擁有者決定，2026-10-05），之後補跑 `spikes/s2-agent/live.ts`。

- **真實模型只在雲端 Linux 跑過一個模型（DeepSeek V4 Flash）**，核准是自動回答。還沒在擁有者的 Windows 上跑，也還沒試過其他模型。
- Anthropic 格式不採用（ADR 0002），因此不再列為待驗證。
- 只跑了預設任務；子代理、平行寫檔、恢復時不重做指令，這些仍只有假模型的證據。
- Checkpointer 用的是記憶體版 `MemorySaver`；`node:sqlite` 版本另外做。
- 第二道防線（通行證）、`run_command` 與 Windows 的子行程管理都還沒做，屬於 M2。

## 後續（2026-10-08 檢查）

- spike 程式（`spikes/s2-agent/`）與測試（`tests/spikes/s2-agent.test.ts`）已刪除，最後一版在 commit `6590139`；假模型伺服器搬到 `tests/fixtures/fake-openai.ts`。限制裡的「之後補跑 `live.ts`」因此不會再做；Windows 上的真實模型使用改由 `scripts/verify-windows.ps1 -Eval` 涵蓋。
- 限制裡的 checkpointer（`node:sqlite` 版本另外做）沒有做：ADR 0007 改成核准在程序內等待，不用 LangGraph interrupt 與 checkpointer。
- 執行紀錄裡「推送後由 CI 執行」那一列當時沒有回填結果。
