# ADR 0024：工具登記處

- 日期：2026-10-09
- 狀態：已採用（ADR 0018「下一步」第二項的第一部分）

## 背景

關卡中介層要知道每個工具呼叫「會做什麼」，才能交給關卡判斷。之前它靠比對名字：
`MEMORY_WRITE_TOOLS`、`MEMORY_READ_TOOLS`、`DOCUMENT_WRITE_TOOLS`、`READ_TOOLS`、`SKILL_TOOLS`、`NO_EFFECT_TOOLS`
分散在五個檔案，再加上 MCP 的名字對照表和一串 if/else。新增一個工具要記得改中介層，忘了就會被當成外部動作。

## 決定

- `src/server/agent/registry.ts` 的 `ToolRegistry`：每個工具註冊時附一個判斷函式（judge），回答這次呼叫會產生什麼效果、
  要不要給關卡判斷、以哪個資料夾為根（記憶工具是記憶資料夾）。
- 每個工具模組自己註冊（`addMemoryTools`、`addDocumentTools`、`addRunCommandTool`、`addPlanTool`、`addSkillTool`、
  `addMcpTools`、`addJobTools`），判斷就寫在工具定義旁邊。Deep Agents 自己的檔案工具、`write_todos`、`task`
  由 `judgeWorkspaceTools` 登記判斷。
- 關卡中介層只呼叫 `tools.effectOf(name, args)`。沒有註冊的工具照舊當成外部動作；沒有專案時回「尚未選專案」。
- 給模型的工具清單由登記處依註冊順序產生；清單與順序不變（golden 檔沒變）。

## 下一部分

- 派工（`delegate_to_opencode`）目前仍登記成名為 `rocky/delegate_to_opencode` 的外部 MCP 動作。
  下一個 PR 讓它成為真正的效果類型，核准面板顯示標題與任務內容，並有自己的放行類別。

## 驗證

見 PR。
