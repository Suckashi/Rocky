import { useEffect, useState } from "react";
import { z } from "zod";
import { learningAutomationSchema } from "../../../packages/contracts/src/learning.js";
import {
  publicModelSchema,
  type PublicModel,
} from "../../../packages/contracts/src/models.js";
import { WorkBudget } from "./work-budget.js";
import {
  modelBudgetSchema,
  type ModelBudget,
} from "../../../packages/contracts/src/model-budget.js";
type Configuration = z.infer<typeof learningAutomationSchema>;
const suiteSchema = z.object({
  id: z.uuid(),
  revision: z.number(),
  hash: z.string(),
  name: z.string(),
  cases: z.number(),
});
export function LearningAutomationConfig({
  initial,
  onChange,
  request,
  locale,
}: {
  initial?: Configuration | null;
  onChange: (value: Configuration | null) => void;
  request: (path: string, body?: unknown) => Promise<unknown>;
  locale: "zh" | "en";
}) {
  const zh = locale === "zh";
  const [models, setModels] = useState<PublicModel[]>([]),
    [suites, setSuites] = useState<z.infer<typeof suiteSchema>[]>([]),
    [model, setModel] = useState(initial?.modelSelection.connectionId ?? ""),
    [suiteId, setSuiteId] = useState(initial?.suiteId ?? ""),
    [target, setTarget] = useState(
      initial?.evaluationTarget.mode === "configured"
        ? initial.evaluationTarget.modelSelection.connectionId
        : "fixture",
    ),
    [daily, setDaily] = useState(initial?.maxEpisodesPerDay ?? 3),
    [budget, setBudget] = useState<ModelBudget | null>(
      initial?.reflectionBudget ??
        modelBudgetSchema.parse({ maxCalls: 12, maxTokens: 1000000 }),
    ),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      request("/model-connections"),
      request("/learning/suites"),
    ])
      .then(([a, b]) => {
        if (!cancelled) {
          setModels(
            z.object({ connections: z.array(publicModelSchema) }).parse(a)
              .connections,
          );
          setSuites(z.object({ suites: z.array(suiteSchema) }).parse(b).suites);
        }
      })
      .catch((error) => {
        if (!cancelled) setError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [request]);
  useEffect(() => {
    const selected = models.find((entry) => entry.id === model),
      suite = suites.find((entry) => entry.id === suiteId),
      evalModel = models.find((entry) => entry.id === target);
    const parsed =
      selected && suite && budget && (target === "fixture" || evalModel)
        ? learningAutomationSchema.safeParse({
            modelSelection: {
              connectionId: selected.id,
              revision: selected.revision,
            },
            reflectionBudget: budget,
            suiteId: suite.id,
            suiteRevision: suite.revision,
            suiteHash: suite.hash,
            evaluationTarget: evalModel
              ? {
                  mode: "configured",
                  modelSelection: {
                    connectionId: evalModel.id,
                    revision: evalModel.revision,
                  },
                }
              : { mode: "fixture" },
            maxEpisodesPerDay: daily,
          })
        : null;
    onChange(parsed?.success ? parsed.data : null);
  }, [models, model, suites, suiteId, target, daily, budget, onChange]);
  return (
    <fieldset>
      <legend>
        {zh ? "自動反思與評測" : "Automatic reflection and evaluation"}
      </legend>
      <label>
        {zh ? "反思模型" : "Reflection model"}
        <select
          aria-label={zh ? "反思模型" : "Reflection model"}
          value={model}
          onChange={(event) => setModel(event.target.value)}
        >
          <option value="">{zh ? "選擇模型" : "Select model"}</option>
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.config.name} · r{item.revision}
            </option>
          ))}
        </select>
      </label>
      <WorkBudget
        locale={locale}
        initialBudget={
          initial?.reflectionBudget ??
          modelBudgetSchema.parse({ maxCalls: 12, maxTokens: 1000000 })
        }
        onChange={setBudget}
      />
      {budget && budget.maxCalls > 12 && (
        <p role="alert">
          {zh
            ? "反思最多 12 次模型呼叫。"
            : "Reflection allows at most 12 model calls."}
        </p>
      )}
      <label>
        {zh ? "每日 episode 上限" : "Daily episode limit"}
        <input
          type="number"
          min={1}
          max={20}
          value={daily}
          onChange={(event) => setDaily(Number(event.target.value))}
        />
      </label>
      <label>
        {zh ? "固定評測集" : "Fixed suite"}
        <select
          aria-label={zh ? "固定評測集" : "Fixed suite"}
          value={suiteId}
          onChange={(event) => setSuiteId(event.target.value)}
        >
          <option value="">
            {zh ? "先在收件匣匯入評測集" : "Import a suite in the Inbox first"}
          </option>
          {suites.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · r{item.revision} · {item.cases}
            </option>
          ))}
        </select>
      </label>
      <label>
        {zh ? "評測模型" : "Evaluation model"}
        <select
          aria-label={zh ? "評測模型" : "Evaluation model"}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="fixture">
            {zh
              ? "合成 fixture（不可發布）"
              : "Synthetic fixture (cannot publish)"}
          </option>
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.config.name} · r{item.revision}
            </option>
          ))}
        </select>
      </label>
      <p>
        {zh
          ? "開啟 propose 會授權以上模型對合格且允許重用的工作，自動執行反思與評測；可能產生模型費用，沒有可信單價時費用為 unknown。技能仍須逐版人工核准。"
          : "Enabling propose authorizes these models to reflect and evaluate eligible reusable Works automatically. Model charges may apply; cost is unknown without trusted pricing. Every skill revision still needs human approval."}
      </p>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
