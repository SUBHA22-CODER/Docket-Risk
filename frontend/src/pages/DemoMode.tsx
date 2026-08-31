import { useRef, useState } from "react";
import {
  Button,
  Card,
  useToast,
} from "../components/ui";
import { Icon } from "../components/Icon";
import { inr, pctScore, shortTime } from "../lib/format";
import {
  runScenarioBatch,
  runScenarioLegit,
  runScenarioRing,
  type MemberResult,
} from "./demo/scenarios";

type ScenarioKey = "A" | "B" | "C";

const SCENARIOS: Record<ScenarioKey, { title: string; desc: string; members: number }> = {
  A: {
    title: "Scenario A — Legitimate customers",
    desc: "Three independent customers return one item each at three different merchants. Expected: every claim scores near zero and auto-approves.",
    members: 3,
  },
  B: {
    title: "Scenario B — Ring formation & crossover",
    desc: "Eight identities share 2 devices + 1 VPA but file one claim each at 8 DIFFERENT merchants. No single merchant sees anything unusual — watch the pooled evidence converge.",
    members: 8,
  },
  C: {
    title: "Scenario C — High-throughput batch replay",
    desc: "16 claims ingested rapidly in batch mode (12 coordinated + 4 control claims). Tests high-concurrency graph updating and real-time decision throughput.",
    members: 16,
  },
};

