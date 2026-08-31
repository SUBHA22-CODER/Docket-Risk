import { useOutletContext } from "react-router-dom";
import { fetchEvalReport, fetchGnnReport } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { Card, ErrorState, InfoTip, SkeletonRows } from "../components/ui";
import { ImportanceBars, PRChart } from "../components/charts";
import { Icon } from "../components/Icon";
import { FEATURE_LABELS, num, pct } from "../lib/format";
import type { GnnReport } from "../types";

/** Full model-quality evaluation rendered straight from models/eval_report.json. */
export default function Evaluation() {
  const ctx = useOutletContext<{ refreshNonce: number }>();
  const rep = useAsync(fetchEvalReport, [ctx.refreshNonce]);
  const gnn = useAsync(fetchGnnReport, [ctx.refreshNonce]);

  if (rep.loading) {
    return (
      <div>
        <div className="skeleton" style={{ width: 240, height: 24, marginBottom: 18 }} />
        <Card title="Evaluation"><SkeletonRows rows={10} /></Card>
      </div>
    );
  }
  if (rep.error || !rep.data) {
    return <ErrorState title="Could not load evaluation report" error={rep.error} onRetry={rep.refetch} />;
  }
  const r = rep.data;
  const high = r.threshold_sweep.find((s) => s.band === "HIGH");
  const medium = r.threshold_sweep.find((s) => s.band === "MEDIUM");

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="section-label">Model Verification</div>
          <h1 className="page-title">Evaluation Report</h1>
          <p className="page-subtitle">
            Temporal holdout model-quality report produced by <code className="mono">train_eval.py</code>.
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className="badge badge-neutral mono">{r.model_file}</span>
          <div className="small muted num" style={{ marginTop: 4 }}>
            {new Date(r.generated_at).toLocaleDateString("en-IN")}
          </div>
        </div>
      </div>

      <Card title="Temporal split protocol">
        <div className="row-wrap small">
          <span className="badge badge-info">Train · {r.split.train}</span>
          <Icon name="chevron-right" size={13} />
          <span className="badge badge-info">Val · {r.split.val}</span>
          <Icon name="chevron-right" size={13} />
          <span className="badge badge-low">Test · {r.split.test}</span>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          Split by day, never randomly — a claim's features are computed only from graph state that
          existed before its own timestamp, so no future information leaks into training or scoring.
          Random splits are the most common way fraud models post fake near-perfect scores.
        </p>
      </Card>

      <div className="section-gap" />

      <div className="inv-grid">
        <div className="stack">
          <Card title="Precision–recall curve">
            <PRChart
              points={r.pr_curve.points}
              baseline={r.pr_curve.baseline}
              markers={[
                ...(high ? [{ label: "HIGH 0.85", color: "var(--red)", recall: high.recall, precision: high.precision }] : []),
                ...(medium ? [{ label: "MED 0.50", color: "var(--amber)", recall: medium.recall, precision: medium.precision }] : []),
              ]}
              height={340}
            />
          </Card>

          <Card title="Threshold sweep">
            <table className="data" style={{ border: "none" }}>
              <thead>
                <tr>
                  <th>Band</th><th className="num">Threshold</th><th className="num">Precision</th>
                  <th className="num">Recall</th><th className="num">F1</th><th className="num">Flagged</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Feature importance">
            <ImportanceBars
              items={r.feature_importance.map((fi) => ({
                feature: fi.feature,
                label: FEATURE_LABELS[fi.feature] ?? fi.feature,
                importance: fi.importance,
              }))}
            />
          </Card>
        </div>

        <div className="stack">
          <Card title="Headline metrics">
            <Metric label="PR-AUC (test)" value={r.pr_auc.toFixed(4)} tip="Primary metric under 1.7% base-rate imbalance" />
            <Metric label="Base rate" value={pct(r.base_rate, 2)} tip="Share of test claims that are confirmed ring claims" />
            <Metric label="Ring claims in test" value={String(r.n_test_ring_claims)} />
            <Metric label="Total test claims" value={num(r.n_test_claims)} />
            <Metric label="Brier score" value={r.calibration.brier.toFixed(4)} tip="Probability calibration quality" />
            <Metric label="ECE (10 bins)" value={r.calibration.ece_10bin.toFixed(4)} tip="Calibration error across score deciles" />
          </Card>

          <Card title="Monetary outcome — reported as a pair">
            <Metric label="₹ prevented (held pre-payout)" value={`₹${num(Math.round(r.monetary.inr_prevented))}`} color="var(--green)" />
            <Metric label="₹ friction cost (legit delayed)" value={`₹${num(Math.round(r.monetary.inr_friction_cost))}`} color="var(--amber)" />
            <InfoTip text="These two numbers must always travel together." />
          </Card>

          <Card title="Camouflage cohort — adversarial FP test">
            <Metric label="False-flag rate @ HIGH" value={pct(r.camouflage.false_flag_rate_high, 1)} color={r.camouflage.false_flag_rate_high <= 0.05 ? "var(--green)" : "var(--red)"} />
            <Metric label="False-flag rate @ MEDIUM" value={pct(r.camouflage.false_flag_rate_medium, 1)} />
            <Metric label="Cohort size" value={`${r.camouflage.n_claims} claims`} />
          </Card>

          <GnnCard gnn={gnn} />

          <Card title="Known limitations — stated up front">
            <ul className="small secondary" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
              <li>A colluding or compromised merchant feeding bad data into the graph is not modeled — that needs separate merchant-trust tooling.</li>
              <li>Evidence features are temporally safe, but ring members who file their first claims before any sharing accumulates are legitimately missed.</li>
              <li>Scores come from synthetic-but-adversarially-designed data calibrated to realistic imbalance (≈1.7% positives), not production outcomes.</li>
              <li>The hot identity graph lives in one process (snapshot to disk); production would move it to Redis with Postgres for decisions.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tip, color }: { label: string; value: string; tip?: string; color?: string }) {
  return (
    <div className="spread" style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="small secondary row" style={{ gap: 6 }}>
        {label} {tip && <InfoTip text={tip} />}
      </span>
      <span className="num" style={{ fontWeight: 700, fontSize: 14.5, color: color ?? "var(--text)" }}>
        {value}
      </span>
    </div>
  );
}

