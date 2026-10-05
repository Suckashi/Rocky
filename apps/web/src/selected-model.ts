import { useCallback, useEffect, useState } from "react";
import {
  publicModelSchema,
  type PublicModel,
} from "../../../packages/contracts/src/models.js";

export type SelectedModel = {
  connectionId: string;
  revision: number;
  name: string;
};
const storageKey = "rocky.selectedModel";

export function isRunnable(model: PublicModel) {
  return (
    model.config.contextWindowTokens !== null &&
    model.config.contextWindowTokens > model.config.maxOutputTokens &&
    !(model.credential.configured && !model.credential.available)
  );
}
export function selectionOf(model: PublicModel): SelectedModel {
  return {
    connectionId: model.id,
    revision: model.revision,
    name: model.config.name,
  };
}
function stored(): Pick<SelectedModel, "connectionId"> | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return typeof value?.connectionId === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Model connections plus the viewer's selection, remembered across reloads.
 * A remembered selection is restored only while its connection is still runnable;
 * the daemon re-checks the exact revision on every run.
 */
export function useModelSelection(
  request: (path: string, body?: unknown) => Promise<unknown>,
) {
  const [models, setModels] = useState<PublicModel[] | null>(null);
  const [selected, setSelectedState] = useState<SelectedModel | null>(null);
  const setSelected = useCallback((model: SelectedModel | null) => {
    setSelectedState(model);
    try {
      if (model) localStorage.setItem(storageKey, JSON.stringify(model));
      else localStorage.removeItem(storageKey);
    } catch {
      /* Selection still works for this page without storage. */
    }
  }, []);
  const refresh = useCallback(async () => {
    const data = (await request("/model-connections")) as {
      connections: unknown[];
    };
    const list = data.connections.map((c) => publicModelSchema.parse(c));
    setModels(list);
    setSelectedState((current) => {
      const id = current?.connectionId ?? stored()?.connectionId;
      const match = list.find((model) => model.id === id);
      return match && isRunnable(match) ? selectionOf(match) : null;
    });
    return list;
  }, [request]);
  useEffect(() => {
    void refresh().catch(() => setModels([]));
  }, [refresh]);
  return { models, selected, setSelected, refresh };
}
