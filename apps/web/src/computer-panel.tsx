import { useState } from "react";
import type {
  PublicEvent,
  Work,
} from "../../../packages/contracts/src/index.js";
import { Workspaces } from "./workspaces.js";
import { ToolActivity } from "./tool-activity.js";
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
          {zh ? "隔離環境尚未實作" : "Isolated environment not implemented"}
        </span>
      </div>
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
        {tab === "Browser" && (
          <div className="computer-setup">
            <h3>{zh ? "Browser 尚不可用" : "Browser unavailable"}</h3>
            <p>
              {zh
                ? "尚未實作受控 browser profile 與精確接管；沒有正在執行的瀏覽器或即時畫面。"
                : "Owned browser profiles and scoped takeover are not implemented. No browser or live screen is running here."}
            </p>
          </div>
        )}
        {tab === "Terminal" && (
          <div className="computer-setup">
            <h3>{zh ? "Terminal 尚不可用" : "Terminal unavailable"}</h3>
            <p>
              {zh
                ? "受控命令執行 adapter 尚未實作；不會改用未授權主機 shell。"
                : "The controlled execution adapter is not implemented; this panel does not fall back to an unauthorized host shell."}
            </p>
          </div>
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
            <label>
              {zh ? "檢視工作" : "Inspect Work"}
              <select
                value={work?.id ?? ""}
                onChange={(e) => setSelected(e.target.value)}
              >
                {!works.length && (
                  <option value="">{zh ? "尚無工作" : "No work"}</option>
                )}
                {works.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.text.slice(0, 100)}
                  </option>
                ))}
              </select>
            </label>
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
