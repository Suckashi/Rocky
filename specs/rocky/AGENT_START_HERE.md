# 交給 Coding Agent：從新的 Rocky Repo 開始

> 2026-10-05 owner decision: remove automated Verify CI and required CI status checks; use relevant local verification. This supersedes earlier mandatory CI / no-disable-CI instructions for Rocky. PR and other branch protections remain; acceptance results are unchanged. See docs/implementation/ci-removal.md.

> 規格版本2.0.0；取代舊的Apsis重構指令。這不是要求你在Apsis開分支或只做rename。

## 1. 先讀這四份文件

- [ROCKY_GREENFIELD_SPEC.md](ROCKY_GREENFIELD_SPEC.md)：完整產品／架構／API／安全／資料／Learning契約。
- [ROCKY_BOT_DESIGN_SPEC.md](ROCKY_BOT_DESIGN_SPEC.md)：全新角色、視覺、persona及真實狀態動畫。
- [implementation-plan.json](implementation-plan.json)：任務DAG、doneWhen、R/AT對照與證據狀態。
- [DECISIONS.md](DECISIONS.md)：本次刪除的舊要求及不變的技術方向。

規格建議放 `Rocky/specs/rocky/`。先確認文件實際存在；聊天附件不是已經在Git。若已在現有Rocky repo，讀取它自己的AGENTS/CONTRIBUTING/SECURITY；如果是全新目錄，建立這些文件。

## 2. 執行目標是 Rocky，不是 Apsis

產品／Repo名 `Rocky`。從新的目錄與獨立Git root開始，不clone Apsis/OpenDots再改名、不fork、不帶上游Git歷史、branches、tags、.git、整包source或48個頭像。

如果你現在位於Apsis/OpenDots目錄，將其視為read-only參考，離開後建立新的Rocky目錄。不要在來源Repo做變更、開重構分支、改remote、刪除/封存/改private、清除舊資料。

如果Rocky目錄已存在，確認是指定專案且工作區狀態安全；不要覆蓋未提交檔案。若Rocky遠端不存在或未有建Repo授權，先完成本地骨架並記remote status，繼續可做的P0；不得虛構GitHub URL或已push成功。

本地初始feature branch可用 `feat/rocky-foundation`。遠端Repo建立、可見性、第一次seed/main push，需要該執行環境的明確授權；此規格本身不提供。首次bootstrap後遵循branch→PR→CI；不拿bootstrap當作繞過既有main保護的理由。

## 3. 已定案，不重問

1. **Local + Explicit Network**：本機掌控資料與工作；允許明確配置的公司/外部模型、MCP和核准網站。不是Strict Offline，不強迫本機模型。
2. **Node/TypeScript-only**：核心與第一版Automatic Learning不要求Python/uv/GEPA/LangMem，也不偷用native build fallback要求一般貢獻者裝compiler。
3. **CopilotKit OSS／AG-UI + Deep Agents JS／LangGraph**：單一主要runtime，使用原生task/todos/context/checkpointer；Rocky管work/policy/ledger/事件，不做第二planner。
4. **MCP**：stdio/Streamable HTTP；不依賴Intelligence、managed connectors、Cloud persistence/平台license key。
5. **Learning**：受限反思→技能候選→Promptfoo完整Agent評測→人工發布→固定版本使用/回滾。Optimize只是明確provider gate後可選加強。
6. **Greenfield**：不要求Apsis功能parity、不做跨產品資料遷移／API/env/DB/checkpoint相容層；一般owner明確選取文件/專案/標準SKILL.md不受影響。
7. **全新Bot**：一個Rocky工程夥伴；新avatar/mark/介面/persona，不沿用48-avatar gallery。背景work不是新的永久人格。
8. **命名**：Rocky、private `@rocky/*`、`ROCKY_*`、`/api/v1`、`rocky.*` events、`x-rocky` version 1、productId `rocky`。不讀 `APSIS_DATA_DIR`。
9. **安全與範圍**：批量或單次操作的重大核准、unknown對帳、scope/credentials隔離均保留為新實作需求，不因角色親和力而放寬。

## 4. 開始 T-001，立刻接續 P0

T-001不是回到Apsis盤點保留class；它是建立Rocky新骨架、repository-manifest、reference-adoption與新AGENTS/CI。

局部參考需記來源、固定commit/license和理由；若引用少量可分離程式，保留notices並在Rocky契約下測試。不能整包放legacy/vendor/submodule後再說之後拆。

依T-002/T-003/T-004固定版本與Node-only雙平台路徑，做：

```text
Rocky UI → 本地Work facade → Deep Agents原生middleware
         → Node stdio/HTTP MCP fixture → tool/subagent/approval呈現
```

無Intelligence、無暗中provider/telemetry；Promptfoo trusted TS provider實際測同一個Rocky evaluation路徑。P0可用中性UI驗證；正式Rocky美術和presence按T-037/T-038完成，不因placeholder就標品牌交付。

P0通過即依DAG繼續，不停在另一份規劃報告。一般工程細節自行依Spec解決並寫ADR；來源站點失效不是改用Cloud/Python的理由。相容性問題使用固定API/型別與最小重現驗證，不憑上版對第三方的描述編造不存在SDK。

## 5. 每輪交付

更新 `docs/implementation/progress.md` 與plan status/evidence；列明T/R/AT、改動、實際command/exit/report、未跑項目及下一個可做task。

`doneWhen`是局部結案標準；相關AT可能跨多階段，不可早期spike就標全域passed。沒有執行就是not_run；Windows/Ubuntu、fixture/live不可互相冒充。缺少授權/credentials只阻擋相應遠端動作，繼續可做的本地功能與fixtures。

## 6. 禁止事項

- 不更動Apsis；不執行舊版「進Apsis做重構／匯入資料／保留avatar」的開工指令。
- 不直接push既有受保護main、不force push、不關CI、不擅自merge/tag/deploy或變更可見性。
- 不commit keys/.env/DB/browser profiles/node_modules/模型/容器/私人證據或上游.git。
- 不把UI detach當cancel、checkpoint當exactly-once、Native workspace當OS sandbox。
- 不把前端approved、MCP hints、persona或Skill文字當權限；不让Learning agent寫active skills/policy。
- 不把角色靈感當電影素材授權；不用劇照/音訊/上游logo偽稱原創MIT素材。

現在在安全的新Rocky目錄開始T-001並接續P0。Spec的API/scripts/元件都是待建立契約；先讀已安裝套件的實際型別，再實作與測試。
