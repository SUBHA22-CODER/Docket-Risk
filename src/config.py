"""Central, validated configuration for the Ring Sentinel scoring service.

All environment variables are read and validated here, once. Invalid values
raise ConfigError with an actionable message instead of crashing later at
import time or, worse, silently misbehaving at request time.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigError(Exception):
    pass


def _env_float(name: str, default: float, lo: float, hi: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        v = float(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number, got {raw!r}") from exc
    if not (lo <= v <= hi):
        raise ConfigError(f"{name} must be in [{lo}, {hi}], got {v}")
    return v


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        v = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc
    if not (lo <= v <= hi):
        raise ConfigError(f"{name} must be in [{lo}, {hi}], got {v}")
    return v


def _env_str(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _env_keys(name: str) -> list[str]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return []
    return [k.strip() for k in raw.split(",") if k.strip()]


DEV_FALLBACK_API_KEY = "dev-insecure-key-change-me"


@dataclass(frozen=True)
class Settings:
    high_threshold: float
    medium_threshold: float
    api_keys: tuple[str, ...]
    model_path: str
    snapshot_path: str
    snapshot_interval_s: int
    audit_db_path: str
    max_nodes: int
    max_cluster_size: int
    max_claim_history_per_cluster: int
    prune_days: int
    rate_limit_per_min: int
    max_body_bytes: int
    log_level: str
    webhook_secret: str = "dev-webhook-secret-change-me"
    webhook_url: str = ""
    dev_key_fallback: bool = False
    version: str = "1.0.0"

    @property
    def using_dev_api_key(self) -> bool:
        return self.api_keys == (DEV_FALLBACK_API_KEY,)


def load_settings() -> Settings:
    high = _env_float("RING_SENTINEL_HIGH", 0.85, 0.0, 1.0)
    medium = _env_float("RING_SENTINEL_MEDIUM", 0.50, 0.0, 1.0)
    if high <= medium:
        raise ConfigError(
            f"RING_SENTINEL_HIGH ({high}) must be strictly greater than "
            f"RING_SENTINEL_MEDIUM ({medium})"
        )
    keys = _env_keys("RING_SENTINEL_API_KEYS")
    dev_key_fallback = False
    if not keys:
        keys = [DEV_FALLBACK_API_KEY]
        dev_key_fallback = True
    settings = Settings(
        high_threshold=high,
        medium_threshold=medium,
        api_keys=tuple(keys),
        model_path=_env_str("RING_SENTINEL_MODEL", "models/ring_sentinel_xgb.json"),
        snapshot_path=_env_str(
            "RING_SENTINEL_SNAPSHOT", "data/graph_state_snapshot.json"
        ),
        snapshot_interval_s=_env_int("RING_SENTINEL_SNAPSHOT_INTERVAL", 60, 5, 3600),
        audit_db_path=_env_str("RING_SENTINEL_AUDIT_DB", "data/decisions.db"),
        max_nodes=_env_int("RING_SENTINEL_MAX_NODES", 2_000_000, 1_000, 100_000_000),
        max_cluster_size=_env_int(
            "RING_SENTINEL_MAX_CLUSTER", 5_000, 10, 10_000_000
        ),
        max_claim_history_per_cluster=_env_int(
            "RING_SENTINEL_MAX_CLAIM_HISTORY", 2_000, 100, 1_000_000
        ),
        prune_days=_env_int("RING_SENTINEL_PRUNE_DAYS", 30, 7, 3650),
        rate_limit_per_min=_env_int("RING_SENTINEL_RATE_LIMIT", 600, 1, 1_000_000),
        max_body_bytes=_env_int("RING_SENTINEL_MAX_BODY_BYTES", 65_536, 1_024, 10_485_760),
        log_level=_env_str("RING_SENTINEL_LOG_LEVEL", "INFO").upper(),
        webhook_secret=_env_str(
            "RING_SENTINEL_WEBHOOK_SECRET", "dev-webhook-secret-change-me"
        ),
        webhook_url=_env_str("RING_SENTINEL_WEBHOOK_URL", ""),
        dev_key_fallback=dev_key_fallback,
    )
    return settings


def anonymize_pii_token(raw_value: str, salt: str = "rzp-sentinel-salt-2026") -> str:
    """Anonymize raw PII (phones, VPAs, account numbers, device identifiers) using HMAC-SHA256.

    Complies with India DPDP Act and RBI data localization norms by preventing reversible
    storage of sensitive merchant/customer identifiers in graph state and audit logs.
    """
    import hashlib
    import hmac

    if not raw_value:
        return ""
    digest = hmac.new(
        salt.encode("utf-8"), raw_value.strip().encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"anon_{digest[:16]}"

