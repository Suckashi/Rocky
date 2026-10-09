# ADR 0019：較輕的護欄與規劃模式

- 日期：2026-10-09
- 狀態：已採用（擁有者在 ADR 0018 的待決事項中決定）；取代 ADR 0007 的三種模式與 ADR 0011 的規則建議、方案預先核准
- 程式：`src/server/effects/{policy,gate,types,hash,rules}.ts`、`src/server/agent/{plan,rocky-agent,prompt}.ts`、
  `src/server/store/{db,threads,settings}.ts`、`src/server/http/routes/{approvals,rules,settings}.ts`、
  `src/web/components/{Chat,ApprovalPanel,PlanPanel,RuleList}.tsx`
- 測試：`tests/unit/{effects-policy,effects-gate,success-criteria}.test.ts`、`tests/integration/{agent-tools,jobs}.test.ts`、
  `scripts/e2e.ts`、`scripts/e2e-jobs.ts`、評測 `plan-before-refactor`

## 背景

ADR 0018 的檢查發現：「需要時才問」與「放手」判斷完全相同；「這個對話都允許」、安全清單、規則建議、方案預先核准
都只在「每次問」才有作用。擁有者希望像 Kimi 一樣由使用者自己管理風險，並把方案審查做成像 Claude Code 的規劃模式。

## 決定

1. **兩種模式，全部對話共用一個設定。**
   - 「需要時才問」（預設）：碰到底線才問。底線是危險指令、讀寫機密檔、改受保護檔案、專案外的動作（含刪除原本就有的檔案、
     會寫入的 MCP 工具）。
   - 「放手」：只有讀機密檔才問；其他都直接做，仍然寫操作紀錄。
   - 刪除「每次問」、內建安全清單、「看不懂的指令要問」、每個對話各自的模式。舊設定的「每次問」遷移成「需要時才問」。
2. **讀機密檔從直接拒絕改成詢問**，兩種模式都一樣；允許規則不會放行讀機密檔。
3. **「這個對話都允許」依類別放行**：例如 `dangerous:force-push`、`external:command:git`、`external:mcp:notes/write`、
   `secret:read`。核准時，同一個對話裡已經在等的同類問題一起放行。範圍只在這個對話、這次執行期間。
4. **「一律允許」**（只限指令）：從核准面板直接存成永久允許規則，面板上會先顯示要存的規則，
   例如 `git push *`（程式加最多三個子指令字再加 `*`；只剩程式名稱時存完整參數）。取代 Roko 的規則建議。
   允許規則在禁止規則之後、底線之前檢查，所以可以放行危險指令；禁止規則在兩種模式都最優先。
5. **規劃模式**（像 Claude Code）：輸入框旁的「規劃」開關，每個對話各自記住（存在資料庫）。
   開著時只能讀取（含標成唯讀的 MCP 工具）；寫檔、指令、其他外部動作一律拒絕並請模型提出方案。
   `propose_plan` 只在規劃模式提供；你選定一個方案後規劃自動關閉，同一輪接著照核准模式做。
   刪除方案的「預先核准指令」。

## 影響

- 判斷順序：方案 → 禁止規則 → 規劃模式 → 底線（放手只留讀機密檔）→ 這個對話的類別 → 允許規則 → 問你。
- ADR 0010 的成功標準 1 改成：預設模式下，危險與專案外的動作，除非你允許了那一類或那條規則，否則一定問；
  放手是你選擇不被問；禁止規則與讀機密檔在兩種模式都有效（`success-criteria.test.ts`）。
- 放手模式下危險指令只留紀錄、不問；目前只有 Rocky 自己寫的檔案能還原，指令造成的損壞不能還原。
- 動作關卡的概念約從 28 個降到 20 個；刪掉規則建議（`suggestions.ts`、兩個 API、`RuleSuggestion.tsx`）。

## 驗證

| 平台                                            | 指令                                                                  | 結果  |
| ----------------------------------------------- | --------------------------------------------------------------------- | ----- |
| 雲端 Linux，Node 24.21.0                        | `npm run check`、`npm run build`                                      | 見 PR |
| 同上，Chromium 1194                             | `node scripts/e2e.ts`、`node scripts/e2e-jobs.ts`（OpenCode 1.18.34） | 見 PR |
| 同上，Command Code `deepseek/deepseek-v4-flash` | `npm run eval -- --repeat 3`                                          | 見 PR |

- 沒有在 Windows 上跑過。
