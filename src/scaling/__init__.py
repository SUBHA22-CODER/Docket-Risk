"""Ring Sentinel — Enterprise Scaling & Production Architecture Package."""

from src.scaling.compliance import (
    DEFAULT_TENANT_SALT,
    EnvelopeEncryptor,
    ImmutableWormAuditLog,
    anonymize_infra_key,
    normalize_phone,
    normalize_vpa,
)
from src.scaling.gateways import (
    GATEWAY_REGISTRY,
    AmazonPayAdapter,
    BaseGatewayAdapter,
    CanonicalClaimEvent,
    CanonicalOrderEvent,
    GenericGatewayAdapter,
    RazorpayAdapter,
    StripeAdapter,
)
from src.scaling.distributed_graph import DistributedGraphState
from src.scaling.inference import FastModelRuntime, LatencyTracker
from src.scaling.shadow_mode import (
    ROLLOUT_MANAGER,
    RolloutManager,
    RolloutPhase,
    ShadowComparisonResult,
)
from src.scaling.ai_scam_detector import (
    SCAM_DETECTOR,
    AIScamPatternDetector,
    AlertFatigueFilter,
    ScamArchetype,
    ScamSignal,
    ConsolidatedIncident,
)
from src.scaling.benchmark import run_scaling_benchmark

__all__ = [
    "DEFAULT_TENANT_SALT",
    "anonymize_infra_key",
    "normalize_phone",
    "normalize_vpa",
    "EnvelopeEncryptor",
    "ImmutableWormAuditLog",
    "CanonicalOrderEvent",
    "CanonicalClaimEvent",
    "BaseGatewayAdapter",
    "AmazonPayAdapter",
    "RazorpayAdapter",
    "StripeAdapter",
    "GenericGatewayAdapter",
    "GATEWAY_REGISTRY",
    "DistributedGraphState",
    "FastModelRuntime",
    "LatencyTracker",
    "RolloutPhase",
    "ShadowComparisonResult",
    "RolloutManager",
    "ROLLOUT_MANAGER",
    "ScamArchetype",
    "ScamSignal",
    "ConsolidatedIncident",
    "AlertFatigueFilter",
    "AIScamPatternDetector",
    "SCAM_DETECTOR",
    "run_scaling_benchmark",
]
