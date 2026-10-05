# ADR 0002：先不採用 Anthropic 格式

- 日期：2026-10-05
- 狀態：已採用

## 決定

模型層只走 OpenAI 相容端點（`@langchain/openai` 的 `ChatOpenAI`），接 Command Code、Ollama 這類第三方服務，也包含 OpenAI 本身。
不使用 Anthropic 格式（`/messages`、`@langchain/anthropic`），已從依賴與 `spikes/s2-agent/live.ts` 移除。

## 原因

- 擁有者使用的 Command Code 方案不含 Claude 模型，而它的 `/provider/v1/messages` 只接受 Claude 模型（ADR 0001 發現 9）。
- 擁有者不打算改用含 Claude 的方案；沒驗證過、也不會用的程式碼不保留。
- OpenAI 相容端點已用真實模型驗證：工具呼叫、關卡、用量與自動快取的 cache read 都正常（ADR 0001）。

## 影響

- `product.md`、`architecture.md`、`plan.md` 的模型清單拿掉 Anthropic。
- 之後若要接 Claude 模型，加回 `ChatAnthropic` 只要幾行；Deep Agents 會自動加上 prompt caching。到時另寫 ADR 並用真實模型驗證。
