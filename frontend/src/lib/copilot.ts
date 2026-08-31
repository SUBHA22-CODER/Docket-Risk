import type { ClaimDetail } from "../types";
import { inr, maskId, pctScore } from "./format";

/**
 * Rule-based investigation copilot — turns the structured evidence bundle into
 * an analyst-ready narrative. No external AI service: every sentence is
 * derived from graph evidence and temporally-safe features.
 */
export function generateCaseSummary(d: ClaimDetail): string {
  const c = d.claim;
  const ev = d.evidence;
  const paras: string[] = [];

  paras.push(
    [
      `Claim ${c.claim_id} — ${inr(c.amount)} at ${c.merchant_id},`,
      `scored ${pctScore(d.score)} (${d.risk_level} risk).`,
      `Recommendation: ${d.action.replace(/_/g, " ").toLowerCase()}.`,
      `Reason on file: “${c.reason_text}”.`,
    ].join(" "),
  );

  if (ev.other_cluster_member_count > 0) {
    const typeCounts: Record<string, number> = {};
    for (const s of ev.shared_infra) {
      const t = s.type.toLowerCase();
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    }
    const typeStr = Object.entries(typeCounts)
      .map(([t, n]) => `${n} ${t}${n > 1 ? "s" : ""}`)
      .join(", ");
    paras.push(
      [
        `Coordination: the claimant sits in a cluster of ${d.cluster.members} identities`,
        typeStr ? `bridged by ${typeStr}` : "",
        `. ${ev.shared_infra.length} shared infrastructure node(s) connect customers who otherwise have no relationship.`,
        ev.cluster_members_sample?.length
          ? ` Sample members: ${ev.cluster_members_sample.slice(0, 4).map(maskId).join(", ")}${ev.other_cluster_member_count > 4 ? "…" : ""}.`
          : "",
      ].join(""),
    );
  } else {
    paras.push(
      "Coordination: none — this identity sits alone in the graph with no shared devices, VPAs, phones, addresses or cards.",
    );
  }

  const tempo: string[] = [];
  if (ev.recent_cluster_claims_7d > 0) {
    tempo.push(
      `${ev.recent_cluster_claims_7d} claim(s) worth ${inr(ev.cluster_value_7d_inr)} filed by connected identities in the previous 7 days`,
    );
  }
  if (ev.reason_text_reused_across_identities) {
    tempo.push("the exact claim reason text was reused verbatim by another cluster member");
  }
  paras.push(
    tempo.length
      ? `Tempo: ${tempo.join("; ")}.`
      : "Tempo: no claim burst and no reason-text reuse in the surrounding cluster.",
  );

  const hist = d.identity_history;
  paras.push(
    hist.counts.total > 0
      ? `History: ${hist.counts.total} prior claim(s) from this identity — ${hist.counts.holds} held, ${hist.counts.auto_approved} auto-approved.`
      : "History: first claim from this identity — no prior refund behaviour on record, consistent with a fresh account being warmed by a ring.",
  );

  const m = d.merchant;
  const merch: string[] = [];
  if (m.n_claims !== undefined && m.n_orders) {
    merch.push(`claim rate ${((m.claim_rate ?? 0) * 100).toFixed(1)}% across ${m.n_orders} orders`);
  }
  if (m.connected_clusters && m.connected_clusters.length > 0) {
    merch.push(`merchant is connected to ring(s) ${m.connected_clusters.join(", ")}`);
  }
  paras.push(
    merch.length
      ? `Merchant context: ${merch.join("; ")}.`
      : "Merchant context: nothing unusual about this merchant in the window.",
  );

  const top = [...ev.why_flagged]
    .filter((w) => w.feature !== "amount")
    .sort((a, b) => b.value - a.value)[0];
  paras.push(
    top
      ? `Assessment: the dominant signal is ${top.label.toLowerCase()}. The score is driven by network structure, not claim amount — ${d.risk_level === "HIGH" ? "hold payout and verify device/VPA ownership before release" : d.risk_level === "MEDIUM" ? "run step-up verification before payout" : "routine approval is appropriate"}.`
      : `Assessment: ${d.risk_level === "HIGH" ? "hold payout pending verification" : "routine processing is appropriate"}.`,
  );
  paras.push(
    "Note: auto-generated from graph evidence and temporally-safe features. Analyst judgement overrides this summary.",
  );

  return paras.join("\n\n");
}

/**
 * Generates a sanitized, customer-facing Explanation Notice for Merchant Support & Appeals.
 * Resolves the "vague Section 12.2 ToS" freeze problem by providing transparent,
 * specific rationale and actionable verification steps without leaking internal ML weights.
 */
export function generateMerchantExplanationNotice(d: ClaimDetail): string {
  const c = d.claim;
  const ev = d.evidence;
  const isHigh = d.risk_level === "HIGH";

  const lines: string[] = [
    `RAZORPAY RISK & SETTLEMENT NOTICE — REF #${c.claim_id}`,
    `Date: ${new Date(c.ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} | Order: ${c.order_id}`,
    `Merchant Account: ${c.merchant_id} | Disputed Amount: ${inr(c.amount)}`,
    "",
    "STATUS: TEMPORARY SETTLEMENT REVIEW (HOLD PRE-PAYOUT)",
    "",
    "1. SPECIFIC REVIEW REASON (EVIDENCE SUMMARY):",
  ];

  if (ev.shared_infra.length > 0) {
    const types = Array.from(new Set(ev.shared_infra.map((s) => s.type.toUpperCase()))).join(", ");
    lines.push(
      `• Coordinated multi-account activity: Linked infrastructure (${types}) detected across ${d.cluster.members} separate user identities.`,
    );
  }
  if (ev.recent_cluster_claims_7d > 2) {
    lines.push(
      `• High refund velocity: ${ev.recent_cluster_claims_7d} claims submitted across linked entities within the last 7 days.`,
    );
  }
  if (ev.reason_text_reused_across_identities) {
    lines.push(
      `• Duplicated claim rationale: Identical dispute phrasing detected across disparate customer accounts.`,
    );
  }
  if (ev.shared_infra.length === 0 && ev.recent_cluster_claims_7d <= 2) {
    lines.push(
      `• Standard precautionary hold: Transaction value and velocity profile flagged for step-up confirmation.`,
    );
  }

  lines.push(
    "",
    "2. WHY THIS MATTERS TO YOUR ACCOUNT:",
    "To protect your merchant settlement balance against synthetic buyer syndicates and chargeback liabilities, Razorpay Risk Ops temporarily holds disputed funds before banking settlement release.",
    "",
    "3. REQUIRED DOCUMENTATION TO EXPEDITE RELEASE (APPEAL CHECKLIST):",
    "To release this hold within 24 hours, please upload the following via Dashboard > Support > Appeals:",
    " [ ] Proof of Delivery (Signed POD / Courier Tracking AWB)",
    " [ ] Customer Communication Record (Email/Chat confirmation of order status)",
    " [ ] Bank Account/VPA ownership confirmation for refund payout",
    "",
    "4. SLA & ESCALATION:",
    isHigh
      ? "• High Priority Review SLA: 12 Hours from document submission."
      : "• Standard Review SLA: 24 Hours from document submission.",
    "• Direct Ops Escalation Channel: risk-appeals@razorpay.com (Quote Ref #" + c.claim_id + ")"
  );

  return lines.join("\n");
}

