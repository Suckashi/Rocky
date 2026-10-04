import { useEffect, useState } from "react";
import { z } from "zod";
import {
  environmentSchema,
  type ComputerEnvironment,
} from "../../../packages/contracts/src/environments.js";
export function EnvironmentSelection({
  workspaceId,
  workspaceRevision,
  value,
  onChange,
  locale,
  request,
}: {
  workspaceId?: string;
  workspaceRevision?: number;
  value: string;
  onChange: (id: string) => void;
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const [items, setItems] = useState<ComputerEnvironment[]>([]),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    onChange("");
  }, [workspaceId, workspaceRevision, onChange]);
  useEffect(() => {
    let active = true;
    void request("/environments")
      .then((response) => {
        if (active) {
          setItems(
            z
              .object({ environments: z.array(environmentSchema) })
              .parse(response).environments,
          );
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [request, refresh, workspaceId]);
  const zh = locale === "zh";
  return (
    <div>
      <label>
        {zh ? "工作執行環境" : "Work execution environment"}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">
            {zh ? "Native：本機 OS 權限" : "Native: local OS permissions"}
          </option>
          {items
            .filter(
              (item) =>
                item.config.workspaceId === workspaceId &&
                item.config.workspaceRevision === workspaceRevision,
            )
            .map((item) => (
              <option
                key={item.id}
                value={item.id}
                disabled={item.state !== "running"}
              >
                {item.id.slice(0, 8)} · {item.state}
              </option>
            ))}
        </select>
      </label>
      <button type="button" onClick={() => setRefresh((count) => count + 1)}>
        {zh ? "更新環境清單" : "Refresh environments"}
      </button>
      {error && <p role="alert">{error}</p>}
      {value && (
        <p>
          {zh
            ? "命令只在選定容器執行；不可用時不會退回 Native。"
            : "Commands use only the selected container; unavailability never falls back to Native."}
        </p>
      )}
    </div>
  );
}