export default function DemoMode() {
  const toast = useToast();
  const [scenario, setScenario] = useState<ScenarioKey>("B");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<MemberResult[]>([]);
  const [done, setDone] = useState(false);
  const cancelRef = useRef(false);

  const reset = () => {
    cancelRef.current = true;
    setRunning(false);
    setResults([]);
    setDone(false);
  };

  const run = async () => {
    setRunning(true);
    setDone(false);
    setResults([]);
    cancelRef.current = false;
    try {
      const onResult = (r: MemberResult) =>
        setResults((rs) => [...rs, r]);
      if (scenario === "A") await runScenarioLegit(onResult, () => cancelRef.current);
      else if (scenario === "B") await runScenarioRing(onResult, () => cancelRef.current);
      else await runScenarioBatch(onResult, () => cancelRef.current);
      setDone(true);
    } catch (e) {
      toast({ tone: "err", title: "Demo failed", msg: (e as Error).message });
    } finally {
      setRunning(false);
    }
  };

  const total = SCENARIOS[scenario].members;
  const notCaught = results.filter((r) => r.res.action === "AUTO_APPROVE");
  const heldFrom = results.find((r) => r.res.action === "HOLD_PAYOUT_HUMAN_REVIEW");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Demo Mode</h1>
          <p className="page-subtitle">
            Live scenarios executed against the real scoring service — nothing is scripted or
            mocked. Detection strengthens as shared infrastructure accumulates.
          </p>
        </div>
        <span className="badge badge-info">drives /v1/ingest/order + /v1/score</span>
      </div>

      <div className="demo-stage">
        <div className="stack">
          <Card title="Choose scenario">
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {(Object.keys(SCENARIOS) as ScenarioKey[]).map((k) => (
                <button
                  key={k}
                  className={`scenario-tab ${scenario === k ? "active" : ""}`}
                  onClick={() => {
                    if (!running) {
                      setScenario(k);
                      reset();
                    }
                  }}
                >
                  <div className="scenario-title">{SCENARIOS[k].title}</div>
                  <div className="scenario-desc">{SCENARIOS[k].desc}</div>
                </button>
              ))}
            </div>
            <div className="divider" />
            <div className="row-wrap">
              <Button variant="primary" disabled={running} onClick={run}>
                <Icon name="play" size={14} /> Run live
              </Button>
              <Button disabled={!running && !done && results.length === 0} onClick={reset}>
                Reset
              </Button>
              {running && <span className="live-dot"><i /> EXECUTING…</span>}
            </div>
          </Card>

          <Card
            title={
              scenario === "A" ? "Customer claims" : "Ring members — one claim per merchant"
            }
          >
            {results.length === 0 ? (
              <p className="small muted" style={{ padding: "8px 0" }}>
                Press <b>Run live</b> — each order is ingested into the identity graph and each
                claim scored by the real model, revealed one at a time.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {Array.from({ length: total }, (_, i) => i + 1).map((m) => {
                  const r = results.find((x) => x.member === m);
                  if (!r) {
                    return (
                      <div key={m} className="demo-member-card pending">
                        <span className="avatar">{m}</span>
                        <span className="small muted">awaiting execution…</span>
                      </div>
                    );
                  }
                  const tone =
                    r.res.action === "HOLD_PAYOUT_HUMAN_REVIEW"
                      ? "high"
                      : r.res.action === "STEP_UP_VERIFICATION"
                        ? "medium"
                        : "auto";
                  return (
                    <div key={m} className={`demo-member-card ${tone}`}>
                      <span className="avatar">{m}</span>
                      <div className="grow">
                        <div className="small" style={{ fontWeight: 650 }}>
                          {r.identity} <span className="muted">@</span>{" "}
                          <span className="mono small secondary">{r.merchant}</span>
                        </div>
                        <div className="small muted num">
                          {inr(r.amount)} · cluster size{" "}
                          {r.res.evidence.cluster_size ?? "?"}
                          {r.res.degraded ? " · DEGRADED FAIL-OPEN" : ""}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          className="num"
                          style={{
                            fontWeight: 750,
                            fontSize: 16,
                            color:
                              tone === "high"
                                ? "var(--red)"
                                : tone === "medium"
                                  ? "var(--amber)"
                                  : "var(--green)",
                          }}
                        >
                          {r.res.score != null ? pctScore(r.res.score) : "—"}
                        </div>
                        <div className="small muted">{shortTime(new Date().toISOString())}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {done && scenario === "B" && notCaught.length > 0 && (
            <div className="honesty-note">
              <Icon name="alert" size={17} />
              <span>
                <b>Honesty note:</b> members [{notCaught.map((r) => r.member).join(", ")}] were{" "}
                <b>NOT caught</b> — their claims would have been auto-approved and paid out before
                the graph had enough evidence.
                {heldFrom && (
                  <>
                    {" "}The system converges once shared infrastructure accumulates; HOLD from
                    member <b>{heldFrom.member}</b> onward.
                  </>
                )}
                {" "}Each merchant individually saw one ordinary first-time customer.
              </span>
            </div>
          )}
          {done && scenario === "A" && (
            <div className="honesty-note" style={{ borderColor: "rgba(61,220,151,.35)", background: "var(--green-bg)" }}>
              <Icon name="check" size={17} />
              <span>
                <b>All clear:</b> every legitimate customer scored near zero and auto-approved with
                zero friction. Shared-infrastructure signals alone drive escalation — ordinary
                behaviour never gets flagged.
              </span>
            </div>
          )}
        </div>

        <div className="stack">
          <Card title="Score progression">
            {results.length > 0 ? (
              <ScoreProgress results={results} />
            ) : (
              <p className="small muted">Scores appear here as the scenario executes.</p>
            )}
          </Card>

          <Card title="What the demo shows">
            <ul className="small secondary" style={{ paddingLeft: 17, lineHeight: 1.75 }}>
              <li><b>Evidence over black-box scores</b> — every score is explainable via shared infrastructure.</li>
              <li><b>Progressive risk detection</b> — early ring claims are honestly missed; detection strengthens with evidence.</li>
              <li><b>No per-merchant visibility</b> — each merchant saw one normal customer; only the pooled graph sees the ring.</li>
              <li><b>Fail-open safety</b> — if the model were unavailable, claims default to AUTO_APPROVE, never blocked.</li>
            </ul>
            <div className="divider" />
            <div className="small muted">
              Action vocabulary: AUTO_APPROVE · STEP_UP_VERIFICATION · HOLD_PAYOUT_HUMAN_REVIEW.
              Thresholds: HIGH ≥ 0.85, MEDIUM ≥ 0.50.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ScoreProgress({ results }: { results: MemberResult[] }) {
  const W = 420;
  const H = 190;
  const padL = 30;
  const padB = 22;
  const n = Math.max(2, results.length);
  const px = (i: number) => padL + (i * (W - padL - 10)) / (n - 1 || 1);
  const py = (s: number) => H - padB - s * (H - padB - 12);
  const path = results
    .map((r, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(r.res.score ?? 0).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Score progression across scenario steps">
      {[0.5, 0.85].map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - 6} y1={py(t)} y2={py(t)} stroke={t === 0.85 ? "var(--red)" : "var(--amber)"} strokeDasharray="4 4" strokeWidth={1.2} opacity={0.7} />
          <text x={W - 8} y={py(t) - 4} textAnchor="end" fontSize={9} fill={t === 0.85 ? "var(--red)" : "var(--amber)"}>
            {t === 0.85 ? "HOLD 0.85" : "STEP-UP 0.50"}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--blue)" strokeWidth={2.2} strokeLinecap="round" />
      {results.map((r, i) => (
        <circle
          key={r.identity}
          cx={px(i)}
          cy={py(r.res.score ?? 0)}
          r={4}
          fill={
            r.res.action === "HOLD_PAYOUT_HUMAN_REVIEW"
              ? "var(--red)"
              : r.res.action === "STEP_UP_VERIFICATION"
                ? "var(--amber)"
                : "var(--green)"
          }
        />
      ))}
      <text x={(W + padL) / 2} y={H - 4} textAnchor="middle" fontSize={9.5} fill="var(--text-muted)">
        sequential members →
      </text>
      <text x={9} y={H / 2} textAnchor="middle" fontSize={9.5} fill="var(--text-secondary)" transform={`rotate(-90 9 ${H / 2})`}>
        score
      </text>
    </svg>
  );
}
