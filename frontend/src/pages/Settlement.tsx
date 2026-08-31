import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAsync, useDebounced } from "../lib/hooks";
import { Card, ErrorState, InfoTip, SkeletonRows } from "../components/ui";
import { inr, inrCompact, num, pctScore } from "../lib/format";

/** Settlement impact simulator — drag the risk thresholds, watch the money move. */
export default function Settlement() {
  const [high, setHigh] = useState(0.85);
  const [medium, setMedium] = useState(0.5);
  const dHigh = useDebounced(high, 300);
  const dMedium = useDebounced(medium, 300);

  const sim = useAsync(() => api.settlementImpact(dHigh, dMedium), [dHigh, dMedium]);

  const data = sim.data;
  const maxRelease = useMemo(
    () => Math.max(1, ...(data?.calendar ?? []).map((c) => c.released)),
    [data],
  );

  if (sim.loading && !data) {
    return (
      <div>
        <div className="skeleton" style={{ width: 260, height: 24, marginBottom: 18 }} />
        <Card title="Settlement impact"><SkeletonRows rows={8} /></Card>
      </div>
    );
  }
  if (sim.error) {
    return <ErrorState title="Could not load settlement impact" error={sim.error} onRetry={sim.refetch} />;
  }
  if (!data?.available) {
    return (
      <Card title="Settlement impact">
        <p className="small muted">
          Scored test artifacts are missing — run train_eval.py first.
        </p>
      </Card>
    );
  }

  const delta = data.held_delta_vs_current;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="section-label">Money in motion</div>
          <h1 className="page-title">Settlement Impact Simulator</h1>
          <p className="page-subtitle">
            Drag the risk thresholds and watch which payouts slip, which merchants get blocked, and
            how much ₹ moves in each settlement cycle — replayed over the scored test window.
          </p>
        </div>
      </div>

      <Card
        title="Risk thresholds"
        actions={
          <InfoTip text="Held payouts (HIGH band) wait for analyst review and release into the next day's settlement cycle. Step-up claims release after a 1-day verification delay." />
        }
      >
        <div className="settle-sliders">
          <label className="settle-slider">
            <span className="small secondary row" style={{ gap: 8 }}>
              HIGH threshold <b className="num" style={{ color: "var(--red)" }}>{pctScore(high)}</b>
              {high !== data.thresholds.current_high && (
                <span className="small muted">(live: {pctScore(data.thresholds.current_high)})</span>
              )}
            </span>
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.01}
              value={high}
              onChange={(e) => setHigh(Number(e.target.value))}
              aria-label="HIGH threshold"
            />
          </label>
          <label className="settle-slider">
            <span className="small secondary row" style={{ gap: 8 }}>
              MEDIUM threshold <b className="num" style={{ color: "var(--amber)" }}>{pctScore(medium)}</b>
              {medium !== data.thresholds.current_medium && (
                <span className="small muted">(live: {pctScore(data.thresholds.current_medium)})</span>
              )}
            </span>
            <input
              type="range"
              min={0.05}
              max={Math.max(0.05, high - 0.05)}
              step={0.01}
              value={medium}
              onChange={(e) => setMedium(Number(e.target.value))}
              aria-label="MEDIUM threshold"
            />
          </label>
        </div>
      </Card>

      <div className="section-gap" />

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">Payouts held</div>
          <div className="kpi-value num" style={{ color: "var(--red)" }}>{num(data.held.count)}</div>
          <div className="kpi-foot num">{inr(data.held.amount)} blocked</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">In step-up</div>
          <div className="kpi-value num" style={{ color: "var(--amber)" }}>{num(data.step_up.count)}</div>
          <div className="kpi-foot num">{inr(data.step_up.amount)} delayed 1 cycle</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Auto-released</div>
          <div className="kpi-value num" style={{ color: "var(--green)" }}>{num(data.auto.count)}</div>
          <div className="kpi-foot num">{inr(data.auto.amount)} same-day</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">vs live thresholds</div>
          <div
            className="kpi-value num"
            style={{ color: delta > 0 ? "var(--red)" : delta < 0 ? "var(--green)" : undefined }}
          >
            {delta > 0 ? "+" : ""}{inrCompact(delta)}
          </div>
          <div className="kpi-foot">{delta === 0 ? "no change" : delta > 0 ? "extra blocked" : "freed up"}</div>
        </div>
      </div>

      <div className="section-gap" />

      <div className="inv-grid">
        <Card title="Settlement calendar — delayed payouts releasing per cycle">
          {data.calendar.length === 0 ? (
            <p className="small muted">No delayed payouts at these thresholds.</p>
          ) : (
            <div role="img" aria-label="Delayed payout value releasing per settlement cycle">
              {data.calendar.map((c, i) => (
                <div key={c.date} className="settle-row">
                  <span className="feature-name num small muted">{c.date.slice(5)}</span>
                  <span className="bar-track" style={{ height: 14 }}>
                    <span
                      className="bar-fill settle-fill"
                      style={{
                        width: `${Math.max(1.5, (c.released / maxRelease) * 100)}%`,
                        background: "var(--blue)",
                        animationDelay: `${i * 40}ms`,
                      }}
                    />
                  </span>
                  <span className="settle-val num">
                    {inrCompact(c.released)}
                    <span className="muted" style={{ fontWeight: 500 }}> · {num(c.delayed_payouts)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="divider" />
          <p className="small muted">
            Window {data.window.from} → {data.window.to}. Each bar is one daily settlement cycle:
            the ₹ value of held/step-up payouts releasing that day, and how many payouts it covers.
          </p>
        </Card>

        <Card title="Most-blocked merchants">
          {data.top_merchants.length === 0 ? (
            <p className="small muted">No merchant has blocked payouts at these thresholds.</p>
          ) : (
            <>
              {data.top_merchants.map((m) => (
                <div key={m.merchant_id} className="spread" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span className="mono small secondary">{m.merchant_id}</span>
                  <span className="row" style={{ gap: 10 }}>
                    <span className="small muted num">{m.held_count} held</span>
                    <span className="num" style={{ fontWeight: 700, color: "var(--red)" }}>{inr(m.held_amount)}</span>
                  </span>
                </div>
              ))}
              <div className="divider" />
              <p className="small muted">
                These merchants would feel the friction first — worth a proactive note before their
                settlement support tickets arrive.
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
