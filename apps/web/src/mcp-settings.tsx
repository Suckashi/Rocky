import { useEffect, useRef, useState } from "react";
import {
  mcpConfigSchema,
  mcpConfigSnapshotSchema,
  type McpConfig,
} from "../../../packages/contracts/src/mcp-config.js";
import { z } from "zod";
import {
  mcpStateSchema,
  type McpState,
} from "../../../packages/contracts/src/mcp-runtime.js";
export function McpSettings({
  locale,
  request,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [revision, setRevision] = useState<number | null>(null),
    [config, setConfig] = useState<McpConfig | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const [states, setStates] = useState<McpState[]>([]),
    [connecting, setConnecting] = useState<string | null>(null);
  const lifecycleAttempts = useRef(new Map<string, string>());
  const readStates = () =>
    request("/mcp-servers").then((value) =>
      setStates(
        z.strictObject({ servers: z.array(mcpStateSchema) }).parse(value)
          .servers,
      ),
    );
  const attempt = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void request("/mcp-config")
      .then((value) => {
        const snapshot = mcpConfigSnapshotSchema.parse(value);
        if (live) {
          setRevision(snapshot.revision);
          setConfig(snapshot.config);
          setText(JSON.stringify(snapshot.config, null, 2));
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    void request("/mcp-servers")
      .then((value) => {
        const parsed = z
          .strictObject({ servers: z.array(mcpStateSchema) })
          .parse(value);
        if (live) setStates(parsed.servers);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [open, request]);
  return (
    <details
      className="model-settings mcp-settings"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {locale === "zh" ? "MCP 伺服器設定" : "MCP server settings"}
      </summary>
      <p>
        {locale === "zh"
          ? "只使用自行配置的 MCP。保存不會啟動程序或連線。就緒表示協定連線與工具探索完成，不代表工作成功。正式模型可按需探索工具；每次外部呼叫都需精確核准。"
          : "Saving does not start configured MCP servers. Ready means protocol connection and tool discovery, not Work success. Configured models can discover tools on demand; each external call requires exact approval."}
      </p>
      {open && (
        <>
          {config && (
            <section
              aria-label={
                locale === "zh" ? "MCP 設定狀態" : "MCP configuration status"
              }
            >
              {Object.entries(config.mcpServers).length === 0 ? (
                <p>
                  {locale === "zh"
                    ? "尚未配置 MCP 伺服器。"
                    : "No MCP servers configured."}
                </p>
              ) : (
                Object.entries(config.mcpServers).map(([id, server]) => (
                  <div className="model-card" key={id}>
                    <p>
                      {id} ·{" "}
                      {states.find((s) => s.serverId === id)?.status === "ready"
                        ? locale === "zh"
                          ? "連線就緒"
                          : "Connection ready"
                        : states.find((s) => s.serverId === id)?.status ===
                            "failed"
                          ? locale === "zh"
                            ? "連線失敗"
                            : "Connection failed"
                          : server.enabled
                            ? locale === "zh"
                              ? "已配置，尚未連線"
                              : "Configured; not connected"
                            : locale === "zh"
                              ? "已停用"
                              : "Disabled"}
                    </p>
                    {states.find((s) => s.serverId === id)?.status ===
                      "ready" && (
                      <p>
                        {locale === "zh" ? "已探索工具" : "Discovered tools"} ·{" "}
                        {states.find((s) => s.serverId === id)?.toolsCount}
                      </p>
                    )}
                    {states.find((s) => s.serverId === id) && (
                      <small>
                        {locale === "zh" ? "最後確認" : "Last confirmed"}:{" "}
                        {states.find((s) => s.serverId === id)?.updatedAt}
                      </small>
                    )}
                    {connecting === id && (
                      <p role="status">
                        {locale === "zh"
                          ? "正在等待連線結果…"
                          : "Waiting for connection result…"}
                      </p>
                    )}
                    <div className="actions">
                      <button
                        disabled={
                          !server.enabled ||
                          revision === null ||
                          connecting !== null ||
                          states.find((s) => s.serverId === id)?.status ===
                            "ready"
                        }
                        onClick={() => {
                          const key = `${id}:${revision}:connect`;
                          let requestId = lifecycleAttempts.current.get(key);
                          if (!requestId) {
                            requestId = crypto.randomUUID();
                            lifecycleAttempts.current.set(key, requestId);
                          }
                          setConnecting(id);
                          setSaved(false);
                          setError("");
                          void request(`/mcp-servers/${id}/connect`, {
                            requestId,
                            expectedRevision: revision,
                          })
                            .then((value) => {
                              const result = mcpStateSchema.parse(value);
                              setStates((old) => [
                                ...old.filter((s) => s.serverId !== id),
                                result,
                              ]);
                              lifecycleAttempts.current.delete(key);
                            })
                            .catch((e) => setError(String(e)))
                            .finally(() => setConnecting(null));
                        }}
                      >
                        {locale === "zh"
                          ? "連線並探索"
                          : "Connect and discover"}
                      </button>
                      <button
                        disabled={
                          !server.enabled ||
                          revision === null ||
                          (!connecting &&
                            states.find((s) => s.serverId === id)?.status !==
                              "ready")
                        }
                        onClick={() => {
                          void request(`/mcp-servers/${id}/stop`, {
                            requestId: crypto.randomUUID(),
                            expectedRevision: revision,
                          })
                            .then(() => readStates())
                            .catch((e) => setError(String(e)));
                        }}
                      >
                        {locale === "zh" ? "停止連線" : "Stop connection"}
                      </button>
                    </div>
                    {states.find((s) => s.serverId === id)?.error && (
                      <p role="status">
                        {states.find((s) => s.serverId === id)?.error}
                      </p>
                    )}
                    <details>
                      <summary>
                        {locale === "zh"
                          ? "連線診斷"
                          : "Connection diagnostics"}
                      </summary>
                      <pre>
                        {states
                          .find((s) => s.serverId === id)
                          ?.diagnostics.join("") ||
                          (locale === "zh" ? "沒有診斷輸出" : "No diagnostics")}
                      </pre>
                    </details>
                  </div>
                ))
              )}
              <button
                onClick={() =>
                  void readStates().catch((e) => setError(String(e)))
                }
              >
                {locale === "zh" ? "更新連線狀態" : "Refresh connection status"}
              </button>
            </section>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              setSaved(false);
              try {
                const parsed = mcpConfigSchema.parse(JSON.parse(text));
                const body = { expectedRevision: revision, config: parsed },
                  key = JSON.stringify(body);
                if (attempt.current?.key !== key)
                  attempt.current = { key, id: crypto.randomUUID() };
                setBusy(true);
                void request("/mcp-config", {
                  ...body,
                  requestId: attempt.current.id,
                })
                  .then((value) => {
                    const snapshot = mcpConfigSnapshotSchema.parse(value);
                    setConfig(snapshot.config);
                    setRevision(snapshot.revision);
                    setText(JSON.stringify(snapshot.config, null, 2));
                    setSaved(true);
                    void readStates().catch((e) => setError(String(e)));
                  })
                  .catch((e) => setError(String(e)))
                  .finally(() => setBusy(false));
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <label htmlFor="mcp-config-json">
              {locale === "zh"
                ? "Rocky MCP 設定 JSON"
                : "Rocky MCP configuration JSON"}
            </label>
            <textarea
              id="mcp-config-json"
              rows={12}
              spellCheck={false}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSaved(false);
              }}
              disabled={busy || revision === null}
            />
            <p>
              {locale === "zh"
                ? "憑證只填環境變數 reference；相對路徑以 Rocky 的 connections/mcp 設定目錄為基準。"
                : "Use environment references for credentials; relative paths are based on Rocky connections/mcp configuration directory."}
            </p>
            <button type="submit" disabled={busy || revision === null}>
              {locale === "zh" ? "保存 MCP 設定" : "Save MCP settings"}
            </button>
          </form>
          {saved && (
            <p role="status">
              {locale === "zh"
                ? "MCP 設定已保存，尚未連線。"
                : "MCP settings saved; not connected."}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </details>
  );
}
