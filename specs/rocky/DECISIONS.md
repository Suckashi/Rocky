# Rocky Greenfield 決策紀錄

> 2026-10-05 owner decision: remove automated Verify CI and required CI status checks; use relevant local verification. This supersedes earlier mandatory CI / no-disable-CI instructions for Rocky. PR and other branch protections remain; acceptance results are unchanged. See docs/implementation/ci-removal.md.

**版本2.0.0｜2026-10-02。**本紀錄與主Spec完整取代先前Apsis重構Spec；不是貼在舊需求後的可選附錄。

> 2026-10-03 最新 UI 決策：OpenDots 是 Rocky 的主要 UI／UX 對照基準；Rocky 的原創設計集中在角色、名稱與必要的功能適配。 舊版與其衝突的全站配色、sidebar、閱讀區、卡片及間距值由本決策取代；產品與技術契約不變。

## 最新使用者決策

從Apsis改造轉為新的Rocky Repo。名稱靈感來自Project Hail Mary中的Rocky，Bot重新設計。Apsis與OpenDots只是參考範本，不再是必須保留、遷移或fork的產品底座。

## 取代關係

| 舊規劃 | Rocky的新規劃 |
|---|---|
| 到Apsis repo開feature branch | 到新的Rocky目錄建立独立Git root |
| 以Apsis main SHA作開發baseline | SHA只作read-only參考，Rocky有自己的commit |
| 盤點keep/replace/defer並維持parity | reference-adoption：採用pattern、局部引用或不採用，依Rocky需求判定 |
| 保留Apsis品牌和48 avatars | 新Rocky角色、mark、favicon、tokens、presence和persona |
| 升級時遷移舊DB/設定/history | 沒有跨產品importer，空白Rocky資料開始 |
| 退出／移除Apsis舊runtime | Rocky從第一個入口只建自己的runtime，不碰上游 |
| 新API沿用/api/v3與APSIS_* | 新產品/api/v1、ROCKY_*、rocky.*、x-rocky v1 |
| 沿用Apsis required-check/ruleset | Rocky新CI與經授權的新保護設定 |
| 舊版回退到Apsis資料 | Rocky只備份／還原自己的資料 |
| Spec 1.0.0 | Spec 2.0.0，與產品release版本分開 |

## 保持不變

Local + Explicit Network；Node/TypeScript-only；CopilotKit OSS/AG-UI；Deep Agents JS/LangGraph主要runtime；MCP stdio/HTTP；本地SQLite；可觀測原生subagent與背景work；mandatory critical/unknown approvals；未知副作用不重播；受限反思＋Promptfoo評測＋人工發布技能。

不要求Python、Intelligence、managed connector、雲端資料庫或在啟動時下載本地模型。

## 額外明確化

**Apsis不再開發，不代表要刪除它。**這份Spec不授權刪除、封存、改名、改private或修改Apsis資料。這次沒有遠端建Repo、push、merge、release或圖片生成。

**Rocky Repo與npm名稱可用性未查證。**名稱按使用者定案；有衝突或權限不足時只停止相應遠端操作，完成本地可做部分。

**2026-10-03 UI／UX 最新決策。**OpenDots 是 Rocky 的主要 UI／UX 對照基準；Rocky 的原創設計集中在角色、名稱與必要的功能適配。 可在 MIT 授權下重用展示元件、CSS、tokens 與互動結構；不得整包移植產品、後端、資料、Git 歷史或 Intelligence route。

**不要刪掉通用能力。**使用者主動加入程式專案、文件或標準Skill仍允許；取消的是跨產品資料遷移，不是取消普通file import、workspace或skill import。

**Bot設計為新的實作基線。**五向岩質外形、琥珀點綴、溫暖實用工程夥伴等是此次提出的設計決策；尚無最終圖像或使用者逐項批准的美術，不可把文件完成當素材完成。

## ID與任務變更

- R-039改為新資料/舊專案隔離；R-043改為Rocky新Repo工程流程；其他相關文字按新建語意調整。
- 新增R-049～R-056：greenfield、reference-only、命名、Bot視覺、presence、persona、素材來源、不處分舊專案。
- T-001改為新Repo骨架/參考決策，T-033改為Rocky隔離與自身備份。
- T-014移除HTTP-only舊config轉換，T-019移除舊48 avatars。
- 新增T-037（P1角色與視覺）及T-038（P4狀態/persona整合）；依DAG執行，不按ID大小猜順序。
- AT-47不再驗收舊資料匯入；新增AT-59～AT-70。

本版共56項需求、38個開發任務、70項驗收。實際任務狀態與證據以 implementation-plan.json 及 docs/implementation/progress.md 為準；全部全域 AT 仍維持 not_run，局部測試與參考 Repo 的結果不能冒充完整驗收。

**2026-10-03 原生暫存 backend。**使用 Deep Agents 1.14.1 公開的零參數 StateBackend；檔案位於每個執行 thread 的 checkpoint graph state，並非主機檔案。工具限 /scratch；原生上下文卸載目錄只讀；execute 未開放。Rocky middleware 在工具執行與公開 trace 之前檢查路徑和 24 KiB 參數上限，trace 只記路徑、儲存種類與位元組數。真實 workspace／shell 留給 daemon broker；不新增 backend 格式、runtime 或上游 monkey patch。原生 context 壓縮驗收尚未執行。
