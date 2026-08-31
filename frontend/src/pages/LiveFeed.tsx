import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openStream } from "../lib/api";
import { Badge, Button, Card, EmptyState, useToast } from "../components/ui";
import { Icon } from "../components/Icon";
import type { StreamAlertEvent, StreamEvent, StreamRingFormingEvent, StreamScoreEvent } from "../types";
import { inr, maskId, pctScore, shortTime, timeAgo } from "../lib/format";

const MAX_EVENTS = 80;

type FeedItem = StreamScoreEvent | StreamAlertEvent | StreamRingFormingEvent;

const isAlert = (e: FeedItem): e is StreamAlertEvent => e.type === "alert";
const isRing = (e: FeedItem): e is StreamRingFormingEvent => e.type === "ring_forming";

export default function LiveFeed() {
  const navigate = useNavigate();
  const toast = useToast();
  const [events, setEvents] = useState<FeedItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [notifyOn, setNotifyOn] = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted",
  );
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const close = openStream((e: StreamEvent) => {
      if (e.type === "hello") {
        setConnected(true);
        return;
      }
      if (pausedRef.current) return;
      setEvents((prev) => [e as FeedItem, ...prev].slice(0, MAX_EVENTS));
      if (
        (e.type === "alert" || e.type === "ring_forming") &&
        notifyOn &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        try {
          new Notification(
            e.type === "ring_forming" ? "RING FORMING" : `Ring Sentinel — ${e.rule_name}`,
            {
              body: e.detail ?? "alert triggered",
              tag: `rs-${e.type}-${e.claim_id}`,
            },
          );
        } catch {
          /* notification failed */
        }
      }
    });
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifyOn]);

  const toggleNotify = async () => {
    if (notifyOn) {
      setNotifyOn(false);
      return;
    }
    if (typeof Notification === "undefined") return;
    const perm = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    if (perm === "granted") {
      setNotifyOn(true);
      toast({ tone: "ok", title: "Desktop notifications on", msg: "You'll be pinged when alert rules fire." });
    } else {
      toast({ tone: "err", title: "Permission denied", msg: "Browser blocked desktop notifications." });
    }
  };

  const scores = events.filter((e) => e.type === "score").length;
  const alerts = events.filter((e) => isAlert(e) || isRing(e)).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="section-label">Real-time</div>
          <h1 className="page-title">Live Risk Feed</h1>
          <p className="page-subtitle">
            Server-sent stream of every scored claim plus triggered alert rules — no polling.
          </p>
        </div>
        <div className="row-wrap">
          <Badge tone={connected ? "low" : "medium"}>
            <span className="row" style={{ gap: 6 }}>
              <span className={`feed-dot ${connected ? "live" : ""}`} style={{ background: connected ? "var(--green)" : "var(--amber)" }} />
              {connected ? "STREAMING" : "CONNECTING…"}
            </span>
          </Badge>
          <Button size="sm" onClick={() => setPaused((p) => !p)}>
            <Icon name={paused ? "play" : "pause"} size={11} /> {paused ? "Resume" : "Pause"}
          </Button>
          <Button size="sm" variant={notifyOn ? "success" : "default"} onClick={toggleNotify}>
            <Icon name="bell" size={12} /> {notifyOn ? "Notifications on" : "Notify me"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEvents([])}>
            Clear
          </Button>
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="kpi-label">Events in view</div>
          <div className="kpi-value num">{events.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Flagged claims</div>
          <div className="kpi-value num">{scores}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Alerts fired</div>
          <div className="kpi-value num" style={{ color: alerts > 0 ? "var(--red)" : undefined }}>{alerts}</div>
        </div>
      </div>

      <Card
        title="Stream"
        bodyClass=""
        actions={<span className="small muted">newest first · max {MAX_EVENTS} kept</span>}
      >
        {events.length === 0 ? (
          <EmptyState
            icon="clock"
            title={paused ? "Feed paused" : "Waiting for events…"}
            desc={
              paused
                ? "Resume the feed to start collecting scored claims and alerts again."
                : "Score a claim from the Demo page or wait for production traffic. The 25 most recent flagged decisions are replayed on connect."
            }
          />
        ) : (
          <div>
            {events.map((e, i) =>
              isRing(e) ? (
                <div
                  key={`${e.ts}-${i}-r`}
                  className="feed-row"
                  style={{
                    background: "rgba(229,72,77,0.10)",
                    borderLeft: "3px solid var(--red)",
                    cursor: e.claim_id ? "pointer" : undefined,
                  }}
                  onClick={() => e.claim_id && navigate(`/claims/${e.claim_id}`)}
                >
                  <span className="feed-dot live" style={{ background: "var(--red)" }} />
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <Icon name="network" size={13} style={{ color: "var(--red)" }} />
                      <b style={{ color: "var(--red)" }}>RING FORMING</b>
                      <span className="badge badge-high">+{e.growth} in {e.window_min}m</span>
                      <span className="small secondary">{e.cluster_size} members now</span>
                    </div>
                    <div className="small secondary" style={{ marginTop: 3 }}>{e.detail}</div>
                    {e.members_sample?.length > 0 && (
                      <div className="row-wrap" style={{ marginTop: 5 }}>
                        {e.members_sample.slice(0, 6).map((m) => (
                          <span key={m} className="chip">{maskId(m)}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="small muted num">{timeAgo(e.ts)}</span>
                </div>
              ) : isAlert(e) ? (
                <div key={`${e.ts}-${i}-a`} className="feed-row" style={{ background: "rgba(229,72,77,0.05)" }}>
                  <span className="feed-dot" style={{ background: "var(--red)" }} />
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <Icon name="alert" size={13} style={{ color: "var(--red)" }} />
                      <b>ALERT · {e.rule_name}</b>
                      <span className={`badge ${e.severity === "HIGH" ? "badge-high" : "badge-medium"}`}>{e.severity}</span>
                    </div>
                    <div className="small secondary" style={{ marginTop: 2 }}>
                      {e.detail}
                      {e.claim_id && (
                        <>
                          {" · "}
                          <button className="chip" style={{ margin: 0 }} onClick={() => navigate(`/claims/${e.claim_id}`)}>
                            {e.claim_id}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="small muted num">{timeAgo(e.ts)}</span>
                </div>
              ) : (
                <div
                  key={`${e.ts}-${i}-s`}
                  className="feed-row"
                  style={{ cursor: e.claim_id ? "pointer" : undefined }}
                  onClick={() => e.claim_id && navigate(`/claims/${e.claim_id}`)}
                >
                  <span
                    className="feed-dot"
                    style={{
                      background:
                        e.action === "HOLD_PAYOUT_HUMAN_REVIEW"
                          ? "var(--red)"
                          : e.action === "STEP_UP_VERIFICATION"
                            ? "var(--amber)"
                            : "var(--green)",
                    }}
                  />
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <b className="mono small">{e.claim_id ?? "(unscored id)"}</b>
                      <span className="mono small muted">{maskId(e.identity_key)}</span>
                      {e.replay && <span className="badge badge-neutral">replay</span>}
                    </div>
                    <div className="small secondary" style={{ marginTop: 2 }}>
                      {e.merchant_id} · {e.amount !== undefined ? inr(e.amount) : "—"} ·{" "}
                      {e.action.replace("_PAYOUT_HUMAN_REVIEW", "")}
                    </div>
                  </div>
                  <span
                    className="num"
                    style={{
                      fontWeight: 700,
                      color:
                        e.action === "HOLD_PAYOUT_HUMAN_REVIEW"
                          ? "var(--red)"
                          : e.action === "STEP_UP_VERIFICATION"
                            ? "var(--amber)"
                            : "var(--text-secondary)",
                    }}
                  >
                    {e.score != null ? pctScore(e.score) : "n/a"}
                  </span>
                  <span className="small muted num" style={{ width: 64, textAlign: "right" }}>
                    {shortTime(e.ts)}
                  </span>
                </div>
              ),
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
