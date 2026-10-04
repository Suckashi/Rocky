import { useState } from "react";
import {
  modelBudgetSchema,
  type ModelBudget,
} from "../../../packages/contracts/src/model-budget.js";

export function WorkBudget({
  locale,
  onChange,
  initialBudget,
}: {
  locale: "zh" | "en";
  onChange: (value: ModelBudget | null) => void;
  initialBudget?: ModelBudget;
}) {
  const [fields, setFields] = useState(() => ({
    calls: String(initialBudget?.maxCalls ?? 48),
    tokens:
      initialBudget?.maxTokens == null ? "" : String(initialBudget.maxTokens),
    cost:
      initialBudget?.maxMicroUsd == null
        ? ""
        : String(initialBudget.maxMicroUsd / 1000000),
    input:
      initialBudget?.pricing == null
        ? ""
        : String(initialBudget.pricing.inputMicroUsdPerMillion / 1000000),
    output:
      initialBudget?.pricing == null
        ? ""
        : String(initialBudget.pricing.outputMicroUsdPerMillion / 1000000),
  }));
  const [invalid, setInvalid] = useState(false);
  const zh = locale === "zh";
  function update(key: keyof typeof fields, value: string) {
    const next = { ...fields, [key]: value };
    setFields(next);
    const hasPrice = next.input !== "" || next.output !== "";
    const parsed = modelBudgetSchema.safeParse({
      maxCalls: next.calls === "" ? NaN : Number(next.calls),
      maxTokens: next.tokens === "" ? null : Number(next.tokens),
      maxMicroUsd: next.cost === "" ? null : Number(next.cost) * 1000000,
      pricing: hasPrice
        ? {
            inputMicroUsdPerMillion:
              next.input === "" ? NaN : Number(next.input) * 1000000,
            outputMicroUsdPerMillion:
              next.output === "" ? NaN : Number(next.output) * 1000000,
          }
        : null,
    });
    setInvalid(!parsed.success);
    onChange(parsed.success ? parsed.data : null);
  }
  return (
    <details className="work-budget">
      <summary>
        {zh ? "工作預算" : "Work budget"} · {fields.calls || "—"}
      </summary>
      {(
        [
          ["calls", zh ? "模型呼叫上限" : "Maximum model calls"],
          [
            "tokens",
            zh ? "總 token 上限（選填）" : "Total token limit (optional)",
          ],
          [
            "cost",
            zh
              ? "估算費用上限 USD（選填）"
              : "Estimated cost limit USD (optional)",
          ],
          [
            "input",
            zh
              ? "可信輸入單價 USD／百萬 tokens"
              : "Trusted input price USD / million tokens",
          ],
          [
            "output",
            zh
              ? "可信輸出單價 USD／百萬 tokens"
              : "Trusted output price USD / million tokens",
          ],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min={key === "calls" ? "1" : "0"}
            step={key === "calls" || key === "tokens" ? "1" : "0.000001"}
            value={fields[key]}
            onChange={(event) => update(key, event.target.value)}
          />
        </label>
      ))}
      <p>
        {zh
          ? "主工作、子工作與摘要共用預算。每次請求先保留設定的整個 context 容量，再用真實用量結算；缺少用量會保留額度。未填可信單價時費用為 unknown；費用是估算，不是服務商帳單或支出保證。"
          : "Root, children and summaries share one budget. Each request reserves the configured context capacity, then settles reported usage; missing usage keeps the reservation. Without trusted prices cost is unknown. Estimates are not provider invoices or spending guarantees."}
      </p>
      {invalid && (
        <p role="alert">
          {zh
            ? "請填入有效上限；費用上限必須同時提供輸入與輸出單價。"
            : "Enter valid limits; a cost limit requires both input and output prices."}
        </p>
      )}
    </details>
  );
}
