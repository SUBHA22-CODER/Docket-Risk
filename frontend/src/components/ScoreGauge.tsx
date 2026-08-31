import { useEffect, useState } from "react";

/** Precision Sentinel Risk Score Gauge
 *  Displays an interactive SVG ring gauge with perfectly centered score percentage and risk level text.
 */
export function ScoreGauge({
  score,
  level,
  size = 110,
}: {
  score: number;
  level: "HIGH" | "MEDIUM" | "LOW";
  size?: number;
}) {
  const stroke = 7;
  const r = (size - stroke) / 2 - 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setShown(score));
    return () => window.cancelAnimationFrame(id);
  }, [score]);

  const color =
    level === "HIGH"
      ? "var(--red)"
      : level === "MEDIUM"
        ? "var(--amber)"
        : "var(--green)";

  return (
    <div
      className="gauge-wrap"
      role="img"
      aria-label={`Risk score ${Math.round(score * 100)} percent, ${level} risk`}
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        width={size}
        height={size}
        style={{
          transform: "rotate(-90deg)",
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
      >
        <circle
          className="gauge-track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="gauge-value-transition"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div
        style={{
          position: "relative",
          zIndex: 1,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 4,
        }}
      >
        <div
          className="num"
          style={{
            fontSize: Math.max(20, size * 0.28),
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: "var(--text)",
          }}
        >
          {Math.round(score * 100)}
          <span style={{ fontSize: "0.55em", fontWeight: 700, color: "var(--text-muted)", marginLeft: 1 }}>%</span>
        </div>
        <div
          className="num"
          style={{
            fontSize: Math.max(9, size * 0.085),
            fontWeight: 800,
            letterSpacing: "0.08em",
            color,
            marginTop: 4,
            textTransform: "uppercase",
          }}
        >
          {level} RISK
        </div>
      </div>
    </div>
  );
}

/** Inline sentinel signal — ultra-compact version for headers and tables.
 *  Shows: SENTINEL SIGNAL · 93% · HIGH
 */
export function SentinelSignal({
  score,
  level,
}: {
  score: number;
  level: "HIGH" | "MEDIUM" | "LOW";
}) {
  const color =
    level === "HIGH"
      ? "var(--red)"
      : level === "MEDIUM"
        ? "var(--amber)"
        : "var(--green)";

  return (
    <div className="sentinel-signal" role="img" aria-label={`Sentinel signal ${Math.round(score * 100)}% ${level}`}>
      <div>
        <div className="sentinel-signal-label">Sentinel signal</div>
        <div className="sentinel-signal-score num" style={{ color }}>
          {Math.round(score * 100)}
          <span style={{ fontSize: "0.5em", fontWeight: 600, color: "var(--text-muted)" }}>%</span>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <div className="sentinel-signal-bar">
          <div
            className="sentinel-signal-fill"
            style={{ width: `${Math.round(score * 100)}%`, background: color }}
          />
        </div>
        <div className="small muted" style={{ marginTop: 2, fontWeight: 650, letterSpacing: "0.04em" }}>
          {level} RISK
        </div>
      </div>
    </div>
  );
}
