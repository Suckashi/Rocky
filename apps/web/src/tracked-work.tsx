import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { Work } from "../../../packages/contracts/src/index.js";
import {
  mcpStateSchema,
  type McpState,
} from "../../../packages/contracts/src/mcp-runtime.js";
import {
  trackedWorkSchema,
  trackingConfigSchema,
  type TrackedWork,
} from "../../../packages/contracts/src/tracking.js";
type Tool = { name: string; inputSchema: Record<string, unknown> };
export function TrackingSettings({
  locale,
  works,
  request,
}: {
  locale: "zh" | "en";
  works: Work[];
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh";
  const [items, setItems] = useState<TrackedWork[]>([]),
    [servers, setServers] = useState<McpState[]>([]),
    [tools, setTools] = useState<Tool[]>([]),
    [nextOffset, setNextOffset] = useState<number | null>(null);
  const [editing, setEditing] = useState<TrackedWork>(),
    [workId, setWorkId] = useState(""),
    [name, setName] = useState(""),
    [serverId, setServerId] = useState(""),
    [toolName, setToolName] = useState(""),
    [args, setArgs] = useState("{}");
  const [statusPath, setStatusPath] = useState("status"),
    [statuses, setStatuses] = useState("failed"),
    [instruction, setInstruction] = useState(""),
    [poll, setPoll] = useState("300"),
    [cooldown, setCooldown] = useState("900"),
    [maxPolls, setMaxPolls] = useState("100"),
    [maxFollowups, setMaxFollowups] = useState("3"),
    [enabled, setEnabled] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const ids = useRef(new Map<string, string>()),
    newId = useRef(crypto.randomUUID());
  useEffect(() => {
    let active = true;
    void Promise.all([request("/tracking"), request("/mcp-servers")])
      .then(([tracking, states]) => {
        if (!active) return;
        const value = z
          .object({
            tracking: z.array(trackedWorkSchema),
            schedulerError: z.string().nullable(),
          })
          .parse(tracking);
        setItems(value.tracking);
        setServers(
          z.object({ servers: z.array(mcpStateSchema) }).parse(states).servers,
        );
        if (value.schedulerError) setError(value.schedulerError);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [request, refresh]);
  const server = servers.find((entry) => entry.serverId === serverId);
  useEffect(() => {
    setTools([]);
    setNextOffset(null);
  }, [serverId, server?.registryRevision]);
  async function loadTools(offset = 0) {
    if (!server || server.status !== "ready") return;
    setBusy(true);
    setError("");
    try {
      const value = z
        .object({
          tools: z.array(
            z.object({
              name: z.string(),
              inputSchema: z.record(z.string(), z.unknown()),
            }),
          ),
          nextOffset: z.number().nullable(),
        })
        .parse(
          await request(
            `/mcp-servers/${server.serverId}/tools?revision=${server.registryRevision}&offset=${offset}`,
          ),
        );
      setTools((old) => (offset ? [...old, ...value.tools] : value.tools));
      setNextOffset(value.nextOffset);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function edit(item?: TrackedWork) {
    setEditing(item);
    setWorkId(item?.workId ?? "");
    setName(item?.config.name ?? "");
    setServerId(item?.config.mapping.serverId ?? "");
    setToolName(item?.config.mapping.toolName ?? "");
    setArgs(JSON.stringify(item?.config.mapping.arguments ?? {}, null, 2));
    setStatusPath(item?.config.statusPath.join("\n") ?? "status");
    setStatuses(item?.config.followupStatuses.join("\n") ?? "failed");
    setInstruction(item?.config.followupInstruction ?? "");
    setPoll(String(item?.config.pollSeconds ?? 300));
    setCooldown(String(item?.config.cooldownSeconds ?? 900));
    setMaxPolls(String(item?.config.maxPolls ?? 100));
    setMaxFollowups(String(item?.config.maxFollowups ?? 3));
    setEnabled(item?.config.enabled ?? false);
    setConfirmed(false);
    newId.current = crypto.randomUUID();
  }
  async function save(config: TrackedWork["config"], current = editing) {
    const body = {
        id: current?.id ?? newId.current,
        expectedRevision: current?.revision ?? 0,
        workId: current?.workId ?? workId,
        config,
      },
      key = JSON.stringify(body),
      requestId = ids.current.get(key) ?? crypto.randomUUID();
    ids.current.set(key, requestId);
    setBusy(true);
    setError("");
    try {
      const value = trackedWorkSchema.parse(
        await request("/tracking", { ...body, requestId }),
      );
      ids.current.delete(key);
      setItems((old) => [value, ...old.filter((item) => item.id !== value.id)]);
      if (!current || editing?.id === current.id) edit(value);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="model-settings">
      <h2>{zh ? "工作／PR／CI 追蹤" : "Work / PR / CI tracking"}</h2>
      <p>
        {zh
          ? "只透過你配置的 MCP 查詢；工具提示不等於唯讀保證。追蹤包含背景 Work；後續工作沿用來源模型與工作區範圍，仍需原有核准，不會自動 merge 或部署。"
          : "Queries only your configured MCP server. Tool hints do not prove read-only behavior. Background Works are included; follow-ups retain source model/workspace scope and approvals, without automatic merge or deployment."}
      </p>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={() => edit()}>
        {zh ? "新增追蹤" : "New tracking"}
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
          try {
            if (!confirmed || !server)
              throw new Error(
                zh
                  ? "請選擇伺服器並確認精確唯讀範圍"
                  : "Choose a server and confirm the exact read-only scope",
              );
            void save(
              trackingConfigSchema.parse({
                name,
                mapping: {
                  serverId,
                  registryRevision: server.registryRevision,
                  toolName,
                  arguments: JSON.parse(args),
                },
                statusPath: statusPath.split(/\r?\n/).filter(Boolean),
                followupStatuses: statuses.split(/\r?\n/).filter(Boolean),
                followupInstruction: instruction,
                pollSeconds: Number(poll),
                cooldownSeconds: Number(cooldown),
                maxPolls: Number(maxPolls),
                maxFollowups: Number(maxFollowups),
                enabled,
                confirmReadOnly: true,
              }),
            );
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <label>
          {zh ? "來源 Work" : "Source Work"}
          <select
            value={workId}
            required
            disabled={!!editing}
            onChange={(event) => setWorkId(event.target.value)}
          >
            <option value="">—</option>
            {works
              .filter(
                (work) =>
                  work.mode === "configured" && work.runMode === "normal",
              )
              .map((work) => (
                <option key={work.id} value={work.id}>
                  {work.kind ?? "main"} · {work.text.slice(0, 80)}
                </option>
              ))}
            {editing && !works.some((work) => work.id === editing.workId) && (
              <option value={editing.workId}>{editing.workId}</option>
            )}
          </select>
        </label>
        <label>
          {zh ? "追蹤名稱" : "Tracking name"}
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          MCP server
          <select
            required
            value={serverId}
            onChange={(event) => setServerId(event.target.value)}
          >
            <option value="">—</option>
            {servers.map((entry) => (
              <option key={entry.serverId} value={entry.serverId}>
                {entry.serverId} · {entry.status}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || server?.status !== "ready"}
          onClick={() => void loadTools()}
        >
          {zh ? "讀取工具清單" : "Load tools"}
        </button>
        <label>
          {zh ? "精確工具名稱" : "Exact tool name"}
          <input
            list="tracking-tools"
            required
            value={toolName}
            onChange={(event) => setToolName(event.target.value)}
          />
          <datalist id="tracking-tools">
            {tools.map((tool) => (
              <option key={tool.name} value={tool.name} />
            ))}
          </datalist>
        </label>
        {nextOffset !== null && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void loadTools(nextOffset)}
          >
            {zh ? "更多工具" : "More tools"}
          </button>
        )}
        {tools.find((tool) => tool.name === toolName) && (
          <details>
            <summary>{zh ? "工具輸入格式" : "Tool input schema"}</summary>
            <pre>
              {JSON.stringify(
                tools.find((tool) => tool.name === toolName)!.inputSchema,
                null,
                2,
              )}
            </pre>
          </details>
        )}
        <label>
          {zh ? "固定查詢參數 JSON" : "Fixed query arguments JSON"}
          <textarea
            required
            value={args}
            onChange={(event) => setArgs(event.target.value)}
          />
        </label>
        <label>
          {zh
            ? "狀態欄位路徑（每行一層 key）"
            : "Status field path (one key per level)"}
          <textarea
            required
            value={statusPath}
            onChange={(event) => setStatusPath(event.target.value)}
          />
        </label>
        <label>
          {zh
            ? "觸發後續工作的狀態（每行一項）"
            : "Statuses that trigger follow-ups (one per line)"}
          <textarea
            value={statuses}
            onChange={(event) => setStatuses(event.target.value)}
          />
        </label>
        <label>
          {zh ? "後續工作指令" : "Follow-up instruction"}
          <textarea
            required
            maxLength={2000}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
        {(
          [
            [zh ? "查詢間隔秒數" : "Poll interval seconds", poll, setPoll],
            [
              zh ? "後續工作冷卻秒數" : "Follow-up cooldown seconds",
              cooldown,
              setCooldown,
            ],
            [zh ? "最多查詢次數" : "Maximum queries", maxPolls, setMaxPolls],
            [
              zh ? "最多後續工作數" : "Maximum follow-ups",
              maxFollowups,
              setMaxFollowups,
            ],
          ] as const
        ).map(([label, value, setter]) => (
          <label key={label}>
            {label}
            <input
              type="number"
              required
              min="0"
              value={value}
              onChange={(event) => setter(event.target.value)}
            />
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          {zh
            ? "我確認此精確工具與參數只讀取狀態，允許在上述次數範圍內查詢，以及符合條件的模型後續工作（可能計費）。"
            : "I confirm this exact tool and arguments only read status, and authorize bounded queries and qualifying model follow-ups (which may incur costs)."}
        </label>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          {zh ? "啟用" : "Enable"}
        </label>
        <button disabled={busy || !confirmed}>
          {zh ? "保存精確追蹤範圍" : "Save exact tracking scope"}
        </button>
      </form>
      {items.map((item) => (
        <article key={item.id}>
          <strong>
            {item.config.name} · {item.state}
          </strong>
          <p>
            {item.lastStatus ?? "—"} · {item.polls}/{item.config.maxPolls}{" "}
            {zh ? "查詢" : "queries"} · {item.followups}/
            {item.config.maxFollowups} {zh ? "後續工作" : "follow-ups"}
          </p>
          {item.error && <p role="status">{item.error}</p>}
          <button disabled={busy} onClick={() => edit(item)}>
            {zh ? "檢視／編輯" : "Review / edit"}
          </button>
          {item.config.enabled && (
            <button
              disabled={busy}
              onClick={() =>
                void save({ ...item.config, enabled: false }, item)
              }
            >
              {zh ? "停止追蹤" : "Stop tracking"}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
