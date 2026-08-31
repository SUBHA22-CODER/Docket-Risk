import { useNavigate, useOutletContext } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import type { AnalystAction, CaseState } from "../types";
import { Button, Card, EmptyState, ErrorState, RiskBadge, SkeletonRows } from "../components/ui";
import { Icon } from "../components/Icon";
import { CASE_STATUS_CLASS, CASE_STATUS_LABELS, inr, maskId, pctScore, slaLabel, timeAgo } from "../lib/format";

/** Analyst activity feed + the claims that currently have open human actions. */
export default function Investigations() {
  const navigate = useNavigate();
  const ctx = useOutletContext<{ refreshNonce: number }>();

  const decisions = useAsync(() => api.decisions(undefined).then((r) => r.items), [ctx.refreshNonce]);
  const holds = useAsync(
    () => api.claims({ risk: "HIGH", sort: "score", order: "desc", page: 1, page_size: 10 }),
    [ctx.refreshNonce],
  );
  const cases = useAsync(() => api.cases(), [ctx.refreshNonce]);
  const caseMap = new Map<string, CaseState>();
  for (const c of cases.data?.items ?? []) caseMap.set(c.claim_id, c);

  const byClaim = new Map<string, AnalystAction[]>();
  for (const a of decisions.data ?? []) {
    const list = byClaim.get(a.claim_id) ?? [];
    list.push(a);
    byClaim.set(a.claim_id, list);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="section-label">Human Review</div>
          <h1 className="page-title">Investigations & Audit Log</h1>
          <p className="page-subtitle">
            Human-in-the-loop decisions: held payouts requiring analyst review and complete audit trail.
          </p>
        </div>
        <Button onClick={() => navigate("/claims?risk=HIGH")}>
          Open HIGH-risk queue <Icon name="chevron-right" size={13} />
        </Button>
      </div>

      <Card title="Awaiting review — highest scores">
        {holds.loading ? (
          <SkeletonRows rows={5} />
        ) : holds.error ? (
          <ErrorState error={holds.error} onRetry={holds.refetch} />
        ) : (holds.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="No high-risk claims"
            desc="Nothing is crossing the HOLD threshold right now. New flagged payouts will appear here."
          />
        ) : (
          <table className="data" style={{ border: "none" }}>
            <thead>
              <tr>
                <th>Claim</th><th>Identity</th><th className="num">Amount</th>
                <th className="num">Score</th><th>Risk</th><th>Case</th><th>SLA</th><th>Analyst activity</th>
              </tr>
            </thead>
            <tbody>
              {(holds.data?.items ?? []).map((c) => {
                const acts = byClaim.get(c.claim_id) ?? [];
                const cs = caseMap.get(c.claim_id);
                const sla = slaLabel(cs?.sla_due_at);
                return (
                  <tr key={c.claim_id} onClick={() => navigate(`/claims/${c.claim_id}`)}>
                    <td className="mono" style={{ fontWeight: 600 }}>{c.claim_id}</td>
                    <td className="mono small secondary">{maskId(c.identity_key)}</td>
                    <td className="num">{inr(c.amount)}</td>
                    <td className="num" style={{ fontWeight: 700, color: "var(--red)" }}>{pctScore(c.score)}</td>
                    <td><RiskBadge level={c.risk_level} /></td>
                    <td>
                      {cs ? (
                        <span className="row" style={{ gap: 6 }}>
                          <span className={`badge ${CASE_STATUS_CLASS[cs.status] ?? "badge-neutral"}`}>
                            {CASE_STATUS_LABELS[cs.status] ?? cs.status}
                          </span>
                          {cs.assigned_to && <span className="mono small muted">{cs.assigned_to}</span>}
                        </span>
                      ) : (
                        <span className="small muted">no case</span>
                      )}
                    </td>
                    <td>
                      {cs?.sla_due_at ? (
                        <span className="small num" style={{ fontWeight: 700, color: sla.overdue ? "var(--red)" : "var(--text-secondary)" }}>
                          {sla.text}
                        </span>
                      ) : (
                        <span className="small muted">—</span>
                      )}
                    </td>
                    <td>
                      {acts.length > 0 ? (
                        <span className="badge badge-info">{acts.length} action{acts.length === 1 ? "" : "s"}</span>
                      ) : (
                        <span className="small muted">unreviewed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div className="section-gap" />

      <Card
        title="Analyst activity (audit trail)"
        actions={
          <button className="btn btn-ghost btn-sm" onClick={decisions.refetch} aria-label="Refresh audit trail">
            <Icon name="refresh" size={12} />
          </button>
        }
      >
        {decisions.loading && !decisions.data ? (
          <SkeletonRows rows={4} />
        ) : decisions.error ? (
          <ErrorState error={decisions.error} onRetry={decisions.refetch} />
        ) : (decisions.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="clock"
            title="No analyst actions yet"
            desc="Approve, hold, or note actions taken on an investigation are recorded here with actor, previous state, new state, and reason."
          />
        ) : (
          <div>
            {(decisions.data ?? []).map((a) => (
              <div key={a.id} className="audit-row">
                <span className="audit-ts">{timeAgo(a.ts)}</span>
                <div className="grow">
                  <div>
                    <b>{a.actor}</b>{" "}
                    <button
                      className="chip"
                      style={{ margin: 0 }}
                      onClick={() => navigate(`/claims/${a.claim_id}`)}
                    >
                      {a.claim_id}
                    </button>{" "}
                    {a.kind === "decision" && a.prev_action && a.new_action && (
                      <span className="arrow-change muted">
                        {a.prev_action.replace("_PAYOUT_HUMAN_REVIEW", "")} →{" "}
                        <b style={{ color: "var(--text)" }}>
                          {a.new_action.replace("_PAYOUT_HUMAN_REVIEW", "")}
                        </b>
                      </span>
                    )}
                    {a.kind !== "decision" && (
                      <span className="badge badge-info" style={{ marginLeft: 4 }}>
                        {a.kind.replace("_", " ")}
                      </span>
                    )}
                  </div>
                  <div className="small muted">“{a.reason}”</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
