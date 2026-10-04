import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  routineConfigSchema,
  routineSchema,
  routineHistorySchema,
  type Routine,
} from "../../../packages/contracts/src/routines.js";
import {
  publicModelSchema,
  type PublicModel,
} from "../../../packages/contracts/src/models.js";
import {
  workspaceSchema,
  type Workspace,
} from "../../../packages/contracts/src/workspaces.js";
import {
  modelBudgetSchema,
  type ModelBudget,
} from "../../../packages/contracts/src/model-budget.js";
import { WorkBudget } from "./work-budget.js";

export function RoutineSettings({
  locale,
  request,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh";
  const [items, setItems] = useState<Routine[]>([]),
    [models, setModels] = useState<PublicModel[]>([]),
    [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [editing, setEditing] = useState<Routine>(),
    [name, setName] = useState(""),
    [prompt, setPrompt] = useState("");
  const [timezone, setTimezone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [kind, setKind] = useState<"cron" | "interval">("cron"),
    [schedule, setSchedule] = useState("0 9 * * 1-5");
  const [misfire, setMisfire] = useState<"skip" | "coalesce-one">("skip"),
    [enabled, setEnabled] = useState(false);
  const [modelId, setModelId] = useState(""),
    [workspaceId, setWorkspaceId] = useState(""),
    [workspaceRead, setWorkspaceRead] = useState(false),
    [budget, setBudget] = useState<ModelBudget | null>(
      modelBudgetSchema.parse({}),
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [history, setHistory] = useState<z.infer<typeof routineHistorySchema>>(),
    [historyId, setHistoryId] = useState("");
  const ids = useRef(new Map<string, string>()),
    newId = useRef(crypto.randomUUID());
  useEffect(() => {
    let active = true;
    void Promise.all([
      request("/routines"),
      request("/model-connections"),
      request("/workspaces"),
    ])
      .then(([routines, connections, roots]) => {
        if (!active) return;
        const value = z
          .object({
            routines: z.array(routineSchema),
            schedulerError: z.string().nullable(),
          })
          .parse(routines);
        setItems(value.routines);
        if (value.schedulerError) setError(value.schedulerError);
        setModels(
          z
            .object({ connections: z.array(publicModelSchema) })
            .parse(connections).connections,
        );
        setWorkspaces(
          z.object({ workspaces: z.array(workspaceSchema) }).parse(roots)
            .workspaces,
        );
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [request, refresh]);
  function edit(value?: Routine) {
    setEditing(value);
    setName(value?.config.name ?? "");
    setPrompt(value?.config.prompt ?? "");
    setTimezone(
      value?.config.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    setKind(value?.config.schedule.kind ?? "cron");
    setSchedule(
      value?.config.schedule.kind === "interval"
        ? String(value.config.schedule.seconds)
        : (value?.config.schedule.expression ?? "0 9 * * 1-5"),
    );
    setMisfire(value?.config.misfirePolicy ?? "skip");
    setEnabled(value?.config.enabled ?? false);
    setModelId(value?.config.modelSelection.connectionId ?? "");
    setWorkspaceId(value?.config.workspaceId ?? "");
    setWorkspaceRead(value?.config.workspaceRead ?? false);
    setBudget(value?.config.modelBudget ?? modelBudgetSchema.parse({}));
    setHistory(undefined);
    newId.current = crypto.randomUUID();
  }
  async function save(config: Routine["config"], current = editing) {
    const body = {
        id: current?.id ?? newId.current,
        expectedRevision: current?.revision ?? 0,
        config,
      },
      key = JSON.stringify(body),
      requestId = ids.current.get(key) ?? crypto.randomUUID();
    ids.current.set(key, requestId);
    setBusy(true);
    setError("");
    try {
      const value = routineSchema.parse(
        await request("/routines", { ...body, requestId }),
      );
      ids.current.delete(key);
      setItems((old) => [value, ...old.filter((item) => item.id !== value.id)]);
      if (!current || current.id === editing?.id) edit(value);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function historyFor(id: string, before?: string) {
    setBusy(true);
    try {
      const page = routineHistorySchema.parse(
        await request(
          `/routines/${id}/occurrences${before ? `?before=${encodeURIComponent(before)}` : ""}`,
        ),
      );
      setHistory((old) =>
        before && historyId === id
          ? {
              ...page,
              occurrences: [...(old?.occurrences ?? []), ...page.occurrences],
            }
          : page,
      );
      setHistoryId(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="model-settings">
      <h2>{zh ? "持續工作與排程" : "Routines"}</h2>
      <p>
        {zh
          ? "daemon 在線時才執行；睡眠或關機期間不會執行。每次排程建立獨立背景 Work，模型可能計費，外部操作仍需核准。"
          : "Runs only while the daemon is online, not during sleep or shutdown. Each occurrence creates an independent background Work, may incur model costs, and retains external-action approvals."}
      </p>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={() => edit()}>
        {zh ? "新排程" : "New routine"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setRefresh((value) => value + 1)}
      >
        {zh ? "重新載入" : "Refresh"}
      </button>
      <form
        className="settings-fields"
        onSubmit={(event) => {
          event.preventDefault();
          const model = models.find((item) => item.id === modelId),
            workspace = workspaces.find((item) => item.id === workspaceId);
          try {
            if (!model || !budget)
              throw new Error(
                zh
                  ? "請選擇模型並設定有效預算"
                  : "Choose a model and valid budget",
              );
            void save(
              routineConfigSchema.parse({
                name,
                prompt,
                timezone,
                schedule:
                  kind === "cron"
                    ? { kind, expression: schedule }
                    : { kind, seconds: Number(schedule) },
                misfirePolicy: misfire,
                enabled,
                modelSelection: {
                  connectionId: model.id,
                  revision: model.revision,
                },
                modelBudget: budget,
                ...(workspace
                  ? {
                      workspaceId: workspace.id,
                      workspaceRevision: workspace.revision,
                      workspaceRead,
                    }
                  : {}),
              }),
            );
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <label>
          {zh ? "排程名稱" : "Routine name"}
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {zh ? "工作指令" : "Work prompt"}
          <textarea
            required
            value={prompt}
            maxLength={8000}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <label>
          {zh ? "IANA 時區" : "IANA timezone"}
          <input
            required
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </label>
        <label>
          {zh ? "排程種類" : "Schedule type"}
          <select
            value={kind}
            onChange={(event) => {
              const value = event.target.value as "cron" | "interval";
              setKind(value);
              setSchedule(value === "cron" ? "0 9 * * 1-5" : "3600");
            }}
          >
            <option value="cron">Cron</option>
            <option value="interval">Interval</option>
          </select>
        </label>
        <label>
          {kind === "cron"
            ? zh
              ? "Cron（分 時 日 月 星期）"
              : "Cron (minute hour day month weekday)"
            : zh
              ? "間隔秒數，至少 60"
              : "Interval seconds, at least 60"}
          <input
            required
            value={schedule}
            onChange={(event) => setSchedule(event.target.value)}
          />
        </label>
        <label>
          {zh ? "錯過執行時" : "Missed executions"}
          <select
            value={misfire}
            onChange={(event) =>
              setMisfire(event.target.value as typeof misfire)
            }
          >
            <option value="skip">{zh ? "跳過" : "Skip"}</option>
            <option value="coalesce-one">
              {zh ? "最多補跑一次" : "Coalesce one"}
            </option>
          </select>
        </label>
        <label>
          {zh ? "模型" : "Model"}
          <select
            required
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
          >
            <option value="">—</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.config.name} · r{model.revision}
              </option>
            ))}
          </select>
        </label>
        <label>
          {zh ? "工作區" : "Workspace"}
          <select
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            <option value="">{zh ? "無" : "None"}</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        {workspaceId && (
          <label>
            <input
              type="checkbox"
              checked={workspaceRead}
              onChange={(event) => setWorkspaceRead(event.target.checked)}
            />
            {zh ? "允許讀取該工作區" : "Allow workspace reads"}
          </label>
        )}
        <WorkBudget
          key={`${editing?.id ?? "new"}:${editing?.revision ?? 0}`}
          locale={locale}
          initialBudget={editing?.config.modelBudget}
          onChange={setBudget}
        />
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          {zh
            ? "啟用並允許以上模型排程呼叫"
            : "Enable and authorize scheduled calls to this model"}
        </label>
        <button disabled={busy || !budget}>
          {zh ? "保存排程" : "Save routine"}
        </button>
      </form>
      {items.map((item) => (
        <article key={item.id}>
          <strong>{item.config.name}</strong>
          <p>
            {item.config.enabled
              ? zh
                ? "已啟用"
                : "Enabled"
              : zh
                ? "已暫停"
                : "Paused"}{" "}
            · {item.config.timezone} · {item.nextAt}
          </p>
          {item.error && <p role="status">{item.error}</p>}
          <button disabled={busy} onClick={() => edit(item)}>
            {zh ? "編輯" : "Edit"}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void save({ ...item.config, enabled: !item.config.enabled }, item)
            }
          >
            {item.config.enabled
              ? zh
                ? "暫停"
                : "Pause"
              : zh
                ? "啟用"
                : "Enable"}
          </button>
          <button disabled={busy} onClick={() => void historyFor(item.id)}>
            {zh ? "執行紀錄" : "Occurrences"}
          </button>
        </article>
      ))}
      {history && (
        <section>
          <h3>{zh ? "排程執行紀錄" : "Scheduled occurrences"}</h3>
          <ul>
            {history.occurrences.map((occurrence) => (
              <li key={occurrence.id}>
                <time dateTime={occurrence.scheduledAt}>
                  {occurrence.scheduledAt}
                </time>{" "}
                · {occurrence.status}
                {occurrence.workId && (
                  <span> · Work {occurrence.workId.slice(0, 8)}</span>
                )}
                {occurrence.error && <p>{occurrence.error}</p>}
              </li>
            ))}
          </ul>
          {history.nextBefore && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void historyFor(historyId, history.nextBefore!)}
            >
              {zh ? "較早紀錄" : "Earlier occurrences"}
            </button>
          )}
        </section>
      )}
    </section>
  );
}
