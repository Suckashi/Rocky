import { reflectionToolSchemas } from "../../../packages/contracts/src/reflection.js";
export function LearningDraft({
  kind,
  payload,
  locale,
}: {
  kind: string;
  payload: Record<string, unknown>;
  locale: "zh" | "en";
}) {
  const zh = locale === "zh";
  const create =
    kind === "propose_skill_create"
      ? reflectionToolSchemas.propose_skill_create.safeParse(payload)
      : undefined;
  const patch =
    kind === "propose_skill_patch"
      ? reflectionToolSchemas.propose_skill_patch.safeParse(payload)
      : undefined;
  const draft = create?.success
    ? create.data.candidate
    : patch?.success
      ? patch.data.changes
      : undefined;
  if (kind === "mark_no_learning") return null;
  if (!draft)
    return (
      <p role="alert">
        {zh
          ? "無法解析候選內容，請檢查原始資料。"
          : "Unable to read draft; inspect the source data."}
      </p>
    );
  return (
    <div className="learning-draft">
      <p>
        {patch?.success
          ? zh
            ? "既有技能的局部修改；未列出的欄位保持原樣。"
            : "Partial change to an existing skill; omitted fields are unchanged."
          : zh
            ? "新技能提案"
            : "New skill proposal"}
      </p>
      {draft.name && (
        <p>
          <strong>{draft.name}</strong>
        </p>
      )}
      {draft.description && (
        <p className="memory-content">{draft.description}</p>
      )}
      {draft.goal && (
        <p className="memory-content">
          <strong>{zh ? "目標" : "Goal"}</strong>
          <br />
          {draft.goal}
        </p>
      )}
      <details>
        <summary>
          {zh ? "閱讀步驟與適用條件" : "Read steps and applicability"}
        </summary>
        {(
          [
            ["preconditions", zh ? "適用前提" : "Preconditions"],
            ["triggers", zh ? "觸發條件" : "Triggers"],
            ["steps", zh ? "建議步驟" : "Proposed steps"],
            ["stopConditions", zh ? "停止條件" : "Stop conditions"],
            ["verification", zh ? "驗證方法" : "Verification"],
            [
              "requiredCapabilities",
              zh
                ? "所需能力（不代表授權）"
                : "Required capabilities (not authorization)",
            ],
            ["knownLimitations", zh ? "已知限制" : "Known limitations"],
          ] as const
        ).map(
          ([key, label]) =>
            draft[key] !== undefined && (
              <div key={key}>
                <strong>{label}</strong>
                {draft[key]!.length ? (
                  <ol>
                    {draft[key]!.map((line, index) => (
                      <li className="memory-content" key={index}>
                        {line}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>{zh ? "未列出" : "None listed"}</p>
                )}
              </div>
            ),
        )}
      </details>
      <details>
        <summary>
          {zh ? "來源與基準版本" : "Evidence and base revision"}
        </summary>
        {patch?.success && (
          <p className="memory-content">
            {zh ? "基準技能" : "Base skill"}:{" "}
            <code>{patch.data.base.skillId}</code>
            <br />
            {zh ? "版本" : "Revision"}: {patch.data.base.revision}
            <br />
            <code>{patch.data.base.contentHash}</code>
          </p>
        )}
        {draft.evidenceRefs?.map((id) => (
          <p key={id}>
            <code>{id}</code>
          </p>
        ))}
      </details>
    </div>
  );
}
