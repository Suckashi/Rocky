import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  environmentSchema,
  type ComputerEnvironment,
} from "../../../packages/contracts/src/environments.js";
import {
  workspaceSchema,
  type Workspace,
} from "../../../packages/contracts/src/workspaces.js";

export function Environments({
  locale,
  request,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh";
  const [items, setItems] = useState<ComputerEnvironment[]>([]),
    [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState(""),
    [engine, setEngine] = useState(""),
    [image, setImage] = useState("");
  const [endpoint, setEndpoint] = useState("npipe:////./pipe/docker_engine");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const ids = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    void Promise.all([request("/environments"), request("/workspaces")])
      .then(([environments, roots]) => {
        if (!active) return;
        setItems(
          z
            .object({ environments: z.array(environmentSchema) })
            .parse(environments).environments,
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
  }, [request]);
  async function send(path: string, body: object) {
    const key = path + JSON.stringify(body),
      requestId = ids.current.get(key) ?? crypto.randomUUID();
    ids.current.set(key, requestId);
    setBusy(true);
    setError("");
    try {
      const value = environmentSchema.parse(
        await request(path, { ...body, requestId }),
      );
      setItems((old) => [value, ...old.filter((item) => item.id !== value.id)]);
      ids.current.delete(key);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const selected = workspaces.find((item) => item.id === workspaceId);
  const label = (state: string) =>
    ({
      configured: zh ? "已設定" : "Configured",
      starting: zh ? "啟動中" : "Starting",
      running: zh ? "執行中" : "Running",
      stopping: zh ? "停止中" : "Stopping",
      stopped: zh ? "已停止" : "Stopped",
      unavailable: zh ? "不可用" : "Unavailable",
      unknown: zh ? "待查證" : "Unknown",
    })[state];
  return (
    <details className="computer-setup">
      <summary>{zh ? "執行環境" : "Execution environments"}</summary>
      <p>
        {zh
          ? "Native 使用本機 OS 權限。容器為選配；缺少引擎時不會退回主機執行。Docker CLI adapter 尚待真實引擎相容性驗證。"
          : "Native uses local OS permissions. Containers are optional; unavailable engines never fall back to host execution. Docker CLI adapter compatibility awaits live engine verification."}
      </p>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (selected)
            void send("/environments", {
              config: {
                engineExecutable: engine,
                image,
                endpoint,
                workspaceId: selected.id,
                workspaceRevision: selected.revision,
              },
            });
        }}
      >
        <label>
          {zh ? "引擎執行檔完整路徑" : "Absolute engine executable"}
          <input
            required
            value={engine}
            disabled={busy}
            onChange={(event) => setEngine(event.target.value)}
          />
        </label>
        <label>
          {zh ? "本機引擎端點" : "Local engine endpoint"}
          <select
            value={endpoint}
            disabled={busy}
            onChange={(event) => setEndpoint(event.target.value)}
          >
            <option value="npipe:////./pipe/docker_engine">
              Windows named pipe
            </option>
            <option value="unix:///var/run/docker.sock">Unix socket</option>
          </select>
        </label>
        <label>
          {zh
            ? "已安裝 image 與 sha256 digest"
            : "Installed image with sha256 digest"}
          <input
            required
            value={image}
            disabled={busy}
            onChange={(event) => setImage(event.target.value)}
            placeholder="image@sha256:…"
          />
        </label>
        <label>
          {zh ? "唯一掛載的工作區" : "Only mounted workspace"}
          <select
            required
            value={workspaceId}
            disabled={busy}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            <option value="">{zh ? "選擇工作區" : "Choose workspace"}</option>
            {workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <p>
          {zh
            ? "啟動會以讀寫方式掛載此工作區，停用容器網路。不會下載 image 或刪除持久資料。"
            : "Starting mounts this workspace read/write and disables container networking. No image download or persistent-data deletion."}
        </p>
        <button disabled={busy || !selected || !engine || !image}>
          {zh ? "保存環境設定" : "Save environment configuration"}
        </button>
      </form>
      {items.map((item) => (
        <article key={item.id}>
          <strong>
            {item.id.slice(0, 8)} · {label(item.state)}
          </strong>
          <p>{item.config.image}</p>
          <p>
            {zh ? "網路限制" : "Network restriction"}:{" "}
            {item.networkEnforcement === "container_none"
              ? zh
                ? "已檢查容器 network=none；完整 egress 驗收待執行"
                : "Inspected container network=none; full egress verification pending"
              : zh
                ? "未驗證"
                : "Unverified"}
          </p>
          {item.error && <p role="status">{item.error}</p>}
          {(["start", "stop", "inspect"] as const).map((action) => (
            <button
              type="button"
              key={action}
              disabled={
                busy ||
                (action === "start" &&
                  ["unknown", "starting", "stopping"].includes(item.state))
              }
              onClick={() =>
                void send(`/environments/${item.id}/control`, {
                  expectedRevision: item.revision,
                  action,
                })
              }
            >
              {action === "start"
                ? zh
                  ? "啟動"
                  : "Start"
                : action === "stop"
                  ? zh
                    ? "停止"
                    : "Stop"
                  : zh
                    ? "查詢實際狀態"
                    : "Inspect actual state"}
            </button>
          ))}
        </article>
      ))}
    </details>
  );
}
