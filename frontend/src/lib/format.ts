/** Formatting helpers — Indian currency, percentages, identifiers. */

const groupIndian = (n: number): string => {
  const neg = n < 0;
  let s = Math.round(Math.abs(n)).toString();
  if (s.length > 3) {
    const head = s.slice(0, -3);
    const tail = s.slice(-3);
    const parts: string[] = [];
    let h = head;
    while (h.length > 2) {
      parts.unshift(h.slice(-2));
      h = h.slice(0, -2);
    }
    if (h) parts.unshift(h);
    s = `${parts.join(",")},${tail}`;
  }
  return `${neg ? "-" : ""}${s}`;
};

/** ₹12,499 */
export const inr = (v: number): string => `₹${groupIndian(v)}`;

/** Compact for KPIs: ₹18.4L / ₹12.5K / ₹3Cr */
export const inrCompact = (v: number): string => {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${Math.round(abs)}`;
};

/** 0.9348 → "93%" ; 0.4216 → "42%" */
export const pctScore = (score: number): string =>
  `${Math.round(score * 100)}%`;

/** raw fraction → "2.4%" */
export const pct = (frac: number, digits = 1): string =>
  `${(frac * 100).toFixed(digits)}%`;

/** count with thousands separators */
export const num = (v: number): string => v.toLocaleString("en-IN");

export const timeAgo = (iso: string, nowMs = Date.now()): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const sec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

export const shortTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });

/**
 * Masked identifier for display: USR_017544 → USR_01…544
 * Full IDs remain available via copy/search; masks reduce incidental PII exposure.
 */
export const maskId = (id: string): string => {
  if (id.length <= 7) return id;
  return `${id.slice(0, 5)}…${id.slice(-3)}`;
};

export const FEATURE_LABELS: Record<string, string> = {
  identity_order_count_so_far: "Identity prior orders",
  identity_merchant_count_so_far: "Identity merchants touched",
  identity_claim_count_so_far: "Identity prior claims",
  identity_claim_approval_ratio_so_far: "Identity claim approval ratio",
  shared_infra_neighbor_count: "Shared infrastructure neighbours",
  cluster_size: "Cluster size",
  cluster_merchant_span: "Merchant span of cluster",
  cluster_claim_burst_7d: "7-day cluster claim burst",
  reason_text_reuse_flag: "Reason-text reuse",
  amount: "Claim amount",
};

export const ACTION_LABELS: Record<string, string> = {
  AUTO_APPROVE: "Auto approve",
  STEP_UP_VERIFICATION: "Step-up verification",
  HOLD_PAYOUT_HUMAN_REVIEW: "Hold payout — human review",
};

export const ACTION_SHORT: Record<string, string> = {
  AUTO_APPROVE: "APPROVED",
  STEP_UP_VERIFICATION: "STEP-UP",
  HOLD_PAYOUT_HUMAN_REVIEW: "HOLD PAYOUT",
};

export const CASE_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_review: "In review",
  approved: "Approved",
  held: "On hold",
  escalated: "Escalated",
  closed: "Closed",
};

export const CASE_STATUS_CLASS: Record<string, string> = {
  open: "badge-neutral",
  in_review: "badge-info",
  approved: "badge-low",
  held: "badge-high",
  escalated: "badge-medium",
  closed: "badge-neutral",
};

/** SLA countdown label: "3h left" / "OVERDUE 2h" */
export const slaLabel = (
  iso: string | null | undefined,
): { text: string; overdue: boolean } => {
  if (!iso) return { text: "no SLA", overdue: false };
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return { text: "no SLA", overdue: false };
  const absH = Math.abs(ms) / 3.6e6;
  const dur =
    absH >= 1 ? `${absH.toFixed(absH < 10 ? 1 : 0)}h` : `${Math.max(1, Math.round(absH * 60))}m`;
  return ms >= 0
    ? { text: `${dur} left`, overdue: false }
    : { text: `OVERDUE ${dur}`, overdue: true };
};
