import { useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { api, fetchEvalReport } from "../lib/api";
import { useAsync } from "../lib/hooks";
import type { ClaimRow } from "../types";
import {
  Card,
  RiskBadge,
  ActionBadge,
  Skeleton,
  SkeletonRows,
  ErrorState,
  InfoTip,
} from "../components/ui";
import { DataTable, Pager, type Column } from "../components/DataTable";
import { SeriesLegend, TimeSeriesChart, DistributionBar, type DayPoint } from "../components/charts";
import { NetworkGraph } from "../components/NetworkGraph";
import { Icon } from "../components/Icon";
import { inr, inrCompact, num, pct, pctScore, timeAgo } from "../lib/format";

const RANGES = [
  { key: "24h", days: 1 },
  { key: "7d", days: 7 },
  { key: "30d", days: 30 },
] as const;

export default function Overview() {
  const navigate = useNavigate();
  const ctx = useOutletContext<{ refreshNonce: number }>();
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("30d");
  const [page, setPage] = useState(1);

  // full scored-test window, aggregated client-side
  const all = useAsync(() => api.claims({ page: 1, page_size: 5000, sort: "ts", order: "asc" }), [ctx.refreshNonce]);
  const evalRep = useAsync(fetchEvalReport, [ctx.refreshNonce]);

  // top high-risk claim for network graph
  const topClaim = useAsync(
    () => api.claims({ risk: "HIGH", sort: "score", order: "desc", page: 1, page_size: 1 }),
    [ctx.refreshNonce],
  );
  const topClaimId = topClaim.data?.items[0]?.claim_id;
  const claimDetail = useAsync(
    () => (topClaimId ? api.claimDetail(topClaimId) : Promise.resolve(null)),
    [topClaimId],
  );

  const rows = all.data?.items ?? [];

  const series = useMemo<DayPoint[]>(() => {
    if (!all.data?.window || rows.length === 0) return [];
    const byDay = new Map<string, DayPoint>();
    for (const r of rows) {
      const day = new Date(r.ts).toISOString().slice(0, 10);
      const d =
        byDay.get(day) ??
        ({ date: day, total: 0, high: 0, medium: 0, low: 0 } as DayPoint);
      d.total += 1;
      if (r.risk_level === "HIGH") d.high += 1;
      else if (r.risk_level === "MEDIUM") d.medium += 1;
      else d.low += 1;
      byDay.set(day, d);
    }
    const out = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
    const days = RANGES.find((r) => r.key === range)?.days ?? 30;
    return out.slice(Math.max(0, out.length - days));
  }, [all.data, rows, range]);

  const dist = useMemo(() => {
    let high = 0,
      med = 0,
      low = 0,
      vh = 0,
      vm = 0,
      vl = 0;
    for (const r of rows) {
      if (r.risk_level === "HIGH") ((high += 1), (vh += r.amount));
      else if (r.risk_level === "MEDIUM") ((med += 1), (vm += r.amount));
      else ((low += 1), (vl += r.amount));
    }
    return [
      { level: "HIGH" as const, count: high, value: vh, color: "var(--red)" },
      { level: "MEDIUM" as const, count: med, value: vm, color: "var(--amber)" },
      { level: "LOW" as const, count: low, value: vl, color: "#1e2d4a" },
    ];
  }, [rows]);

  // derive active signals from actual data
  const signals = useMemo(() => {
    const d = claimDetail.data;
    if (!d) return [];
    const sigs: { id: string; text: string; level: "HIGH" | "MEDIUM" | "LOW" }[] = [];
    if (d.evidence.shared_infra.length > 0) {
      const devCount = d.evidence.shared_infra.filter(s => s.type === "device").reduce((a, s) => a + s.connected_identities.length, 0);
      if (devCount > 0) {
        sigs.push({ id: "SIG-001", text: `Shared device across ${devCount} identities`, level: "HIGH" });
      }
      const vpaCount = d.evidence.shared_infra.filter(s => s.type === "VPA").reduce((a, s) => a + s.connected_identities.length, 0);
      if (vpaCount > 0) {
        sigs.push({ id: "SIG-002", text: `Shared VPA across ${vpaCount} identities`, level: "HIGH" });
      }
    }
    if (d.evidence.recent_cluster_claims_7d > 3) {
      sigs.push({ id: "SIG-003", text: `${d.evidence.recent_cluster_claims_7d} claims connected within 7 days`, level: "HIGH" });
    }
    if (d.evidence.reason_text_reused_across_identities) {
      sigs.push({ id: "SIG-004", text: "Repeated claim reason detected across cluster", level: "MEDIUM" });
    }
    if (d.cluster.members > 1) {
      sigs.push({ id: "SIG-005", text: `Ring cluster: ${d.cluster.members} members, ${d.cluster.shared_infra_types.length} infra types`, level: "HIGH" });
    }
    return sigs;
  }, [claimDetail.data]);

  const flaggedPage = useAsync(
    () => api.claims({ risk: "HIGH", sort: "score", order: "desc", page, page_size: 8 }),
    [page, ctx.refreshNonce],
  );

  if (all.loading && rows.length === 0) {
    return (
      <div>
        <div className="skeleton" style={{ width: 200, height: 18, marginBottom: 16 }} />
        <div className="kpis">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="kpi">
              <Skeleton w="55%" h={8} />
              <Skeleton w="40%" h={20} />
            </div>
          ))}
        </div>
        <Card title="Network">
          <SkeletonRows rows={6} />
        </Card>
      </div>
    );
  }

  if (all.error && rows.length === 0) {
    return (
      <ErrorState
        title="Risk service unavailable"
        error={all.error}
        onRetry={all.refetch}
        extraActions={
          <button className="btn" onClick={() => navigate("/settings")}>
            View system status
          </button>
        }
      />
    );
  }

  const total = num(rows.length);
  const highCount = dist[0]?.count ?? 0;
  const medCount = dist[1]?.count ?? 0;
  const monetary = evalRep.data?.monetary;
  const camo = evalRep.data?.camouflage;

  const columns: Column<ClaimRow>[] = [
    {
      key: "claim_id",
      header: "Claim",
      render: (r) => (
        <span className="row" style={{ gap: 6 }}>
          <span className="mono" style={{ fontWeight: 600 }}>{r.claim_id}</span>
          {r.has_evidence && (
            <InfoTip text={`Shared-infrastructure evidence available · cluster of ${r.cluster_size}`} />
          )}
        </span>
      ),
    },
    { key: "ts", header: "Time", render: (r) => <span className="muted small">{timeAgo(r.ts)}</span>, sortable: false },
    { key: "identity_key", header: "Identity", render: (r) => <span className="mono small secondary">{r.identity_key}</span> },
    { key: "merchant_id", header: "Merchant", render: (r) => <span className="mono small secondary">{r.merchant_id}</span> },
    { key: "amount", header: "Amount", numeric: true, render: (r) => <span className="num">{inr(r.amount)}</span> },
    { key: "score", header: "Score", numeric: true, sortable: true, render: (r) => (
      <span
        className="num"
        style={{ fontWeight: 700, color: r.risk_level === "HIGH" ? "var(--red)" : r.risk_level === "MEDIUM" ? "var(--amber)" : "var(--text-muted)" }}
      >
        {pctScore(r.score)}
      </span>
    ) },
    { key: "risk_level", header: "Level", render: (r) => <RiskBadge level={r.risk_level} /> },
    { key: "action", header: "Action", render: (r) => <ActionBadge action={r.action} />, sortable: false },
  ];

  const flaggedTotal = flaggedPage.data?.total ?? 0;
  const d = claimDetail.data;

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <div className="section-label">Overview</div>
          <h1 className="page-title">Network Risk Overview</h1>
          <p className="page-subtitle">
            Coordinated refund-ring risk across the evaluation window
            {all.data?.window && (
              <> · {all.data.window.from} → {all.data.window.to}</>
            )}
          </p>
        </div>
        {d && d.cluster.members > 1 && (
          <div className="sentinel-signal">
            <div>
              <div className="sentinel-signal-label">Sentinel Signal</div>
              <div className="sentinel-signal-score num" style={{ color: d.risk_level === "HIGH" ? "var(--red)" : d.risk_level === "MEDIUM" ? "var(--amber)" : "var(--green)" }}>
                {pctScore(d.score)}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="sentinel-signal-bar">
                <div className="sentinel-signal-fill" style={{
                  width: `${Math.round(d.score * 100)}%`,
                  background: d.risk_level === "HIGH" ? "var(--red)" : d.risk_level === "MEDIUM" ? "var(--amber)" : "var(--green)",
                }} />
              </div>
              <div className="small muted" style={{ marginTop: 2 }}>
                {d.cluster.ring_id ?? "Active cluster"} · {d.cluster.members} identities
              </div>
            </div>
            <RiskBadge level={d.risk_level} />
          </div>
        )}
      </div>

      {/* ── Network Graph + Risk Summary ── */}
      <div className="overview-network">
        <Card
          title={
            <span className="row" style={{ gap: 6 }}>
              Network intelligence
              <InfoTip text="Highest-risk cluster in the evaluation window. Identity nodes (circles) connect through shared infrastructure (boxes)." />
            </span>
          }
          actions={
            d && (
              <button className="btn btn-sm" onClick={() => navigate(`/claims/${d.claim.claim_id}`)}>
                Investigate <Icon name="chevron-right" size={11} />
              </button>
            )
          }
        >
          {d && d.graph.nodes.length > 0 ? (
            <NetworkGraph
              nodes={d.graph.nodes}
              edges={d.graph.edges}
              flaggedIdentity={d.claim.identity_key}
              height={380}
            />
          ) : claimDetail.loading || topClaim.loading ? (
            <SkeletonRows rows={6} />
          ) : (
            <div className="state-block" style={{ padding: "40px 16px" }}>
              <div className="state-icon info"><Icon name="network" size={18} /></div>
              <div className="state-title">No cluster data</div>
              <p className="state-desc">
                Run train_eval.py to populate scored claims with network evidence.
              </p>
            </div>
          )}
        </Card>

        {/* Right panel — Risk Summary */}
        <div className="stack">
          <Card title="Risk summary">
            <div className="risk-summary-row">
              <span className="risk-summary-label">High risk</span>
              <span className="risk-summary-value num" style={{ color: "var(--red)" }}>{num(highCount)}</span>
            </div>
            <div className="risk-summary-row">
              <span className="risk-summary-label">Medium</span>
              <span className="risk-summary-value num" style={{ color: "var(--amber)" }}>{num(medCount)}</span>
            </div>
            <div className="risk-summary-row">
              <span className="risk-summary-label">Total screened</span>
              <span className="risk-summary-value num">{total}</span>
            </div>
            {monetary && (
              <>
                <div className="divider" />
                <div className="risk-summary-row">
                  <span className="risk-summary-label">Prevented</span>
                  <span className="risk-summary-value num" style={{ color: "var(--green)" }}>{inrCompact(monetary.inr_prevented)}</span>
                </div>
                <div className="risk-summary-row">
                  <span className="risk-summary-label">Friction</span>
                  <span className="risk-summary-value num">{inrCompact(monetary.inr_friction_cost)}</span>
                </div>
              </>
            )}
            {camo && (
              <>
                <div className="divider" />
                <div className="risk-summary-row">
                  <span className="risk-summary-label">False-flag rate</span>
                  <span className="risk-summary-value num">{pct(camo.false_flag_rate_high, 1)}</span>
                </div>
              </>
            )}
          </Card>

          <Card title="Distribution">
            <DistributionBar buckets={dist} />
          </Card>
        </div>
      </div>

      {/* ── Active Signals ── */}
      <div className="overview-signals">
        <Card title="Active signals">
          {signals.length > 0 ? (
            signals.map((sig) => (
              <div key={sig.id} className="signal-row" onClick={() => topClaimId && navigate(`/claims/${topClaimId}`)}>
                <div className="evidence-signal" style={{ background: sig.level === "HIGH" ? "var(--red)" : sig.level === "MEDIUM" ? "var(--amber)" : "var(--green)", marginTop: 4 }} />
                <div className="grow">
                  <div className="signal-id">{sig.id}</div>
                  <div className="signal-text">{sig.text}</div>
                </div>
                <RiskBadge level={sig.level} />
              </div>
            ))
          ) : (
            <div className="small muted" style={{ padding: "12px 0" }}>
              No active signals detected. Signals are derived from cluster evidence on the highest-risk claims.
            </div>
          )}
        </Card>

        <Card
          title="Risk activity"
          actions={
            <div className="segmented" role="tablist" aria-label="Time range">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  role="tab"
                  aria-selected={range === r.key}
                  className={range === r.key ? "active" : ""}
                  onClick={() => setRange(r.key)}
                >
                  {r.key}
                </button>
              ))}
            </div>
          }
        >
          <div className="spread" style={{ marginBottom: 6 }}>
            <SeriesLegend />
          </div>
          {series.length > 0 ? (
            <TimeSeriesChart data={series} height={180} />
          ) : (
            <SkeletonRows rows={3} />
          )}
        </Card>
      </div>

      {/* ── Flagged Claims Table ── */}
      <Card
        title="Flagged payouts — highest scores"
        actions={
          <button className="btn btn-sm" onClick={() => navigate("/claims?risk=HIGH")}>
            Full queue <Icon name="chevron-right" size={11} />
          </button>
        }
      >
        {flaggedPage.loading && flaggedTotal === 0 ? (
          <SkeletonRows rows={5} />
        ) : flaggedPage.error ? (
          <ErrorState error={flaggedPage.error} onRetry={flaggedPage.refetch} />
        ) : (
          <DataTable
            ariaLabel="Flagged claims"
            columns={columns}
            rows={flaggedPage.data?.items ?? []}
            rowKey={(r) => r.claim_id}
            onRowClick={(r) => navigate(`/claims/${encodeURIComponent(r.claim_id)}`)}
            emptyTitle="No high-risk claims"
            emptyDesc="Nothing crossed the HOLD threshold in this window."
            footer={
              <Pager
                page={page}
                pageSize={8}
                total={flaggedTotal}
                onPage={setPage}
              />
            }
          />
        )}
      </Card>
    </div>
  );
}
