import { useEffect, useRef, useState } from "react";
import {
  mcpConfigSchema,
  mcpConfigSnapshotSchema,
  type McpConfig,
} from "../../../packages/contracts/src/mcp-config.js";
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
          ? "只使用自行配置的 MCP。保存不會啟動程序或連線，也不代表通過驗證；工具路由與連線管理尚未接上。"
          : "Use explicitly configured MCP servers. Saving does not start a process/connect or prove verification. Transport management and tool routing are not connected yet."}
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
                  <p key={id}>
                    {id} ·{" "}
                    {server.enabled
                      ? locale === "zh"
                        ? "已配置，尚未連線"
                        : "Configured; not connected"
                      : locale === "zh"
                        ? "已停用"
                        : "Disabled"}
                  </p>
                ))
              )}
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
