import { useState } from "react";
import {
  mcpConfigSchema,
  type McpConfig,
} from "../../../packages/contracts/src/mcp-config.js";

const blank = () => ({
  id: "",
  transport: "stdio",
  command: "",
  args: [] as string[],
  cwd: "",
  url: "",
  enabled: false,
  bearer: "",
  policy: "",
  proxy: "direct",
  proxyUrl: "",
  caRef: "",
  receipt: "",
  startup: "30000",
  timeout: "60000",
  allowlist: "PATH,SystemRoot,TEMP,TMP",
  refs: [] as [string, string][],
});

export function McpServerForm({
  text,
  disabled,
  locale,
  onChange,
}: {
  text: string;
  disabled: boolean;
  locale: "zh" | "en";
  onChange: (text: string) => void;
}) {
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState("");
  const [error, setError] = useState("");
  const zh = locale === "zh";
  let draft: McpConfig | null = null;
  try {
    draft = mcpConfigSchema.parse(JSON.parse(text));
  } catch {
    /* JSON editor owns invalid drafts. */
  }
  function field<K extends keyof ReturnType<typeof blank>>(
    key: K,
    value: ReturnType<typeof blank>[K],
  ) {
    setForm((old) => ({ ...old, [key]: value }));
  }
  function select(id: string) {
    setEditing(id);
    setError("");
    if (!id || !draft) {
      setForm(blank());
      return;
    }
    const server = draft.mcpServers[id]!,
      option = draft["x-rocky"].servers[id]!;
    setForm({
      ...blank(),
      id,
      transport: option.transport,
      enabled: server.enabled,
      receipt: option.receiptUriTemplate ?? "",
      startup: String(option.startupTimeoutMs),
      timeout: String(option.toolTimeoutMs),
      ...("command" in server && option.transport === "stdio"
        ? {
            command: server.command,
            args: server.args,
            cwd: server.cwd ?? "",
            allowlist: option.envAllowlist.join(","),
            refs: Object.entries(option.envRefs),
          }
        : "url" in server && option.transport === "streamable-http"
          ? {
              url: server.url,
              bearer: option.bearerTokenEnvVar ?? "",
              policy: option.networkPolicyId,
              proxy: option.proxy?.mode ?? "direct",
              proxyUrl:
                option.proxy?.mode === "explicit" ? option.proxy.url : "",
              caRef: option.caRef ?? "",
              refs: Object.entries(option.headerRefs),
            }
          : {}),
    });
  }
  function apply() {
    try {
      if (!draft)
        throw Error(
          zh ? "請先修正 JSON 草稿。" : "Correct the JSON draft first.",
        );
      if (!editing && draft.mcpServers[form.id])
        throw Error(
          zh
            ? "此 ID 已存在；請選擇編輯。"
            : "ID already exists; select it for editing.",
        );
      if (new Set(form.refs.map(([key]) => key)).size !== form.refs.length)
        throw Error(
          zh ? "Reference 名稱不可重複。" : "Reference names must be unique.",
        );
      const oldServer = draft.mcpServers[form.id],
        oldOption = draft["x-rocky"].servers[form.id];
      const same = oldOption?.transport === form.transport;
      const timeouts = {
        startupTimeoutMs: Number(form.startup),
        toolTimeoutMs: Number(form.timeout),
        receiptUriTemplate: form.receipt || undefined,
      };
      const server =
        form.transport === "stdio"
          ? {
              ...(same ? oldServer : {}),
              command: form.command,
              args: form.args,
              ...(form.cwd ? { cwd: form.cwd } : { cwd: undefined }),
              enabled: form.enabled,
            }
          : { url: form.url, enabled: form.enabled };
      const option =
        form.transport === "stdio"
          ? {
              ...(same ? oldOption : {}),
              transport: "stdio",
              ...timeouts,
              envAllowlist: form.allowlist
                .split(",")
                .map((name) => name.trim())
                .filter(Boolean),
              envRefs: Object.fromEntries(form.refs),
            }
          : {
              ...(same ? oldOption : {}),
              transport: "streamable-http",
              ...timeouts,
              networkPolicyId: form.policy,
              proxy:
                form.proxy === "explicit"
                  ? { mode: "explicit", url: form.proxyUrl }
                  : { mode: form.proxy },
              caRef: form.caRef || undefined,
              bearerTokenEnvVar: form.bearer || undefined,
              headerRefs: Object.fromEntries(form.refs),
            };
      const next = mcpConfigSchema.parse({
        ...draft,
        mcpServers: { ...draft.mcpServers, [form.id]: server },
        "x-rocky": {
          version: 1,
          servers: { ...draft["x-rocky"].servers, [form.id]: option },
        },
      });
      onChange(JSON.stringify(next, null, 2));
      setEditing(form.id);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <fieldset disabled={disabled} className="model-form">
      <legend>{zh ? "MCP 伺服器表單" : "MCP server form"}</legend>
      <label>
        {zh ? "新增或編輯" : "Add or edit"}
        <select
          value={editing}
          onChange={(event) => select(event.target.value)}
        >
          <option value="">{zh ? "新增伺服器" : "New server"}</option>
          {Object.keys(draft?.mcpServers ?? {}).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <label>
        ID
        <input
          value={form.id}
          disabled={!!editing}
          onChange={(event) => field("id", event.target.value)}
        />
      </label>
      <label>
        {zh ? "傳輸" : "Transport"}
        <select
          value={form.transport}
          onChange={(event) => {
            field("transport", event.target.value);
            field("refs", []);
          }}
        >
          <option value="stdio">stdio</option>
          <option value="streamable-http">Streamable HTTP</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(event) => field("enabled", event.target.checked)}
        />
        {zh ? "允許手動連線" : "Enable explicit connection"}
      </label>
      {form.transport === "stdio" ? (
        <>
          <label>
            {zh ? "執行程式" : "Executable"}
            <input
              value={form.command}
              onChange={(event) => field("command", event.target.value)}
            />
          </label>
          {form.args.map((argument, index) => (
            <div key={index}>
              <label>
                {zh ? `參數 ${index + 1}` : `Argument ${index + 1}`}
                <textarea
                  value={argument}
                  onChange={(event) =>
                    field(
                      "args",
                      form.args.map((value, at) =>
                        at === index ? event.target.value : value,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  field(
                    "args",
                    form.args.filter((_, at) => at !== index),
                  )
                }
              >
                {zh ? "移除參數" : "Remove argument"}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => field("args", [...form.args, ""])}
          >
            {zh ? "新增精確參數" : "Add literal argument"}
          </button>
          <label>
            {zh ? "工作目錄" : "Working directory"}
            <input
              value={form.cwd}
              onChange={(event) => field("cwd", event.target.value)}
            />
          </label>
          <label>
            {zh
              ? "環境變數允許清單（逗號分隔）"
              : "Environment allowlist (comma separated)"}
            <input
              value={form.allowlist}
              onChange={(event) => field("allowlist", event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            URL
            <input
              value={form.url}
              onChange={(event) => field("url", event.target.value)}
            />
          </label>
          <label>
            {zh ? "Network policy ID" : "Network policy ID"}
            <input
              value={form.policy}
              onChange={(event) => field("policy", event.target.value)}
            />
          </label>
          <label>
            {zh
              ? "Bearer 憑證環境變數 reference"
              : "Bearer credential environment reference"}
            <input
              value={form.bearer}
              onChange={(event) => field("bearer", event.target.value)}
            />
          </label>
          <label>
            {zh ? "代理設定" : "Proxy"}
            <select
              value={form.proxy}
              onChange={(event) => field("proxy", event.target.value)}
            >
              <option value="direct">{zh ? "直接連線" : "Direct"}</option>
              <option value="environment">
                {zh ? "使用 daemon 環境" : "Daemon environment"}
              </option>
              <option value="explicit">
                {zh ? "指定代理" : "Explicit proxy"}
              </option>
            </select>
          </label>
          {form.proxy === "explicit" && (
            <label>
              Proxy URL
              <input
                value={form.proxyUrl}
                onChange={(event) => field("proxyUrl", event.target.value)}
              />
            </label>
          )}
          <label>
            {zh ? "CA 環境變數 reference" : "CA environment reference"}
            <input
              value={form.caRef}
              onChange={(event) => field("caRef", event.target.value)}
            />
          </label>
          <p>
            {zh
              ? "只允許此確切 endpoint，拒絕 redirect。TLS 驗證維持啟用；HTTP CONNECT 代理上的遠端 DNS enforcement 尚未驗證。"
              : "Only this exact endpoint is allowed; redirects are refused. TLS verification stays enabled. Remote DNS enforcement through HTTP CONNECT proxies is unverified."}
          </p>
        </>
      )}
      <p>
        {zh
          ? "只填 daemon 環境變數名稱，不填憑證值。"
          : "Enter daemon environment variable names, never credential values."}
      </p>
      {form.refs.map(([name, reference], index) => (
        <div className="actions" key={index}>
          <input
            aria-label={
              zh ? `Reference ${index + 1} 名稱` : `Reference ${index + 1} name`
            }
            value={name}
            onChange={(event) =>
              field(
                "refs",
                form.refs.map((pair, at) =>
                  at === index ? [event.target.value, reference] : pair,
                ),
              )
            }
          />
          <input
            aria-label={
              zh
                ? `Reference ${index + 1} 環境變數`
                : `Reference ${index + 1} environment variable`
            }
            value={reference}
            onChange={(event) =>
              field(
                "refs",
                form.refs.map((pair, at) =>
                  at === index ? [name, event.target.value] : pair,
                ),
              )
            }
          />
          <button
            type="button"
            onClick={() =>
              field(
                "refs",
                form.refs.filter((_, at) => at !== index),
              )
            }
          >
            {zh ? "移除" : "Remove"}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => field("refs", [...form.refs, ["", ""]])}
      >
        {zh ? "新增憑證 reference" : "Add credential reference"}
      </button>
      <label>
        {zh ? "啟動逾時 ms" : "Startup timeout ms"}
        <input
          type="number"
          value={form.startup}
          onChange={(event) => field("startup", event.target.value)}
        />
      </label>
      <label>
        {zh ? "工具逾時 ms" : "Tool timeout ms"}
        <input
          type="number"
          value={form.timeout}
          onChange={(event) => field("timeout", event.target.value)}
        />
      </label>
      <label>
        {zh
          ? "唯讀收據 URI template（選填）"
          : "Read-only receipt URI template (optional)"}
        <input
          value={form.receipt}
          onChange={(event) => field("receipt", event.target.value)}
        />
      </label>
      <p>
        {zh
          ? "只為支援 Rocky operationId／intentHash 收據契約的可信 server 設定。使用 {operationId} 與 {intentHash}；對帳只讀取收據，不重送原工具。"
          : "Configure only for a trusted server supporting Rocky operationId/intentHash receipts. Use {operationId} and {intentHash}; reconciliation reads the receipt without replaying the tool."}
      </p>
      <button type="button" disabled={!draft} onClick={apply}>
        {zh ? "套用至草稿" : "Apply to draft"}
      </button>
      <p>
        {zh
          ? "套用後使用下方「保存 MCP 設定」。保存不會自動連線。"
          : "After applying, use Save MCP settings below. Saving does not connect."}
      </p>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
