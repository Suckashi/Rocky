import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";

export function SkillImport({
  locale,
  request,
  onImported,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
  onImported: () => void;
}) {
  const zh = locale === "zh";
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>(
      [],
    ),
    [scope, setScope] = useState("user"),
    [source, setSource] = useState(""),
    [license, setLicense] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const alive = useRef(true),
    picker = useRef<HTMLInputElement>(null);
  const intent = useRef<
    { key: string; requestId: string; id: string } | undefined
  >(undefined);
  useEffect(() => {
    alive.current = true;
    void request("/workspaces")
      .then((value) => {
        if (alive.current)
          setWorkspaces(
            z
              .object({
                workspaces: z.array(
                  z.object({ id: z.uuid(), name: z.string() }),
                ),
              })
              .parse(value).workspaces,
          );
      })
      .catch((e) => {
        if (alive.current) setError(String(e));
      });
    return () => {
      alive.current = false;
    };
  }, [request]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!files.length) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      if (
        files.length > 128 ||
        files.reduce((n, file) => n + file.size, 0) > 4194304 ||
        files.some((file) => file.size > 1048576)
      )
        throw Error(
          zh
            ? "套件最多 128 個檔案、總計 4 MiB，每檔最多 1 MiB。"
            : "Package limit:128 files,4 MiB total,1 MiB per file.",
        );
      const directoryName = files[0]!.webkitRelativePath.split("/")[0]!;
      if (
        !directoryName ||
        files.some(
          (file) => !file.webkitRelativePath.startsWith(directoryName + "/"),
        )
      )
        throw Error(
          zh ? "請選取單一技能資料夾。" : "Select one skill directory.",
        );
      const snapshot = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        snapshot.push({
          path: file.webkitRelativePath.slice(directoryName.length + 1),
          contentBase64: btoa(binary),
        });
      }
      const body = {
        expectedRevision: 0,
        scope:
          scope === "user"
            ? { kind: "user" }
            : { kind: "project", projectId: scope },
        source: {
          type: "manual",
          reference: source.trim(),
          license: license.trim(),
        },
        package: { directoryName, files: snapshot },
      };
      const key = JSON.stringify(body);
      if (intent.current?.key !== key)
        intent.current = {
          key,
          requestId: crypto.randomUUID(),
          id: crypto.randomUUID(),
        };
      await request("/skills/import", {
        ...body,
        requestId: intent.current.requestId,
        id: intent.current.id,
      });
      if (alive.current) {
        setSaved(true);
        setFiles([]);
        setSource("");
        setLicense("");
        intent.current = undefined;
        if (picker.current) picker.current.value = "";
        onImported();
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details className="skill-import">
      <summary>{zh ? "匯入技能資料夾" : "Import skill folder"}</summary>
      <form className="model-card" onSubmit={submit}>
        <fieldset disabled={busy}>
          <p>
            {zh
              ? "選取包含 SKILL.md 的資料夾。所有檔案會保存為本地未信任快照；不會執行其中的腳本。"
              : "Select a folder containing SKILL.md. Files are saved locally as an untrusted snapshot; scripts are not executed."}
          </p>
          <label>
            {zh ? "技能資料夾" : "Skill folder"}
            <input
              ref={picker}
              type="file"
              multiple
              {...{ webkitdirectory: "" }}
              onChange={(e) => {
                const selected = Array.from(e.target.files ?? []);
                setFiles(selected);
                setSaved(false);
                intent.current = undefined;
                if (selected[0])
                  setSource(selected[0].webkitRelativePath.split("/")[0]!);
              }}
            />
          </label>
          <p>
            {zh ? "已選檔案" : "Selected files"}：{files.length}
          </p>
          <label>
            {zh ? "匯入範圍" : "Import scope"}
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="user">{zh ? "個人" : "User"}</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {zh ? "來源位置或參考" : "Source location or reference"}
            <input
              required
              maxLength={2048}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <label>
            {zh ? "授權聲明" : "License declaration"}
            <input
              required
              maxLength={4096}
              value={license}
              onChange={(e) => setLicense(e.target.value)}
            />
          </label>
          <button disabled={!files.length || !source.trim() || !license.trim()}>
            {busy
              ? zh
                ? "匯入中…"
                : "Importing…"
              : zh
                ? "保存未信任套件"
                : "Save untrusted package"}
          </button>
          {error && <p role="alert">{error}</p>}
          {saved && (
            <p role="status">
              {zh
                ? "已匯入；審查並啟用後才會供新工作使用。"
                : "Imported. Review and enable before new Works can use it."}
            </p>
          )}
        </fieldset>
      </form>
    </details>
  );
}
