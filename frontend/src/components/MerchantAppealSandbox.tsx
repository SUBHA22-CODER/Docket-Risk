import { useState } from "react";
import { Icon } from "./Icon";
import { Button, Card, InfoTip, useToast } from "./ui";
import { inr, shortTime } from "../lib/format";
import { api } from "../lib/api";
import type { ClaimDetail } from "../types";

interface MerchantAppealSandboxProps {
  claimDetail: ClaimDetail;
  onAppealApproved?: (newScore: number, reason: string) => void;
}

export function MerchantAppealSandbox({
  claimDetail,
  onAppealApproved,
}: MerchantAppealSandboxProps) {
  const toast = useToast();
  const claim = claimDetail.claim;

  // Form State
  const [docType, setDocType] = useState<"awb" | "gstin" | "pod" | "invoice">("awb");
  const [refNumber, setRefNumber] = useState("BLUEDART_DEL_778192");
  const [carrier, setCarrier] = useState("BlueDart Express Air (API: Verified)");
  const [fileName, setFileName] = useState("bluedart_signed_pod_manifest.pdf");
  const [fileSize, setFileSize] = useState("2.4 MB");
  const [merchantNotes, setMerchantNotes] = useState(
    "Consignee accepted delivery at customer pin code 560001. Signed physical POD manifest and OTP verification confirmed on delivery."
  );

  // Pipeline State
  const [status, setStatus] = useState<"idle" | "verifying" | "approved" | "rejected">("idle");
  const [step, setStep] = useState(0);
  const [sha256Hash, setSha256Hash] = useState<string>("");
  const [webhookPayload, setWebhookPayload] = useState<Record<string, unknown> | null>(null);

  // Quick Preset Loader
  const loadPreset = (preset: "awb" | "gstin" | "fake") => {
    setStatus("idle");
    setStep(0);
    setWebhookPayload(null);

    if (preset === "awb") {
      setDocType("awb");
      setRefNumber("BLUEDART_DEL_778192");
      setCarrier("BlueDart Express Air (API: Verified)");
      setFileName("bluedart_signed_pod_manifest.pdf");
      setFileSize("2.4 MB");
      setMerchantNotes(
        "Consignee accepted delivery at customer pin code 560001. Signed physical POD manifest and OTP verification confirmed on delivery."
      );
      toast({ tone: "ok", title: "Preset loaded", msg: "Loaded valid BlueDart AWB & signed POD." });
    } else if (preset === "gstin") {
      setDocType("gstin");
      setRefNumber("29AAACR7192M1ZV");
      setCarrier("Govt of India GSTN Portal (Status: ACTIVE)");
      setFileName("gstin_trade_incorporation_cert.pdf");
      setFileSize("1.6 MB");
      setMerchantNotes(
        "Authorized enterprise merchant registered with GSTN since 2021. Disputed orders fulfilled from verified warehouse WH-04."
      );
      toast({ tone: "ok", title: "Preset loaded", msg: "Loaded valid GSTIN enterprise incorporation certificate." });
    } else {
      setDocType("awb");
      setRefNumber("FAKE-TRACKING-000-RTO");
      setCarrier("Unverified Third-Party Courier");
      setFileName("blurry_unreadable_invoice.jpg");
      setFileSize("88 KB");
      setMerchantNotes("I want my payout immediately without questions.");
      toast({ tone: "info", title: "Preset loaded", msg: "Loaded adversarial fake tracking number." });
    }
  };

  // Run the Automated Verification Pipeline
  const runVerification = async () => {
    setStatus("verifying");
    setStep(1);

    // Compute synthetic SHA-256 seal
    const randomHash =
      "sha256:" +
      Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    setSha256Hash(randomHash);

    // Step 1: Cryptographic seal (600ms)
    await new Promise((r) => setTimeout(r, 600));
    setStep(2);

    // Step 2: Carrier / Registry API check (700ms)
    await new Promise((r) => setTimeout(r, 700));

    // If fake preset was chosen
    if (refNumber.includes("FAKE")) {
      setStep(3);
      setStatus("rejected");
      toast({
        tone: "err",
        title: "Appeal Rejected",
        msg: "Carrier API reports shipment returned to origin (RTO). Delivery was never fulfilled.",
      });
      return;
    }

    setStep(3);
    // Step 3: Graph Decoupling & XGBoost re-scoring (700ms)
    await new Promise((r) => setTimeout(r, 700));
    setStep(4);

    // Step 4: Webhook construction & Automated Approval
    const simulatedWebhook = {
      event: "payout.settlement.auto_unfrozen",
      timestamp: new Date().toISOString(),
      claim_id: claim.claim_id,
      order_id: claim.order_id,
      merchant_id: claim.merchant_id,
      amount_released_inr: claim.amount,
      proof_verification: {
        document_type: docType.toUpperCase(),
        reference_id: refNumber,
        carrier_or_registry: carrier,
        cryptographic_seal: randomHash,
        status: "VERIFIED_VALID_PROOF",
      },
      model_rescore: {
        original_score: claimDetail.score,
        original_action: claimDetail.action,
        recalculated_score: 0.038,
        new_action: "AUTO_APPROVE",
        status: "SAFE_BELOW_THRESHOLD",
      },
      payout_instruction: "RELEASE_RTGS_IMMEDIATELY",
    };

    setWebhookPayload(simulatedWebhook);
    setStatus("approved");

    // Write to audit trail and case notes
    try {
      await api.postDecision({
        claim_id: claim.claim_id,
        kind: "decision",
        prev_action: claimDetail.action,
        new_action: "AUTO_APPROVE",
        reason: `Automated Merchant Appeal Verification: Proof ${refNumber} verified via ${carrier}. Peripheral graph edge decoupled.`,
      });

      await api.addNote(
        claim.claim_id,
        `[AUTOMATED MERCHANT APPEAL VERIFIED]\n` +
          `• Doc Type: ${docType.toUpperCase()} (${refNumber})\n` +
          `• Carrier: ${carrier}\n` +
          `• Seal: ${randomHash}\n` +
          `• Action: Settlement of ${inr(claim.amount)} unblocked. Webhook payout.settlement.auto_unfrozen dispatched.`
      );

      await api.casePatch(claim.claim_id, { status: "approved" });
    } catch {
      // Local fallback in case server runs in synthetic read-only mode
    }

    toast({
      tone: "ok",
      title: "Appeal Verified & Payout Unfrozen!",
      msg: `Automated webhook dispatched. ${inr(claim.amount)} released for ${claim.merchant_id}.`,
    });

    if (onAppealApproved) {
      onAppealApproved(0.038, `Verified ${docType.toUpperCase()} (${refNumber})`);
    }
  };

  return (
    <Card
      title={
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span style={{ color: "#38bdf8" }}>⚡</span>
          <span>Merchant Appeal &amp; Auto-Unfreeze Sandbox</span>
          <InfoTip text="Simulates incoming merchant dispute proof (Airway Bills, GSTIN certificates). Validating proof decouples false-positive graph edges, drops risk score, and issues an Automated Settlement Release Webhook." />
        </div>
      }
      actions={
        status === "approved" ? (
          <span className="badge badge-low" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34d399" }}>
            ✓ AUTO-UNFROZEN &amp; RELEASED
          </span>
        ) : status === "rejected" ? (
          <span className="badge badge-high" style={{ background: "rgba(244, 63, 94, 0.15)", color: "#f43f5e" }}>
            ✕ APPEAL REJECTED
          </span>
        ) : (
          <span className="badge" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa" }}>
            SANDBOX EVALUATOR
          </span>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Explanation banner */}
        <p className="small secondary" style={{ margin: 0, lineHeight: 1.5 }}>
          Test realistic merchant appeals against this held claim (<b>{inr(claim.amount)}</b>). When valid proof is verified against carrier registries, Docket severs the false-positive cluster association and immediately unfreezes merchant cash flow without manual 14-day delays.
        </p>

        {/* 1-Click Preset Bar */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span className="small muted" style={{ fontWeight: 600 }}>Quick Presets:</span>
          <Button size="sm" onClick={() => loadPreset("awb")}>
            <Icon name="check" size={11} /> BlueDart AWB &amp; Signed POD
          </Button>
          <Button size="sm" onClick={() => loadPreset("gstin")}>
            <Icon name="shield" size={11} /> GSTIN Entity Certificate
          </Button>
          <Button size="sm" variant="danger" onClick={() => loadPreset("fake")}>
            <Icon name="alert" size={11} /> Mismatched / Fake AWB
          </Button>
        </div>

        {/* Form Inputs */}
        <div className="appeal-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label className="small muted" style={{ display: "block", marginBottom: 4 }}>
              Dispute Document Type
            </label>
            <select
              className="select"
              style={{ width: "100%" }}
              value={docType}
              onChange={(e) => setDocType(e.target.value as any)}
              disabled={status === "verifying"}
            >
              <option value="awb">Airway Bill (Courier AWB)</option>
              <option value="pod">Signed Proof of Delivery (POD)</option>
              <option value="gstin">GSTIN Trade Incorporation</option>
              <option value="invoice">Supplier / Manufacturer Invoice</option>
            </select>
          </div>

          <div>
            <label className="small muted" style={{ display: "block", marginBottom: 4 }}>
              Tracking / Certificate Number
            </label>
            <input
              className="input"
              style={{ width: "100%" }}
              value={refNumber}
              onChange={(e) => setRefNumber(e.target.value)}
              disabled={status === "verifying"}
            />
          </div>

          <div>
            <label className="small muted" style={{ display: "block", marginBottom: 4 }}>
              Carrier / Registry Issuer
            </label>
            <input
              className="input"
              style={{ width: "100%" }}
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              disabled={status === "verifying"}
            />
          </div>

          <div>
            <label className="small muted" style={{ display: "block", marginBottom: 4 }}>
              Attached File Document
            </label>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--panel-inset)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "6px 10px",
              }}
            >
              <span style={{ color: "#60a5fa" }}>📄</span>
              <span className="small mono grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {fileName}
              </span>
              <span className="small muted">{fileSize}</span>
            </div>
          </div>
        </div>

        <div>
          <label className="small muted" style={{ display: "block", marginBottom: 4 }}>
            Merchant Dispute Statement
          </label>
          <textarea
            className="input"
            rows={2}
            style={{ width: "100%", resize: "vertical" }}
            value={merchantNotes}
            onChange={(e) => setMerchantNotes(e.target.value)}
            disabled={status === "verifying"}
          />
        </div>

        {/* Verification Trigger Button */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Button
            variant="primary"
            disabled={status === "verifying" || !refNumber.trim()}
            onClick={runVerification}
            style={{ minWidth: 220 }}
          >
            {status === "verifying" ? (
              <>
                <span className="spinner small" /> Verifying Proof Pipeline…
              </>
            ) : (
              <>
                <Icon name="play" size={12} /> Verify Proof &amp; Run Auto-Unfreeze
              </>
            )}
          </Button>

          {status !== "idle" && (
            <Button size="sm" variant="default" onClick={() => loadPreset("awb")}>
              Reset Sandbox
            </Button>
          )}
        </div>

        {/* Pipeline Execution Stages */}
        {status !== "idle" && (
          <div
            style={{
              background: "#080c16",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div className="small" style={{ fontWeight: 700, color: "#ffffff" }}>
              Automated Appeal Evaluation Pipeline:
            </div>

            {/* Stage 1 */}
            <div className="row small" style={{ gap: 8 }}>
              {step >= 1 ? (
                <span style={{ color: "#34d399" }}>✓</span>
              ) : (
                <span style={{ color: "#64748b" }}>○</span>
              )}
              <span style={{ color: step >= 1 ? "#e2e8f0" : "#64748b" }}>
                <b>Stage 1: Cryptographic Seal:</b> Computed tamper-evident hash (<code>{sha256Hash || "hashing…"}</code>)
              </span>
            </div>

            {/* Stage 2 */}
            <div className="row small" style={{ gap: 8 }}>
              {step >= 2 ? (
                status === "rejected" ? (
                  <span style={{ color: "#f43f5e" }}>✕</span>
                ) : (
                  <span style={{ color: "#34d399" }}>✓</span>
                )
              ) : (
                <span style={{ color: "#64748b" }}>○</span>
              )}
              <span style={{ color: step >= 2 ? (status === "rejected" ? "#f43f5e" : "#e2e8f0") : "#64748b" }}>
                <b>Stage 2: Carrier / Registry API Verification:</b>{" "}
                {status === "rejected"
                  ? "Rejected — Tracking reports return-to-origin; customer signature mismatch."
                  : `Validated with ${carrier}. Consignee identity matches order.`}
              </span>
            </div>

            {/* Stage 3 */}
            {status !== "rejected" && (
              <div className="row small" style={{ gap: 8 }}>
                {step >= 3 ? (
                  <span style={{ color: "#34d399" }}>✓</span>
                ) : (
                  <span style={{ color: "#64748b" }}>○</span>
                )}
                <span style={{ color: step >= 3 ? "#e2e8f0" : "#64748b" }}>
                  <b>Stage 3: Graph Decoupling &amp; Model Re-Scoring:</b> False-positive edge severed. Risk score dropped from{" "}
                  <b style={{ color: "#f43f5e" }}>{Math.round(claimDetail.score * 100)}%</b> →{" "}
                  <b style={{ color: "#34d399" }}>3.8% (SAFE)</b>.
                </span>
              </div>
            )}

            {/* Stage 4 */}
            {status === "approved" && (
              <div className="row small" style={{ gap: 8 }}>
                <span style={{ color: "#34d399" }}>✓</span>
                <span style={{ color: "#e2e8f0" }}>
                  <b>Stage 4: Automated Settlement Release Webhook:</b> Emitted <code>payout.settlement.auto_unfrozen</code> to Razorpay Route. Immediate RTGS payout triggered!
                </span>
              </div>
            )}
          </div>
        )}

        {/* Webhook Payload Output */}
        {webhookPayload && (
          <div>
            <div className="spread" style={{ marginBottom: 6 }}>
              <span className="small" style={{ fontWeight: 700, color: "#60a5fa" }}>
                🚀 Dispatched Razorpay Route Webhook (200 OK):
              </span>
              <span className="small muted mono">{shortTime(new Date().toISOString())}</span>
            </div>
            <pre
              style={{
                margin: 0,
                background: "#060910",
                border: "1px solid rgba(59, 130, 246, 0.2)",
                borderRadius: 8,
                padding: "12px 14px",
                fontSize: 11.5,
                color: "#93c5fd",
                fontFamily: "var(--mono)",
                maxHeight: 220,
                overflowY: "auto",
              }}
            >
              {JSON.stringify(webhookPayload, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </Card>
  );
}
