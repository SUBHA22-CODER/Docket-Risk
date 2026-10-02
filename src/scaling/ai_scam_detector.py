"""Ring Sentinel — AI-Driven Scam Pattern Recognition & Alert Fatigue Engine.

Detects emerging AI-enabled scam workflows across UPI, banking, and digital wallet contexts:
1. Reverse UPI Collect / QR Code Scams: "Approve collect request to receive refund/prize".
2. Mutating AI-Generated Narrative Reuse: LLM-rephrased dispute and refund claims.
3. Synthetic Mule Rings & Synchronized Sleeper Bursts: Dormant accounts suddenly activating.
4. Screen-Share / Remote Access Exploitation (AnyDesk/TeamViewer patterns).
5. Algorithmic VPA / Phone Enumeration: Patterned disposable accounts.

Anti-Alert-Fatigue Guard:
- Incident-Level Rollup: Groups hundreds of micro-events into a single Syndicate Incident.
- Dynamic Entropy Thresholding & Cooldown Suppress: Prevents redundant alarms on active clusters.
- Actionable Mitigation Playbooks: Provides instant defense commands (e.g. VPA block, OTP step-up).
"""

from __future__ import annotations

import collections
import hashlib
import logging
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

log = logging.getLogger("ring_sentinel.ai_scam_detector")


class ScamArchetype:
    REVERSE_UPI_COLLECT = "REVERSE_UPI_COLLECT_FRAUD"
    AI_MUTATED_NARRATIVE = "AI_MUTATED_NARRATIVE_SYNDICATE"
    SYNTHETIC_MULE_RING = "SYNTHETIC_MULE_CLUSTER"
    REMOTE_ACCESS_SCREENSHARE = "REMOTE_ACCESS_SESSION_TAKEOVER"
    SLEEPER_BURST_DRAIN = "SLEEPER_BURST_DRAIN"
    VPA_PATTERN_ENUMERATION = "ALGORITHMIC_VPA_ENUMERATION"


# High-risk phrases frequently seen in automated / social-engineered UPI dispute workflows
REVERSE_COLLECT_INDICATORS = [
    "collect request", "scan qr", "receive refund", "enter pin to receive",
    "reverse payment", "claim cash prize", "helpline number", "customer care apk",
    "apk download", "support desk", "refund processing fee", "test transaction"
]

REMOTE_ACCESS_INDICATORS = [
    "anydesk", "teamviewer", "quicksupport", "rustdesk", "zoho assist",
    "screen share", "remote access", "accessibility permission"
]


def _text_ngrams(text: str, n: int = 3) -> set[str]:
    clean = re.sub(r"[^a-z0-9\s]", "", text.lower()).strip()
    words = clean.split()
    if len(words) < n:
        return {" ".join(words)}
    return {" ".join(words[i:i + n]) for i in range(len(words) - n + 1)}


def jaccard_similarity(text_a: str, text_b: str) -> float:
    set_a = _text_ngrams(text_a, 2)
    set_b = _text_ngrams(text_b, 2)
    union = set_a | set_b
    if not union:
        return 0.0
    return len(set_a & set_b) / len(union)


@dataclass
class ScamSignal:
    archetype: str
    confidence: float
    title: str
    description: str
    indicators: list[str]
    suggested_action: str
    severity: str  # CRITICAL, HIGH, MEDIUM, LOW


@dataclass
class ConsolidatedIncident:
    incident_id: str
    cluster_root: str
    archetype: str
    severity: str
    score: float
    affected_entities: list[str]
    event_count: int
    first_seen: str
    last_seen: str
    title: str
    executive_summary: str
    action_playbook: list[str]
    raw_signals: list[dict[str, Any]] = field(default_factory=list)


class AlertFatigueFilter:
    """Intelligent Alert Deduplicator and Fatigue Filter.
    
    Prevents alert storms by:
    1. Rolling up individual node events into cluster-level incidents.
    2. Enforcing a cooldown window per cluster root and archetype.
    3. Suppressing sub-threshold micro-noise until statistical significance is reached.
    """

    def __init__(self, cooldown_seconds: int = 1800, min_confidence: float = 0.65) -> None:
        self.cooldown_seconds = cooldown_seconds
        self.min_confidence = min_confidence
        self._lock = threading.Lock()
        self._last_alert_time: dict[str, float] = {}  # key: f"{cluster_root}:{archetype}"
        self._incident_registry: dict[str, ConsolidatedIncident] = {}
        self.total_signals_received = 0
        self.total_alerts_emitted = 0
        self.total_alerts_suppressed = 0

    def should_emit(self, cluster_root: str, archetype: str, confidence: float) -> Tuple[bool, str]:
        if confidence < self.min_confidence:
            self.total_alerts_suppressed += 1
            return False, f"Confidence {confidence:.2f} below threshold {self.min_confidence}"

        key = f"{cluster_root}:{archetype}"
        now = time.monotonic()
        with self._lock:
            last = self._last_alert_time.get(key, 0.0)
            if now - last < self.cooldown_seconds:
                self.total_alerts_suppressed += 1
                return False, f"Suppressed by cooldown ({int(now - last)}s < {self.cooldown_seconds}s)"

            self._last_alert_time[key] = now
            self.total_alerts_emitted += 1
            return True, "Emitted"


