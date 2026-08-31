import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { DataSet, Network } from "vis-network/standalone";
import type { Data, Options } from "vis-network/standalone";
import type { GraphEdge, GraphNode } from "../types";
import { Icon } from "./Icon";

/* Node shape mapping per entity type */
const INFRA_SHAPES: Record<string, string> = {
  device:  "box",        // square/box for device
  VPA:     "diamond",    // diamond for VPA
  phone:   "triangle",   // triangle for phone
  address: "hexagon",    // hexagon for address
  card:    "square",     // square for card
};

/* Sentinel Modern Palette for Nodes */
const INFRA_COLORS: Record<"device" | "VPA" | "phone" | "address" | "card" | string, { bg: string; border: string }> = {
  device:  { bg: "#0284c7", border: "#38bdf8" },
  VPA:     { bg: "#7c3aed", border: "#a78bfa" },
  phone:   { bg: "#d97706", border: "#fbbf24" },
  address: { bg: "#059669", border: "#34d399" },
  card:    { bg: "#e11d48", border: "#fb7185" },
};

const IDENT_COLOR = { bg: "#1e3a8a", border: "#60a5fa" };
const FLAGGED_COLOR = { bg: "#9f1239", border: "#f43f5e" };

export interface NodeDetail {
  node: GraphNode;
  neighbors: string[];
  merchants: string[];
}

export type GraphViewMode = "bipartite" | "ident-only" | "high-risk";

interface NetworkGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  flaggedIdentity?: string | null;
  onSelectNode?: (detail: NodeDetail | null) => void;
  height?: number;
  showInfraTypes?: Set<string>;
  searchHit?: string | null;
  /** When set, only these identities (+ their infra links) are shown — used by the formation replay. */
  visibleIds?: Set<string> | null;
  /** When set, edges connected to these severed nodes are severed in real-time for blast-radius simulation. */
  severedNodeIds?: Set<string>;
  /** Identities that are safely decoupled by the blast-radius simulation. */
  decoupledNodeIds?: Set<string>;
}

export interface NetworkGraphHandle {
  /** Returns the underlying canvas element for PNG export, or null if not ready. */
  getCanvas: () => HTMLCanvasElement | null;
}

/**
 * High-Taste Interactive Sentinel Network Graph Component.
 * Visualizes multi-entity infrastructure links with physics, crisp typography, and risk highlighting.
 */
