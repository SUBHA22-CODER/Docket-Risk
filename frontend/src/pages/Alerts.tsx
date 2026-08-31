import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import type { AlertRule } from "../types";
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, SkeletonRows, useToast, type ConfirmSpec } from "../components/ui";
import { Icon } from "../components/Icon";
import { timeAgo } from "../lib/format";

const METRIC_LABELS: Record<AlertRule["metric"], string> = {
  min_score: "Score at least",
  risk_band: "Band reaches",
  cluster_burst: "Cluster burst ≥ (7d)",
};

const condLabel = (r: AlertRule): string => {
  if (r.metric === "min_score") return `score ≥ ${Math.round(r.threshold * 100)}%`;
  if (r.metric === "risk_band") return `band ≥ ${r.threshold >= 2 ? "HIGH" : "MEDIUM"}`;
  return `${Math.round(r.threshold)} claims in 7 days`;
};

export default function Alerts() {
  const ctx = useOutletContext<{ refreshNonce: number }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [nonce, setNonce] = useState(0);
  const [name, setName] = useState("");
  const [metric, setMetric] = useState<AlertRule["metric"]>("min_score");
  const [threshold, setThreshold] = useState("0.9");
  const [webhook, setWebhook] = useState("");

  const rules = useAsync(() => api.alertRules(), [ctx.refreshNonce, nonce]);
  const events = useAsync(() => api.alerts(60), [ctx.refreshNonce, nonce]);
  const bump = () => setNonce((n) => n + 1);

  const create = async () => {
    const thr = metric === "risk_band" ? (threshold === "1" ? 1 : 2) : parseFloat(threshold);
    if (!name.trim() || Number.isNaN(thr)) {
      toast({ tone: "err", title: "Invalid rule", msg: "Name and numeric threshold are required." });
      return;
    }
    try {
      await api.alertRuleAdd({
        name: name.trim(),
        metric,
        threshold: thr,
        webhook_url: webhook.trim() || undefined,
      });
      toast({ tone: "ok", title: "Rule created", msg: "It is now live and matching every scored claim." });
      setName("");
      setWebhook("");
      bump();
    } catch (e) {
      toast({ tone: "err", title: "Could not create rule", msg: (e as Error).message });
    }
  };

  const toggle = async (r: AlertRule) => {
    try {
      await api.alertRuleToggle(r.id, r.enabled === 0);
      bump();
    } catch (e) {
      toast({ tone: "err", title: "Toggle failed", msg: (e as Error).message });
    }
  };

  const remove = (r: AlertRule) =>
    setConfirm({
      title: "Delete rule",
      body: `Delete alert rule “${r.name}”? Triggered alert history is kept.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        try {
          await api.alertRuleDelete(r.id);
          toast({ tone: "ok", title: "Rule deleted" });
          bump();
        } catch (e) {
          toast({ tone: "err", title: "Delete failed", msg: (e as Error).message });
        }
      },
    });

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="section-label">Real-time</div>
          <h1 className="page-title">Alert Rules</h1>
          <p className="page-subtitle">
            Rules are evaluated on every scored claim. Matches stream to the live feed, the bell menu, and any webhook you attach.
          </p>
        </div>
      </div>

      <Card title="Create a rule">
        <div className="row-wrap">
          <input
            className="input"
            style={{ width: 210 }}
            placeholder="Rule name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Rule name"
          />
          <select className="select" value={metric} onChange={(e) => setMetric(e.target.value as AlertRule["metric"])} aria-label="Condition type">
            {(Object.keys(METRIC_LABELS) as AlertRule["metric"][]).map((m) => (
              <option key={m} value={m}>{METRIC_LABELS[m]}</option>
            ))}
          </select>
          {metric === "risk_band" ? (
            <select className="select" value={threshold} onChange={(e) => setThreshold(e.target.value)} aria-label="Band">
              <option value="1">MEDIUM or higher</option>
              <option value="2">HIGH</option>
            </select>
          ) : (
            <input
              className="input num"
              style={{ width: 110 }}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value.replace(metric === "min_score" ? /[^0-9.]/g : /[^0-9]/g, ""))}
              placeholder={metric === "min_score" ? "0.90" : "5"}
              aria-label="Threshold"
            />
          )}
          <input
            className="input mono"
            style={{ width: 250 }}
            placeholder="Optional webhook URL…"
            value={webhook}
            onChange={(e) => setWebhook(e.target.value)}
            aria-label="Webhook URL"
          />
          <Button variant="primary" onClick={create} disabled={!name.trim()}>
            <Icon name="bell" size={13} /> Create rule
          </Button>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Webhooks receive a JSON POST: {"{ rule, claim_id, identity_key, score, action, amount, severity }"}.
        </p>
      </Card>

      <div className="section-gap" />

      <Card title={`Rules (${rules.data?.items.length ?? 0})`}>
        {rules.loading && !rules.data ? (
          <SkeletonRows rows={3} />
        ) : rules.error ? (
          <ErrorState error={rules.error} onRetry={rules.refetch} />
        ) : (rules.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon="bell"
            title="No alert rules yet"
            desc="Create one above — e.g. “Page me on any HIGH-risk claim” or “Burst of 5+ claims in a cluster within 7 days”."
          />
        ) : (
          <div className="table-wrap" style={{ border: "none" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th><th>Condition</th><th>Webhook</th><th>On?</th><th></th>
                </tr>
              </thead>
              <tbody>
                {(rules.data?.items ?? []).map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 650 }}>{r.name}</td>
                    <td className="small secondary">{condLabel(r)}</td>
                    <td className="mono small muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.webhook_url ?? "—"}
                    </td>
                    <td>
                      <input type="checkbox" checked={r.enabled === 1} onChange={() => toggle(r)} aria-label={`Toggle ${r.name}`} />
                    </td>
                    <td>
                      <Button size="sm" variant="ghost" onClick={() => remove(r)} aria-label={`Delete ${r.name}`}>
                        <Icon name="x" size={12} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="section-gap" />

      <Card title="Triggered alerts" bodyClass="">
        {events.loading && !events.data ? (
          <SkeletonRows rows={4} />
        ) : events.error ? (
          <ErrorState error={events.error} onRetry={events.refetch} />
        ) : (events.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon="check"
            title="No alerts fired yet"
            desc="When a scored claim matches a rule it appears here instantly and in the live feed."
          />
        ) : (
          <div>
            {(events.data?.items ?? []).map((ev) => (
              <div key={ev.id} className="feed-row">
                <span className="feed-dot" style={{ background: ev.severity === "HIGH" ? "var(--red)" : "var(--amber)" }} />
                <div className="grow">
                  <div className="row" style={{ gap: 8 }}>
                    <b>{ev.rule_name}</b>
                    <span className={`badge ${ev.severity === "HIGH" ? "badge-high" : "badge-medium"}`}>{ev.severity}</span>
                    {ev.claim_id && (
                      <button className="chip" style={{ margin: 0 }} onClick={() => navigate(`/claims/${ev.claim_id}`)}>
                        {ev.claim_id}
                      </button>
                    )}
                  </div>
                  <div className="small secondary" style={{ marginTop: 2 }}>{ev.detail}</div>
                </div>
                <span className="small muted" title={ev.delivered ? "webhook delivered" : "no webhook / delivery failed"}>
                  {ev.delivered ? "webhook ✓" : ""} · {timeAgo(ev.ts)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
