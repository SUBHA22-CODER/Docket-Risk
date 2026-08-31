import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { inr, inrCompact, num, pct } from "../lib/format";

export interface DayPoint {
  date: string;
  total: number;
  high: number;
  medium: number;
  low: number;
}

/* ---- Risk activity time series ---- */

export function TimeSeriesChart({
  data,
  height = 220,
}: {
  data: DayPoint[];
  height?: number;
}) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [grown, setGrown] = useState(false);

  /* bars rise from the baseline on mount and on every range switch (24h/7d/30d) */
  useLayoutEffect(() => {
    setGrown(false);
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setGrown(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [data]);

  if (data.length === 0) return null;

  const W = 1000;
  const H = height;
  const padB = 24;
  const maxV = Math.max(1, ...data.map((d) => d.total));
  const bw = W / data.length;

  const yScale = (v: number) => ((H - padB) * (1 - v / maxV)) + 4;
  // stacked segments: low (bottom), medium, high (top)
  const segs = data.map((d) => {
    const hi = d.high;
    const md = d.medium;
    const lo = Math.max(0, d.total - d.high - d.medium);
    return { hi, md, lo };
  });

  return (
    <div
      ref={ref}
      style={{ position: "relative" }}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label="Claims volume by risk level over time"
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const xFrac = (e.clientX - rect.left) / rect.width;
          const i = Math.min(data.length - 1, Math.max(0, Math.floor(xFrac * data.length)));
          setHover({ i, x: e.clientX - rect.left, y: e.clientY - rect.top });
        }}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={yScale(maxV * f)} y2={yScale(maxV * f)}
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}
        {segs.map((s, i) => {
          const x = i * bw + bw * 0.14;
          const w = bw * 0.72;
          const yLo = yScale(s.lo);
          const hLo = H - padB - yLo + 4;
          const yMd = yScale(s.lo + s.md);
          const hMd = yLo - yMd;
          const yHi = yScale(s.lo + s.md + s.hi);
          const hHi = yMd - yHi;
          return (
            <g
              key={i}
              className={`ts-col${grown ? " in" : ""}`}
              style={{ transitionDelay: `${Math.min(i * 12, 600)}ms` }}
            >
              <rect x={x} y={yLo} width={w} height={Math.max(0, hLo)} fill="#1e2d4a" opacity={0.7} rx={1} />
              <rect x={x} y={yMd} width={w} height={Math.max(0, hMd)} fill="var(--amber)" opacity={0.85} rx={1} />
              <rect x={x} y={yHi} width={w} height={Math.max(0, hHi)} fill="var(--red)" opacity={0.9} rx={1} />
              {hover?.i === i && (
                <rect className="ts-hover-col" x={x - 2} y={4} width={w + 4} height={H - padB} fill="rgba(92,155,255,0.07)" />
              )}
            </g>
          );
        })}
        {/* x labels: first / middle / last */}
        {data.length > 1 && [0, Math.floor((data.length - 1) / 2), data.length - 1]
          .filter((v, idx, arr) => arr.indexOf(v) === idx)
          .map((i) => (
            <text
              key={i}
              x={Math.min(W - 30, Math.max(18, i * bw + bw / 2))}
              y={H - 7}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {data[i]?.date.slice(5)}
            </text>
          ))}
      </svg>
      {hover && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(hover.x + 14, (ref.current?.clientWidth ?? 400) - 180),
            top: Math.max(4, hover.y - 70),
          }}
        >
          <div className="tt-date">{data[hover.i]?.date}</div>
          <div className="tt-row"><span className="swatch" style={{ background: "var(--red-strong)" }} />High<span className="tt-val num">{num(data[hover.i]?.high ?? 0)}</span></div>
          <div className="tt-row"><span className="swatch" style={{ background: "var(--amber)" }} />Medium<span className="tt-val num">{num(data[hover.i]?.medium ?? 0)}</span></div>
          <div className="tt-row"><span className="swatch" style={{ background: "#33456b" }} />Approved<span className="tt-val num">{num(segs[hover.i]?.lo ?? 0)}</span></div>
          <div className="tt-row" style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
            Total<span className="tt-val num">{num(data[hover.i]?.total ?? 0)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function SeriesLegend() {
  return (
    <div className="row-wrap" style={{ gap: 12 }}>
      {[
        ["var(--red)", "High risk"],
        ["var(--amber)", "Medium risk"],
        ["#1e2d4a", "Auto-approved"],
      ].map(([c, l]) => (
        <span key={l} className="legend-key">
          <span className="legend-swatch" style={{ background: c }} /> {l}
        </span>
      ))}
    </div>
  );
}

/* ---- Risk distribution stacked bar ---- */

export function DistributionBar({
  buckets,
}: {
  buckets: { level: "HIGH" | "MEDIUM" | "LOW"; count: number; value: number; color: string }[];
}) {
  const total = Math.max(1, buckets.reduce((a, b) => a + b.count, 0));
  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 12,
          borderRadius: 6,
          overflow: "hidden",
          border: "1px solid var(--border)",
          background: "var(--panel-inset)",
        }}
        role="img"
        aria-label={buckets.map((b) => `${b.level}: ${b.count}`).join(", ")}
      >
        {buckets.map((b) => (
          <div
            key={b.level}
            style={{ width: `${(b.count / total) * 100}%`, background: b.color, transition: "width 0.4s ease" }}
            title={`${b.level}: ${num(b.count)} (${pct(b.count / total, 1)})`}
          />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12 }}>
        {buckets.map((b) => (
          <div key={b.level} style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3, flexWrap: "wrap" }}>
              <div className="row" style={{ gap: 4, minWidth: 0 }}>
                <span className="legend-swatch" style={{ background: b.color, width: 7, height: 7, borderRadius: 2, flexShrink: 0 }} />
                <span className="small" style={{ fontWeight: 700, fontSize: 11 }}>{b.level}</span>
              </div>
              <span className="small muted num" style={{ fontSize: 10.5 }}>{pct(b.count / total, 1)}</span>
            </div>
            <div className="num" style={{ fontSize: 15, fontWeight: 750, marginTop: 3 }}>
              {num(b.count)}
            </div>
            <div
              className="small muted num"
              style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}
              title={inr(b.value)}
            >
              {inrCompact(b.value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Precision-Recall curve ---- */

export function PRChart({
  points,
  baseline,
  markers,
  height = 300,
}: {
  points: [number, number][];
  baseline: number;
  markers: { label: string; color: string; recall?: number; precision?: number }[];
  height?: number;
}) {
  const W = 520;
  const H = height;
  const padL = 44;
  const padB = 32;
  const padT = 12;
  const px = (r: number) => padL + r * (W - padL - 14);
  const py = (p: number) => H - padB - p * (H - padT - padB);

  const path = useMemo(
    () =>
      points.length === 0
        ? ""
        : points.map(([r, p], i) => `${i === 0 ? "M" : "L"}${px(r).toFixed(1)},${py(p).toFixed(1)}`).join(" "),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, height],
  );

  /* draw-in + marker pop-in animation */
  const pathRef = useRef<SVGPathElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [curveLen, setCurveLen] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [markersIn, setMarkersIn] = useState(false);

  useLayoutEffect(() => {
    const el = pathRef.current;
    if (!el || !path) return;
    setCurveLen(el.getTotalLength());
    setDrawn(false);
    setMarkersIn(false);
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setDrawn(true));
    });
    const failSafe = window.setTimeout(() => setMarkersIn(true), 1200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(failSafe);
    };
  }, [path]);

  /* hover crosshair */
  const [hov, setHov] = useState<{ i: number; x: number; y: number } | null>(null);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const ctm = e.currentTarget.getScreenCTM();
    if (!ctm) return;
    const ux = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse()).x;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (!pt) continue;
      const d = Math.abs(px(pt[0]) - ux);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    setHov({
      i: best,
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    });
  };

  const hp = hov ? points[hov.i] : undefined;

  return (
    <div ref={wrapRef} style={{ position: "relative" }} onMouseLeave={() => setHov(null)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label="Precision-recall curve"
        style={{ cursor: "crosshair" }}
        onMouseMove={onMove}
      >
        {/* gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W - 14} y1={py(f)} y2={py(f)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 7} y={py(f) + 3} textAnchor="end" fontSize={9.5} fill="var(--text-muted)">
              {f.toFixed(2)}
            </text>
          </g>
        ))}
        {/* baseline */}
        <line x1={padL} x2={W - 14} y1={py(baseline)} y2={py(baseline)} stroke="var(--text-muted)" strokeDasharray="5 4" strokeWidth={1.2} />
        <text x={W - 16} y={py(baseline) - 5} textAnchor="end" fontSize={9.5} fill="var(--text-muted)">
          base rate {pct(baseline, 1)}
        </text>
        {/* hover crosshair */}
        {hp && (
          <g pointerEvents="none">
            <line
              x1={px(hp[0])}
              x2={px(hp[0])}
              y1={padT}
              y2={H - padB}
              stroke="var(--blue)"
              strokeOpacity={0.4}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={px(hp[0])} cy={py(hp[1])} r={5.5} fill="var(--blue)" stroke="#0a0e17" strokeWidth={1.5} />
          </g>
        )}
        {/* curve */}
        <path
          ref={pathRef}
          d={path}
          fill="none"
          stroke="var(--blue)"
          strokeWidth={2.2}
          strokeLinecap="round"
          style={{
            strokeDasharray: curveLen || undefined,
            strokeDashoffset: curveLen && !drawn ? curveLen + 2 : 0,
            transition: drawn ? "stroke-dashoffset 650ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
          }}
          onTransitionEnd={() => setMarkersIn(true)}
        />
        {/* threshold markers */}
        {markers.map(
          (m, mi) =>
            m.recall !== undefined &&
            m.precision !== undefined && (
              <g
                key={m.label}
                className={`pr-marker${markersIn ? " in" : ""}`}
                style={{ transitionDelay: markersIn ? `${mi * 90}ms` : "0ms" }}
              >
                <circle cx={px(m.recall)} cy={py(m.precision)} r={4.5} fill={m.color} stroke="#0a0e17" strokeWidth={1.5} />
                <text
                  x={px(m.recall)}
                  y={py(m.precision) - 9}
                  textAnchor="middle"
                  fontSize={9.5}
                  fontWeight={700}
                  fill={m.color}
                >
                  {m.label}
                </text>
              </g>
            ),
        )}
        {/* axes labels */}
        <text x={(W + padL) / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
          Recall
        </text>
        <text x={13} y={H / 2} textAnchor="middle" fontSize={10} fill="var(--text-secondary)" transform={`rotate(-90 13 ${H / 2})`}>
          Precision
        </text>
      </svg>
      {hp && hov && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(hov.x + 14, (wrapRef.current?.clientWidth ?? 400) - 150),
            top: Math.max(4, hov.y - 58),
          }}
        >
          <div className="tt-date">nearest curve point</div>
          <div className="tt-row"><span className="swatch" style={{ background: "var(--blue)" }} />Recall<span className="tt-val num">{pct(hp[0], 1)}</span></div>
          <div className="tt-row"><span className="swatch" style={{ background: "var(--blue)", opacity: 0.55 }} />Precision<span className="tt-val num">{pct(hp[1], 1)}</span></div>
        </div>
      )}
    </div>
  );
}

/* ---- Feature importance bars ---- */

export function ImportanceBars({
  items,
  topFeatureLabel,
}: {
  items: { feature: string; label: string; importance: number }[];
  topFeatureLabel?: string;
}) {
  const max = Math.max(...items.map((i) => i.importance), 1e-9);
  return (
    <div role="table" aria-label="Feature importance">
      {items.map((item) => {
        const share = item.importance / max;
        const color =
          item.feature.includes("cluster") ||
          item.feature.includes("infra") ||
          item.feature.includes("burst") ||
          item.feature.includes("reason")
            ? "var(--blue)"
            : "#33456b";
        return (
          <div key={item.feature} className="feature-bar-row">
            <span className="feature-name" title={topFeatureLabel}>
              {item.label}
            </span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${Math.max(share * 100, 0.8)}%`, background: color }}
              />
            </span>
            <span className="signal-tag num muted">{(item.importance * 100).toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}
