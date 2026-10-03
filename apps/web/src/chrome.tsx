import {
  PanelLeft,
  MessageCircle,
  FileText,
  Settings,
  Clock,
  Folder,
  Sparkles,
  BookOpen,
  Monitor,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Chrome({
  locale,
  connected,
  count,
  actions,
  children,
  settings,
  workspaces,
  artifacts,
}: {
  locale: "zh" | "en";
  connected: boolean;
  count: number;
  actions: ReactNode;
  children: ReactNode;
  settings: ReactNode;
  workspaces?: ReactNode;
  artifacts?: ReactNode;
}) {
  const zh = locale === "zh";
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const [compact, setCompact] = useState(() => window.innerWidth <= 1100);
  const resultPane = useRef<HTMLElement>(null);
  const panelOpener = useRef<HTMLElement | null>(null);
  const resultWasOpen = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1100px)");
    const change = () => setCompact(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const opener = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const names = zh
    ? [
        "主對話",
        "近期工作",
        "文件與成果",
        "工作區",
        "技能",
        "Learning",
        "Computer",
        "設定",
      ]
    : [
        "Conversation",
        "Recent work",
        "Documents & results",
        "Workspaces",
        "Skills",
        "Learning",
        "Computer",
        "Settings",
      ];
  useEffect(() => {
    if (!panel || panel === "2") return;
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, [panel]);
  useEffect(() => {
    if (panel === "2")
      resultPane.current?.querySelector<HTMLButtonElement>("button")?.focus();
    else if (resultWasOpen.current)
      (window.innerWidth <= 700
        ? opener.current
        : panelOpener.current
      )?.focus();
    resultWasOpen.current = panel === "2";
  }, [panel]);
  useEffect(() => {
    if (!drawer) return;
    const nav = document.querySelector<HTMLElement>(".sidebar");
    nav?.querySelector<HTMLButtonElement>("button")?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrawer(false);
        opener.current?.focus();
      }
      if (e.key === "Tab") {
        const controls = nav?.querySelectorAll<HTMLButtonElement>("button");
        if (!controls?.length) return;
        if (e.shiftKey && document.activeElement === controls[0]) {
          e.preventDefault();
          controls[controls.length - 1]?.focus();
        } else if (
          !e.shiftKey &&
          document.activeElement === controls[controls.length - 1]
        ) {
          e.preventDefault();
          controls[0]?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [drawer]);
  useEffect(() => {
    if (panel !== "2") return;
    function key(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setPanel(null);
        (window.innerWidth <= 700
          ? opener.current
          : panelOpener.current
        )?.focus();
      } else if (
        compact &&
        event.key === "Tab" &&
        !resultPane.current?.contains(document.activeElement)
      ) {
        event.preventDefault();
        resultPane.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [panel, compact]);
  function open(index: number) {
    setDrawer(false);
    if (index === 0) {
      document.getElementById("chat")?.focus();
      return;
    }
    if (index === 1) {
      document.getElementById("works")?.scrollIntoView();
      return;
    }
    panelOpener.current = document.activeElement as HTMLElement;
    setPanel(String(index));
  }
  return (
    <div
      className={`template-app app ${collapsed ? "nav-collapsed" : ""} ${drawer ? "nav-open" : ""} ${panel === "2" ? "result-open" : ""}`}
    >
      <div
        className="icon-rail"
        inert={panel === "2" && compact ? true : undefined}
        aria-label={zh ? "應用程式導覽" : "Application navigation"}
      >
        <img src="/rocky/mark.svg" width="28" height="28" alt="" />
        <button
          aria-label={zh ? "收合導覽" : "Collapse navigation"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          <PanelLeft size={18} />
        </button>
        <button aria-label={names[0]} onClick={() => open(0)}>
          <MessageCircle size={18} />
        </button>
        <button aria-label={names[2]} onClick={() => open(2)}>
          <FileText size={18} />
        </button>
        <button
          className="rail-bottom"
          aria-label={names[7]}
          onClick={() => open(7)}
        >
          <Settings size={18} />
        </button>
      </div>
      <button
        ref={opener}
        className="mobile-menu"
        inert={panel === "2" && compact ? true : undefined}
        aria-label={zh ? "開啟導覽" : "Open navigation"}
        aria-expanded={drawer}
        onClick={() => setDrawer(!drawer)}
      >
        ☰
      </button>
      {drawer && (
        <button
          className="nav-scrim"
          aria-label={zh ? "關閉導覽" : "Close navigation"}
          onClick={() => {
            setDrawer(false);
            opener.current?.focus();
          }}
        />
      )}
      <aside
        className="sidebar"
        inert={panel === "2" && compact ? true : undefined}
        aria-label={zh ? "主要導覽" : "Main navigation"}
      >
        <div className="wordmark">Rocky</div>
        <div className="nav-label">{zh ? "助手" : "ASSISTANT"}</div>
        <button className="nav-item selected" onClick={() => open(0)}>
          <img src="/rocky/mark.svg" width="20" height="20" alt="" />
          <span>Rocky</span>
        </button>
        <div className="nav-label">{zh ? "工作空間" : "WORKSPACE"}</div>
        {names.slice(1, 6).map((name, i) => (
          <button className="nav-item" key={name} onClick={() => open(i + 1)}>
            <span aria-hidden="true">
              {
                [
                  <Clock size={16} />,
                  <FileText size={16} />,
                  <Folder size={16} />,
                  <Sparkles size={16} />,
                  <BookOpen size={16} />,
                ][i]
              }
            </span>
            <span>{name}</span>
            {i === 0 && <small>{count}</small>}
          </button>
        ))}
        <div className="sidebar-bottom">
          {names.slice(6).map((name, i) => (
            <button className="nav-item" key={name} onClick={() => open(i + 6)}>
              <span aria-hidden="true">
                {i ? <Settings size={16} /> : <Monitor size={16} />}
              </span>
              <span>{name}</span>
            </button>
          ))}
        </div>
      </aside>
      <main
        id="chat"
        className="workspace"
        tabIndex={-1}
        inert={panel === "2" && compact ? true : undefined}
      >
        <header
          className="topbar"
          aria-hidden={panel && panel !== "2" ? true : undefined}
        >
          <div className="breadcrumbs">
            Rocky <span>/</span> {names[0]}
          </div>
          <div className="top-actions">
            <span className={`connection ${connected ? "" : "warning"}`}>
              {connected
                ? zh
                  ? "本機已連線"
                  : "Connected locally"
                : zh
                  ? "連線中斷；顯示最後確認狀態"
                  : "Disconnected; showing last confirmed state"}
            </span>
            {actions}
          </div>
        </header>
        {children}
      </main>
      {panel === "2" && (
        <>
          {compact && <div className="result-scrim" aria-hidden="true" />}
          <aside
            ref={resultPane}
            className="result-pane"
            role={compact ? "dialog" : "region"}
            aria-modal={compact || undefined}
            aria-label={names[2]}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setPanel(null);
                (window.innerWidth <= 700
                  ? opener.current
                  : panelOpener.current
                )?.focus();
              }
              if (compact && event.key === "Tab") {
                const elements = Array.from(
                  resultPane.current?.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), a[href], summary, [tabindex="0"]',
                  ) ?? [],
                ).filter((el) => el.getClientRects().length);
                const first = elements[0],
                  last = elements.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <div className="pane-header">
              <strong>{names[2]}</strong>
              <button
                aria-label={zh ? "關閉成果面板" : "Close result panel"}
                onClick={() => {
                  setPanel(null);
                  (window.innerWidth <= 700
                    ? opener.current
                    : panelOpener.current
                  )?.focus();
                }}
              >
                ×
              </button>
            </div>
            <div className="pane-body">{artifacts}</div>
          </aside>
        </>
      )}
      <dialog
        ref={dialog}
        className="workspace-dialog"
        onClose={() => {
          setPanel(null);
          if (window.innerWidth <= 700) opener.current?.focus();
        }}
        onCancel={() => setPanel(null)}
      >
        <div className="pane-header">
          <strong>{panel ? names[Number(panel)] : ""}</strong>
          <div className="top-actions">{actions}</div>
          <button
            aria-label={zh ? "關閉" : "Close"}
            onClick={() => {
              dialog.current?.close();
              setPanel(null);
            }}
          >
            ×
          </button>
        </div>
        <div className="pane-body">
          {panel === "7" ? (
            settings
          ) : panel === "3" ? (
            workspaces
          ) : (
            <p role="status">
              {zh
                ? "此能力尚未實作；沒有正在執行的外部服務或合成成果。"
                : "This capability is not implemented yet. No external service or synthetic result is running."}
            </p>
          )}
        </div>
      </dialog>
    </div>
  );
}

export function Transcript({
  children,
  revision,
}: {
  children: ReactNode;
  revision: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (follow.current) el.scrollTop = el.scrollHeight;
    else setAway(true);
  }, [revision]);
  return (
    <div className="transcript-frame">
      <div
        id="works"
        tabIndex={-1}
        ref={ref}
        className="chat-transcript works"
        onScroll={() => {
          const el = ref.current!;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 64;
          if (follow.current) setAway(false);
        }}
      >
        {children}
      </div>
      {away && (
        <button
          className="jump-bottom"
          onClick={() => {
            const el = ref.current!;
            el.scrollTop = el.scrollHeight;
            follow.current = true;
            setAway(false);
          }}
        >
          {document.documentElement.lang === "en"
            ? "New content ↓"
            : "新內容 ↓"}
        </button>
      )}
    </div>
  );
}
