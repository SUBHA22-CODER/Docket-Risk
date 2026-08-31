import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { generateCaseSummary, generateMerchantExplanationNotice } from "../lib/copilot";
import type { Action as ActionT, AnalystAction } from "../types";
import {
  Button,
  Card,
  ConfirmDialog,
  Drawer,
  ErrorState,
  InfoTip,
  RiskBadge,
  SkeletonRows,
  useToast,
  type ConfirmSpec,
} from "../components/ui";
import { ScoreGauge } from "../components/ScoreGauge";
import { NetworkGraph } from "../components/NetworkGraph";
import { MerchantAppealSandbox } from "../components/MerchantAppealSandbox";
import { Icon } from "../components/Icon";
import { ACTION_LABELS, CASE_STATUS_LABELS, FEATURE_LABELS, inr, maskId, num, pctScore, shortDate, shortTime, slaLabel, timeAgo } from "../lib/format";

const INFRA_ICON: Record<string, "device" | "vpa" | "phone" | "address" | "card"> = {
  device: "device",
  VPA: "vpa",
  phone: "phone",
  address: "address",
  card: "card",
};

function signalOf(value: number): { label: string; color: string } {
  if (value >= 4) return { label: "High", color: "var(--red)" };
  if (value >= 1) return { label: "Medium", color: "var(--amber)" };
  return { label: "Low", color: "var(--text-muted)" };
}

