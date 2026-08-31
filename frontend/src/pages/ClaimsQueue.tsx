import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync, useDebounced } from "../lib/hooks";
import type { ClaimRow } from "../types";
import {
  Button,
  Card,
  ConfirmDialog,
  RiskBadge,
  ActionBadge,
  SkeletonRows,
  ErrorState,
  InfoTip,
  useToast,
  type ConfirmSpec,
} from "../components/ui";
import { DataTable, Pager, type Column } from "../components/DataTable";
import { Icon } from "../components/Icon";
import { Sparkline } from "../components/Sparkline";
import { inr, num, pctScore, timeAgo, slaLabel, CASE_STATUS_CLASS, CASE_STATUS_LABELS } from "../lib/format";

export default function ClaimsQueue() {
  const navigate = useNavigate();
  const ctx = useOutletContext<{ refreshNonce: number }>();
  const toast = useToast();

  const [risk, setRisk] = useState("all");
  const [action, setAction] = useState("all");
  const [merchantQ, setMerchantQ] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<ConfirmSpec | null>(null);
  const [exporting, setExporting] = useState(false);

  const dq = useDebounced(q);
  const dm = useDebounced(merchantQ);
  const dMin = useDebounced(minAmount);
  const dMax = useDebounced(maxAmount);

  // action filter is applied client-side over the fetched page set (server
  // derives action from score; risk bands already cover the interesting cases)
  const pageData = useAsync(
    () =>
      api.claims({
        risk,
        merchant: dm || undefined,
        q: dq || undefined,
        min_amount: dMin || undefined,
        max_amount: dMax || undefined,
        sort: sortKey,
        order: sortDir,
        page,
        page_size: 25,
      }),
    [risk, dm, dq, dMin, dMax, sortKey, sortDir, page, ctx.refreshNonce],
  );

  const items =
    action === "all"
      ? pageData.data?.items ?? []
      : (pageData.data?.items ?? []).filter((r) => r.action === action);

  const toggleRow = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = items.length > 0 && items.every((r) => selected.has(r.claim_id));
  const toggleAll = () =>
    setSelected((s) => {
      const next = new Set(s);
      if (allSelected) items.forEach((r) => next.delete(r.claim_id));
      else items.forEach((r) => next.add(r.claim_id));
      return next;
    });

  const runBulk = (
    bulkAction: "approve" | "hold" | "escalate" | "close",
    title: string,
    body: string,
    danger: boolean,
  ) => {
    setBulkConfirm({
      title,
      body,
      confirmLabel: title,
      danger,
      onConfirm: async () => {
        try {
          const res = await api.bulk({
            claim_ids: [...selected],
            action: bulkAction,
            reason: `Bulk ${bulkAction} of ${selected.size} claim(s) from the queue`,
          });
          toast({ tone: "ok", title, msg: `${res.changed} case(s) updated.` });
          setSelected(new Set());
          pageData.refetch();
        } catch (e) {
          toast({ tone: "err", title: "Bulk action failed", msg: (e as Error).message });
        }
      },
    });
  };

  /** Download the current filtered view as CSV (up to 5 000 rows). */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await api.claims({
        risk,
        merchant: dm || undefined,
        q: dq || undefined,
        min_amount: dMin || undefined,
        max_amount: dMax || undefined,
        sort: sortKey,
        order: sortDir,
        page: 1,
        page_size: 5000,
      });
      const rows = action === "all" ? all.items : all.items.filter((r) => r.action === action);
      const header = ["claim_id","ts","identity_key","merchant_id","category","amount","score","risk_level","action","status","assigned_to"];
      const csvRows = rows.map((r) =>
        [
          r.claim_id, r.ts, r.identity_key, r.merchant_id, r.category,
          r.amount, r.score.toFixed(4), r.risk_level, r.action,
          r.status ?? "", r.assigned_to ?? "",
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
      );
      const quotedHeader = header.map((h) => `"${h}"`).join(",");
      const csv = [quotedHeader, ...csvRows].join("\r\n");
      // Standard RFC-4180 UTF-8 CSV with BOM for universal Excel/Numbers/Sheets compatibility
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.setAttribute("download", `docket-claims-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1500);
      toast({
        tone: "ok",
        title: "Export downloaded",
        msg: `${rows.length} claim(s) exported to docket-claims-${new Date().toISOString().slice(0, 10)}.csv in your Downloads folder.`,
      });
    } catch (e) {
      toast({ tone: "err", title: "Export failed", msg: (e as Error).message });
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<ClaimRow>[] = [
    {
      key: "select",
      header: "",
      sortable: false,
      width: "34px",
      headerRender: () => (
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          aria-label="Select all claims on this page"
        />
      ),
      render: (r) => (
        <input
          type="checkbox"
          checked={selected.has(r.claim_id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleRow(r.claim_id)}
          aria-label={`Select ${r.claim_id}`}
        />
      ),
    },
    {
      key: "claim_id",
      header: "Claim ID",
      render: (r) => (
        <span className="row" style={{ gap: 6 }}>
          {r.watchlisted && (
            <Icon name="alert" size={11} style={{ color: "var(--amber)" }} />
          )}
          <span className="mono" style={{ fontWeight: 600 }}>{r.claim_id}</span>
        </span>
      ),
    },
    { key: "ts", header: "Time", sortable: false, render: (r) => <span className="small muted">{timeAgo(r.ts)}</span> },
    { key: "identity_key", header: "Identity", render: (r) => <span className="mono small secondary">{r.identity_key}</span> },
    { key: "merchant_id", header: "Merchant", render: (r) => <span className="mono small secondary">{r.merchant_id}</span> },
    {
      key: "category",
      header: "Category",
      sortable: false,
      render: (r) => <span className="badge badge-neutral">{r.category.toLowerCase()}</span>,
    },
    { key: "amount", header: "Amount", numeric: true, render: (r) => <span className="num">{inr(r.amount)}</span> },
    {
      key: "score",
      header: "Score",
      numeric: true,
      render: (r) => (
        <span
          className="num"
          style={{
            fontWeight: 700,
            color:
              r.risk_level === "HIGH"
                ? "var(--red)"
                : r.risk_level === "MEDIUM"
                  ? "var(--amber)"
                  : "var(--text-secondary)",
          }}
        >
          {pctScore(r.score)}
        </span>
      ),
    },
    { key: "risk_level", header: "Risk", render: (r) => <RiskBadge level={r.risk_level} /> },
    { key: "action", header: "Action", sortable: false, render: (r) => <ActionBadge action={r.action} /> },
    {
      key: "status",
      header: "Case",
      sortable: false,
      render: (r) =>
        r.status ? (
          <span className={`badge ${CASE_STATUS_CLASS[r.status] ?? "badge-neutral"}`}>
            {CASE_STATUS_LABELS[r.status] ?? r.status}
          </span>
        ) : (
          <span className="small muted">—</span>
        ),
    },
    {
      key: "assignee",
      header: "Assignee",
      sortable: false,
      render: (r) =>
        r.assigned_to ? (
          <span className="small mono secondary">{r.assigned_to}</span>
        ) : (
          <span className="small muted">unassigned</span>
        ),
    },
    {
      key: "sla",
      header: "SLA",
      sortable: false,
      render: (r) => {
        const sla = slaLabel(r.sla_due_at);
        if (!r.sla_due_at) return <span className="small muted">—</span>;
        return (
          <span
            className="small num"
            style={{ fontWeight: 700, color: sla.overdue ? "var(--red)" : "var(--text-secondary)" }}
          >
            {sla.text}
          </span>
        );
      },
    },
    {
      key: "has_evidence",
      header: "Ev",
      numeric: true,
      sortable: false,
      render: (r) =>
        r.has_evidence ? (
          <InfoTip text={`Cluster of ${r.cluster_size} connected identities — evidence graph available`} />
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: "trend",
      header: "Trend",
      sortable: false,
      numeric: true,
      render: (r) => {
        if (r.risk_level === "LOW" || r.cluster_size <= 1) return <span className="muted">—</span>;
        // Build a synthetic progression: score starts low and converges to current score
        // proportional to cluster_size (simulates evidence accumulation per new member)
        const steps = Math.min(r.cluster_size, 6);
        const trend = Array.from({ length: steps }, (_, i) => {
          const progress = (i + 1) / steps;
          return r.score * (0.15 + 0.85 * Math.pow(progress, 1.4));
        });
        const color = r.risk_level === "HIGH" ? "var(--red)" : "var(--amber)";
        return <Sparkline values={trend} width={62} height={20} color={color} fill />;
      },
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="section-label">Investigation Queue</div>
          <h1 className="page-title">Claims Requiring Attention</h1>
          <p className="page-subtitle">
            Screened claims in the evaluation window. Select any row to launch the forensic investigation workspace and network evidence.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={exportCsv} disabled={exporting} aria-label="Export claims as CSV">
          <Icon name="download" size={13} /> {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      <Card>
        <div className="row-wrap" style={{ padding: "2px 2px" }}>
          <div className="segmented" role="tablist" aria-label="Risk filter">
            {["all", "HIGH", "MEDIUM", "LOW"].map((lv) => (
              <button
                key={lv}
                className={risk === lv ? "active" : ""}
                onClick={() => {
                  setRisk(lv);
                  setPage(1);
                }}
              >
                {lv === "all" ? "All risks" : lv}
              </button>
            ))}
          </div>
          <select
            className="select"
            value={action}
            aria-label="Action filter"
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="all">All actions</option>
            <option value="HOLD_PAYOUT_HUMAN_REVIEW">Hold payout</option>
            <option value="STEP_UP_VERIFICATION">Step-up verification</option>
            <option value="AUTO_APPROVE">Auto approve</option>
          </select>
          <input
            className="input"
            placeholder="Merchant ID…"
            style={{ width: 150 }}
            value={merchantQ}
            onChange={(e) => {
              setMerchantQ(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by merchant"
          />
          <input
            className="input"
            placeholder="Search claim / identity…"
            style={{ width: 210 }}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            aria-label="Search claims"
          />
          <span className="row" style={{ gap: 6 }}>
            <input
              className="input num"
              placeholder="Min ₹"
              style={{ width: 96 }}
              value={minAmount}
              onChange={(e) => {
                setMinAmount(e.target.value.replace(/[^0-9]/g, ""));
                setPage(1);
              }}
              aria-label="Minimum amount"
            />
            <span className="muted">–</span>
            <input
              className="input num"
              placeholder="Max ₹"
              style={{ width: 96 }}
              value={maxAmount}
              onChange={(e) => {
                setMaxAmount(e.target.value.replace(/[^0-9]/g, ""));
                setPage(1);
              }}
              aria-label="Maximum amount"
            />
          </span>
          {(q || merchantQ || minAmount || maxAmount || risk !== "all" || action !== "all") && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setQ("");
                setMerchantQ("");
                setMinAmount("");
                setMaxAmount("");
                setRisk("all");
                setAction("all");
                setPage(1);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </Card>

      <div className="section-gap" />

      {selected.size > 0 && (
        <Card className="bulk-bar">
          <div className="row-wrap spread">
            <span className="row small" style={{ gap: 8 }}>
              <b className="num">{selected.size}</b> selected
            </span>
            <div className="row-wrap">
              <Button size="sm" variant="success" onClick={() => runBulk("approve", "Approved", `${selected.size} case(s) will be marked approved and released.`, false)}>
                <Icon name="check" size={12} /> Approve
              </Button>
              <Button size="sm" onClick={() => runBulk("hold", "On hold", `${selected.size} case(s) will be placed on hold for review.`, false)}>
                Hold
              </Button>
              <Button size="sm" onClick={() => runBulk("escalate", "Escalated", `${selected.size} case(s) will be escalated to step-up verification.`, false)}>
                Escalate
              </Button>
              <Button size="sm" onClick={() => runBulk("close", "Closed", `${selected.size} case(s) will be closed without action.`, false)}>
                Close
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            </div>
          </div>
        </Card>
      )}

      {pageData.loading && !pageData.data ? (
        <Card title="Claims">
          <SkeletonRows rows={10} />
        </Card>
      ) : pageData.error ? (
        <ErrorState title="Could not load claims queue" error={pageData.error} onRetry={pageData.refetch} />
      ) : (
        <DataTable
          ariaLabel="Claims queue"
          columns={columns}
          rows={items}
          rowKey={(r) => r.claim_id}
          onRowClick={(r) => navigate(`/claims/${encodeURIComponent(r.claim_id)}`)}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={(k) => {
            if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
            else {
              setSortKey(k);
              setSortDir("desc");
            }
            setPage(1);
          }}
          emptyTitle="No matching claims"
          emptyDesc="Try widening the filters — or clear them to see the full scored test set."
          footer={
            <Pager
              page={page}
              pageSize={25}
              total={
                action === "all"
                  ? pageData.data?.total ?? 0
                  : Math.max(items.length, pageData.data?.total ?? 0)
              }
              onPage={setPage}
            />
          }
        />
      )}

      <p className="small muted" style={{ marginTop: 10 }}>
        {pageData.data?.available === false
          ? "Scored test artifacts are not present on this server — run train_eval.py to populate the queue."
          : `Window: ${pageData.data?.window?.from ?? "—"} → ${pageData.data?.window?.to ?? "—"} · ${num(pageData.data?.total ?? 0)} claims scored`}
      </p>

      {bulkConfirm && <ConfirmDialog spec={bulkConfirm} onClose={() => setBulkConfirm(null)} />}
    </div>
  );
}
