import { useEffect, useState, type FormEvent } from "react";
import {
  modelConfigSchema,
  publicModelSchema,
  type ModelConfig,
  type PublicModel,
} from "../../../packages/contracts/src/models.js";
const initial = (): ModelConfig => ({
  name: "",
  provider: "openai-compatible",
  baseUrl: "",
  modelId: "",
  credentialRef: null,
  caRef: null,
  contextWindowTokens: null,
  maxOutputTokens: 128,
  visionEnabled: false,
  proxy: { mode: "direct" },
});
export function ModelSettings({
  locale,
  request,
  onSelect,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
  onSelect: (model: {
    connectionId: string;
    revision: number;
    name: string;
  }) => void;
}) {
  const zh = locale === "zh";
  const [models, setModels] = useState<PublicModel[]>([]),
    [config, setConfig] = useState(initial),
    [editing, setEditing] = useState<PublicModel | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function refresh() {
    const data = (await request("/model-connections")) as {
      connections: unknown[];
    };
    setModels(data.connections.map((c) => publicModelSchema.parse(c)));
  }
  useEffect(() => {
    let active = true;
    void request("/model-connections")
      .then((data) => {
        if (active)
          setModels(
            (data as { connections: unknown[] }).connections.map((c) =>
              publicModelSchema.parse(c),
            ),
          );
      })
      .catch(() => {
        if (active)
          setMessage(
            zh ? "無法讀取模型設定。" : "Could not load model settings.",
          );
      });
    return () => {
      active = false;
    };
  }, [request, zh]);
  const probing = models.some((model) => model.probe?.status === "running");
  useEffect(() => {
    if (!probing) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = (await request("/model-connections")) as {
          connections: unknown[];
        };
        if (active)
          setModels(data.connections.map((c) => publicModelSchema.parse(c)));
      } catch {
        /* Keep the last confirmed state; retry while a probe is pending. */
      }
      if (active) timer = setTimeout(() => void poll(), 1000);
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [probing, request]);
  function field<K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const parsed = modelConfigSchema.safeParse(config);
      if (!parsed.success)
        throw Error(
          zh
            ? "請檢查網址、環境變數名稱及 token 上限。"
            : "Check endpoint, environment variable names and token limits.",
        );
      await request("/model-connections", {
        requestId: crypto.randomUUID(),
        id: editing?.id ?? crypto.randomUUID(),
        expectedRevision: editing?.revision ?? 0,
        config: parsed.data,
      });
      setConfig(initial());
      setEditing(null);
      await refresh();
      setMessage(
        zh ? "已保存；尚未發送模型請求。" : "Saved; no model request was sent.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function probe(model: PublicModel) {
    setBusy(true);
    setMessage(zh ? "正在測試指定端點…" : "Testing the configured endpoint…");
    try {
      await request(`/model-connections/${model.id}/probe`, {
        requestId: crypto.randomUUID(),
        expectedRevision: model.revision,
      });
      await refresh();
      setMessage(zh ? "測試已結束，結果如下。" : "Probe ended. Results below.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  const status = (value: string) =>
    zh
      ? ({
          passed: "通過",
          failed: "失敗",
          not_run: "未執行",
          running: "測試中",
          completed: "測試完成",
          interrupted: "已中斷",
        }[value] ?? value)
      : value;
  return (
    <details className="model-settings">
      <summary>{zh ? "模型連線設定" : "Model connections"}</summary>
      <p>
        {zh
          ? "先保存，再由你啟動測試或選擇模型。測試最多發送 5 次 nonce 請求，每次輸出上限 128 tokens，可能產生供應商費用。使用模型前須設定 context，且大於輸出上限。"
          : "Save first, then explicitly test or select a model. A probe sends up to 5 nonce requests with at most 128 output tokens each and may incur provider charges. Model use requires a context window larger than its output limit."}
      </p>
      <form className="model-form" onSubmit={save}>
        <fieldset disabled={busy}>
          <legend>
            {editing
              ? zh
                ? "編輯連線"
                : "Edit connection"
              : zh
                ? "新增連線"
                : "Add connection"}
          </legend>
          <label>
            {zh ? "名稱" : "Name"}
            <input
              required
              maxLength={80}
              value={config.name}
              onChange={(e) => field("name", e.target.value)}
            />
          </label>
          <label>
            {zh ? "供應商格式" : "Provider format"}
            <select
              value={config.provider}
              onChange={(e) =>
                field("provider", e.target.value as ModelConfig["provider"])
              }
            >
              {[
                "openai-compatible",
                "openai",
                "anthropic",
                "ollama-compatible",
              ].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            {zh
              ? "API 基底網址（包含版本路徑）"
              : "API base URL (include version path)"}
            <input
              type="url"
              required
              placeholder="http://127.0.0.1:11434/v1"
              value={config.baseUrl}
              onChange={(e) => field("baseUrl", e.target.value)}
            />
          </label>
          <label>
            {zh ? "模型 ID" : "Model ID"}
            <input
              required
              maxLength={200}
              value={config.modelId}
              onChange={(e) => field("modelId", e.target.value)}
            />
          </label>
          <label>
            {zh
              ? "憑證環境變數名稱（不是金鑰）"
              : "Credential environment variable name (not the key)"}
            <input
              autoComplete="off"
              pattern="[A-Za-z_][A-Za-z0-9_]{0,127}"
              placeholder="ROCKY_MODEL_KEY"
              value={config.credentialRef ?? ""}
              onChange={(e) => field("credentialRef", e.target.value || null)}
            />
          </label>
          <label>
            {zh
              ? "Context tokens（留空表示未知）"
              : "Context tokens (blank means unknown)"}
            <input
              type="number"
              min="1"
              max="100000000"
              value={config.contextWindowTokens ?? ""}
              onChange={(e) =>
                field(
                  "contextWindowTokens",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            />
          </label>
          <label>
            {zh ? "最大輸出 tokens" : "Maximum output tokens"}
            <input
              type="number"
              required
              min="1"
              max="1000000"
              value={config.maxOutputTokens}
              onChange={(e) => field("maxOutputTokens", Number(e.target.value))}
            />
          </label>
          <label className="model-vision-toggle">
            <input
              type="checkbox"
              checked={config.visionEnabled}
              onChange={(e) => field("visionEnabled", e.target.checked)}
            />
            <span>
              {zh
                ? "啟用模型影像輸入（需自行確認模型支援；不代表已通過測試）"
                : "Enable model image input (confirm model support; not a passed probe)"}
            </span>
          </label>
          <details>
            <summary>{zh ? "代理與 CA" : "Proxy and CA"}</summary>
            <label>
              {zh ? "代理策略" : "Proxy policy"}
              <select
                value={config.proxy.mode}
                onChange={(e) =>
                  field(
                    "proxy",
                    e.target.value === "explicit"
                      ? { mode: "explicit", url: "" }
                      : { mode: e.target.value as "direct" | "environment" },
                  )
                }
              >
                <option value="direct">{zh ? "直接連線" : "Direct"}</option>
                <option value="environment">HTTP(S)_PROXY / NO_PROXY</option>
                <option value="explicit">
                  {zh ? "指定代理" : "Explicit proxy"}
                </option>
              </select>
            </label>
            {config.proxy.mode === "explicit" && (
              <label>
                {zh ? "代理網址" : "Proxy URL"}
                <input
                  required
                  type="url"
                  value={config.proxy.url}
                  onChange={(e) =>
                    field("proxy", { mode: "explicit", url: e.target.value })
                  }
                />
              </label>
            )}
            <label>
              {zh
                ? "CA 憑證環境變數名稱"
                : "CA certificate environment variable name"}
              <input
                autoComplete="off"
                pattern="[A-Za-z_][A-Za-z0-9_]{0,127}"
                value={config.caRef ?? ""}
                onChange={(e) => field("caRef", e.target.value || null)}
              />
            </label>
          </details>
          {editing && (
            <p>
              {zh
                ? "重新填寫需要的憑證與 CA 參照；留空會清除。保存後原測試結果失效。"
                : "Re-enter required credential and CA references; blanks clear them. Saving invalidates prior probe results."}
            </p>
          )}
          <div className="model-actions">
            <button type="submit">{zh ? "保存連線" : "Save connection"}</button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setConfig(initial());
                }}
              >
                {zh ? "取消編輯" : "Cancel edit"}
              </button>
            )}
          </div>
        </fieldset>
      </form>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {models.map((model) => (
        <article className="model-card" key={model.id}>
          <strong>{model.config.name}</strong>
          <p>
            {model.config.modelId} · {model.config.baseUrl}
          </p>
          <p>
            {zh ? "Context" : "Context"}:{" "}
            {model.config.contextWindowTokens ?? (zh ? "未知" : "Unknown")} ·{" "}
            {zh ? "憑證" : "Credential"}:{" "}
            {model.credential.available
              ? zh
                ? "daemon 可用"
                : "Available in daemon"
              : model.credential.configured
                ? zh
                  ? "環境變數不存在"
                  : "Environment variable missing"
                : zh
                  ? "未配置"
                  : "Not configured"}
          </p>
          <p>
            {zh ? "模型影像輸入" : "Model image input"}:{" "}
            {model.config.visionEnabled
              ? zh
                ? "啟用（支援未驗證）"
                : "Enabled (support unverified)"
              : zh
                ? "關閉"
                : "Off"}
          </p>
          {model.probe ? (
            <>
              <p>
                {status(model.probe.status)} · {model.probe.requests}/5{" "}
                {zh ? "請求" : "requests"}
              </p>
              <ul>
                {Object.entries(model.probe.checks).map(([name, result]) => (
                  <li key={name}>
                    {
                      {
                        text: zh ? "文字" : "Text",
                        tools: zh ? "工具往返" : "Tool roundtrip",
                        stream: zh ? "串流" : "Stream",
                        cancellation: zh ? "用戶端取消" : "Client cancellation",
                      }[name]
                    }
                    : {status(result)}
                  </li>
                ))}
              </ul>
              {model.probe.error && <p>{model.probe.error}</p>}
            </>
          ) : (
            <p>{zh ? "尚未測試此版本" : "This revision has not been tested"}</p>
          )}
          <div className="model-actions">
            <button
              disabled={
                busy ||
                model.config.contextWindowTokens === null ||
                model.config.contextWindowTokens <=
                  model.config.maxOutputTokens ||
                (model.credential.configured && !model.credential.available)
              }
              onClick={() =>
                onSelect({
                  connectionId: model.id,
                  revision: model.revision,
                  name: model.config.name,
                })
              }
            >
              {zh ? "使用此模型" : "Use this model"}
            </button>

            <button
              disabled={busy || model.probe?.status === "running"}
              onClick={() => void probe(model)}
            >
              {zh ? "測試連線" : "Test connection"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setEditing(model);
                setConfig({
                  ...model.config,
                  credentialRef: null,
                  caRef: null,
                });
              }}
            >
              {zh ? "編輯" : "Edit"}
            </button>
          </div>
        </article>
      ))}
    </details>
  );
}
