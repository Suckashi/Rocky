# ADR 0001：Agent 執行路徑（S2 spike 結果）

- 日期：2026-10-05
- 狀態：已採用（真實模型部分待擁有者在 Windows 上確認）
- 程式：`spikes/s2-agent/`；測試：`tests/spikes/s2-agent.test.ts`

## 決定

Rocky 的 agent 以這條路徑執行，M1 起照此實作：

Deep Agents 1.14.1（在 Rocky 程序內）→ `@langchain/openai` 的 `ChatOpenAI`（OpenAI 相容端點，含 Ollama 的 `/v1`）
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

## 執行紀錄

| 平台                                         | 指令                                                       | 結果                                         |
| -------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| 雲端 Linux，Node 24.21.0                     | `npm run check`（含 S2 的 9 個測試）                       | exit 0；13 個測試通過                        |
| 雲端 Linux，Node 24.21.0                     | `node spikes/s2-agent/live.ts`（指向假伺服器，自動回答 y） | exit 0；3 次核准、3 個檔案、只連到 127.0.0.1 |
| GitHub Actions windows-latest／ubuntu-latest | `npm run check`                                            | 推送後由 CI 執行                             |

## 還沒驗證的（限制）

- **沒有用真實模型跑過。** 雲端環境沒有模型可用。需要擁有者在 Windows 上用 Ollama 執行 `spikes/s2-agent/live.ts`（步驟見 `spikes/s2-agent/README.md`）。
  要確認的是：真實模型會不會正確呼叫工具、Ollama 是否回報用量、中文內容是否正常。
- Checkpointer 用的是記憶體版 `MemorySaver`；`node:sqlite` 版本另外做。
- 第二道防線（通行證）、`run_command` 與 Windows 的子行程管理都還沒做，屬於 M2。
