import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { Button, Card, Drawer, ErrorState, SkeletonRows, useToast } from "../components/ui";
import { NetworkGraph, type NetworkGraphHandle } from "../components/NetworkGraph";
import { Icon } from "../components/Icon";
import { inr, maskId, pctScore, shortDate } from "../lib/format";

interface NodeDetail {
  node: { id: string; kind: string; infra_type?: string };
  neighbors: string[];
  merchants: string[];
}

const INFRA_TYPES = ["device", "VPA", "phone", "address", "card"] as const;

export default function NetworkExplorer() {
  const navigate = useNavigate();
  const ctx = useOutletContext<{ refreshNonce: number }>();
  const toast = useToast();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<NodeDetail | null>(null);
  const [replayIdx, setReplayIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [severedNodes, setSeveredNodes] = useState<Set<string>>(new Set());
  const graphRef = useRef<NetworkGraphHandle>(null);

  const toggleSeverNode = (nodeId: string) => {
    setSeveredNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
        toast({ tone: "ok", title: "Node reconnected", msg: `Restored connection for ${maskId(nodeId)}.` });
      } else {
        next.add(nodeId);
        toast({ tone: "info", title: "Blast-radius simulation active", msg: `Severed ${maskId(nodeId)} — cluster recalculated.` });
      }
      return next;
    });
  };

  const exportPng = () => {
    const canvas = graphRef.current?.getCanvas();
    if (!canvas) {
      toast({ tone: "err", title: "Export failed", msg: "Network graph canvas is not ready yet." });
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.setAttribute("download", `docket-network-${d?.claim.claim_id ?? "export"}.png`);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
    }, 1500);
    toast({ tone: "ok", title: "Graph exported", msg: "PNG image saved to downloads." });
  };

  // highest-scoring claims with evidence → richest cluster first
  const top = useAsync(
    () => api.claims({ risk: "HIGH", sort: "score", order: "desc", page: 1, page_size: 12 }),
    [ctx.refreshNonce],
  );
  const [claimIdx, setClaimIdx] = useState(0);
  const selectedId =
    query.trim().length >= 3
      ? null
      : top.data?.items[claimIdx]?.claim_id ?? top.data?.items[0]?.claim_id ?? "";

  const detail = useAsync(
    () => (selectedId ? api.claimDetail(selectedId) : Promise.resolve(null)),
    [selectedId, ctx.refreshNonce],
  );

  useEffect(() => {
    setSeveredNodes(new Set());
  }, [selectedId]);

  const searchHit = useMemo(() => {
    const q = query.trim();
    if (q.length < 2 || !detail.data) return null;
    if (detail.data.claim.claim_id === q || detail.data.claim.identity_key === q) {
      return detail.data.claim.identity_key;
    }
    const hitN = detail.data.graph.nodes.find(
      (n) => n.id.toLowerCase().includes(q.toLowerCase()) && n.id !== q,
    );
    return (
      detail.data.graph.nodes.find((n) => n.id === q)?.id ??
      hitN?.id ??
      detail.data.graph.nodes.find((n) => n.kind === "infra" && n.id.endsWith(q.slice(-6)))?.id ??
      null
    );
  }, [query, detail.data]);

  const replay = detail.data?.replay ?? [];

  const blastSimulation = useMemo(() => {
    if (!detail.data || detail.data.graph.nodes.length === 0) return null;
    const allNodes = detail.data.graph.nodes;
    const allEdges = detail.data.graph.edges;
    const flagged = detail.data.claim.identity_key;

    const activeEdges = allEdges.filter(
      (e) => !severedNodes.has(e.from) && !severedNodes.has(e.to),
    );

    const adj = new Map<string, string[]>();
    allNodes.forEach((n) => adj.set(n.id, []));
    activeEdges.forEach((e) => {
      adj.get(e.from)?.push(e.to);
      adj.get(e.to)?.push(e.from);
    });

    const visited = new Set<string>();
    const queue = [flagged];
    visited.add(flagged);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const neighbors = adj.get(curr) ?? [];
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }

    const initialIdentities = allNodes.filter((n) => n.kind === "ident");
    const remainingIdentities = allNodes.filter(
      (n) => n.kind === "ident" && visited.has(n.id),
    );
    const decoupledIdentities = allNodes.filter(
      (n) => n.kind === "ident" && !visited.has(n.id),
    );

    const originalScore = detail.data.score;
    const reductionRatio = remainingIdentities.length / Math.max(1, initialIdentities.length);
    const simulatedScore = Math.max(0.0001, originalScore * Math.pow(reductionRatio, 1.8));

    return {
      active: severedNodes.size > 0,
      severedCount: severedNodes.size,
      initialMemberCount: initialIdentities.length,
      simulatedMemberCount: remainingIdentities.length,
      decoupledCount: decoupledIdentities.length,
      decoupledNodeIds: new Set(decoupledIdentities.map((n) => n.id)),
      originalScore,
      simulatedScore,
      decoupledIdentities: decoupledIdentities.map((n) => n.id),
    };
  }, [detail.data, severedNodes]);

  /* playback advances one order-event at a time */
  useEffect(() => {
    if (!playing || replayIdx === null) return;
    const id = window.setInterval(() => {
      setReplayIdx((i) => {
        if (i === null) return i;
        if (i >= replay.length) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, Math.max(100, Math.round(450 / speed)));
    return () => window.clearInterval(id);
  }, [playing, replayIdx, replay.length, speed]);

  useEffect(() => {
    setReplayIdx(null);
    setPlaying(false);
  }, [selectedId]);

  const replayVisibleIds = useMemo(() => {
    if (replayIdx === null) return null;
    const ids = new Set<string>();
    for (const ev of replay.slice(0, replayIdx)) {
      ids.add(ev.identity);
      ev.infra.forEach((i) => ids.add(i));
    }
    return ids;
  }, [replay, replayIdx]);

  const replayTs = replayIdx !== null && replay[replayIdx - 1] ? replay[replayIdx - 1]!.ts : null;

  const currentStep = replayIdx ?? replay.length;
  const stepRatio = replay.length > 0 ? Math.min(1, currentStep / replay.length) : 1;

  const dynamicStepScore = useMemo(() => {
    if (!detail.data) return 0.042;
    if (replayIdx === null || currentStep >= replay.length) return detail.data.score;
    if (currentStep <= 1) return 0.042;
    return Math.min(detail.data.score, Math.max(0.042, detail.data.score * Math.pow(stepRatio, 1.6)));
  }, [detail.data, currentStep, replayIdx, replay.length, stepRatio]);

  const stepNarrative = useMemo(() => {
    if (!detail.data || replay.length === 0) return null;
    if (replayIdx === null || currentStep >= replay.length) {
      return {
        phase: "CRITICAL SYNDICATE DETECTION",
        desc: `Full ring topology active: ${replay.length} coordinated transactions across ${detail.data.cluster.members} identities. Pre-settlement hold active.`,
        color: "#f43f5e",
      };
    }
    if (currentStep === 1) {
      const first = replay[0];
      return {
        phase: "PHASE 1: INITIAL TRANSACTION",
        desc: `Identity ${maskId(first?.identity ?? "")} places order at ${first?.merchant ?? "merchant"}. Clean single-buyer profile.`,
        color: "#10b981",
      };
    }
    const curr = replay[currentStep - 1];
    if (stepRatio < 0.5) {
      return {
        phase: "PHASE 2: INFRASTRUCTURE CONVERGENCE",
        desc: `Identity ${maskId(curr?.identity ?? "")} links to shared infra (${curr?.infra.map((i) => maskId(i)).join(", ") || "device"}). Coordination edges forming.`,
        color: "#f59e0b",
      };
    }
    return {
      phase: "PHASE 3: MULTI-MERCHANT VELOCITY BURST",
      desc: `Rapid refund burst across disparate merchant accounts! Shared infrastructure graph density exceeds threshold.`,
      color: "#ef4444",
    };
  }, [detail.data, currentStep, replayIdx, replay, stepRatio]);

  if (top.loading) {
    return <Card title="Network"><SkeletonRows rows={8} /></Card>;
  }
  if (top.error) {
    return <ErrorState title="Could not load network data" error={top.error} onRetry={top.refetch} />;
  }

  const items = top.data?.items ?? [];
  const d = detail.data;
  const toggleType = (t: string) =>
    setHiddenTypes((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="section-label">Graph Intelligence</div>
          <h1 className="page-title">Network Intelligence Explorer</h1>
          <p className="page-subtitle">
            Shared-infrastructure graph topology across refund-ring clusters. Filter by infrastructure type or search identity / node IDs.
          </p>
        </div>
        <div className="row-wrap">
          <input
            className="input"
            style={{ width: 230 }}
            placeholder="Find identity / infra node…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search graph nodes"
          />
        </div>
      </div>

      {items.length > 1 && !query && (
        <div className="row-wrap" style={{ marginBottom: 14 }}>
          <span className="small muted">Cluster:</span>
          {items.slice(0, 8).map((it, i) => (
            <button
              key={it.claim_id}
              className={`btn btn-sm ${i === claimIdx ? "btn-primary" : ""}`}
              onClick={() => setClaimIdx(i)}
            >
              {it.identity_key.startsWith("RNG")
                ? `ring ${it.identity_key.split("_")[0]}`
                : it.identity_key}{" "}
              · {pctScore(it.score)}
            </button>
          ))}
        </div>
      )}

      <div className="inv-grid">
        <div className="stack">
          <Card
            title={
              d
                ? blastSimulation?.active
                  ? `Cluster around ${maskId(d.claim.identity_key)} — simulated score ${pctScore(blastSimulation.simulatedScore)} (-${Math.round((1 - blastSimulation.simulatedScore / d.score) * 100)}%)`
                  : `Cluster around ${maskId(d.claim.identity_key)} — score ${pctScore(d.score)}`
                : "Cluster"
            }
            actions={
              d && (
                <div className="row" style={{ gap: 6 }}>
                  {blastSimulation?.active && (
                    <Button size="sm" variant="ghost" onClick={() => setSeveredNodes(new Set())}>
                      <Icon name="refresh" size={12} /> Reset Simulation
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={exportPng} title="Export graph as PNG image">
                    <Icon name="download" size={12} /> Export PNG
                  </Button>
                  <Button size="sm" onClick={() => navigate(`/claims/${d.claim.claim_id}`)}>
                    Open investigation <Icon name="external" size={12} />
                  </Button>
                </div>
              )
            }
          >
            {d && d.graph.nodes.length > 0 ? (
              <>
                <NetworkGraph
                  ref={graphRef}
                  nodes={d.graph.nodes}
                  edges={d.graph.edges}
                  flaggedIdentity={d.claim.identity_key}
                  height={replay.length > 1 ? 490 : 540}
                  showInfraTypes={
                    hiddenTypes.size > 0
                      ? new Set(INFRA_TYPES.filter((t) => !hiddenTypes.has(t)))
                      : undefined
                  }
                  searchHit={searchHit}
                  onSelectNode={setDrawer}
                  visibleIds={replayVisibleIds}
                  severedNodeIds={severedNodes}
                  decoupledNodeIds={blastSimulation?.decoupledNodeIds}
                />
                {replay.length > 1 && (
                  <div className="time-machine-panel">
                    {/* Top row: controls, speed, dynamic HUD */}
                    <div className="time-machine-top">
                      <div className="time-machine-controls">
                        <Button
                          size="sm"
                          variant={playing ? "danger" : "primary"}
                          onClick={() => {
                            if (replayIdx === null) {
                              setReplayIdx(1);
                              setPlaying(true);
                            } else {
                              setPlaying((p) => !p);
                            }
                          }}
                          aria-label={playing ? "Pause replay" : "Play temporal ring-formation replay"}
                        >
                          <Icon name={playing ? "pause" : "play"} size={12} />
                          {replayIdx === null ? "Temporal Replay" : playing ? "Pause" : "Resume"}
                        </Button>

                        <div className="row" style={{ gap: 4 }}>
                          {([1, 2, 4] as const).map((s) => (
                            <button
                              key={s}
                              className={`speed-badge ${speed === s ? "active" : ""}`}
                              onClick={() => setSpeed(s)}
                              title={`Playback speed ${s}x`}
                            >
                              {s}x
                            </button>
                          ))}
                        </div>

                        {replayIdx !== null && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReplayIdx(null);
                              setPlaying(false);
                            }}
                            aria-label="Exit replay"
                          >
                            <Icon name="x" size={11} /> Reset
                          </Button>
                        )}
                      </div>

                      <div className="time-machine-hud">
                        <div
                          className="time-machine-gauge"
                          style={{
                            borderColor:
                              dynamicStepScore >= 0.85
                                ? "rgba(244, 63, 94, 0.4)"
                                : dynamicStepScore >= 0.5
                                ? "rgba(245, 158, 11, 0.4)"
                                : "rgba(16, 185, 129, 0.4)",
                            color:
                              dynamicStepScore >= 0.85
                                ? "#f43f5e"
                                : dynamicStepScore >= 0.5
                                ? "#f59e0b"
                                : "#10b981",
                          }}
                        >
                          <span style={{ opacity: 0.7 }}>DYNAMIC RISK:</span>
                          <span>{pctScore(dynamicStepScore)}</span>
                        </div>

                        <span className="small num muted" style={{ minWidth: 160, textAlign: "right" }}>
                          {replayIdx === null
                            ? `${replay.length} events · full ring`
                            : `Step ${replayIdx}/${replay.length}${replayTs ? ` · ${shortDate(replayTs)}` : ""} · ${replayVisibleIds?.size ?? 0} nodes`}
                        </span>
                      </div>
                    </div>

                    {/* Middle: Slider track */}
                    <div className="row" style={{ gap: 12, alignItems: "center" }}>
                      <input
                        type="range"
                        min={0}
                        max={replay.length}
                        value={replayIdx ?? replay.length}
                        onChange={(e) => {
                          setPlaying(false);
                          setReplayIdx(Number(e.target.value));
                        }}
                        style={{ flex: 1, accentColor: "#3b82f6" }}
                        aria-label="Temporal Formation timeline"
                      />
                    </div>

                    {/* Bottom: Event intelligence narrative */}
                    {stepNarrative && (
                      <div className="time-machine-narrative">
                        <span
                          className="badge"
                          style={{
                            background: `rgba(255,255,255,0.06)`,
                            color: stepNarrative.color,
                            fontSize: 10,
                            fontWeight: 750,
                            letterSpacing: "0.04em",
                          }}
                        >
                          {stepNarrative.phase}
                        </span>
                        <span className="grow" style={{ color: "#cbd5e1" }}>
                          {stepNarrative.desc}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : detail.loading ? (
              <SkeletonRows rows={6} />
            ) : (
              <div className="state-block">
                <div className="state-icon info"><Icon name="network" size={20} /></div>
                <div className="state-title">No graph available</div>
                <p className="state-desc">
                  No scored cluster is available to render. Ensure train_eval.py artifacts exist.
                </p>
              </div>
            )}
          </Card>
        </div>

        <div className="stack">
          {d && (
            <>
              <Card
                title={
                  <span className="row" style={{ gap: 6 }}>
                    <Icon name="crosshair" size={13} />
                    Blast-Radius Simulator
                    {blastSimulation?.active && (
                      <span className="badge badge-medium" style={{ fontSize: 9, padding: "1px 6px" }}>
                        {severedNodes.size} severed
                      </span>
                    )}
                  </span>
                }
                actions={
                  blastSimulation?.active && (
                    <Button size="sm" variant="ghost" onClick={() => setSeveredNodes(new Set())}>
                      <Icon name="refresh" size={11} /> Reset
                    </Button>
                  )
                }
              >
                {blastSimulation?.active ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    <div className="spread" style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                      <span className="small secondary">Remaining in ring</span>
                      <span className="small num mono" style={{ fontWeight: 700, color: "var(--red)" }}>
                        {blastSimulation.simulatedMemberCount} / {blastSimulation.initialMemberCount} members
                      </span>
                    </div>
                    <div className="spread" style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                      <span className="small secondary">Simulated fraud score</span>
                      <span
                        className="small num mono"
                        style={{
                          fontWeight: 700,
                          color: blastSimulation.simulatedScore < 0.5 ? "var(--green)" : "var(--amber)",
                        }}
                      >
                        {pctScore(blastSimulation.simulatedScore)} (was {pctScore(d.score)})
                      </span>
                    </div>
                    <div className="spread" style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                      <span className="small secondary">Decoupled safe merchants</span>
                      <span className="small num mono" style={{ fontWeight: 700, color: "var(--green)" }}>
                        {blastSimulation.decoupledCount} safe to unblock
                      </span>
                    </div>
                    {blastSimulation.decoupledIdentities.length > 0 && (
                      <div>
                        <div className="small muted" style={{ fontSize: 10.5, marginBottom: 4 }}>
                          Decoupled entities (eligible for immediate settlement release):
                        </div>
                        <div className="row-wrap" style={{ gap: 4 }}>
                          {blastSimulation.decoupledIdentities.map((id) => (
                            <span key={id} className="badge badge-low" style={{ fontSize: 9.5 }}>
                              ✓ {maskId(id)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div
                      className="small muted"
                      style={{
                        fontSize: 11,
                        background: "rgba(16, 185, 129, 0.08)",
                        border: "1px solid rgba(16, 185, 129, 0.2)",
                        borderRadius: "var(--radius-sm)",
                        padding: 8,
                        lineHeight: 1.4,
                      }}
                    >
                      💡 <b>Ops Action:</b> Blacklisting the severed node(s) isolates the fraud core while safeguarding {blastSimulation.decoupledCount} peripheral merchant accounts from false-positive freezes.
                    </div>
                  </div>
                ) : (
                  <div className="small muted" style={{ lineHeight: 1.5 }}>
                    Click on any shared device, VPA, phone, or address node and select <b>“Simulate Severing”</b> to test how blacklisting specific infrastructure decouples legitimate merchants from the fraud ring.
                  </div>
                )}
              </Card>

              <Card title="Filters">
                <div className="small muted" style={{ marginBottom: 9 }}>
                  Infrastructure types shown:
                </div>
                {INFRA_TYPES.map((t) => {
                  const present = d.graph.nodes.some((n) => n.infra_type === t);
                  const on = !hiddenTypes.has(t);
                  return (
                    <label key={t} className={`checkbox-row ${present ? "" : "muted"}`} style={{ padding: "4px 0" }}>
                      <input type="checkbox" checked={on && present} disabled={!present} onChange={() => toggleType(t)} />
                      <span style={{ textTransform: "capitalize" }}>{t}</span>
                      {!present && <span className="small muted">— none in this cluster</span>}
                    </label>
                  );
                })}
              </Card>

              <Card title="Cluster summary">
                {[
                  ["Ring ID", d.cluster.ring_id ?? "unnamed"],
                  ["Members", String(d.cluster.members)],
                  ["Merchant span", String(Math.round(d.features["cluster_merchant_span"] ?? 0))],
                  ["Shared infra types", d.cluster.shared_infra_types.join(", ")],
                  ["Claims last 7d", String(d.evidence.recent_cluster_claims_7d)],
                  ["Claim value 7d", inr(d.evidence.cluster_value_7d_inr)],
                ].map(([k, v]) => (
                  <div key={k} className="spread" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <span className="small secondary">{k}</span>
                    <span className="small num mono" style={{ fontWeight: 650 }}>{v}</span>
                  </div>
                ))}
              </Card>

              <Card title="Members">
                <div>
                  {(d.evidence.cluster_members_sample as string[]).map((m) => (
                    <span key={m} className="chip" onClick={() => setQuery(m)}>
                      {maskId(m)}
                    </span>
                  ))}
                  {d.evidence.other_cluster_member_count > 11 && (
                    <span className="small muted">+{d.evidence.other_cluster_member_count - 11} more…</span>
                  )}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      {drawer && (
        <Drawer
          title={drawer.node.kind === "infra" ? `Shared ${drawer.node.infra_type}` : "Customer identity"}
          onClose={() => setDrawer(null)}
        >
          <div className="mono" style={{ fontSize: 15, fontWeight: 650, marginBottom: 12, wordBreak: "break-all" }}>
            {drawer.node.id}
          </div>
          <Row k="Type" v={drawer.node.kind === "infra" ? `Shared ${drawer.node.infra_type}` : "Customer identity"} />
          <Row k="Connected identities" v={String(drawer.neighbors.length)} />
          {drawer.merchants.length > 0 && <Row k="Merchants via this node" v={drawer.merchants.slice(0, 6).join(", ")} />}
          <div className="divider" />
          <div className="small secondary" style={{ marginBottom: 7 }}>Neighbors:</div>
          <div>
            {drawer.neighbors.map((id) => (
              <span key={id} className="chip">{id}</span>
            ))}
          </div>
          <div className="divider" style={{ margin: "16px 0" }} />
          <div>
            <Button
              variant={severedNodes.has(drawer.node.id) ? "success" : "danger"}
              style={{ width: "100%" }}
              onClick={() => toggleSeverNode(drawer.node.id)}
            >
              {severedNodes.has(drawer.node.id)
                ? "↩ Restore Connection in Graph"
                : "✂ Simulate Severing Node (Blast-Radius Test)"}
            </Button>
          </div>
        </Drawer>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="spread" style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="small secondary">{k}</span>
      <span className="small mono num" style={{ fontWeight: 650 }}>{v}</span>
    </div>
  );
}