/** XGBoost vs from-scratch GCN benchmark on the same graph + temporal split. */
function GnnCard({ gnn }: { gnn: ReturnType<typeof useAsync<GnnReport>> }) {
  if (gnn.loading) {
    return (
      <Card title="GNN benchmark">
        <SkeletonRows rows={3} />
      </Card>
    );
  }
  if (gnn.error || !gnn.data) {
    return (
      <Card title="GNN benchmark">
        <p className="small muted">
          Not trained yet — run <code className="mono">python src/train_gnn.py</code> to benchmark a
          graph neural network against XGBoost on this same identity graph.
        </p>
      </Card>
    );
  }
  const g = gnn.data;
  const xgb = g.xgb_pr_auc;
  const maxAuc = Math.max(g.pr_auc, xgb ?? 0, 0.0001);
  return (
    <Card
      title="GNN benchmark — XGBoost vs graph neural network"
      actions={
        <InfoTip text="A 2-layer GCN implemented from scratch in NumPy, message-passing over the shared-infrastructure graph, evaluated on the same disjoint test identities." />
      }
    >
      {[
        { name: "XGBoost (800 trees, monotonic)", value: xgb ?? 0, color: "var(--blue)" },
        { name: `GCN (${g.params} params, from scratch)`, value: g.pr_auc, color: "var(--green)" },
      ].map((row) => (
        <div key={row.name} className="feature-bar-row">
          <span className="feature-name" style={{ maxWidth: 150 }}>{row.name}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${Math.max(3, (row.value / maxAuc) * 100)}%`, background: row.color }}
            />
          </span>
          <span className="num" style={{ fontWeight: 700, minWidth: 52, textAlign: "right" }}>
            {row.value.toFixed(4)}
          </span>
        </div>
      ))}
      <div className="divider" />
      <div className="row-wrap small muted">
        <span>{num(g.n_identities)} identities ({num(g.graph_edges)} graph edges)</span>
        <span>·</span>
        <span>trained in {g.train_seconds}s</span>
        <span>·</span>
        <span>{g.epochs_trained} epochs</span>
        {g.lift_vs_xgb !== null && (
          <>
            <span>·</span>
            <span style={{ color: g.lift_vs_xgb >= 0 ? "var(--green)" : "var(--amber)", fontWeight: 700 }}>
              lift {g.lift_vs_xgb >= 0 ? "+" : ""}{g.lift_vs_xgb.toFixed(4)}
            </span>
          </>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        {g.architecture}. {g.split}. ROC-AUC {g.roc_auc.toFixed(4)}.
      </p>
    </Card>
  );
}
