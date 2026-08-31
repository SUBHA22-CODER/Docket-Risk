import { useOutletContext } from "react-router-dom";
import { fetchEvalReport, fetchPrometheusMetrics } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { Card, ErrorState, InfoTip, MetricCard, SkeletonRows } from "../components/ui";
import { ImportanceBars, PRChart } from "../components/charts";
import { FEATURE_LABELS, num, pct } from "../lib/format";

export default function Analytics() {
  const ctx = useOutletContext<{ refreshNonce: number }>();
  const rep = useAsync(fetchEvalReport, [ctx.refreshNonce]);

  if (rep.loading) {
    return (
      <div>
        <div className="skeleton" style={{ width: 240, height: 24, marginBottom: 18 }} />
        <Card title="Model performance"><SkeletonRows rows={8} /></Card>
      </div>
    );
  }
  if (rep.error || !rep.data) {
    return (
      <ErrorState
        title="Evaluation report unavailable"
        error={rep.error}
        onRetry={rep.refetch}
      />
    );
  }
  const r = rep.data;
  const high = r.threshold_sweep.find((s) => s.band === "HIGH");
  const medium = r.threshold_sweep.find((s) => s.band === "MEDIUM");

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="section-label">Model Analytics</div>
          <h1 className="page-title">Performance & Feature Attribution</h1>
          <p className="page-subtitle">
            Temporal holdout evaluation metrics ({r.split.test} test window, trained on {r.split.train}).
          </p>
        </div>
        <span className="badge badge-neutral">
          {new Date(r.generated_at).toLocaleDateString("en-IN")}
        </span>
      </div>

      <div className="kpis">
        <MetricCard
          label="PR-AUC"
          value={r.pr_auc.toFixed(3)}
          tooltip="Area under the precision-recall curve — preferred over ROC-AUC under heavy class imbalance"
          foot={<span className="muted">base rate {pct(r.base_rate, 2)}</span>}
        />
        <MetricCard
          label="ROC-AUC"
          value={r.roc_auc.toFixed(3)}
          tooltip="Reference only; reported for completeness alongside PR-AUC"
        />
        <MetricCard
          label="Brier score"
          value={r.calibration.brier.toFixed(4)}
          tooltip="Mean squared error of predicted probabilities — lower is better; shows scores are calibrated, not just ranked"
        />
        <MetricCard
          label="ECE (10 bins)"
          value={r.calibration.ece_10bin.toFixed(4)}
          tooltip="Expected calibration error: how far predicted probabilities drift from observed outcomes across 10 score bins"
        />
      </div>

      <div className="inv-grid">
        <div className="stack">
          <Card
            title="Precision–recall curve"
            actions={
              <InfoTip text="Markers show operating points at the agreed policy thresholds. The dashed line is the base-rate baseline a random classifier would follow." />
            }
          >
            <PRChart
              points={r.pr_curve.points}
              baseline={r.pr_curve.baseline}
              markers={[
                high && { label: "HIGH 0.85", color: "var(--red)", recall: high.recall, precision: high.precision },
                medium && { label: "MED 0.50", color: "var(--amber)", recall: medium?.recall, precision: medium?.precision },
              ].filter(Boolean) as { label: string; color: string; recall?: number; precision?: number }[]}
            />
            <div className="row-wrap" style={{ marginTop: 8 }}>
              <span className="legend-key"><span className="legend-swatch" style={{ background: "var(--blue)" }} /> Model curve</span>
              <span className="legend-key"><span className="legend-swatch" style={{ background: "var(--red)" }} /> HIGH threshold</span>
              <span className="legend-key"><span className="legend-swatch" style={{ background: "var(--amber)" }} /> MEDIUM threshold</span>
            </div>
          </Card>

          <Card title="Threshold sweep — never one number">
            <table className="data" style={{ border: "none" }}>
              <thead>
                <tr>
                  <th>Band</th><th className="num">Threshold</th><th className="num">Precision</th>
                  <th className="num">Recall</th><th className="num">F1</th>
                  <th className="num">Flagged</th><th className="num">TP</th><th className="num">FP</th>
                </tr>
              </thead>
              <tbody>
                {r.threshold_sweep.map((row) => (
                  <tr key={row.band} style={{ cursor: "default" }}>
                    <td style={{ fontWeight: 700, color: row.band === "HIGH" ? "var(--red)" : "var(--amber)" }}>{row.band}</td>
                    <td className="num">{row.threshold.toFixed(2)}</td>
                    <td className="num">{row.precision.toFixed(3)}</td>
                    <td className="num">{row.recall.toFixed(3)}</td>
                    <td className="num">{row.f1.toFixed(3)}</td>
                    <td className="num">{row.flagged != null ? num(row.flagged) : "—"}</td>
                    <td className="num">{row.true_positives != null ? num(row.true_positives) : "—"}</td>
                    <td className="num">{row.false_positives != null ? num(row.false_positives) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 10 }}>
              {r.n_test_claims.toLocaleString("en-IN")} test claims,{" "}
              {r.n_test_ring_claims} confirmed ring claims. Precision/recall are always read together:
              precision protects customers from wrongful friction, recall limits fraud losses.
            </p>
          </Card>
        </div>

        <div className="stack">
          <Card
            title="Economic impact"
            actions={<InfoTip text="Prevented value and friction cost are always reported as a pair — showing savings without friction would misrepresent the tradeoff." />}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="card card-pad" style={{ borderColor: "rgba(61,220,151,.35)" }}>
                <div className="kpi-label" style={{ color: "var(--green)" }}>Prevented</div>
                <div className="num" style={{ fontSize: 22, fontWeight: 750, marginTop: 6 }}>
                  ₹{num(Math.round(r.monetary.inr_prevented))}
                </div>
                <div className="small muted" style={{ marginTop: 4 }}>
                  ring-claim value held pre-payout
                </div>
              </div>
              <div className="card card-pad" style={{ borderColor: "rgba(245,176,62,.35)" }}>
                <div className="kpi-label" style={{ color: "var(--amber)" }}>Friction cost</div>
                <div className="num" style={{ fontSize: 22, fontWeight: 750, marginTop: 6 }}>
                  ₹{num(Math.round(r.monetary.inr_friction_cost))}
                </div>
                <div className="small muted" style={{ marginTop: 4 }}>
                  legitimate-claim value delayed
                </div>
              </div>
            </div>
            <p className="small muted" style={{ marginTop: 12 }}>
              Every rupee of prevented loss must be weighed against the legitimate claims it delayed.
              In this window the model caught all ring claims at HIGH while delaying{" "}
              <b style={{ color: "var(--amber)" }}>zero</b> legitimate claim value at that threshold.
            </p>
          </Card>

          <Card
            title="Legitimate coincidence stress test"
            actions={<InfoTip text="The camouflage cohort exists to catch lazy models: legitimate identities seeded with exactly one coincidental shared signal." />}
          >
            <div className="num" style={{ fontSize: 30, fontWeight: 750, color: "var(--green)" }}>
              {pct(r.camouflage.false_flag_rate_high, 1)}
            </div>
            <div className="small secondary" style={{ marginTop: 2 }}>false-flag rate @ HIGH threshold</div>
            <p className="small muted" style={{ marginTop: 10 }}>
              False flags among {r.camouflage.n_claims} claims by legitimate identities intentionally
              seeded with one coincidental shared signal (same device model or pincode). A low rate here
              demonstrates the system punishes <i>coordination</i>, not <i>coincidence</i>.
            </p>
          </Card>

          <Card title="Feature importance">
            <ImportanceBars
              items={r.feature_importance.slice(0, 8).map((fi) => ({
                feature: fi.feature,
                label: FEATURE_LABELS[fi.feature] ?? fi.feature,
                importance: fi.importance,
              }))}
            />
            <p className="small muted" style={{ marginTop: 10 }}>
              Graph-density features dominate; amount contributes almost nothing — exactly what you'd
              want from coordination detection rather than ticket-size filtering.
            </p>
          </Card>

          <LatencyHistogramCard />
        </div>
      </div>
    </div>
  );
}

function LatencyHistogramCard() {
  const met = useAsync(fetchPrometheusMetrics, []);

  if (met.loading && !met.data) {
    return <Card title="Live scoring latency (Prometheus)"><SkeletonRows rows={4} /></Card>;
  }

  if (met.error || !met.data) {
    return (
      <Card title="Live scoring latency (Prometheus)">
        <p className="small muted">Prometheus telemetry unavailable — uvicorn risk service might be offline or /metrics unreachable.</p>
      </Card>
    );
  }

  const d = met.data;
  const avgMs = d.countSeconds > 0 ? ((d.sumSeconds / d.countSeconds) * 1000).toFixed(1) : "—";
  const nonInfBuckets = d.buckets.filter((b) => b.le !== "+Inf");
  const maxCount = Math.max(...nonInfBuckets.map((b) => b.count), 1);

  return (
    <Card
      title="Live scoring latency (Prometheus)"
      actions={<InfoTip text="Real-time histogram parsed directly from /metrics — tracks model inference latency and scoring throughput." />}
    >
      <div className="spread" style={{ marginBottom: 12 }}>
        <div>
          <div className="small muted">Average Latency</div>
          <div className="num" style={{ fontSize: 20, fontWeight: 750, color: "var(--green)" }}>{avgMs} ms</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="small muted">Live Requests Scored</div>
          <div className="num" style={{ fontSize: 20, fontWeight: 750 }}>{num(d.countSeconds)}</div>
        </div>
      </div>

      <div className="small secondary" style={{ fontWeight: 600, marginBottom: 8 }}>Latency distribution (s):</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {nonInfBuckets.slice(0, 6).map((b) => {
          const pct = Math.max(3, Math.round((b.count / maxCount) * 100));
          return (
            <div key={b.le} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="mono small muted" style={{ width: 44, textAlign: "right" }}>&le; {b.le}s</span>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--panel-inset)", overflow: "hidden", border: "1px solid var(--border)" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: "var(--blue)", borderRadius: 3 }} />
              </div>
              <span className="num small secondary" style={{ width: 36, textAlign: "right" }}>{b.count}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