export const NetworkGraph = forwardRef<NetworkGraphHandle, NetworkGraphProps>(function NetworkGraph({
  nodes,
  edges,
  flaggedIdentity,
  onSelectNode,
  height = 480,
  showInfraTypes,
  searchHit,
  visibleIds,
  severedNodeIds,
  decoupledNodeIds,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodesDsRef = useRef<DataSet<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edgesDsRef = useRef<DataSet<any> | null>(null);
  const pulseRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [viewMode, setViewMode] = useState<GraphViewMode>("bipartite");
  const [physicsActive, setPhysicsActive] = useState(true);

  useImperativeHandle(ref, () => ({
    getCanvas: () => {
      // vis-network renders into an inner canvas inside the container
      return containerRef.current?.querySelector("canvas") ?? null;
    },
  }));

  // Filter nodes based on infra types & viewMode
  const visibleNodes = useMemo(() => {
    let result = nodes;
    if (visibleIds) {
      const idents = new Set(
        nodes
          .filter(
            (n) =>
              n.kind === "ident" &&
              (visibleIds.has(n.id) || n.id === flaggedIdentity),
          )
          .map((n) => n.id),
      );
      const infra = new Set<string>();
      for (const e of edges) {
        if (idents.has(e.from) && !idents.has(e.to)) infra.add(e.to);
        if (idents.has(e.to) && !idents.has(e.from)) infra.add(e.from);
      }
      const active = new Set<string>([...idents, ...infra]);
      result = result.filter((n) => active.has(n.id));
    }
    if (showInfraTypes) {
      result = result.filter(
        (n) =>
          n.kind === "ident" ||
          (n.infra_type != null && showInfraTypes.has(n.infra_type)),
      );
    }
    if (viewMode === "ident-only") {
      result = result.filter((n) => n.kind === "ident");
    } else if (viewMode === "high-risk") {
      result = result.filter(
        (n) => n.id === flaggedIdentity || n.kind === "infra",
      );
    }
    return result;
  }, [nodes, showInfraTypes, viewMode, flaggedIdentity, visibleIds, edges]);

  const data: Data = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    const visEdges = edges.filter((e) => {
      if (!ids.has(e.from) || !ids.has(e.to)) return false;
      if (severedNodeIds && (severedNodeIds.has(e.from) || severedNodeIds.has(e.to))) {
        return false;
      }
      return true;
    });

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const visNodes: any[] = visibleNodes.map((n) => {
      const isFlagged = n.id === flaggedIdentity;
      const isIdent = n.kind === "ident";
      const isSevered = severedNodeIds?.has(n.id) ?? false;
      const isDecoupled = decoupledNodeIds?.has(n.id) ?? false;

      let colors = isIdent
        ? isFlagged
          ? FLAGGED_COLOR
          : isDecoupled
          ? { bg: "#064e3b", border: "#10b981" }
          : IDENT_COLOR
        : INFRA_COLORS[n.infra_type ?? ""] ?? { bg: "#0284c7", border: "#38bdf8" };

      if (isSevered) {
        colors = { bg: "#262626", border: "#ef4444" };
      }

      return {
        id: n.id,
        label: isSevered
          ? `[SEVERED]\n${n.kind === "infra" ? `${n.infra_type?.toUpperCase()}\n${n.id.slice(-6)}` : n.label}`
          : isDecoupled
          ? `✓ SAFE\n${n.label}`
          : n.kind === "infra"
          ? `${n.infra_type?.toUpperCase()}\n${n.id.slice(-6)}`
          : n.label,
        shape: n.kind === "infra"
          ? (INFRA_SHAPES[n.infra_type ?? ""] ?? "box")
          : "dot",
        color: {
          background: colors.bg,
          border: colors.border,
          highlight: { background: "#ffffff", border: "#3b82f6" },
          hover: { background: colors.border, border: "#ffffff" },
        },
        size: isIdent ? (isFlagged ? 20 : isDecoupled ? 16 : 14) : isSevered ? 9 : 11,
        font: {
          color: isSevered ? "#ef4444" : isDecoupled ? "#34d399" : isIdent ? "#f1f5f9" : "#94a3b8",
          size: isIdent ? 11 : 9,
          face: "'JetBrains Mono', 'Plus Jakarta Sans', monospace",
          multi: true,
          bold: isFlagged || isDecoupled ? "11px 'JetBrains Mono'" : undefined,
        },
        borderWidth: isFlagged || isDecoupled ? 2.5 : 1.5,
        shadow: {
          enabled: true,
          size: isFlagged ? 12 : isDecoupled ? 10 : 6,
          x: 0,
          y: 2,
          color: isFlagged
            ? "rgba(244, 63, 94, 0.4)"
            : isDecoupled
            ? "rgba(16, 185, 129, 0.5)"
            : isSevered
            ? "rgba(239, 68, 68, 0.2)"
            : "rgba(0, 0, 0, 0.5)",
        },
      };
    });

    const visEdgesAny: any[] = visEdges.map((e) => {
      const flat = e.label.replace(/\n/g, ", ");
      return {
        from: e.from,
        to: e.to,
        label: flat.length > 24 ? `${flat.slice(0, 22)}…` : flat,
        font: {
          size: 8.5,
          color: "#64748b",
          strokeWidth: 0,
          face: "'JetBrains Mono', monospace",
        },
        color: {
          color: "rgba(59, 130, 246, 0.25)",
          highlight: "#60a5fa",
          hover: "rgba(59, 130, 246, 0.5)",
        },
        width: 1,
        selectionWidth: 2,
        hoverWidth: 1.5,
        smooth: { type: "continuous", roundness: 0.2 },
      };
    });

    return { nodes: visNodes, edges: visEdgesAny };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }, [visibleNodes, edges, flaggedIdentity]);

  useEffect(() => {
    if (!containerRef.current) return;
    const options: Options = {
      autoResize: true,
      physics: {
        enabled: physicsActive,
        solver: "forceAtlas2Based",
        forceAtlas2Based: {
          gravitationalConstant: -2800,
          centralGravity: 0.015,
          springLength: 110,
          springConstant: 0.06,
          damping: 0.4,
        },
        stabilization: { iterations: 250, fit: true },
      },
      interaction: {
        hover: true,
        tooltipDelay: 120,
        navigationButtons: false,
        keyboard: false,
        zoomView: true,
        dragView: true,
      },
    };

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const nodesDataSet = new DataSet<any>(data.nodes as any[]);
    const edgesDataSet = new DataSet<any>(data.edges as any[]);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    nodesDsRef.current = nodesDataSet;
    edgesDsRef.current = edgesDataSet;

    const network = new Network(
      containerRef.current,
      { nodes: nodesDataSet, edges: edgesDataSet } as Data,
      options,
    );
    networkRef.current = network;
    setReady(true);

    network.on("click", (params) => {
      if (!onSelectNode) return;
      const nodeId: string | undefined = params.nodes?.[0];
      if (!nodeId) {
        onSelectNode(null);
        return;
      }
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) {
        onSelectNode(null);
        return;
      }
      const neighborEdges = edges.filter((e) => e.from === nodeId || e.to === nodeId);
      const neighbors = Array.from(
        new Set(neighborEdges.map((e) => (e.from === nodeId ? e.to : e.from))),
      );
      const merchants = Array.from(
        new Set(
          neighborEdges.flatMap((e) => e.label.split("\n")).filter(Boolean),
        ),
      ).slice(0, 10);
      onSelectNode({ node, neighbors, merchants });
    });

    return () => {
      network.destroy();
      networkRef.current = null;
      setReady(false);
    };
  }, [data, edges, nodes, onSelectNode, physicsActive]);

  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(
      () =>
        networkRef.current?.fit({
          animation: { duration: 350, easingFunction: "easeOutQuad" },
        }),
      500,
    );
    return () => window.clearTimeout(id);
  }, [ready]);

  useEffect(() => {
    if (!searchHit || !networkRef.current) return;
    try {
      networkRef.current.selectNodes([searchHit]);
      networkRef.current.focus(searchHit, {
        scale: 1.2,
        animation: { duration: 300, easingFunction: "easeInOutQuad" },
      });
    } catch {
      /* node hidden by filter */
    }
  }, [searchHit]);

  /* edge signal wave — staggered opacity pulses travel outward across links */
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ds = edgesDsRef.current;
    if (!ds || ds.length === 0) return;
    const ids = ds.getIds() as number[];
    let frame = 0;
    const id = window.setInterval(() => {
      frame += 1;
      const updates = ids.map((eid, i) => {
        const phase = (((frame + i * 4) % 30) / 30) * Math.PI;
        const alpha = 0.14 + 0.34 * Math.sin(phase);
        return { id: eid, color: { color: `rgba(59, 130, 246, ${alpha.toFixed(3)})` } };
      });
      edgesDsRef.current?.update(updates);
    }, 160);
    return () => window.clearInterval(id);
  }, [data, ready]);

  /* flagged-node pulse ring — tracks the node through pan/zoom/physics */
  useEffect(() => {
    const net = networkRef.current;
    const el = pulseRef.current;
    if (!net || !el || !flaggedIdentity) return;
    const hidden = visibleIds != null && !visibleIds.has(flaggedIdentity);
    if (hidden) {
      el.style.display = "none";
      return;
    }
    const handler = () => {
      try {
        const pos = net.getPositions([flaggedIdentity])[flaggedIdentity];
        if (!pos) {
          el.style.display = "none";
          return;
        }
        const dom = net.canvasToDOM(pos);
        el.style.display = "block";
        el.style.transform = `translate(${dom.x}px, ${dom.y}px)`;
      } catch {
        el.style.display = "none";
      }
    };
    handler();
    net.on("afterDrawing", handler);
    return () => {
      net.off("afterDrawing", handler);
    };
  }, [ready, flaggedIdentity, visibleIds, data]);

  const togglePhysics = () => {
    setPhysicsActive((prev) => !prev);
  };

  return (
    <div className="graph-container" style={{ height }}>
      {/* Background Matrix Grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          opacity: 0.6,
        }}
      />

      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />

      {/* Pulse ring on the flagged identity */}
      <div ref={pulseRef} className="graph-pulse" aria-hidden="true" />

      {/* Top Toolbar */}
      <div className="graph-toolbar">
        <button
          className="icon-btn"
          title="Fit graph to view"
          aria-label="Fit graph"
          onClick={() => networkRef.current?.fit({ animation: true })}
        >
          <Icon name="fit" size={13} />
        </button>
        <button
          className="icon-btn"
          title="Re-stabilize layout"
          aria-label="Reset layout"
          onClick={() => {
            const net = networkRef.current;
            if (!net) return;
            net.stabilize(180);
            setTimeout(() => net.fit({ animation: true }), 550);
          }}
        >
          <Icon name="refresh" size={12} />
        </button>
        <button
          className={`icon-btn ${physicsActive ? "" : "active"}`}
          title={physicsActive ? "Pause Physics Simulation" : "Resume Physics Simulation"}
          aria-label="Toggle physics"
          onClick={togglePhysics}
        >
          <Icon name={physicsActive ? "pause" : "play"} size={11} />
        </button>
      </div>

      {/* Mode Selector Segment */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10,
        }}
      >
        <div className="segmented">
          <button
            className={viewMode === "bipartite" ? "active" : ""}
            onClick={() => setViewMode("bipartite")}
          >
            Full Infra Graph
          </button>
          <button
            className={viewMode === "ident-only" ? "active" : ""}
            onClick={() => setViewMode("ident-only")}
          >
            Identities Only
          </button>
          <button
            className={viewMode === "high-risk" ? "active" : ""}
            onClick={() => setViewMode("high-risk")}
          >
            Risk Spotlight
          </button>
        </div>
      </div>

      {/* Legend Footer */}
      <div className="graph-legend">
        <span className="legend-key">
          <span
            className="legend-swatch"
            style={{ background: FLAGGED_COLOR.border, boxShadow: "0 0 6px " + FLAGGED_COLOR.border }}
          />{" "}
          Flagged Ring
        </span>
        <span className="legend-key">
          <span className="legend-swatch" style={{ background: IDENT_COLOR.border }} />{" "}
          Identity
        </span>
        <span className="legend-key">
          <span className="legend-swatch box" style={{ background: INFRA_COLORS.device?.border ?? "#38bdf8" }} />{" "}
          Device
        </span>
        <span className="legend-key">
          <span
            className="legend-swatch"
            style={{
              background: INFRA_COLORS.VPA?.border ?? "#a78bfa",
              transform: "rotate(45deg)",
              borderRadius: "1px",
            }}
          />{" "}
          VPA
        </span>
        <span className="legend-key">
          <span
            className="legend-swatch"
            style={{
              background: INFRA_COLORS.phone?.border ?? "#fbbf24",
              clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
            }}
          />{" "}
          Phone
        </span>
        <span className="legend-key">
          <span className="legend-swatch box" style={{ background: INFRA_COLORS.address?.border ?? "#34d399" }} />{" "}
          Address
        </span>
        <span className="legend-key">
          <span className="legend-swatch box" style={{ background: INFRA_COLORS.card?.border ?? "#fb7185" }} />{" "}
          Card
        </span>
      </div>
    </div>
  );
});