export default function Investigation() {
  const { claimId } = useParams<{ claimId: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const detail = useAsync(() => api.claimDetail(claimId ?? ""), [claimId]);
  const audit = useAsync(
    () => api.decisions(claimId ?? "").then((r) => r.items),
    [claimId],
  );

  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [drawer, setDrawer] = useState<NodeDetail | null>(null);
  const [expandedInfra, setExpandedInfra] = useState<string | null>(null);
  const [searchHit, setSearchHit] = useState<string | null>(null);
  const [caseNonce, setCaseNonce] = useState(0);
  const [noteDraft, setNoteDraft] = useState("");
  const [assigneeDraft, setAssigneeDraft] = useState("");

  const caseData = useAsync(
    () => (claimId ? api.caseGet(claimId) : Promise.resolve(null)),
    [claimId, caseNonce],
  );

  const bumpCase = () => {
    setCaseNonce((n) => n + 1);
    audit.refetch();
  };

  const patchCase = async (patch: { status?: string; assigned_to?: string }) => {
    try {
      await api.casePatch(claimId ?? "", patch);
      toast({ tone: "ok", title: "Case updated", msg: "Written to the case + audit log." });
      bumpCase();
    } catch (e) {
      toast({ tone: "err", title: "Failed", msg: (e as Error).message });
    }
  };

  const toggleWatch = async (identity: string, watched: boolean) => {
    try {
      if (watched) {
        await api.watchlistRemove(identity);
        toast({ tone: "ok", title: "Removed from watchlist", msg: identity });
      } else {
        await api.watchlistAdd({
          entity: identity,
          kind: "identity",
          reason: `Watched from investigation of ${claimId}`,
        });
        toast({ tone: "ok", title: "Added to watchlist", msg: `${identity} will be flagged in the queue.` });
      }
      bumpCase();
    } catch (e) {
      toast({ tone: "err", title: "Failed", msg: (e as Error).message });
    }
  };

  const addNote = async () => {
    const body = noteDraft.trim();
    if (body.length < 2) return;
    try {
      await api.addNote(claimId ?? "", body);
      setNoteDraft("");
      toast({ tone: "ok", title: "Note added", msg: "Saved to the case file." });
      bumpCase();
    } catch (e) {
      toast({ tone: "err", title: "Failed", msg: (e as Error).message });
    }
  };

  const d = detail.data;

  /* ---- copilot summary (typing reveal) ---- */
  const [copilotFull, setCopilotFull] = useState<string | null>(null);
  const [copilotShown, setCopilotShown] = useState(0);
  const [narrativeMode, setNarrativeMode] = useState<"ops" | "merchant">("ops");

  useEffect(() => {
    if (copilotFull == null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCopilotShown(copilotFull.length);
      return;
    }
    setCopilotShown(0);
    const id = window.setInterval(() => {
      setCopilotShown((s) => {
        if (s >= copilotFull.length) {
          window.clearInterval(id);
          return s;
        }
        return s + 5;
      });
    }, 12);
    return () => window.clearInterval(id);
  }, [copilotFull]);

  const runCopilot = (mode: "ops" | "merchant" = narrativeMode) => {
    if (!d) return;
    setNarrativeMode(mode);
    setCopilotFull(mode === "ops" ? generateCaseSummary(d) : generateMerchantExplanationNotice(d));
  };
  const copyCopilot = () => {
    if (copilotFull) {
      navigator.clipboard?.writeText(copilotFull).catch(() => undefined);
      toast({ tone: "ok", title: "Copied to clipboard", msg: narrativeMode === "ops" ? "Ops dossier narrative copied." : "Merchant support notice copied." });
    }
  };
  const saveCopilotNote = async () => {
    if (!copilotFull || copilotShown < copilotFull.length || !claimId) return;
    try {
      await api.addNote(claimId, `[${narrativeMode === "ops" ? "OPS DOSSIER" : "MERCHANT EXPLANATION NOTICE"}]\n${copilotFull}`);
      toast({ tone: "ok", title: "Summary saved", msg: `${narrativeMode === "ops" ? "Copilot" : "Merchant Notice"} added to case notes.` });
      bumpCase();
    } catch (e) {
      toast({ tone: "err", title: "Failed", msg: (e as Error).message });
    }
  };

  const featureRows = useMemo(() => {
    if (!d) return [];
    return [
      "cluster_size",
      "shared_infra_neighbor_count",
      "cluster_merchant_span",
      "cluster_claim_burst_7d",
      "reason_text_reuse_flag",
      "identity_claim_count_so_far",
      "identity_claim_approval_ratio_so_far",
      "amount",
    ].map((f) => {
      const v = d.features[f] ?? 0;
      let display: string;
      if (f === "reason_text_reuse_flag") display = v > 0.5 ? "Yes" : "No";
      else if (f === "amount") display = inr(v);
      else if (f === "identity_claim_approval_ratio_so_far") display = `${Math.round(v * 100)}%`;
      else display = String(Math.round(v));
      const sig =
        f === "amount"
          ? signalOf(0)
          : f === "identity_claim_count_so_far"
            ? signalOf(Math.min(2, v / 2))
            : signalOf(v);
      return { key: f, label: FEATURE_LABELS[f] ?? f, display, value: v, sig };
    });
  }, [d]);

  if (detail.loading) {
    return (
      <div>
        <div className="inv-header">
          <SkeletonRows rows={3} />
        </div>
        <div className="inv-grid">
          <Card title="Evidence">
            <SkeletonRows rows={6} />
          </Card>
          <Card title="Decision">
            <SkeletonRows rows={5} />
          </Card>
        </div>
      </div>
    );
  }

  if (detail.error || !d) {
    return (
      <ErrorState
        title="Could not open investigation"
        error={detail.error}
        onRetry={detail.refetch}
        extraActions={
          <Button onClick={() => navigate("/claims")}>Back to queue</Button>
        }
      />
    );
  }

  const act = (
    kind: string,
    newAction: ActionT | undefined,
    title: string,
    body: string,
    danger: boolean,
    confirmLabel: string,
    reason?: string,
  ) => {
    setConfirm({
      title,
      body,
      confirmLabel,
      danger,
      onConfirm: async () => {
        try {
          await api.postDecision({
            claim_id: d.claim.claim_id,
            kind,
            prev_action: d.action,
            ...(newAction ? { new_action: newAction } : {}),
            reason:
              reason ??
              (kind === "decision"
                ? "Analyst reviewed the shared-infrastructure evidence"
                : REASON_PROMPTS[kind] ?? "Analyst review"),
          });
          toast({
            tone: "ok",
            title: "Recorded",
            msg: `${title} on ${d.claim.claim_id} written to the audit log.`,
          });
          audit.refetch();
        } catch (e) {
          toast({ tone: "err", title: "Failed", msg: (e as Error).message });
        }
      },
    });
  };

  const isHold = d.action === "HOLD_PAYOUT_HUMAN_REVIEW";

  return (
    <div>
      {/* ---- header ---- */}
      <div className="inv-header">
        <div className="spread row-wrap" style={{ alignItems: "flex-start" }}>
          <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
            <div>
              <div className="row" style={{ gap: 9 }}>
                <h1 className="page-title mono">{d.claim.claim_id}</h1>
                <RiskBadge level={d.risk_level} />
              </div>
              <div className="small secondary" style={{ marginTop: 5 }}>
                <span className="mono">{maskId(d.claim.identity_key)}</span> at{" "}
                <span className="mono">{d.claim.merchant_id}</span> ·{" "}
                {shortDate(d.claim.ts)} {shortTime(d.claim.ts)} · order{" "}
                <span className="mono">{d.claim.order_id}</span>
              </div>
              <div className="small muted" style={{ marginTop: 4, maxWidth: 560 }}>
                “{d.claim.reason_text}”
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="num" style={{ fontSize: 24, fontWeight: 750 }}>{inr(d.claim.amount)}</div>
            <div className="small muted">Claim amount</div>
            <div style={{ marginTop: 8 }}>
              <span
                className="badge"
                style={{
                  background:
                    d.risk_level === "HIGH"
                      ? "var(--red-bg)"
                      : d.risk_level === "MEDIUM"
                        ? "var(--amber-bg)"
                        : "var(--green-bg)",
                  color:
                    d.risk_level === "HIGH"
                      ? "var(--red)"
                      : d.risk_level === "MEDIUM"
                        ? "var(--amber)"
                        : "var(--green)",
                }}
              >
                {ACTION_LABELS[d.action]}
              </span>
            </div>
          </div>
        </div>
      </div>

      {d.claim.ring_id && (
        <div className="degraded-banner" style={{ borderColor: "rgba(229,72,77,.35)", background: "var(--red-bg)", color: "var(--red)" }}>
          <Icon name="network" size={16} />
          <span>
            Confirmed member of ring <b className="mono">{d.claim.ring_id}</b> in the labelled
            evaluation dataset ({d.cluster.members} identities). This ground-truth label is shown for
            demo honesty — in production it would not exist.
          </span>
        </div>
      )}

      <div className="inv-grid">
        {/* ---- left: evidence + graph ---- */}
        <div className="stack">
          <Card
            title={
              <span className="row" style={{ gap: 8 }}>
                {narrativeMode === "ops" ? "Copilot ops dossier" : "Merchant appeal notice (Zendesk snippet)"}
                <InfoTip text="Deterministic, rule-based narrative generated directly from graph evidence and features — transparent explanation without LLM hallucination." />
              </span>
            }
            actions={
              <div className="row" style={{ gap: 6 }}>
                <div className="segmented" role="tablist" aria-label="Copilot Mode" style={{ marginRight: 4 }}>
                  <button
                    className={narrativeMode === "ops" ? "active" : ""}
                    onClick={() => runCopilot("ops")}
                    title="Internal forensic summary for risk ops team"
                  >
                    Ops Dossier
                  </button>
                  <button
                    className={narrativeMode === "merchant" ? "active" : ""}
                    onClick={() => runCopilot("merchant")}
                    title="Customer-facing notice explaining freeze with appeal checklist"
                  >
                    Merchant Notice
                  </button>
                </div>
                {copilotFull && copilotShown >= copilotFull.length && (
                  <>
                    <Button size="sm" variant="ghost" onClick={copyCopilot} title="Copy notice to clipboard">
                      <Icon name="copy" size={12} />
                    </Button>
                    <Button size="sm" onClick={saveCopilotNote} title="Save to case notes">
                      Save as note
                    </Button>
                  </>
                )}
                <Button size="sm" variant="primary" onClick={() => runCopilot()}>
                  <Icon name="play" size={11} /> {copilotFull ? "Regenerate" : "Generate"}
                </Button>
              </div>
            }
          >
            {copilotFull ? (
              <div className="copilot-text small secondary" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontFamily: narrativeMode === "merchant" ? "var(--mono)" : undefined }}>
                {copilotFull.slice(0, copilotShown)}
                {copilotShown < copilotFull.length && <span className="copilot-caret" aria-hidden="true" />}
              </div>
            ) : (
              <p className="small muted">
                Select <b>Ops Dossier</b> for internal investigation notes or <b>Merchant Notice</b> for an appeal explanation snippet with specific evidence and document checklist.
              </p>
            )}
          </Card>

          <MerchantAppealSandbox
            claimDetail={d}
            onAppealApproved={() => {
              bumpCase();
              detail.refetch();
            }}
          />

          <Card
            title="Why this claim was flagged"
            actions={<InfoTip text="Each item is derived from features computed only from information available before this claim's timestamp." />}
          >
            <div className="evidence-list">
              {d.evidence.why_flagged.map((item) => {
                const sig = signalOf(item.value);
                const isInfra = item.feature === "shared_infra_neighbor_count";
                const expanded = expandedInfra === item.feature;
                return (
                  <div
                    key={item.feature}
                    className="evidence-item"
                    onClick={() =>
                      isInfra && setExpandedInfra(expanded ? null : item.feature)
                    }
                    onKeyDown={(e) => {
                      if (isInfra && e.key === "Enter") setExpandedInfra(expanded ? null : item.feature);
                    }}
                    role={isInfra ? "button" : undefined}
                    tabIndex={isInfra ? 0 : undefined}
                  >
                    <span className="evidence-signal" style={{ background: sig.color }} />
                    <div className="grow">
                      <div className="evidence-text">{item.label}</div>
                      {expanded && d.evidence.shared_infra.length > 0 && (
                        <div className="evidence-drill" style={{ flexDirection: "column", alignItems: "flex-start", gap: 7 }}>
                          {d.evidence.shared_infra.slice(0, 12).map((s) => (
                            <div key={s.id}>
                              <span className="chip">
                                <Icon name={INFRA_ICON[s.type] ?? "device"} size={11} /> {s.type} …{s.id.slice(-6)}
                              </span>
                              <span className="small muted">shared with</span>{" "}
                              {s.connected_identities.slice(0, 6).map((id) => (
                                <span
                                  key={id}
                                  className="chip"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSearchHit(id);
                                  }}
                                >
                                  {maskId(id)}
                                </span>
                              ))}
                              {s.connected_identities.length > 6 && (
                                <span className="small muted">+{s.connected_identities.length - 6} more</span>
                              )}
                            </div>
                          ))}
                          <span className="small muted">Click a chip to highlight that node in the network graph ↓</span>
                        </div>
                      )}
                      {!expanded && (
                        <div className="evidence-drill">
                          <span style={{ color: sig.color, fontWeight: 700 }}>{sig.label} signal</span>
                          {isInfra && d.evidence.shared_infra.length > 0 && (
                            <>
                              {" "}· click to inspect {d.evidence.shared_infra.length} shared infrastructure node(s)
                              <Icon name="chevron-down" size={11} />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <span
                      className="signal-tag"
                      style={{ color: sig.color, fontSize: 10, marginTop: 4 }}
                    >
                      {sig.label.toUpperCase()}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* ── Score Drivers (Feature 1: visual explain panel) ── */}
          {d.evidence.why_flagged.length > 0 && (
            <Card
              title={
                <span className="row" style={{ gap: 8 }}>
                  Score drivers
                  <InfoTip text="Feature contributions computed from the XGBoost model — values are normalised so the dominant driver reaches 100%. Only temporally-safe features (available before claim time) feed the score." />
                </span>
              }
              actions={
                <span
                  className="num"
                  style={{
                    fontWeight: 750,
                    fontSize: 20,
                    color: d.risk_level === "HIGH" ? "var(--red)" : d.risk_level === "MEDIUM" ? "var(--amber)" : "var(--green)",
                  }}
                >
                  {Math.round(d.score * 100)}%
                </span>
              }
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(() => {
                  const maxVal = Math.max(...d.evidence.why_flagged.map((f) => Math.abs(f.value)), 1);
                  return d.evidence.why_flagged.map((item) => {
                    const pct = Math.max(4, Math.round((Math.abs(item.value) / maxVal) * 100));
                    const sig = item.value >= 4 ? { color: "var(--red)", label: "High" }
                      : item.value >= 1 ? { color: "var(--amber)", label: "Med" }
                      : { color: "var(--text-muted)", label: "Low" };
                    return (
                      <div key={item.feature} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div className="spread">
                          <span className="small secondary" style={{ fontWeight: 550 }}>{item.label}</span>
                          <span className="small num" style={{ color: sig.color, fontWeight: 700 }}>
                            {Number.isInteger(item.value) ? item.value : item.value.toFixed(2)}
                            &nbsp;<span style={{ fontSize: 10, opacity: 0.7 }}>{sig.label}</span>
                          </span>
                        </div>
                        <div style={{
                          height: 6,
                          borderRadius: 3,
                          background: "var(--panel-inset)",
                          overflow: "hidden",
                          border: "1px solid var(--border)",
                        }}>
                          <div style={{
                            height: "100%",
                            width: `${pct}%`,
                            borderRadius: 3,
                            background: sig.color,
                            opacity: 0.85,
                            transition: "width 0.6s cubic-bezier(.4,0,.2,1)",
                          }} />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              <p className="small muted" style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                Graph-density features dominate when coordination is present. Amount alone never triggers a hold.
              </p>
            </Card>
          )}

          <Card
            title={
              <span className="row" style={{ gap: 8 }}>
                Network evidence — shared infrastructure
                <InfoTip text="Identity circles are customers; boxes are shared devices/VPAs/phones/addresses/cards. Edge labels show which merchants each order touched." />
              </span>
            }
          >
            {d.graph.nodes.length > 0 ? (
              <NetworkGraph
                nodes={d.graph.nodes}
                edges={d.graph.edges}
                flaggedIdentity={d.claim.identity_key}
                height={480}
                searchHit={searchHit}
                onSelectNode={(nd) => setDrawer(nd)}
              />
            ) : (
              <div className="state-block">
                <div className="state-icon info"><Icon name="network" size={20} /></div>
                <div className="state-title">No connected infrastructure</div>
                <p className="state-desc">
                  This identity shares no device/VPA/phone/address/card with any other customer —
                  it sits alone in the identity graph.
                </p>
              </div>
            )}
          </Card>

          <Card title="Model signals (feature evidence)">
            {featureRows.map((f) => (
              <div key={f.key} className="feature-bar-row">
                <span className="feature-name">{f.label}</span>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{
                      width: `${Math.min(100, Math.max(3, f.key === "reason_text_reuse_flag" ? (f.value > 0.5 ? 100 : 3) : (f.value / Math.max(1, d.features["cluster_size"] ?? 1)) * 100))}%`,
                      background: f.sig.color,
                    }}
                  />
                </span>
                <span className="right">
                  <span className="num" style={{ fontWeight: 650 }}>{f.display}</span>{" "}
                  <span className="signal-tag small" style={{ color: f.sig.color }}>{f.sig.label}</span>
                </span>
              </div>
            ))}
            <div className="divider" />
            <p className="small muted">
              Signals are computed from temporally-safe features — nothing after the claim's own
              timestamp feeds the score. The model weighs graph-density features highest; amount
              alone is never decisive.
            </p>
          </Card>

          <CounterfactualsCard claimId={d.claim.claim_id} />
        </div>

        {/* ---- right rail ---- */}
        <div className="stack">
          <Card
            title="Case workflow"
            actions={
              d.claim.identity_key && (
                <Button
                  size="sm"
                  variant={caseData.data?.watchlisted ? "danger" : "default"}
                  onClick={() => toggleWatch(d.claim.identity_key, !!caseData.data?.watchlisted)}
                  title={caseData.data?.watchlisted ? "Remove identity from watchlist" : "Add identity to watchlist"}
                >
                  <Icon name="alert" size={12} />
                  {caseData.data?.watchlisted ? "Unwatch" : "Watchlist"}
                </Button>
              )
            }
          >
            {caseData.data && (
              <>
                <div className="row-wrap" style={{ marginBottom: 10 }}>
                  <select
                    className="select"
                    value={caseData.data.case.status}
                    aria-label="Case status"
                    onChange={(e) => patchCase({ status: e.target.value })}
                    style={{ width: 150 }}
                  >
                    {["open", "in_review", "approved", "held", "escalated", "closed"].map((s) => (
                      <option key={s} value={s}>{CASE_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                  <span
                    className="small num"
                    style={{
                      fontWeight: 700,
                      color: slaLabel(caseData.data.case.sla_due_at).overdue ? "var(--red)" : "var(--text-secondary)",
                    }}
                  >
                    SLA: {slaLabel(caseData.data.case.sla_due_at).text}
                  </span>
                </div>
                <div className="row-wrap" style={{ marginBottom: 12 }}>
                  <input
                    className="input"
                    style={{ width: 150 }}
                    placeholder={caseData.data.case.assigned_to ?? "Assign to analyst…"}
                    value={assigneeDraft}
                    onChange={(e) => setAssigneeDraft(e.target.value)}
                    aria-label="Assignee"
                  />
                  <Button
                    size="sm"
                    disabled={!assigneeDraft.trim()}
                    onClick={() => {
                      patchCase({ assigned_to: assigneeDraft.trim() });
                      setAssigneeDraft("");
                    }}
                  >
                    Assign
                  </Button>
                </div>
                <div className="divider" />
                <div className="small secondary" style={{ marginBottom: 7 }}>
                  Case notes ({caseData.data.notes.length})
                </div>
                <div style={{ maxHeight: 180, overflowY: "auto", marginBottom: 10 }}>
                  {caseData.data.notes.length === 0 ? (
                    <p className="small muted">No notes yet — findings, call logs and evidence links go here.</p>
                  ) : (
                    caseData.data.notes.map((n) => (
                      <div key={n.id} className="audit-row">
                        <span className="audit-ts">{timeAgo(n.ts)}</span>
                        <div className="grow">
                          <b className="small">{n.actor}</b>
                          <div className="small secondary" style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <textarea
                    className="input grow"
                    rows={2}
                    placeholder="Add a case note…"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addNote();
                    }}
                    aria-label="New case note"
                  />
                  <Button size="sm" disabled={noteDraft.trim().length < 2} onClick={addNote}>
                    Add
                  </Button>
                </div>
                {caseData.data.watchlisted && (
                  <p className="small" style={{ color: "var(--amber)", marginTop: 8 }}>
                    This identity is on the watchlist — new claims are flagged in the queue.
                  </p>
                )}
              </>
            )}
          </Card>

          <Card title="Risk decision">
            <div style={{ display: "grid", placeItems: "center", padding: "6px 0 10px" }}>
              <ScoreGauge score={d.score} level={d.risk_level} />
            </div>
            <div className="divider" />
            <div className="small secondary" style={{ marginBottom: 10 }}>
              Recommended action
              <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2, color: "var(--text)" }}>
                {ACTION_LABELS[d.action]}
              </div>
            </div>
            <div className="grid" style={{ gap: 8 }}>
              <Button
                variant="success"
                disabled={!isHold}
                title={isHold ? undefined : "Only held payouts can be approved by an analyst"}
                onClick={() =>
                  act(
                    "decision",
                    "AUTO_APPROVE",
                    "Approved payout",
                    `You are releasing ${inr(d.claim.amount)} for ${d.claim.claim_id}. This overrides the HOLD recommendation and will be recorded with your analyst ID and reason.`,
                    false,
                    "Approve payout",
                    "Payout released after analyst review of evidence",
                  )
                }
              >
                <Icon name="check" size={14} /> Approve payout
              </Button>
              <Button
                disabled={!isHold}
                onClick={() =>
                  act(
                    "decision",
                    "STEP_UP_VERIFICATION",
                    "Requested verification",
                    "The customer will be asked to verify ownership before payout release.",
                    false,
                    "Request verification",
                  )
                }
              >
                Request verification
              </Button>
              <Button
                variant="danger"
                disabled={isHold}
                onClick={() =>
                  act(
                    "decision",
                    "HOLD_PAYOUT_HUMAN_REVIEW",
                    "Placed on hold",
                    `${inr(d.claim.amount)} will be held pre-payout pending human review.`,
                    true,
                    "Keep hold",
                  )
                }
              >
                Keep payout on hold
              </Button>
            </div>
            <div className="divider" />
            <div className="row-wrap">
              <Button
                size="sm"
                onClick={() =>
                  act("investigation", undefined, "Investigation created", "An investigation case referencing this claim will be opened.", false, "Create")
                }
              >
                <Icon name="investigations" size={13} /> Create investigation
              </Button>
              <Button size="sm" onClick={() => act("note", undefined, "Note added", "Adds an analyst note to the audit trail.", false, "Add note")}>
                Add note
              </Button>
            </div>
          </Card>

          <Card title="Cluster summary">
            {d.cluster.members > 1 ? (
              <>
                <SummaryRow label="Cluster / ring" value={d.cluster.ring_id ?? "unnamed"} mono />
                <SummaryRow label="Members" value={num(d.cluster.members)} />
                <SummaryRow label="Merchant span" value={String(Math.round(d.features["cluster_merchant_span"] ?? 0))} />
                <SummaryRow label="Shared infrastructure" value={`${d.cluster.shared_infra_types.length} types`} />
                <SummaryRow label="Claims — 7d" value={num(d.evidence.recent_cluster_claims_7d)} />
                <SummaryRow label="Cluster claim value — 7d" value={inr(d.evidence.cluster_value_7d_inr)} />
                <SummaryRow
                  label="Risk concentration"
                  value={d.risk_level}
                  color={
                    d.risk_level === "HIGH"
                      ? "var(--red)"
                      : d.risk_level === "MEDIUM"
                        ? "var(--amber)"
                        : "var(--green)"
                  }
                />
              </>
            ) : (
              <p className="small muted">Single-identity cluster — no coordination detected.</p>
            )}
          </Card>

          <Card title="Decision timeline">
            <div className="timeline">
              {d.timeline.map((t) => (
                <div key={t.event + t.ts} className="tl-event">
                  <span
                    className={`tl-dot ${
                      t.event === "payout_held" ? "red" :
                      t.event === "scored" ? (d.risk_level === "HIGH" ? "red" : d.risk_level === "MEDIUM" ? "amber" : "green") :
                      t.event === "shared_infra_detected" ? "blue" :
                      t.event === "graph_ingested" ? "" : ""
                    }`}
                  />
                  <div className="tl-time num">{shortTime(t.ts)}</div>
                  <div className="tl-label">{t.label}</div>
                  {t.detail && <div className="tl-detail">{t.detail}</div>}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Identity history">
            {d.identity_history.prior_claims.length > 0 ? (
              <>
                <div className="row-wrap small muted" style={{ marginBottom: 8 }}>
                  <span>{d.identity_history.counts.total} prior claims</span>
                  <span>·</span>
                  <span>{d.identity_history.counts.holds} held</span>
                  <span>·</span>
                  <span>{d.identity_history.counts.auto_approved} auto-approved</span>
                </div>
                {d.identity_history.prior_claims.slice(-6).reverse().map((h) => (
                  <div key={h.claim_id} className="audit-row">
                    <span className="audit-ts">{shortTime(h.ts)}</span>
                    <div className="grow">
                      <Link className="mono small" style={{ color: "var(--blue)" }} to={`/claims/${h.claim_id}`}>
                        {h.claim_id}
                      </Link>
                      <div className="small muted">
                        {h.merchant_id} · <span className="num">{inr(h.amount)}</span> · score{" "}
                        <span className="num">{pctScore(h.score)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <p className="small muted">
                First claim from this identity — no prior refund behaviour on record.
              </p>
            )}
          </Card>

          <Card title="Merchant context">
            <SummaryRow label="Merchant" value={d.merchant.merchant_id} mono />
            {d.merchant.category && <SummaryRow label="Category" value={d.merchant.category} />}
            {d.merchant.n_orders !== undefined && <SummaryRow label="Orders (window)" value={num(d.merchant.n_orders)} />}
            {d.merchant.n_claims !== undefined && <SummaryRow label="Claims (window)" value={num(d.merchant.n_claims)} />}
            {d.merchant.claim_rate != null && (
              <SummaryRow label="Merchant claim rate" value={`${(d.merchant.claim_rate * 100).toFixed(1)}%`} />
            )}
            {d.merchant.connected_clusters && d.merchant.connected_clusters.length > 0 && (
              <SummaryRow label="Connected rings" value={d.merchant.connected_clusters.join(", ")} mono />
            )}
            <div className="divider" />
            <p className="small muted">
              The attack intentionally spreads across merchants: each merchant sees one ordinary-looking
              first-time customer. Only pooled infrastructure reveals coordination.
            </p>
          </Card>

          <Card
            title="Audit trail"
            actions={
              <button className="btn btn-ghost btn-sm" onClick={audit.refetch}>
                <Icon name="refresh" size={12} />
              </button>
            }
          >
            {audit.data && audit.data.length > 0 ? (
              audit.data.map((a: AnalystAction) => (
                <div key={a.id} className="audit-row">
                  <span className="audit-ts">{timeAgo(a.ts)}</span>
                  <div className="grow">
                    <div>
                      <b>{a.actor}</b>{" "}
                      {a.kind === "decision" && a.prev_action && a.new_action && (
                        <span className="arrow-change muted">
                          {a.prev_action.replace("_PAYOUT_HUMAN_REVIEW", "")} →{" "}
                          <span style={{ color: "var(--text)" }}>{a.new_action.replace("_PAYOUT_HUMAN_REVIEW", "")}</span>
                        </span>
                      )}
                      {a.kind !== "decision" && (
                        <span className="badge badge-info" style={{ marginLeft: 4 }}>{a.kind.replace("_", " ")}</span>
                      )}
                    </div>
                    <div className="small muted">“{a.reason}”</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="small muted">
                No analyst actions recorded yet for this claim. Every approve/hold/note decision is
                appended here.
              </p>
            )}
          </Card>
        </div>
      </div>

      {confirm && <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />}
      {drawer && (
        <Drawer
          title={drawer.node.kind === "infra" ? `Shared ${drawer.node.infra_type}` : "Customer identity"}
          onClose={() => setDrawer(null)}
        >
          <div className="mono" style={{ fontSize: 15, fontWeight: 650, marginBottom: 12, wordBreak: "break-all" }}>
            {drawer.node.id}
          </div>
          {drawer.node.kind === "infra" ? (
            <NodeDetailInfra drawer={drawer} onFind={(id) => setSearchHit(id)} />
          ) : (
            <NodeDetailIdent drawer={drawer} onFind={(id) => setSearchHit(id)} claimant={d.claim.identity_key} />
          )}
        </Drawer>
      )}
    </div>
  );
}

const REASON_PROMPTS: Record<string, string> = {
  decision: "Analyst reviewed evidence graph",
  note: "Analyst note",
  investigation: "Investigation opened from workspace",
  resolved: "Marked resolved after review",
};

/** Counterfactual attribution: what pushes the score up, and the path to approval. */
function CounterfactualsCard({ claimId }: { claimId: string }) {
  const cf = useAsync(() => api.counterfactuals(claimId), [claimId]);
  if (cf.loading) {
    return (
      <Card title="Why this score — counterfactuals">
        <SkeletonRows rows={4} />
      </Card>
    );
  }
  const data = cf.data;
  if (cf.error || !data || !data.available || !data.contributions || !data.path) return null;

  const ups = data.contributions.filter((c) => c.delta > 0.001);
  const maxUp = Math.max(...ups.map((u) => u.delta), 1e-9);
  const path = data.path;

  return (
    <Card
      title="Why this score — counterfactuals"
      actions={
        <InfoTip text="Each row re-scores the claim with that one feature swapped to a benign value. The score drop is that feature's push contribution — computed live by the model itself." />
      }
    >
      <div className="small secondary" style={{ marginBottom: 9 }}>
        Score <b className="num">{pctScore(data.score ?? 0)}</b> — top push factors:
      </div>
      {ups.length === 0 ? (
        <p className="small muted">No single feature pushes the score materially — this is a cumulative judgement.</p>
      ) : (
        ups.slice(0, 6).map((u) => (
          <div key={u.feature} className="feature-bar-row">
            <span className="feature-name">{FEATURE_LABELS[u.feature] ?? u.feature}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${Math.max(4, (u.delta / maxUp) * 100)}%`, background: "var(--red)" }}
              />
            </span>
            <span className="signal-tag num" style={{ color: "var(--red)" }}>
              −{(u.delta * 100).toFixed(1)} pts
            </span>
          </div>
        ))
      )}
      <div className="divider" />
      <div className="small secondary" style={{ marginBottom: 7 }}>
        Path to auto-approval:
      </div>
      {path.reaches_auto_approve ? (
        <div className="row-wrap">
          {path.steps.map((s) => (
            <span key={s.feature} className="chip">
              {(FEATURE_LABELS[s.feature] ?? s.feature).toLowerCase()} → {Number.isInteger(s.to) ? s.to : s.to.toFixed(2)}
            </span>
          ))}
          <span className="badge badge-low">would score {pctScore(path.final_score)}</span>
        </div>
      ) : (
        <p className="small muted">
          No single-feature story explains this flag — even with the top signals removed the score
          stays at <b className="num">{pctScore(path.final_score)}</b>. Treat as coordinated.
        </p>
      )}
    </Card>
  );
}

function SummaryRow({
  label,
  value,
  mono,
  color,
}: {
  label: string;
  value: string;
  mono?: boolean;
  color?: string;
}) {
  return (
    <div className="spread" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="small secondary">{label}</span>
      <span className={`small ${mono ? "mono" : "num"}`} style={{ fontWeight: 650, color: color ?? "var(--text)" }}>
        {value}
      </span>
    </div>
  );
}

interface NodeDetail {
  node: { id: string; kind: string; infra_type?: string };
  neighbors: string[];
  merchants: string[];
}

function NodeDetailInfra({ drawer, onFind }: { drawer: NodeDetail; onFind: (id: string) => void }) {
  return (
    <>
      <SummaryRow label="Type" value={`Shared ${drawer.node.infra_type ?? "infrastructure"}`} />
      <SummaryRow label="Connected identities" value={String(drawer.neighbors.length)} />
      <div className="divider" />
      <div className="small secondary" style={{ marginBottom: 7 }}>Connected identities:</div>
      <div>
        {drawer.neighbors.map((id) => (
          <span key={id} className="chip" onClick={() => onFind(id)}>
            {id}
          </span>
        ))}
      </div>
      {drawer.merchants.length > 0 && (
        <>
          <div className="divider" />
          <div className="small secondary" style={{ marginBottom: 7 }}>Merchants touched via this node:</div>
          <div>{drawer.merchants.map((m) => <span key={m} className="chip">{m}</span>)}</div>
        </>
      )}
      <div className="divider" />
      <p className="small muted">
        This single piece of infrastructure is the bridge that pulls otherwise-unrelated customers into
        one cluster. No individual merchant saw anything unusual — the pattern only exists pooled.
      </p>
    </>
  );
}

function NodeDetailIdent({
  drawer,
  onFind,
  claimant,
}: {
  drawer: NodeDetail;
  onFind: (id: string) => void;
  claimant: string;
}) {
  return (
    <>
      <SummaryRow label="Role" value={drawer.node.id === claimant ? "Flagged claimant" : "Linked customer"} />
      <SummaryRow label="Shared infrastructure links" value={String(drawer.neighbors.length)} />
      <div className="divider" />
      <div className="small secondary" style={{ marginBottom: 7 }}>Shares infrastructure with:</div>
      <div>
        {drawer.neighbors.map((id) => (
          <span key={id} className="chip" onClick={() => onFind(id)}>
            {id}
          </span>
        ))}
      </div>
    </>
  );
}
