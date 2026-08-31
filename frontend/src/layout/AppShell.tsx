import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BrandMark, Icon } from "../components/Icon";
import { CommandPalette } from "../components/CommandPalette";
import { DocketCopilot } from "../components/DocketCopilot";
import { Badge, useToast } from "../components/ui";
import { api, openStream } from "../lib/api";
import { timeAgo } from "../lib/format";
import type { HealthStatus, StreamAlertEvent, StreamRingFormingEvent } from "../types";

const NAV = [
  { to: "/overview", icon: "overview", label: "Overview" },
  { to: "/claims", icon: "queue", label: "Claims" },
  { to: "/investigations", icon: "investigations", label: "Investigations" },
  { to: "/live", icon: "play", label: "Live feed" },
  { to: "/alerts", icon: "alert", label: "Alerts" },
  { to: "/settlement", icon: "overview", label: "Settlement" },
  { to: "/network", icon: "network", label: "Network" },
  { to: "/analytics", icon: "analytics", label: "Analytics" },
  { to: "/evaluation", icon: "evaluation", label: "Evaluation" },
  { to: "/demo", icon: "play", label: "Demo" },
  { to: "/arena", icon: "crosshair", label: "Red-Team Arena" },
] as const;

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthErr, setHealthErr] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date>(new Date());
  const [tick, setTick] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [liveAlerts, setLiveAlerts] = useState<StreamAlertEvent[]>([]);
  const [ringAlerts, setRingAlerts] = useState<StreamRingFormingEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const refreshNonce = useRef(0);
  const toast = useToast();

  useEffect(() => {
    const close = openStream((e) => {
      if (e.type === "alert") {
        setLiveAlerts((prev) => [e, ...prev].slice(0, 8));
        setUnread((u) => u + 1);
        toast({
          tone: "info",
          title: `Alert · ${e.rule_name}`,
          msg: e.detail ?? undefined,
        });
      } else if (e.type === "ring_forming") {
        setRingAlerts((prev) => [e, ...prev].slice(0, 5));
        setUnread((u) => u + 1);
        toast({
          tone: "err",
          title: "RING FORMING",
          msg: e.detail,
        });
      }
    });
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshHealth = () => {
    api
      .health()
      .then((h) => {
        setHealth(h);
        setHealthErr(false);
        setUpdatedAt(new Date());
      })
      .catch(() => setHealthErr(true));
  };

  useEffect(() => {
    refreshHealth();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshHealth();
    }, 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!notifOpen && !userOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".popover-anchor")) {
        setNotifOpen(false);
        setUserOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNotifOpen(false);
        setUserOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [notifOpen, userOpen]);

  // scroll to top on navigation
  useEffect(() => {
    document.querySelector(".page")?.scrollTo({ top: 0 });
  }, [location.pathname]);

  const degraded = healthErr || (health != null && !health.model_loaded);

  return (
    <div className="shell">
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
        <Link to="/" className="sidebar-brand" style={{ textDecoration: "none", color: "inherit" }} title="Return to Landing Page">
          <span className="brand-mark">
            <BrandMark size={18} />
          </span>
          {!collapsed && (
            <div>
              <div className="brand-name">
                Docket <span>Risk</span>
              </div>
              <div className="brand-sub">Freeze & Ring Intelligence</div>
            </div>
          )}
        </Link>

        <nav className="nav-section" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/overview"}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon name={item.icon} size={14} />
              {!collapsed && item.label}
            </NavLink>
          ))}

          <div className="divider" style={{ margin: "6px 0" }} />

          <button
            className="nav-item copilot-nav-btn"
            onClick={() => window.dispatchEvent(new CustomEvent("rs:open-copilot"))}
            title={collapsed ? "Docket Copilot (AI)" : undefined}
            style={{ width: "100%", background: "none", border: "none", textAlign: "left", cursor: "pointer", color: "#60a5fa" }}
          >
            <Icon name="shield" size={14} />
            {!collapsed && (
              <span className="row" style={{ justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                <span>Docket Copilot</span>
                <span className="badge badge-low" style={{ fontSize: 9, padding: "1px 5px" }}>AI</span>
              </span>
            )}
          </button>
        </nav>

        <div className="nav-footer">
          <button
            className="icon-btn"
            style={{ marginBottom: collapsed ? 6 : 0 }}
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={13} />
          </button>
          {!collapsed && (
            <>
              <div className="env-pill">
                <span className="env-dot" />
                Scoring online
              </div>
              <div className="user-row">
                <span className="avatar">OP</span>
                <span className="user-meta">
                  <span className="user-name">ops_014</span>
                  <br />
                  <span className="user-role">Risk analyst</span>
                </span>
              </div>
            </>
          )}
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button
            className="searchbox"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open global search"
          >
            <Icon name="search" size={13} />
            <span>Search claims, identities, infrastructure…</span>
            <span className="kbd">Ctrl K</span>
          </button>

          <div className="topbar-right">
            <Badge tone={degraded ? "medium" : "low"}>
              {degraded ? "DEGRADED" : "SCORING ONLINE"}
            </Badge>
            <span className="updated-at" title={updatedAt.toLocaleTimeString("en-IN")}>
              {timeAgo(updatedAt.toISOString(), tick * 0 + Date.now())}
            </span>
            <button
              className="icon-btn"
              aria-label="Refresh data"
              onClick={() => {
                refreshNonce.current += 1;
                refreshHealth();
                window.dispatchEvent(
                  new CustomEvent("rs:refresh", { detail: refreshNonce.current }),
                );
              }}
            >
              <Icon name="refresh" size={13} />
            </button>
            <div className="popover-anchor">
              <button
                className="icon-btn notif-btn"
                aria-label="Notifications"
                aria-expanded={notifOpen}
                onClick={() => {
                  setNotifOpen((o) => !o);
                  setUnread(0);
                }}
              >
                <Icon name="bell" size={13} />
                {unread > 0 ? (
                  <span className="notif-count">{unread > 9 ? "9+" : unread}</span>
                ) : (
                  ((health?.known_identities ?? 0) > 0 || degraded) && (
                    <span className="notif-count">{degraded ? "!" : (health?.known_identities ?? 0) > 99 ? "99+" : health?.known_identities ?? 0}</span>
                  )
                )}
              </button>
              {notifOpen && (
                <div className="popover">
                  <div className="popover-head">
                    Operational alerts
                    <button className="btn btn-ghost btn-sm" onClick={() => setNotifOpen(false)}>
                      Close
                    </button>
                  </div>
                  <div className="popover-body" style={{ padding: "6px 0" }}>
                    <NotificationList
                      health={health}
                      healthErr={healthErr}
                      liveAlerts={liveAlerts}
                      ringAlerts={ringAlerts}
                      onGo={(to) => {
                        setNotifOpen(false);
                        navigate(to);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="popover-anchor">
              <button
                className="icon-btn"
                aria-label="Analyst menu"
                onClick={() => setUserOpen((o) => !o)}
              >
                <Icon name="user" size={13} />
              </button>
              {userOpen && (
                <div className="popover" style={{ minWidth: 200 }}>
                  <div className="popover-head">
                    ops_014 · Risk analyst
                    <button className="btn btn-ghost btn-sm" onClick={() => setUserOpen(false)}>
                      Close
                    </button>
                  </div>
                  <div style={{ padding: 10 }} className="small secondary">
                    Session is read-only against synthetic evaluation data.
                    Decisions are recorded to the audit log with your analyst ID.
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="page" id="page-scroll">
          <Outlet context={{ refreshNonce: refreshNonce.current }} />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <DocketCopilot />
    </div>
  );
}

function NotificationList({
  health,
  healthErr,
  liveAlerts,
  ringAlerts,
  onGo,
}: {
  health: HealthStatus | null;
  healthErr: boolean;
  liveAlerts: StreamAlertEvent[];
  ringAlerts: StreamRingFormingEvent[];
  onGo: (to: string) => void;
}) {
  if (healthErr) {
    return (
      <div style={{ padding: "8px 12px" }}>
        <div className="row" style={{ gap: 8 }}>
          <Icon name="alert" size={13} />
          <div>
            <b>Risk service unreachable</b>
            <div className="small muted">
              The scoring service is not answering /healthz. Claims are failing open.
            </div>
            <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => onGo("/settings")}>
              View system status
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ padding: "4px 12px" }}>
      {health && !health.model_loaded && (
        <div className="row small" style={{ gap: 6, padding: "5px 0", color: "var(--amber)" }}>
          <Icon name="alert" size={12} /> Model file missing — serving fail-open scores.
        </div>
      )}
      {ringAlerts.length > 0 && (
        <>
          <div className="section-label" style={{ margin: "6px 0 2px" }}>Ring formation</div>
          {ringAlerts.map((r, i) => (
            <div key={`${r.ts}-${i}`} className="row small" style={{ gap: 6, padding: "5px 0" }}>
              <span className="feed-dot live" style={{ background: "var(--red)", marginTop: 4 }} />
              <div className="grow">
                <b style={{ color: "var(--red)" }}>RING FORMING</b>
                {r.claim_id && (
                  <>
                    {" · "}
                    <button className="chip" style={{ margin: 0 }} onClick={() => onGo(`/claims/${r.claim_id}`)}>
                      {r.claim_id}
                    </button>
                  </>
                )}
                <div className="small muted" style={{ fontSize: 10.5 }}>{r.detail}</div>
              </div>
            </div>
          ))}
          <div className="divider" />
        </>
      )}
      {liveAlerts.length > 0 && (
        <>
          <div className="section-label" style={{ margin: "6px 0 2px" }}>Live alert rules</div>
          {liveAlerts.map((a, i) => (
            <div key={`${a.ts}-${i}`} className="row small" style={{ gap: 6, padding: "5px 0" }}>
              <span className="feed-dot" style={{ background: a.severity === "HIGH" ? "var(--red)" : "var(--amber)", marginTop: 4 }} />
              <div className="grow">
                <b>{a.rule_name}</b>
                {a.claim_id && (
                  <>
                    {" · "}
                    <button className="chip" style={{ margin: 0 }} onClick={() => onGo(`/claims/${a.claim_id}`)}>
                      {a.claim_id}
                    </button>
                  </>
                )}
                <div className="small muted" style={{ fontSize: 10.5 }}>{timeAgo(a.ts)}</div>
              </div>
            </div>
          ))}
          <button className="btn btn-sm" style={{ margin: "4px 0 6px" }} onClick={() => onGo("/alerts")}>
            Manage alert rules
          </button>
          <div className="divider" />
        </>
      )}
      <div className="row small" style={{ gap: 6, padding: "5px 0" }}>
        <Icon name="check" size={12} />
        <span>
          {health
            ? `${health.known_identities.toLocaleString("en-IN")} identities in the live graph`
            : "—"}
        </span>
      </div>
      <div className="row small muted" style={{ gap: 6, padding: "5px 0" }}>
        <Icon name="clock" size={12} /> No new ring formations in the last hour.
      </div>
      <button className="btn btn-sm" style={{ marginTop: 4 }} onClick={() => onGo("/claims?risk=HIGH")}>
        Review HIGH-risk queue
      </button>
    </div>
  );
}
