import { FileText, ArrowUpRight, Download } from "lucide-react";
import type { Artifact } from "../../../packages/contracts/src/artifacts.js";
export function WorkArtifacts({
  items,
  locale,
  onOpen,
}: {
  items: Artifact[];
  locale: "zh" | "en";
  onOpen: (item: Artifact) => void;
}) {
  if (!items.length) return null;
  const zh = locale === "zh";
  return (
    <section
      className="work-artifacts"
      aria-label={zh ? "這項工作的成果" : "Results from this work"}
    >
      {items.map((item) => (
        <article className="delivered-artifact" key={item.id}>
          <header>
            <FileText size={16} />
            <span>{zh ? "已保存成果" : "Saved result"}</span>
          </header>
          <div>
            <h3>{item.title}</h3>
            <p>{item.files.map((f) => f.name).join(", ")}</p>
          </div>
          <footer>
            <button onClick={() => onOpen(item)}>
              <ArrowUpRight size={16} />
              {zh ? "開啟成果" : "Open result"}
            </button>
            <a
              href={"/api/v1/artifacts/" + item.id + "/files/" + item.entry}
              download
            >
              <Download size={16} />
              {zh ? "下載" : "Download"}
            </a>
            <small>{zh ? "不可變快照" : "Immutable snapshot"}</small>
          </footer>
        </article>
      ))}
    </section>
  );
}