class AIScamPatternDetector:
    """Core pattern recognition engine for AI-enabled scams in UPI, banking, and wallet ecosystems."""

    def __init__(self, cooldown_seconds: int = 1800) -> None:
        self.fatigue_filter = AlertFatigueFilter(cooldown_seconds=cooldown_seconds)
        self._lock = threading.Lock()
        self._seen_reasons: collections.deque[tuple[str, str, str]] = collections.deque(maxlen=1000)  # (text, identity, ts)
        self._active_incidents: dict[str, ConsolidatedIncident] = {}

    def analyze_event(
        self,
        event_data: dict[str, Any],
        graph_evidence: Optional[dict[str, Any]] = None,
    ) -> list[ScamSignal]:
        """Analyzes order/claim/payment context for emerging scam signatures."""
        signals: list[ScamSignal] = []
        ev = graph_evidence or {}

        reason = str(event_data.get("reason_text") or event_data.get("reason") or "").lower()
        metadata = event_data.get("raw_metadata") or event_data.get("notes") or {}
        ident = event_data.get("identity_key", "")
        vpa = str(event_data.get("vpa_id") or event_data.get("vpa") or "").lower()
        amount = float(event_data.get("amount", 0.0))
        cluster_size = int(ev.get("cluster_size", 1))
        burst_7d = int(ev.get("recent_cluster_claims_7d", 0))

        # 1. Reverse UPI Collect Scam Check
        reverse_hits = [w for w in REVERSE_COLLECT_INDICATORS if w in reason]
        if reverse_hits or metadata.get("is_collect_request") is True:
            signals.append(ScamSignal(
                archetype=ScamArchetype.REVERSE_UPI_COLLECT,
                confidence=0.92,
                title="Reverse UPI Collect Trap Detected",
                description=(
                    "Transaction context contains social engineering keywords instructing the victim to approve "
                    "a collect request or scan a QR code under the guise of receiving a refund or prize."
                ),
                indicators=reverse_hits or ["is_collect_request_flag"],
                suggested_action="STEP_UP_VERIFICATION_REJECT_COLLECT",
                severity="CRITICAL",
            ))

        # 2. Remote Access / Screen Share Session Flag
        client_apps = str(metadata.get("running_apps") or metadata.get("client_context") or "").lower()
        remote_hits = [app for app in REMOTE_ACCESS_INDICATORS if app in client_apps or app in reason]
        if remote_hits:
            signals.append(ScamSignal(
                archetype=ScamArchetype.REMOTE_ACCESS_SCREENSHARE,
                confidence=0.95,
                title="Remote Access App (AnyDesk/TeamViewer) Active",
                description="Client device session indicates remote screen-share software running concurrently during payment.",
                indicators=remote_hits,
                suggested_action="TERMINATE_SESSION_FREEZE_WALLET",
                severity="CRITICAL",
            ))

        # 3. AI-Mutated Narrative Reuse (Semantic Claim Paraphrasing)
        if len(reason) > 15:
            with self._lock:
                similar_matches = []
                for past_reason, past_ident, _ in self._seen_reasons:
                    if past_ident != ident:
                        sim = jaccard_similarity(reason, past_reason)
                        if 0.50 <= sim < 1.0:  # Mutated/paraphrased (not identical copy)
                            similar_matches.append((past_ident, sim))

                if similar_matches:
                    signals.append(ScamSignal(
                        archetype=ScamArchetype.AI_MUTATED_NARRATIVE,
                        confidence=0.88,
                        title="AI-Mutated Narrative Template Reused Across Accounts",
                        description=(
                            f"Dispute narrative shares high semantic overlap with claims filed by {len(similar_matches)} other "
                            f"identities. Characteristic of automated LLM script variation deployed by syndicates."
                        ),
                        indicators=[f"Overlap with {m[0]} (Jaccard: {m[1]:.2f})" for m in similar_matches[:3]],
                        suggested_action="HOLD_PAYOUT_HUMAN_REVIEW",
                        severity="HIGH",
                    ))

                self._seen_reasons.append((reason, ident, datetime.now(timezone.utc).isoformat()))

        # 4. Sleeper Mule Burst / Synchronized Drain
        if cluster_size >= 4 and burst_7d >= 3:
            signals.append(ScamSignal(
                archetype=ScamArchetype.SLEEPER_BURST_DRAIN,
                confidence=0.89,
                title="Synchronized Sleeper Cluster Drain Attack",
                description=(
                    f"Cluster of {cluster_size} linked accounts exhibits coordinated claim velocity burst "
                    f"({burst_7d} disputes in 7 days). Indicates synchronized syndicate cashout."
                ),
                indicators=[f"Cluster size: {cluster_size}", f"7d burst: {burst_7d}"],
                suggested_action="HOLD_CLUSTER_SETTLEMENTS",
                severity="HIGH",
            ))

        # 5. Algorithmic VPA / Account Enumeration
        if re.search(r"[a-z]+[0-9]{4,}[a-z]?@", vpa):
            signals.append(ScamSignal(
                archetype=ScamArchetype.VPA_PATTERN_ENUMERATION,
                confidence=0.78,
                title="Algorithmic Disposable VPA Pattern",
                description="UPI VPA follows programmatic alphanumeric enumeration patterns typical of disposable mule pools.",
                indicators=[f"VPA pattern match: {vpa}"],
                suggested_action="FLAG_WATCHLIST_FOR_KYC",
                severity="MEDIUM",
            ))

        return signals

    def process_and_deduplicate(
        self,
        event_data: dict[str, Any],
        graph_evidence: Optional[dict[str, Any]] = None,
    ) -> Tuple[list[ScamSignal], Optional[ConsolidatedIncident]]:
        """Processes signals, checks fatigue filters, and produces a consolidated incident if actionable."""
        signals = self.analyze_event(event_data, graph_evidence)
        if not signals:
            return [], None

        ident = event_data.get("identity_key", "unknown")
        cluster_root = graph_evidence.get("cluster_root") or ident
        primary_signal = max(signals, key=lambda s: s.confidence)

        should_emit, reason = self.fatigue_filter.should_emit(
            cluster_root=cluster_root,
            archetype=primary_signal.archetype,
            confidence=primary_signal.confidence,
        )

        with self._lock:
            incident_id = f"inc_{hashlib.md5(f'{cluster_root}:{primary_signal.archetype}'.encode()).hexdigest()[:10]}"
            now_iso = datetime.now(timezone.utc).isoformat()

            if incident_id in self._active_incidents:
                inc = self._active_incidents[incident_id]
                inc.event_count += 1
                inc.last_seen = now_iso
                if ident not in inc.affected_entities:
                    inc.affected_entities.append(ident)
            else:
                inc = ConsolidatedIncident(
                    incident_id=incident_id,
                    cluster_root=cluster_root,
                    archetype=primary_signal.archetype,
                    severity=primary_signal.severity,
                    score=primary_signal.confidence,
                    affected_entities=[ident],
                    event_count=1,
                    first_seen=now_iso,
                    last_seen=now_iso,
                    title=primary_signal.title,
                    executive_summary=primary_signal.description,
                    action_playbook=[
                        primary_signal.suggested_action,
                        "Notify merchant risk operations",
                        "Quarantine linked cluster nodes in Redis graph",
                    ],
                    raw_signals=[{"title": s.title, "confidence": s.confidence} for s in signals],
                )
                self._active_incidents[incident_id] = inc

        if should_emit:
            return signals, inc
        return signals, None

    def list_active_incidents(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {
                    "incident_id": inc.incident_id,
                    "cluster_root": inc.cluster_root,
                    "archetype": inc.archetype,
                    "severity": inc.severity,
                    "score": inc.score,
                    "affected_entities_count": len(inc.affected_entities),
                    "event_count": inc.event_count,
                    "first_seen": inc.first_seen,
                    "last_seen": inc.last_seen,
                    "title": inc.title,
                    "executive_summary": inc.executive_summary,
                    "action_playbook": inc.action_playbook,
                }
                for inc in sorted(self._active_incidents.values(), key=lambda x: x.last_seen, reverse=True)
            ]


SCAM_DETECTOR = AIScamPatternDetector()
