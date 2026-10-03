# Rocky — Greenfield Spec 套件

**文件版本2.0.0｜2026-10-02｜繁體中文。**這是全新Rocky產品的規格，不是Apsis改名／升級／fork；沒有包含可啟動的Rocky原始碼或完成的Bot圖像。

## 文件

| 文件 | 用途 |
|---|---|
| [ROCKY_GREENFIELD_SPEC.md](ROCKY_GREENFIELD_SPEC.md) | 完整產品、架構、資料、MCP、Agent、Learning、CI與70項驗收 |
| [ROCKY_BOT_DESIGN_SPEC.md](ROCKY_BOT_DESIGN_SPEC.md) | 新Rocky角色／視覺／persona／狀態動畫的實作基線 |
| [implementation-plan.json](implementation-plan.json) | 38個任務DAG、56项需求、status/evidence欄位 |
| [AGENT_START_HERE.md](AGENT_START_HERE.md) | 可直接交给coding agent的開工指令 |
| [DECISIONS.md](DECISIONS.md) | 明確取代Apsis舊規劃的變更紀錄 |
| [SPEC_VALIDATION.md](SPEC_VALIDATION.md) | 本文件包的結構／引用／一致性檢查；不是app測試 |
| [validate-spec.mjs](validate-spec.mjs) | Node執行的文件一致性validator |

## 使用

把本資料夾內容放到新的 `Rocky/specs/rocky/`，將 `AGENT_START_HERE.md` 交給agent。不要把舊的Apsis開工指令一起當作有效要求。

```sh
node specs/rocky/validate-spec.mjs
```

上面只驗證Spec。產品的npm scripts是主Spec中要求agent新增的契約，目前不存在於這個文件包。

## 範圍

Local + Explicit Network、Node/TypeScript-only、CopilotKit OSS/AG-UI、Deep Agents JS/LangGraph、MCP、本地資料、受限Learning＋Promptfoo＋人工發布。Apsis/OpenDots為read-only參考。

不做Apsis importer、parity、舊API/env兼容、48-avatar保留或第二套runtime。不擅自刪除/封存Apsis，也未建立或查證Rocky遠端Repo；取得相應權限後由實作者/owner處理。

此包沒有模型、browser binaries、node_modules、DB或私人證據。全部開發tasks為pending、驗收為not_run；新Bot圖像與元件是待實作交付，不是本次已生成成果。
