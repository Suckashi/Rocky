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
}: {
  locale: "zh" | "en";
  connected: boolean;
  count: number;
  actions: ReactNode;
  children: ReactNode;
  settings: ReactNode;
}) {
  const zh = locale === "zh";
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
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
    if (!panel) return;
    dialog.current?.showModal();
    return () => dialog.current?.close();
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
    setPanel(String(index));
  }
  return (
    <div
      className={`template-app app ${collapsed ? "nav-collapsed" : ""} ${drawer ? "nav-open" : ""}`}
    >
      <div
        className="icon-rail"
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
      <main id="chat" className="workspace" tabIndex={-1}>
        <header className="topbar" aria-hidden={panel ? true : undefined}>
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
