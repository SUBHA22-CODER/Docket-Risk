/**
 * Sparkline — inline SVG micro-chart for score trend visualization.
 * No dependencies; renders a polyline from a number[] of values in [0,1].
 */

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  /** If true, fill area below the line */
  fill?: boolean;
}

export function Sparkline({ values, width = 64, height = 22, color = "var(--blue)", fill = false }: SparklineProps) {
  if (values.length < 2) {
    return <span className="small muted" style={{ fontSize: 11 }}>—</span>;
  }

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const px = (i: number) => pad + (i / (values.length - 1)) * w;
  const py = (v: number) => pad + h - ((v - min) / range) * h;

  const pts = values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const linePath = "M" + values.map((v, i) => `${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" L");
  const fillPath = linePath
    + ` L${px(values.length - 1).toFixed(1)} ${(pad + h).toFixed(1)}`
    + ` L${pad.toFixed(1)} ${(pad + h).toFixed(1)} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="Score trend"
      style={{ display: "block", overflow: "visible" }}
    >
      {fill && (
        <path
          d={fillPath}
          fill={color}
          opacity={0.12}
        />
      )}
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Last point dot */}
      <circle
        cx={px(values.length - 1)}
        cy={py(values[values.length - 1]!)}
        r={2.5}
        fill={color}
      />
    </svg>
  );
}
