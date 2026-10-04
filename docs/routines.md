# Routines / 排程

Routines use a five-field cron expression or an interval of at least 60 seconds, with an explicit IANA timezone. The daemon must be online. Saving an enabled routine authorizes its configured model and budget for each occurrence; it does not authorize external effects or bypass approvals.

排程預設跳過錯過的執行。超過預定時間 60 秒視為 misfire；可明確選擇 coalesce-one，最多補跑最近一次。停用再啟用從下一個未來時段開始，不補跑停用期間。每次建立獨立背景 Work；相同 occurrence 身分只提交一次，重啟不重播已建立的工作。

Each occurrence freezes its submission, model revision, budget and workspace revision before admission. Failed admission remains visible in occurrence history; it is not secretly retried with new permissions. Changes to model or workspace configuration require updating the routine. Background coding retains the workspace isolation and exact command approval requirements.

Calendar calculation uses pinned `croner@10.0.1` (MIT), only as a paused calendar evaluator; Rocky owns the persisted schedule and occurrence lifecycle. See the [upstream calendar API](https://github.com/Hexagon/croner). Native tasks remain ephemeral children in the single Deep Agents runtime.

Implementation and fake-clock fixtures are present. DST gaps/repeats, daemon restart, queue admission and UI evidence remain pending concentrated verification; no live scheduled model calls were made during development.
