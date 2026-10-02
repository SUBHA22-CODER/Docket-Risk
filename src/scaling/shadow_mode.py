"""Ring Sentinel — Universal Zero-Risk Rollout & Shadow Mode Engine.

Implements the 3-phase enterprise deployment strategy across any gateway (Amazon Pay, Razorpay, etc.):
- Phase 1: Shadow Mode (Passive scoring alongside legacy rules, false positive & friction calculation)
- Phase 2: Step-Up Verification Gating (2FA/OTP challenges for Medium score band 0.50 <= score < 0.85)
- Phase 3: High-Confidence Settlement Reserve (Automated holds on score >= 0.85 + automated appeal notices)
"""

from __future__ import annotations

import enum
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

log = logging.getLogger("ring_sentinel.shadow_mode")


class RolloutPhase(str, enum.Enum):
    SHADOW_MODE = "PHASE_1_SHADOW_MODE"
    STEP_UP_GATING = "PHASE_2_STEP_UP_GATING"
    SETTLEMENT_RESERVE = "PHASE_3_SETTLEMENT_RESERVE"


@dataclass
class ShadowComparisonResult:
    claim_id: str
    gateway: str
    tenant_id: str
    ring_score: float
    ring_action: str
    legacy_action: str
    phase: RolloutPhase
    effective_action: str
    challenge_required: bool
    appeal_notice_generated: bool
    discrepancy_type: str  # "AGREEMENT", "PREVENTED_FRAUD", "SAVED_FRICTION", "DIVERGENT"
    appeal_dossier: Optional[dict[str, Any]] = None
    ts: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class RolloutManager:
    """Manages the rollout lifecycle and shadow comparison across multiple payment gateways."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.gateway_phases: dict[str, RolloutPhase] = {
            "amazon_pay": RolloutPhase.SHADOW_MODE,
            "razorpay": RolloutPhase.SHADOW_MODE,
            "stripe": RolloutPhase.SHADOW_MODE,
            "generic": RolloutPhase.SETTLEMENT_RESERVE,
        }
        self.history: list[ShadowComparisonResult] = []
        self.metrics = {
            "total_evaluated": 0,
            "agreements": 0,
            "prevented_fraud_count": 0,
            "prevented_fraud_amount": 0.0,
            "saved_friction_count": 0,
            "saved_friction_amount": 0.0,
            "step_up_challenges": 0,
            "settlement_holds": 0,
        }

    def set_phase(self, gateway: str, phase: RolloutPhase) -> None:
        with self._lock:
            self.gateway_phases[gateway.lower()] = phase

    def get_phase(self, gateway: str) -> RolloutPhase:
        with self._lock:
            return self.gateway_phases.get(gateway.lower(), RolloutPhase.SHADOW_MODE)

    def evaluate(
        self,
        claim_id: str,
        gateway: str,
        tenant_id: str,
        ring_score: float,
        ring_action: str,
        legacy_action: str,
        amount: float,
        evidence: Optional[dict[str, Any]] = None,
    ) -> ShadowComparisonResult:
        phase = self.get_phase(gateway)
        challenge_required = False
        appeal_notice_generated = False
        appeal_dossier = None

        # 1. Determine Effective Action according to rollout phase
        if phase == RolloutPhase.SHADOW_MODE:
            # Passive: Legacy action is what the merchant/gateway actually executes
            effective_action = legacy_action
        elif phase == RolloutPhase.STEP_UP_GATING:
            if ring_action == "STEP_UP_VERIFICATION":
                challenge_required = True
                effective_action = "STEP_UP_VERIFICATION"
            else:
                effective_action = legacy_action
        else:  # SETTLEMENT_RESERVE
            effective_action = ring_action
            if ring_action == "HOLD_PAYOUT_HUMAN_REVIEW":
                appeal_notice_generated = True
                appeal_dossier = self._generate_appeal_dossier(claim_id, gateway, ring_score, evidence)
            elif ring_action == "STEP_UP_VERIFICATION":
                challenge_required = True

        # 2. Categorize Discrepancy & Opportunity
        if (ring_action == legacy_action) or (ring_action == "AUTO_APPROVE" and legacy_action in ("APPROVE", "AUTO_APPROVE")):
            discrepancy = "AGREEMENT"
        elif ring_action == "HOLD_PAYOUT_HUMAN_REVIEW" and legacy_action in ("APPROVE", "AUTO_APPROVE"):
            discrepancy = "PREVENTED_FRAUD"
        elif ring_action == "STEP_UP_VERIFICATION" and legacy_action in ("APPROVE", "AUTO_APPROVE"):
            discrepancy = "STEP_UP_GATED"
        elif ring_action == "AUTO_APPROVE" and legacy_action in ("HOLD", "REJECT", "HOLD_PAYOUT_HUMAN_REVIEW"):
            discrepancy = "SAVED_FRICTION"
        else:
            discrepancy = "DIVERGENT"

        # 3. Record Metrics
        with self._lock:
            self.metrics["total_evaluated"] += 1
            if discrepancy == "AGREEMENT":
                self.metrics["agreements"] += 1
            elif discrepancy == "PREVENTED_FRAUD":
                self.metrics["prevented_fraud_count"] += 1
                self.metrics["prevented_fraud_amount"] += amount
            elif discrepancy == "SAVED_FRICTION":
                self.metrics["saved_friction_count"] += 1
                self.metrics["saved_friction_amount"] += amount

            if challenge_required:
                self.metrics["step_up_challenges"] += 1
            if effective_action == "HOLD_PAYOUT_HUMAN_REVIEW":
                self.metrics["settlement_holds"] += 1

            result = ShadowComparisonResult(
                claim_id=claim_id,
                gateway=gateway,
                tenant_id=tenant_id,
                ring_score=ring_score,
                ring_action=ring_action,
                legacy_action=legacy_action,
                phase=phase,
                effective_action=effective_action,
                challenge_required=challenge_required,
                appeal_notice_generated=appeal_notice_generated,
                discrepancy_type=discrepancy,
                appeal_dossier=appeal_dossier,
            )
            self.history.append(result)
            if len(self.history) > 1000:
                self.history.pop(0)

        return result

    def _generate_appeal_dossier(
        self,
        claim_id: str,
        gateway: str,
        ring_score: float,
        evidence: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        """Auto-generates gateway-specific appeal dossiers and Zendesk notices."""
        ev = evidence or {}
        if gateway == "amazon_pay":
            return {
                "channel": "Amazon Pay A-to-z Appeal Portal",
                "reference": claim_id,
                "dispute_type": "SYNDICATE_DEFENSE",
                "appeal_text": (
                    f"Automated Dispute Notice: Claim {claim_id} was placed on temporary settlement reserve. "
                    f"Syndicate model calculated risk score of {round(ring_score, 4)} with bipartite cluster "
                    f"size of {ev.get('cluster_size', 1)} and {ev.get('recent_cluster_claims_7d', 0)} claims in 7 days."
                ),
                "resolution_options": ["Request OTP Verification", "Upload Proof of Delivery", "Merchant Appeal"],
            }
        elif gateway == "razorpay":
            return {
                "channel": "Razorpay Risk Operations / Zendesk",
                "reference": claim_id,
                "dispute_type": "PAYOUT_HOLD_DISPUTE_DEFENSE",
                "appeal_text": (
                    f"Razorpay Dispute Defense: Ring Sentinel cluster root identified multi-merchant fraud ring. "
                    f"Risk score: {round(ring_score, 4)}."
                ),
                "resolution_options": ["Submit KYC Re-Verification", "Merchant Whitelist Request"],
            }
        else:
            return {
                "channel": "Zendesk Merchant Dispute Portal",
                "reference": claim_id,
                "appeal_text": f"High risk hold generated by Ring Sentinel (Score: {round(ring_score, 4)}).",
                "resolution_options": ["Contact Risk Analyst", "Submit Additional Proof"],
            }

    def get_summary(self) -> dict[str, Any]:
        with self._lock:
            total = self.metrics["total_evaluated"]
            agreement_rate = (self.metrics["agreements"] / total * 100.0) if total > 0 else 100.0
            return {
                "gateway_phases": {k: v.value for k, v in self.gateway_phases.items()},
                "total_evaluated": total,
                "agreement_rate_pct": round(agreement_rate, 2),
                "prevented_fraud_count": self.metrics["prevented_fraud_count"],
                "prevented_fraud_amount": round(self.metrics["prevented_fraud_amount"], 2),
                "saved_friction_count": self.metrics["saved_friction_count"],
                "saved_friction_amount": round(self.metrics["saved_friction_amount"], 2),
                "step_up_challenges": self.metrics["step_up_challenges"],
                "settlement_holds": self.metrics["settlement_holds"],
            }


ROLLOUT_MANAGER = RolloutManager()
