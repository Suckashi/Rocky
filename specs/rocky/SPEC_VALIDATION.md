# Rocky 規格一致性檢查

**文件版本：2.0.0｜日期：2026-10-02**

範圍僅為本次產出的 Markdown／JSON 開發規格及驗證腳本；不是 Rocky 原始碼、SDK 相容性、品牌權利、GitHub 或真實模型測試。

實際使用此容器的 Node **v22.16.0** 執行：

```sh
node validate-spec.mjs --handoff --json
```

此驗證腳本只使用 Node built-ins。這個文件檢查使用的 Node 版本，不代表已完成主規格要求的 Node 24 與 Windows／Ubuntu 應用驗收。

結果：**59/59 項文件檢查通過**。

- 56 項需求、38 個任務、70 項產品驗收。
- 所有任務為 `pending`，所有產品驗收為 `not_run`；未填入虛構 implementation evidence。
- 新 Rocky 身分、名稱空間、空白啟動、Bot 設計、任務表與 JSON 一致；依賴無循環。
- 原 Apsis spec／plan／開工指令的 SHA-256 與修訂前相同；未覆寫原檔。

## 實際檢查結果

| 檢查 | 結果 |
|---|---|
| Known CLI arguments | 通過 |
| All core documents exist | 通過 |
| Spec identity and filenames | 通過 |
| Expected handoff scope: 56 requirements, 38 tasks, 70 acceptance items | 通過 |
| R IDs unique and well formed | 通過 |
| T IDs unique and well formed | 通過 |
| AT IDs unique and well formed | 通過 |
| SRC IDs unique and well formed | 通過 |
| R sequence complete | 通過 |
| T sequence complete | 通過 |
| AT sequence complete | 通過 |
| SRC sequence complete | 通過 |
| Task dependencies exist and are not self-references | 通過 |
| Task dependency graph acyclic | 通過 |
| Every task has valid acceptance references | 通過 |
| Every acceptance item references defined requirements | 通過 |
| Every requirement has acceptance coverage | 通過 |
| Every acceptance item has an owning/contributing task | 通過 |
| Task requirements match acceptance-derived coverage | 通過 |
| Every task has a local doneWhen and phase | 通過 |
| Valid task and acceptance status vocabulary | 通過 |
| Completed task / passed acceptance must contain evidence | 通過 |
| All implementation tasks pending with no fabricated evidence | 通過 |
| All product acceptance not_run with no fabricated evidence | 通過 |
| Requirements table matches plan exactly | 通過 |
| Acceptance table matches plan exactly | 通過 |
| Task table matches plan exactly | 通過 |
| Main chapters 0–26 complete | 通過 |
| Bot chapters B0–B10 complete | 通過 |
| ROCKY_GREENFIELD_SPEC.md: defined requirement/task/test references | 通過 |
| ROCKY_GREENFIELD_SPEC.md: code fences paired | 通過 |
| ROCKY_GREENFIELD_SPEC.md: no internal tool citation artifacts | 通過 |
| ROCKY_GREENFIELD_SPEC.md: relative file links resolve | 通過 |
| ROCKY_BOT_DESIGN_SPEC.md: defined requirement/task/test references | 通過 |
| ROCKY_BOT_DESIGN_SPEC.md: code fences paired | 通過 |
| ROCKY_BOT_DESIGN_SPEC.md: no internal tool citation artifacts | 通過 |
| ROCKY_BOT_DESIGN_SPEC.md: relative file links resolve | 通過 |
| AGENT_START_HERE.md: defined requirement/task/test references | 通過 |
| AGENT_START_HERE.md: code fences paired | 通過 |
| AGENT_START_HERE.md: no internal tool citation artifacts | 通過 |
| AGENT_START_HERE.md: relative file links resolve | 通過 |
| DECISIONS.md: defined requirement/task/test references | 通過 |
| DECISIONS.md: code fences paired | 通過 |
| DECISIONS.md: no internal tool citation artifacts | 通過 |
| DECISIONS.md: relative file links resolve | 通過 |
| README.md: defined requirement/task/test references | 通過 |
| README.md: code fences paired | 通過 |
| README.md: no internal tool citation artifacts | 通過 |
| README.md: relative file links resolve | 通過 |
| Source definitions unique and cover registry | 通過 |
| All main source references defined | 通過 |
| Sources disclose inherited versus current verification | 通過 |
| Rocky target is greenfield; references are not baseline | 通過 |
| Remote creation/commit not falsely claimed | 通過 |
| Local + Explicit Network and Node-only retained | 通過 |
| New brand tasks are required by UI and final verification | 通過 |
| No stale in-place development commands in main/start/task deliverables | 通過 |
| Explicit new namespace contract exists | 通過 |
| Bot design is a specification, not fabricated finished artwork | 通過 |

## 檔案完整性

下表不包含本報告本身，避免自我引用雜湊。ZIP 的容器完整性另以解壓 CRC 檢查確認。

| 檔案 | bytes | SHA-256 |
|---|---:|---|
| `AGENT_START_HERE.md` | 5,710 | `5fa6de0d661751d6b57ce3fafccb0fb30cd213a80432475b099077ebbce756ec` |
| `DECISIONS.md` | 3,539 | `77b778fb3b49b7c9542d7cf3fb6c133263e1d28ef45c2bd5285812fd74fee897` |
| `README.md` | 1,954 | `475f350fcc07ad570c1b315d16c0aa70545104c582ad9288f27dc617a351abe4` |
| `ROCKY_BOT_DESIGN_SPEC.md` | 18,489 | `7cec777e4517e21dc6b8e891344089fbd1294843db95977203fb7841d5cd17ac` |
| `ROCKY_GREENFIELD_SPEC.md` | 133,653 | `d84a46778f4e00d57a6ceb86ed03f97efbfde3d438f1ce1b45d41c1b6360f4ba` |
| `implementation-plan.json` | 99,290 | `817f907a2dabb179a30fa4a7ff096dcc0b96b83ecf35bb9ce6c75e63faa4fdb9` |
| `validate-spec.mjs` | 10,504 | `943edeb0b597798d6aa9c7e3daba559c5bff7ee33b2c21412457728f4c4a5c38` |

## 尚未執行／尚未產出

尚未建立 Rocky GitHub Repo、初始化應用程式或進行任何遠端 push／PR／CI；未變更、刪除或封存 Apsis。
尚未產出最終 avatar／logo／favicon 圖像與元件；`ROCKY_BOT_DESIGN_SPEC.md` 是設計及驗收基線，不是已核准美術。
尚未完成 Rocky build/tests、Node-only dependency installation、Windows／Ubuntu verification、模型／MCP 真實整合、container smoke tests、使用者驗收或名稱／素材權利審查。
舊規格的外部技術參考註明為沿用來源，沒有將本次文件改寫宣稱成第三方 API 的重新查證。
執行者仍須在 P0 鎖定實際依賴並驗證公開 API；P0 或後續測試失敗不得以本報告替代。

## 持續使用驗證腳本

一般開發更新 task/acceptance 狀態後執行 `node validate-spec.mjs`；需要檢查初始交接狀態才加 `--handoff`。
增加或移除需求／任務／驗收項目時，須同步更新文件版本、JSON 與驗證腳本的 scope 計數；不能為了隱藏實作缺口而改計數或移除硬性要求。
