import { useState } from "react";
import type {
  PublicEvent,
  Work,
} from "../../../packages/contracts/src/index.js";
import { Workspaces } from "./workspaces.js";
import { ToolActivity } from "./tool-activity.js";
import { CommandTerminal } from "./command-terminal.js";
import { Environments } from "./environments.js";
import { BrowserPanel } from "./browser-panel.js";
export function ComputerPanel({
  locale,
  works,
  events,
  request,
}: {
  locale: "zh" | "en";
  works: Work[];
  events: PublicEvent[];
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh",
    [tab, setTab] = useState("Browser"),
    [selected, setSelected] = useState("");
  const tabs = ["Browser", "Files", "Terminal", "Activity"],
    work = works.find((w) => w.id === selected) ?? works.at(-1);
  return (
    <div className="computer-panel">
      <div className="computer-status">
        <strong>{zh ? "本機能力" : "Local capabilities"}</strong>
        <span>
          {zh ? "Native／選配本機容器" : "Native / optional local containers"}
        </span>
      </div>
      <Environments locale={locale} request={request} />
      <div
        className="computer-tool-tabs"
        role="tablist"
        aria-label="Computer tools"
      >
        {tabs.map((name) => (
          <button
            key={name}
            role="tab"
            id={"computer-tab-" + name}
            aria-controls="computer-content"
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={(e) => {
              const at = tabs.indexOf(name);
              const next =
                e.key === "ArrowRight"
                  ? (at + 1) % tabs.length
                  : e.key === "ArrowLeft"
                    ? (at + tabs.length - 1) % tabs.length
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? tabs.length - 1
                        : -1;
              if (next >= 0) {
                e.preventDefault();
                setTab(tabs[next]!);
                document.getElementById("computer-tab-" + tabs[next])?.focus();
              }
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <section
        id="computer-content"
        role="tabpanel"
        aria-labelledby={"computer-tab-" + tab}
        className="computer-section"
      >
        {(tab === "Terminal" || tab === "Activity" || tab === "Browser") && (
          <label>
            {zh ? "檢視工作" : "Inspect Work"}
            <select
              value={work?.id ?? ""}
              onChange={(event) => setSelected(event.target.value)}
            >
              {!works.length && (
                <option value="">{zh ? "尚無工作" : "No work"}</option>
              )}
              {works.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.text.slice(0, 100)}
                </option>
              ))}
            </select>
          </label>
        )}
        {tab === "Browser" && (
          <BrowserPanel
            work={work}
            cursor={
              events
                .filter(
                  (event) =>
                    event.workId === work?.id &&
                    event.payload.kind === "domain" &&
                    event.payload.name.startsWith("rocky.browser."),
                )
                .at(-1)?.sequence ?? "0"
            }
            locale={locale}
            request={request}
          />
        )}
        {tab === "Terminal" && (
          <CommandTerminal
            work={work}
            cursor={
              events
                .filter(
                  (event) =>
                    event.workId === work?.id &&
                    event.payload.kind === "domain" &&
                    event.payload.name.startsWith("rocky.operation."),
                )
                .at(-1)?.sequence ?? "0"
            }
            locale={locale}
            request={request}
          />
        )}
        {tab === "Files" && (
          <>
            <p>
              {zh
                ? "讀取已註冊工作區；使用本機 OS 權限，不是容器隔離。"
                : "Read registered workspaces using local OS permissions; this is not container isolation."}
            </p>
            <Workspaces locale={locale} request={request} />
          </>
        )}
        {tab === "Activity" && (
          <>
            <p>
              {zh
                ? "以下為共用事件中的已確認工具活動，不代表目前畫面或外部操作已成功。"
                : "Confirmed tool activity from shared events; not a current screen or proof of external success."}
            </p>
            {work ? (
              <ToolActivity
                work={work}
                events={events}
                locale={locale}
                empty={
                  <p>
                    {zh
                      ? "此工作尚無可顯示的工具活動。"
                      : "No tool activity to display for this Work."}
                  </p>
                }
              />
            ) : (
              <p>{zh ? "尚無可顯示的活動。" : "No activity to display."}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
