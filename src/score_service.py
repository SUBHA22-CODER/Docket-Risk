"""Ring Sentinel — real-time scoring API (production hardening).

Security:
  - API-key auth (X-API-Key) on all decision endpoints; health/metrics public.
  - Strict input bounds; graph node-cap and per-request body-size limits.
Reliability:
  - Fail-open at BOTH startup (missing model) and request time (any scoring
    exception) -> AUTO_APPROVE with degraded=true, never a 500 on /score.
  - Atomic evaluate+record under a single lock acquisition (no TOCTOU).
  - Idempotency: duplicate order_ids / claim_ids are deduplicated (LRU).
  - Disk snapshot of graph state on shutdown + periodic interval; restored
    on startup so restarts no longer wipe the graph.
  - Time-windowed claim-history pruning and cluster-size feature capping.
Observability:
  - Structured JSON logs with request IDs; Prometheus /metrics; SQLite
    decision audit log; /healthz /readyz /version.

GraphState re-implements the same union-find + incremental ingestion logic as
ClusterState in graph_features.py. The two MUST stay logically identical;
tests/test_parity.py enforces this automatically.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import queue as _queue
import re
import socket
import sqlite3
import sys
import threading
import time
import urllib.request
from urllib.parse import urlparse
import uuid
from collections import OrderedDict, defaultdict, deque
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Literal

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, Query, Request
from fastapi import Path as FPath
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    Response,
    StreamingResponse,
)
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from pydantic import BaseModel, Field, field_validator

try:
    from src.config import DEV_FALLBACK_API_KEY, ConfigError, Settings, load_settings
except ImportError:  # direct-script execution from src/
    from config import (  # type: ignore[no-redef, import-not-found]
        DEV_FALLBACK_API_KEY,
        ConfigError,
        Settings,
        load_settings,
    )

try:
    from src.graph_features import FEATURE_ORDER, INFRA_PREFIXES
except ImportError:  # direct-script execution from src/
    from graph_features import (  # type: ignore[no-redef, import-not-found]
        FEATURE_ORDER,
        INFRA_PREFIXES,
    )

NEUTRAL_APPROVAL_RATIO = 0.62
BURST_WINDOW_DAYS = 7

ACTION_AUTO_APPROVE = "AUTO_APPROVE"
ACTION_STEP_UP = "STEP_UP_VERIFICATION"
ACTION_HOLD = "HOLD_PAYOUT_HUMAN_REVIEW"

log = logging.getLogger("ring_sentinel")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if hasattr(record, "request_id"):
            payload["request_id"] = record.request_id
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def _configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(getattr(logging, level, logging.INFO))


try:
    SETTINGS = load_settings()
except ConfigError as exc:
    print(json.dumps({"level": "CRITICAL", "msg": f"configuration error: {exc}"}))
    raise

_configure_logging(SETTINGS.log_level)
if SETTINGS.dev_key_fallback:
    log.warning(
        "RING_SENTINEL_API_KEYS not set; using development fallback key %r — "
        "set RING_SENTINEL_API_KEYS before any real deployment",
        DEV_FALLBACK_API_KEY,
    )


METRIC_REQUESTS = Counter(
    "ring_sentinel_requests_total", "HTTP requests", ["endpoint", "status"]
)
METRIC_SCORE_LATENCY = Histogram(
    "ring_sentinel_score_latency_seconds", "Score endpoint latency",
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0),
)
METRIC_SCORES = Counter(
    "ring_sentinel_scores_total", "Scoring decisions", ["action"]
)
METRIC_FAIL_OPEN_STARTUP = Counter(
    "ring_sentinel_failopen_startup_total", "Model missing/unverified at startup"
)
METRIC_FAIL_OPEN_RUNTIME = Counter(
    "ring_sentinel_failopen_runtime_total", "Runtime scoring errors served fail-open"
)
METRIC_DUPLICATES = Counter(
    "ring_sentinel_duplicates_total", "Idempotent duplicates ignored", ["kind"]
)
METRIC_CAPACITY_REJECTS = Counter(
    "ring_sentinel_capacity_rejects_total", "Ingests rejected for capacity"
)
METRIC_RATE_LIMITED = Counter(
    "ring_sentinel_rate_limited_total", "Requests rejected by rate limiter"
)
GAUGE_KNOWN_IDENTITIES = Gauge("ring_sentinel_known_identities", "Known identity count")
GAUGE_GRAPH_NODES = Gauge("ring_sentinel_graph_nodes", "Union-find nodes")
GAUGE_CLUSTER_SIZE_MAX = Gauge(
    "ring_sentinel_cluster_size_max", "Largest observed cluster (capped value)"
)


class CapacityError(Exception):
    pass


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        self.status = status
        self.code = code
        self.message = message


class GraphState:
    """Live union-find over identity+infra nodes with per-cluster aggregates.

    Must remain logically identical to ClusterState in graph_features.py
    (parity enforced by tests/test_parity.py).
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = threading.RLock()
        self.parent: dict[str, str] = {}
        self.members: dict[str, set[str]] = defaultdict(set)
        self.cluster_merchants: dict[str, set[str]] = defaultdict(set)
        self.cluster_claims: dict[str, list[tuple[pd.Timestamp, str]]] = defaultdict(list)
        self.identity_order_counts: dict[str, int] = defaultdict(int)
        self.identity_merchant_sets: dict[str, set[str]] = defaultdict(set)
        self.identity_claim_stats: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        self.reason_users: dict[str, set[str]] = defaultdict(set)

    def _ensure(self, node: str) -> None:
        if node not in self.parent:
            self.parent[node] = node
            if not node.startswith(INFRA_PREFIXES):
                self.members[node].add(node)

    def _find(self, x: str) -> str:
        parent = self.parent
        r = x
        while parent[r] != r:
            r = parent[r]
        while parent[x] != r:
            parent[x], x = r, parent[x]
        return r

    def _union(self, a: str, b: str) -> None:
        ra, rb = self._find(a), self._find(b)
        if ra == rb:
            return
        if len(self.members[ra]) < len(self.members[rb]):
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.members[ra] |= self.members.pop(rb, set())
        self.cluster_merchants[ra] |= self.cluster_merchants.pop(rb, set())
        self.cluster_claims[ra].extend(self.cluster_claims.pop(rb, []))
        history_cap = self.settings.max_claim_history_per_cluster
        if len(self.cluster_claims[ra]) > history_cap * 2:
            self._prune_locked(ra)

    def _prune_locked(self, root: str) -> None:
        cutoff = pd.Timestamp.now(timezone.utc) - pd.Timedelta(days=self.settings.prune_days)
        claims = self.cluster_claims[root]
        kept = [c for c in claims if c[0] >= cutoff]
        if len(kept) > self.settings.max_claim_history_per_cluster:
            kept.sort(key=lambda c: c[0])
            kept = kept[-self.settings.max_claim_history_per_cluster:]
        self.cluster_claims[root] = kept

    def ingest_order(self, identity_key: str, infra_ids: list[str],
                     merchant_id: str) -> int:
        """Returns number of NEW nodes created; raises CapacityError."""
        new_nodes = sum(1 for n in [identity_key, *infra_ids] if n not in self.parent)
        with self._lock:
            if len(self.parent) + new_nodes > self.settings.max_nodes:
                METRIC_CAPACITY_REJECTS.inc()
                raise CapacityError(
                    f"graph capacity exceeded "
                    f"({self.settings.max_nodes} nodes)"
                )
            self._ensure(identity_key)
            for n in infra_ids:
                self._ensure(n)
                self._union(identity_key, n)
            self.identity_order_counts[identity_key] += 1
            self.identity_merchant_sets[identity_key].add(merchant_id)
            self.cluster_merchants[self._find(identity_key)].add(merchant_id)
            return new_nodes

    def compute_features(self, claim_ts: pd.Timestamp, identity_key: str,
                         amount: float, reason_text: str,
                         predictor: Callable[[dict], float | None] | None = None,
                         record_claim: bool = True,
                         approved: bool = False) -> tuple[dict, dict]:
        """Atomic evaluate (+optional record). One lock acquisition total.

        When predictor is provided the model score is computed INSIDE the same
        critical section, so concurrent claims from one cluster can never
        observe each other half-recorded (no TOCTOU).
        """
        cap = self.settings.max_cluster_size
        score: float | None = None
        with self._lock:
            self._ensure(identity_key)
            prior_claims, approved_sum = self.identity_claim_stats.get(
                identity_key, [0, 0]
            )
            approval_ratio = (
                approved_sum / prior_claims
                if prior_claims > 0
                else NEUTRAL_APPROVAL_RATIO
            )
            root = self._find(identity_key)
            cluster = sorted(self.members[root])
            others = [m for m in cluster if m != identity_key]
            window_start = claim_ts - pd.Timedelta(days=BURST_WINDOW_DAYS)
            burst = sum(
                1
                for ts, who in self.cluster_claims[root]
                if who != identity_key and window_start <= ts <= claim_ts
            )
            reuse = int(
                any(u != identity_key
                    for u in self.reason_users.get(reason_text, ()))
            )
            raw_cluster_size = len(cluster)
            features = {
                "identity_order_count_so_far": self.identity_order_counts[identity_key],
                "identity_merchant_count_so_far": len(self.identity_merchant_sets[identity_key]),
                "identity_claim_count_so_far": prior_claims,
                "identity_claim_approval_ratio_so_far": approval_ratio,
                "shared_infra_neighbor_count": min(len(others), cap),
                "cluster_size": min(raw_cluster_size, cap),
                "cluster_merchant_span": min(len(self.cluster_merchants[root]), cap),
                "cluster_claim_burst_7d": burst,
                "reason_text_reuse_flag": reuse,
                "amount": float(amount),
            }
            evidence = {
                "cluster_size": min(raw_cluster_size, cap),
                "cluster_members_sample": others[:5],
                "other_cluster_member_count": len(others),
                "cluster_merchant_span": features["cluster_merchant_span"],
                "recent_cluster_claims_7d": burst,
                "reason_text_reused_across_identities": bool(reuse),
                "identity_prior_orders": features["identity_order_count_so_far"],
                "identity_prior_claims": prior_claims,
                "shared_infra_neighbor_count": features["shared_infra_neighbor_count"],
                "cluster_capped": raw_cluster_size > cap,
            }
            if predictor is not None:
                score = predictor(features)
            if record_claim:
                self.cluster_claims[root].append((claim_ts, identity_key))
                stats = self.identity_claim_stats[identity_key]
                stats[0] += 1
                stats[1] += int(approved)
                self.reason_users[reason_text].add(identity_key)
            GAUGE_KNOWN_IDENTITIES.set(len(self.identity_order_counts))
            GAUGE_GRAPH_NODES.set(len(self.parent))
            GAUGE_CLUSTER_SIZE_MAX.set(max(
                (len(v) for v in self.members.values()), default=0
            ))
        return features, {"score": score, "evidence": evidence}

    def known_identity_count(self) -> int:
        with self._lock:
            return len(self.identity_order_counts)

    def cluster_root(self, identity_key: str) -> str:
        """Union-find root for an identity ('' safe if unknown)."""
        with self._lock:
            if identity_key not in self.parent:
                return identity_key
            return self._find(identity_key)

    # ---- persistence -----------------------------------------------------

    def snapshot_dict(self) -> dict:
        with self._lock:
            for root in list(self.cluster_claims.keys()):
                self._prune_locked(root)
            return {
                "version": 1,
                "saved_at": datetime.now(timezone.utc).isoformat(),
                "parent": dict(self.parent),
                "members": {k: sorted(v) for k, v in self.members.items() if v},
                "cluster_merchants": {k: sorted(v) for k, v in self.cluster_merchants.items() if v},
                "cluster_claims": {
                    k: [[ts.isoformat(), who] for ts, who in v]
                    for k, v in self.cluster_claims.items() if v
                },
                "identity_order_counts": dict(self.identity_order_counts),
                "identity_merchant_sets": {k: sorted(v) for k, v in self.identity_merchant_sets.items()},
                "identity_claim_stats": dict(self.identity_claim_stats),
                "reason_users": {k: sorted(v) for k, v in self.reason_users.items()},
            }

    def load_snapshot_dict(self, snap: dict) -> None:
        if snap.get("version") != 1:
            raise ValueError(f"unsupported snapshot version {snap.get('version')!r}")
        with self._lock:
            self.parent = dict(snap["parent"])
            self.members = defaultdict(set,
                                       {k: set(v) for k, v in snap["members"].items()})
            self.cluster_merchants = defaultdict(
                set, {k: set(v) for k, v in snap["cluster_merchants"].items()}
            )
            self.cluster_claims = defaultdict(
                list,
                {
                    k: [(pd.Timestamp(ts), who) for ts, who in v]
                    for k, v in snap["cluster_claims"].items()
                },
            )
            self.identity_order_counts = defaultdict(int, snap["identity_order_counts"])
            self.identity_merchant_sets = defaultdict(
                set, {k: set(v) for k, v in snap["identity_merchant_sets"].items()}
            )
            self.identity_claim_stats = defaultdict(
                lambda: [0, 0], {k: list(v) for k, v in snap["identity_claim_stats"].items()}
            )
            self.reason_users = defaultdict(
                set, {k: set(v) for k, v in snap["reason_users"].items()}
            )


state = GraphState(SETTINGS)
_model = None
_model_sha256_short: str | None = None
_model_sha_verified: bool = False


def _verify_model_sha(model_path: str) -> tuple[str | None, bool]:
    sha_path = model_path + ".sha256"
    if not os.path.exists(sha_path):
        return None, False
    try:
        with open(sha_path) as fh:
            expected = fh.read().split()[0].strip().lower()
        h = hashlib.sha256()
        with open(model_path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        actual = h.hexdigest()
        return actual[:12], hmac.compare_digest(expected, actual)
    except Exception:
        log.exception("model SHA verification failed")
        return None, False


def load_model(model_path: str | None = None) -> None:
    global _model, _model_sha256_short, _model_sha_verified
    model_path = model_path or SETTINGS.model_path
    try:
        import xgboost as xgb

        model = xgb.XGBClassifier()
        model.load_model(model_path)
        loaded_sha, verified = _verify_model_sha(model_path)
        if os.path.exists(model_path + ".sha256") and not verified:
            METRIC_FAIL_OPEN_STARTUP.inc()
            log.critical(
                "MODEL SHA MISMATCH for %s — artifact may have been tampered with "
                "or replaced; serving FAIL-OPEN until verified", model_path,
            )
        else:
            _model = model
            _model_sha256_short = loaded_sha
            _model_sha_verified = verified
            log.info(
                "model loaded from %s sha256=%s verified=%s",
                model_path, loaded_sha, verified,
            )
    except Exception:  # noqa: BLE001 — any load failure must fail open, never crash startup
        _model = None
        _model_sha256_short = None
        _model_sha_verified = False
        METRIC_FAIL_OPEN_STARTUP.inc()
        log.warning(
            "model could not be loaded from %s; failing OPEN with "
            "AUTO_APPROVE scores", model_path,
        )


def predict_score(features: dict) -> tuple[float | None, str | None]:
    """Returns (score|None, degradation_reason|None). Never raises."""
    if _model is None:
        return None, "model_unavailable"
    try:
        row = pd.DataFrame([[features[c] for c in FEATURE_ORDER]], columns=FEATURE_ORDER)
        return float(_model.predict_proba(row)[0, 1]), None
    except Exception:
        METRIC_FAIL_OPEN_RUNTIME.inc()
        log.exception("runtime scoring failure; failing open")
        return None, "scoring_error"


def apply_policy(score: float | None) -> str:
    s = 0.0 if score is None else score
    if s >= SETTINGS.high_threshold:
        return ACTION_HOLD
    if s >= SETTINGS.medium_threshold:
        return ACTION_STEP_UP
    return ACTION_AUTO_APPROVE


# ---- audit log -----------------------------------------------------------

class AuditLog:
    def __init__(self, path: str) -> None:
        self._lock = threading.Lock()
        self.path = path
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS decisions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL,
              request_id TEXT,
              claim_id TEXT,
              identity_key TEXT,
              merchant_id TEXT,
              amount REAL,
              score REAL,
              action TEXT,
              model_loaded INTEGER,
              degraded INTEGER,
              shadow INTEGER
            )
            """
        )
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_decisions_ts ON decisions(ts)"
        )
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_decisions_claim ON decisions(claim_id)"
        )
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_decisions_identity ON decisions(identity_key)"
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS analyst_actions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL,
              actor TEXT NOT NULL,
              claim_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              prev_action TEXT,
              new_action TEXT,
              reason TEXT
            )
            """
        )
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_analyst_claim ON analyst_actions(claim_id)"
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS case_notes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL,
              claim_id TEXT NOT NULL,
              actor TEXT NOT NULL,
              body TEXT NOT NULL
            )
            """
        )
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_claim ON case_notes(claim_id)"
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS case_state (
              claim_id TEXT PRIMARY KEY,
              status TEXT NOT NULL DEFAULT 'open',
              assigned_to TEXT,
              sla_due_at TEXT,
              updated_ts TEXT,
              updated_by TEXT
            )
            """
        )
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_case_state_sla ON case_state(sla_due_at)"
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS watchlist (
              entity TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              reason TEXT NOT NULL,
              added_by TEXT,
              added_ts TEXT
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS alert_rules (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              metric TEXT NOT NULL,
              threshold REAL NOT NULL DEFAULT 0,
              webhook_url TEXT,
              enabled INTEGER NOT NULL DEFAULT 1,
              created_ts TEXT
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS alert_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ts TEXT NOT NULL,
              rule_id INTEGER,
              rule_name TEXT,
              claim_id TEXT,
              severity TEXT,
              detail TEXT,
              delivered INTEGER
            )
            """
        )
        self.conn.commit()

    def insert(self, **kw) -> None:
        cols = ",".join(kw)
        marks = ",".join("?" for _ in kw)
        try:
            with self._lock:
                self.conn.execute(
                    f"INSERT INTO decisions ({cols}) VALUES ({marks})",
                    list(kw.values()),
                )
                self.conn.commit()
        except sqlite3.Error:
            log.exception("audit write failed")

    def close(self) -> None:
        with self._lock:
            self.conn.close()

    def insert_analyst(self, **kw) -> None:
        cols = ",".join(kw)
        marks = ",".join("?" for _ in kw)
        try:
            with self._lock:
                cur = self.conn.execute(
                    f"INSERT INTO analyst_actions ({cols}) VALUES ({marks})",
                    list(kw.values()),
                )
                self.conn.commit()
                kw["id"] = cur.lastrowid
        except sqlite3.Error:
            log.exception("analyst action write failed")
            raise ApiError(500, "audit_write_failed",
                           "could not record analyst action")

    def fetch_analyst(self, claim_id: str | None = None,
                      limit: int = 200) -> list[dict]:
        try:
            with self._lock:
                if claim_id:
                    rows = self.conn.execute(
                        "SELECT * FROM analyst_actions WHERE claim_id = ? "
                        "ORDER BY id DESC LIMIT ?", (claim_id, limit),
                    ).fetchall()
                else:
                    rows = self.conn.execute(
                        "SELECT * FROM analyst_actions ORDER BY id DESC LIMIT ?",
                        (limit,),
                    ).fetchall()
            cols = ["id", "ts", "actor", "claim_id", "kind",
                    "prev_action", "new_action", "reason"]
            return [dict(zip(cols, r)) for r in rows]
        except sqlite3.Error:
            log.exception("analyst action read failed")
            return []

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        """Generic read helper for the ops-console tables."""
        try:
            with self._lock:
                cur = self.conn.execute(sql, params)
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, r)) for r in cur.fetchall()]
        except sqlite3.Error:
            log.exception("ops query failed")
            return []

    def execute(self, sql: str, params: tuple = ()) -> int:
        """Generic write helper; returns lastrowid."""
        with self._lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return int(cur.lastrowid or 0)


audit: AuditLog | None = None


# ---- live stream (SSE) + alert rules engine ---------------------------------

_subscribers: list[_queue.Queue] = []
_subscribers_lock = threading.Lock()


def _publish(event: dict) -> None:
    with _subscribers_lock:
        subs = list(_subscribers)
    for q in subs:
        try:
            q.put_nowait(event)
        except _queue.Full:
            pass


def _band_of_action(action: str) -> int:
    return {ACTION_HOLD: 2, ACTION_STEP_UP: 1}.get(action, 0)


def _rules_matching(score: float | None, action: str, features: dict) -> list[dict]:
    if audit is None:
        return []
    rules = audit.query("SELECT * FROM alert_rules WHERE enabled = 1")
    matched: list[dict] = []
    for r in rules:
        metric = r["metric"]
        thr = float(r["threshold"] or 0)
        hit = False
        if metric == "min_score":
            hit = score is not None and score >= thr
        elif metric == "risk_band":
            hit = _band_of_action(action) >= int(thr)
        elif metric == "cluster_burst":
            hit = float(features.get("cluster_claim_burst_7d", 0)) >= thr
        if hit:
            matched.append(r)
    return matched


def _sign_webhook(body_bytes: bytes) -> str:
    """Stripe-style signature: t=<unix>,v1=HMAC_SHA256(secret, f'{t}.{body}')."""
    ts = str(int(time.time()))
    mac = hmac.new(
        SETTINGS.webhook_secret.encode(),
        f"{ts}.".encode() + body_bytes,
        hashlib.sha256,
    ).hexdigest()
    return f"t={ts},v1={mac}"


def _dispatch_webhook(rule: dict, payload: dict) -> int:
    """Fire-and-forget signed webhook POST in a daemon thread. Returns 1 on success."""
    url = (rule.get("webhook_url") or "").strip()
    if not url:
        return 0
    body_bytes = json.dumps(payload).encode()
    signature = _sign_webhook(body_bytes)

    def _post() -> int:
        try:
            req = urllib.request.Request(
                url,
                data=body_bytes,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "ring-sentinel-webhooks/1",
                    "X-RingSentinel-Signature": signature,
                    "X-RingSentinel-Topic": str(payload.get("topic", "alert.triggered")),
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=4):
                return 1
        except Exception:
            log.warning("webhook delivery failed for rule %r", rule.get("name"))
            return 0

    result: list[int] = []

    def _run() -> None:
        result.append(_post())

    threading.Thread(target=_run, daemon=True).start()
    # delivered status is provisional (0) until the thread finishes writing
    return result[0] if result else 0


def _evaluate_alerts(score_out: ScoreOut, identity_key: str, amount: float) -> None:
    """Match scored claim against enabled rules; record + stream + webhook."""
    if audit is None:
        return
    for rule in _rules_matching(score_out.score, score_out.action,
                                score_out.features):
        dedupe = audit.query(
            "SELECT id FROM alert_events WHERE rule_id=? AND claim_id=? LIMIT 1",
            (rule["id"], score_out.claim_id or ""),
        )
        if dedupe:
            continue
        severity = "HIGH" if _band_of_action(score_out.action) >= 2 else "MEDIUM"
        detail = (
            f"score {score_out.score if score_out.score is not None else 'n/a'} "
            f"→ {score_out.action} · ₹{amount:,.0f} · {identity_key}"
        )
        delivered = _dispatch_webhook(
            {"name": rule["name"], "id": rule["id"], "webhook_url": rule.get("webhook_url")},
            {"topic": "alert.triggered", "rule": rule["name"], "rule_id": rule["id"],
             "claim_id": score_out.claim_id, "identity_key": identity_key,
             "score": score_out.score, "action": score_out.action,
             "amount": amount, "severity": severity},
        )
        audit.execute(
            "INSERT INTO alert_events (ts,rule_id,rule_name,claim_id,severity,detail,delivered) "
            "VALUES (?,?,?,?,?,?,?)",
            (datetime.now(timezone.utc).isoformat(), rule["id"], rule["name"],
             score_out.claim_id, severity, detail, delivered),
        )
        _publish({
            "type": "alert",
            "ts": datetime.now(timezone.utc).isoformat(),
            "rule_id": rule["id"],
            "rule_name": rule["name"],
            "claim_id": score_out.claim_id,
            "identity_key": identity_key,
            "score": score_out.score,
            "action": score_out.action,
            "severity": severity,
            "detail": detail,
        })


# ---- ring-forming detector ----------------------------------------------------
# Fires when one union-find cluster gains >= RING_FORM_GROWTH members within
# RING_FORM_WINDOW_MIN minutes — a coordinated campaign assembling in real time.

RING_FORM_GROWTH = 3
RING_FORM_WINDOW_MIN = 30
RING_FORM_COOLDOWN_MIN = 10

_ring_watch: dict[str, deque] = {}
_ring_watch_lock = threading.Lock()
_ring_last_fired: dict[str, float] = {}


def _check_ring_forming(
    root: str, size: int, claim_id: str | None, identity_key: str,
    members_sample: list[str],
) -> None:
    now = time.monotonic()
    with _ring_watch_lock:
        dq = _ring_watch.setdefault(root, deque())
        dq.append((now, size))
        while dq and now - dq[0][0] > RING_FORM_WINDOW_MIN * 60:
            dq.popleft()
        growth = size - min((s for _, s in dq), default=size)
        last = _ring_last_fired.get(root, 0)
        if growth < RING_FORM_GROWTH or now - last < RING_FORM_COOLDOWN_MIN * 60:
            return
        _ring_last_fired[root] = now

    detail = (
        f"cluster grew +{growth} identities in {RING_FORM_WINDOW_MIN} min "
        f"(now {size} members) · latest {identity_key}"
    )
    if audit is not None:
        try:
            audit.execute(
                "INSERT INTO alert_events (ts,rule_id,rule_name,claim_id,severity,detail,delivered) "
                "VALUES (?,NULL,'ring-formation-detector',?,'HIGH',?,0)",
                (datetime.now(timezone.utc).isoformat(), claim_id, detail),
            )
        except sqlite3.Error:
            log.exception("ring-forming audit write failed")
    _publish({
        "type": "ring_forming",
        "ts": datetime.now(timezone.utc).isoformat(),
        "claim_id": claim_id,
        "identity_key": identity_key,
        "cluster_root": root,
        "cluster_size": size,
        "growth": growth,
        "window_min": RING_FORM_WINDOW_MIN,
        "members_sample": members_sample[:8],
        "detail": detail,
    })


# ---- API models (strict bounds) ------------------------------------------

ID_PATTERN = r"^[A-Za-z0-9_.:\-@]{1,64}$"


class OrderIn(BaseModel):
    order_id: str = Field(pattern=ID_PATTERN)
    identity_key: str = Field(pattern=ID_PATTERN)
    merchant_id: str = Field(pattern=ID_PATTERN)
    device_id: str = Field(pattern=ID_PATTERN)
    vpa_id: str = Field(pattern=ID_PATTERN)
    phone_id: str = Field(pattern=ID_PATTERN)
    address_id: str = Field(pattern=ID_PATTERN)
    card_id: str = Field(pattern=ID_PATTERN)
    ts: datetime | None = None


class ClaimIn(BaseModel):
    claim_id: str | None = Field(default=None, pattern=ID_PATTERN)
    identity_key: str = Field(pattern=ID_PATTERN)
    merchant_id: str = Field(pattern=ID_PATTERN)
    amount: float = Field(ge=0, le=10_000_000)
    reason_text: str = Field(min_length=1, max_length=512)
    approved: bool = False
    ts: datetime | None = None

    @field_validator("amount")
    @classmethod
    def finite(cls, v: float) -> float:
        if v != v or v in (float("inf"), float("-inf")):  # noqa: PLR0124 — NaN check
            raise ValueError("amount must be finite")
        return round(v, 2)


class ScoreOut(BaseModel):
    claim_id: str | None = None
    score: float | None = None
    action: str
    degraded: bool = False
    degradation_reason: str | None = None
    deduplicated: bool = False
    thresholds: dict
    features: dict
    evidence: dict
    model_loaded: bool
    model_sha256: str | None = None
    request_id: str | None = None


class IngestOut(BaseModel):
    status: str
    order_id: str
    known_identities: int
    deduplicated: bool = False


# ---- idempotency caches ---------------------------------------------------

_seen_orders: OrderedDict[str, dict] = OrderedDict()
_seen_claims: OrderedDict[str, dict] = OrderedDict()
_IDEM_LOCK = threading.Lock()
_IDEM_MAX = 50_000


def _idem_check(cache: OrderedDict, key: str, kind: str) -> dict | None:
    with _IDEM_LOCK:
        if key in cache:
            cache.move_to_end(key)
            METRIC_DUPLICATES.labels(kind=kind).inc()
            return cache[key]
        return None


def _idem_store(cache: OrderedDict, key: str, value: dict) -> None:
    with _IDEM_LOCK:
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > _IDEM_MAX:
            cache.popitem(last=False)


# ---- app setup -------------------------------------------------------------

_snapshot_thread: threading.Thread | None = None
_snapshot_stop = threading.Event()


def _snapshot_once() -> None:
    try:
        snap = state.snapshot_dict()
        os.makedirs(os.path.dirname(SETTINGS.snapshot_path) or ".", exist_ok=True)
        tmp = SETTINGS.snapshot_path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(snap, fh)
        os.replace(tmp, SETTINGS.snapshot_path)
        log.info("state snapshot saved (%d identities)", len(snap["identity_order_counts"]))
    except Exception:
        log.exception("snapshot save failed")


def _snapshot_loop() -> None:
    while not _snapshot_stop.wait(SETTINGS.snapshot_interval_s):
        _snapshot_once()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global audit
    audit = AuditLog(SETTINGS.audit_db_path)
    load_model()
    if os.path.exists(SETTINGS.snapshot_path):
        try:
            with open(SETTINGS.snapshot_path) as fh:  # noqa: ASYNC230 — one-shot startup read
                state.load_snapshot_dict(json.load(fh))
            log.info(
                "state restored from snapshot (%d identities)",
                state.known_identity_count(),
            )
        except Exception:
            log.exception("snapshot restore failed; starting with empty state")
    global _snapshot_thread
    _snapshot_thread = threading.Thread(target=_snapshot_loop, daemon=True)
    _snapshot_thread.start()
    yield
    _snapshot_stop.set()
    _snapshot_once()
    if audit is not None:
        audit.close()


app = FastAPI(title="Ring Sentinel Scoring Service", version=SETTINGS.version,
              lifespan=lifespan)


# ---- middleware ------------------------------------------------------------

@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    request.state.request_id = request_id
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    elapsed = time.perf_counter() - start
    if request.url.path in ("/v1/score", "/score"):
        METRIC_SCORE_LATENCY.observe(elapsed)
    return response


@app.middleware("http")
async def body_size_middleware(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > SETTINGS.max_body_bytes:
        METRIC_REQUESTS.labels(endpoint=request.url.path, status="413").inc()
        return JSONResponse(
            status_code=413,
            content={"error": {"code": "payload_too_large",
                               "message": f"body exceeds {SETTINGS.max_body_bytes} bytes"}},
        )
    return await call_next(request)


_rate_buckets: dict[str, deque] = {}


def _rate_limit_hit(key: str) -> bool:
    now = time.monotonic()
    bucket = _rate_buckets.setdefault(key, deque())
    window_start = now - 60
    while bucket and bucket[0] < window_start:
        bucket.popleft()
    if len(bucket) >= SETTINGS.rate_limit_per_min:
        return True
    bucket.append(now)
    return False


PUBLIC_PATHS = {"/health", "/healthz", "/readyz", "/version", "/metrics", "/docs",
                "/openapi.json", "/"}


async def enforce_auth_and_rate(request: Request) -> None:
    if request.url.path in PUBLIC_PATHS:
        return
    key = request.headers.get("X-API-Key", "")
    if not any(hmac.compare_digest(key, k) for k in SETTINGS.api_keys):
        METRIC_REQUESTS.labels(endpoint=request.url.path, status="401").inc()
        raise ApiError(401, "unauthorized", "missing or invalid X-API-Key header")
    if _rate_limit_hit(key):
        METRIC_RATE_LIMITED.inc()
        METRIC_REQUESTS.labels(endpoint=request.url.path, status="429").inc()
        raise ApiError(429, "rate_limited",
                       f"exceeds {SETTINGS.rate_limit_per_min} requests/min")


async def auth_guard(request: Request) -> None:
    """Route dependency: runs BEFORE body validation so unauthenticated
    callers never receive schema/validation details."""
    await enforce_auth_and_rate(request)


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content={"error": {"code": exc.code, "message": exc.message},
                 "request_id": getattr(request.state, "request_id", None)},
    )


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "internal_error",
                           "message": "internal server error"},
                 "request_id": getattr(request.state, "request_id", None)},
    )


# ---- endpoints --------------------------------------------------------------

def _do_ingest(order: OrderIn, request: Request) -> IngestOut:
    if order.order_id:
        prior = _idem_check(_seen_orders, f"ord:{order.order_id}", "order")
        if prior is not None:
            return IngestOut(status="duplicate", order_id=order.order_id,
                             known_identities=prior["known_identities"],
                             deduplicated=True)
    try:
        state.ingest_order(
            order.identity_key,
            [order.device_id, order.vpa_id, order.phone_id,
             order.address_id, order.card_id],
            order.merchant_id,
        )
    except CapacityError as exc:
        raise ApiError(503, "capacity_exceeded", str(exc))
    out = IngestOut(status="ingested", order_id=order.order_id,
                    known_identities=state.known_identity_count())
    _idem_store(_seen_orders, f"ord:{order.order_id}",
                {"known_identities": out.known_identities})
    return out


async def ingest_order_v1(order: OrderIn, request: Request) -> IngestOut:
    out = _do_ingest(order, request)
    METRIC_REQUESTS.labels(endpoint="/v1/ingest/order", status="200").inc()
    return out


async def ingest_order_legacy(order: OrderIn, request: Request) -> IngestOut:
    out = _do_ingest(order, request)
    METRIC_REQUESTS.labels(endpoint="/ingest/order", status="200").inc()
    return out


app.post(
    "/v1/ingest/order", response_model=IngestOut,
    dependencies=[Depends(auth_guard)],
)(ingest_order_v1)
app.post(
    "/ingest/order", response_model=IngestOut,
    dependencies=[Depends(auth_guard)],
)(ingest_order_legacy)


def _do_score(claim: ClaimIn, shadow: bool, request: Request) -> ScoreOut:
    request_id = getattr(request.state, "request_id", None)
    idem_key = f"clm:{claim.claim_id}" if claim.claim_id else None
    if idem_key and not shadow:
        prior = _idem_check(_seen_claims, idem_key, "claim")
        if prior is not None:
            prior = dict(prior)
            prior["deduplicated"] = True
            return ScoreOut(**prior)

    ts = claim.ts or datetime.now(timezone.utc)
    pd_ts = pd.Timestamp(ts)
    if pd_ts.tzinfo is None:
        pd_ts = pd_ts.tz_localize(timezone.utc)
    else:
        pd_ts = pd_ts.tz_convert(timezone.utc)
    now_utc = pd.Timestamp.now(tz=timezone.utc)
    if pd_ts > now_utc + pd.Timedelta(seconds=60):
        # Prevent future-timestamp velocity evasion: clamp anchor to current server time
        pd_ts = now_utc

    degradation: list[str | None] = [None]

    def predictor(feats: dict) -> float | None:
        score_val, reason = predict_score(feats)
        if reason is not None:
            degradation[0] = reason
        return score_val

    features, bundle = state.compute_features(
        pd_ts, claim.identity_key, claim.amount, claim.reason_text,
        predictor=predictor,
        record_claim=not shadow,
        approved=claim.approved,
    )
    raw_score = bundle["score"]
    evidence = bundle["evidence"]

    score = raw_score
    degraded = score is None
    degradation_reason = degradation[0] if degraded else None
    action = apply_policy(score)
    METRIC_SCORES.labels(action=action).inc()

    out = ScoreOut(
        claim_id=claim.claim_id,
        score=round(score, 6) if score is not None else None,
        action=action,
        degraded=degraded,
        degradation_reason=degradation_reason,
        thresholds={"high": SETTINGS.high_threshold,
                    "medium": SETTINGS.medium_threshold},
        features=features,
        evidence=evidence,
        model_loaded=_model is not None,
        model_sha256=_model_sha256_short,
        request_id=request_id,
    )
    if audit is not None and not shadow:
        audit.insert(
            ts=datetime.now(timezone.utc).isoformat(),
            request_id=request_id,
            claim_id=claim.claim_id,
            identity_key=claim.identity_key,
            merchant_id=claim.merchant_id,
            amount=claim.amount,
            score=out.score,
            action=out.action,
            model_loaded=int(out.model_loaded),
            degraded=int(degraded),
            shadow=0,
        )
        _publish({
            "type": "score",
            "ts": datetime.now(timezone.utc).isoformat(),
            "claim_id": claim.claim_id,
            "identity_key": claim.identity_key,
            "merchant_id": claim.merchant_id,
            "amount": claim.amount,
            "score": out.score,
            "action": out.action,
            "degraded": degraded,
        })
        try:
            _evaluate_alerts(out, claim.identity_key, claim.amount)
        except Exception:
            log.exception("alert evaluation failed")
        try:
            _check_ring_forming(
                state.cluster_root(claim.identity_key),
                int(features.get("cluster_size", 1)),
                claim.claim_id,
                claim.identity_key,
                list(evidence.get("cluster_members_sample", [])),
            )
        except Exception:
            log.exception("ring-forming check failed")
    if idem_key and not shadow:
        _idem_store(_seen_claims, idem_key, out.model_dump())
    return out


async def score_claim_v1(claim: ClaimIn, request: Request) -> ScoreOut:
    out = _do_score(claim, shadow=False, request=request)
    METRIC_REQUESTS.labels(endpoint="/v1/score", status="200").inc()
    return out


async def score_claim_legacy(claim: ClaimIn, request: Request) -> ScoreOut:
    out = _do_score(claim, shadow=False, request=request)
    METRIC_REQUESTS.labels(endpoint="/score", status="200").inc()
    return out


async def score_shadow_v1(claim: ClaimIn, request: Request) -> ScoreOut:
    out = _do_score(claim, shadow=True, request=request)
    METRIC_REQUESTS.labels(endpoint="/v1/score/shadow", status="200").inc()
    return out


app.post(
    "/v1/score", response_model=ScoreOut,
    dependencies=[Depends(auth_guard)],
)(score_claim_v1)
app.post(
    "/score", response_model=ScoreOut,
    dependencies=[Depends(auth_guard)],
)(score_claim_legacy)
app.post(
    "/v1/score/shadow", response_model=ScoreOut,
    dependencies=[Depends(auth_guard)],
)(score_shadow_v1)


@app.get("/health")
@app.get("/healthz")
def health() -> dict:
    return {
        "status": "ok",
        "model_loaded": _model is not None,
        "model_sha_verified": _model_sha_verified,
        "known_identities": state.known_identity_count(),
    }


@app.get("/readyz")
def readyz() -> dict:
    return {
        "ready": True,
        "model_loaded": _model is not None,
        "known_identities": state.known_identity_count(),
    }


@app.get("/version")
def version() -> dict:
    return {
        "service": "ring-sentinel-scoring",
        "version": SETTINGS.version,
        "model_sha256": _model_sha256_short,
        "thresholds": {"high": SETTINGS.high_threshold,
                       "medium": SETTINGS.medium_threshold},
    }


@app.get("/metrics")
def metrics() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ---- ops dashboard: offline claims store ------------------------------------
#
# Read-only view over the scored held-out test set produced by train_eval.py
# (data/test_claims_scored.parquet) plus orders/identities parquets used to
# reconstruct cluster evidence graphs. All identities are synthetic.
# If the artifacts are absent the endpoints degrade gracefully so the live
# scoring API keeps working without them.

try:
    from src.build_dashboard import build_cluster_graph
except ImportError:  # direct-script execution from src/
    from build_dashboard import (  # type: ignore[no-redef, import-not-found]
        build_cluster_graph,
    )

MERCHANT_CATEGORIES = ["ELECTRONICS", "FASHION", "GROCERY", "HOME", "BEAUTY"]
_DATA_DIR = os.environ.get("RING_SENTINEL_DATA_DIR", "data")


def risk_action_for_score(score: float) -> tuple[str, str]:
    if score >= SETTINGS.high_threshold:
        return "HIGH", ACTION_HOLD
    if score >= SETTINGS.medium_threshold:
        return "MEDIUM", ACTION_STEP_UP
    return "LOW", ACTION_AUTO_APPROVE


class ClaimsStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._loaded = False
        self.available = False
        self.claims: pd.DataFrame | None = None
        self.orders: pd.DataFrame | None = None
        self.ring_by_identity: dict[str, str] = {}

    def _ensure_loaded(self) -> None:
        with self._lock:
            if self._loaded:
                return
            self._loaded = True
            try:
                claims_path = os.path.join(_DATA_DIR, "test_claims_scored.parquet")
                orders_path = os.path.join(_DATA_DIR, "orders.parquet")
                idents_path = os.path.join(_DATA_DIR, "identities.parquet")
                if not os.path.exists(claims_path):
                    log.warning("claims store unavailable: %s missing", claims_path)
                    return
                df = pd.read_parquet(claims_path)
                df["claim_ts"] = pd.to_datetime(df["claim_ts"], utc=True)
                df = df.sort_values("claim_ts").reset_index(drop=True)
                self.claims = df
                self.orders = (
                    pd.read_parquet(orders_path)
                    if os.path.exists(orders_path) else None
                )
                if os.path.exists(idents_path):
                    ids = pd.read_parquet(idents_path)
                    rings = ids[ids["is_ring"] & ids["ring_id"].notna()]
                    self.ring_by_identity = dict(
                        zip(rings["identity_key"], rings["ring_id"])
                    )
                self.available = True
                log.info("claims store loaded (%d scored test claims)", len(df))
            except Exception:
                log.exception("claims store load failed; dashboard queue disabled")

    def _with_risk(self, df: pd.DataFrame) -> pd.DataFrame:
        actions = df["score"].map(risk_action_for_score)
        df = df.copy()
        df["risk_level"] = [r for r, _ in actions]
        df["action"] = [a for _, a in actions]
        return df

    def list_claims(
        self,
        risk: str,
        merchant: str | None,
        q: str | None,
        min_amount: float | None,
        max_amount: float | None,
        sort: str,
        order: str,
        page: int,
        page_size: int,
    ) -> dict:
        self._ensure_loaded()
        empty: dict = {"available": self.available, "total": 0, "page": page,
                       "page_size": page_size, "window": None, "items": []}
        if self.claims is None:
            return empty
        df = self._with_risk(self.claims)
        if risk in ("HIGH", "MEDIUM", "LOW"):
            df = df[df["risk_level"] == risk]
        if merchant:
            df = df[df["merchant_id"] == merchant]
        if q:
            ql = q.lower()
            mask = (
                df["claim_id"].str.lower().str.contains(ql, regex=False)
                | df["identity_key"].str.lower().str.contains(ql, regex=False)
                | df["merchant_id"].str.lower().str.contains(ql, regex=False)
            )
            df = df[mask]
        if min_amount is not None:
            df = df[df["amount"] >= min_amount]
        if max_amount is not None:
            df = df[df["amount"] <= max_amount]
        col = {"score": "score", "amount": "amount", "ts": "claim_ts"}.get(sort, "score")
        df = df.sort_values(col, ascending=(order == "asc"), kind="stable")
        total = len(df)
        start = (page - 1) * page_size
        items = []
        for row in df.iloc[start:start + page_size].itertuples(index=False):
            items.append({
                "claim_id": row.claim_id,
                "ts": row.claim_ts.isoformat(),
                "identity_key": row.identity_key,
                "merchant_id": row.merchant_id,
                "category": row.category,
                "amount": round(float(row.amount), 2),
                "score": round(float(row.score), 6),
                "risk_level": row.risk_level,
                "action": row.action,
                "cluster_size": int(row.cluster_size),
                "has_evidence": bool(
                    row.cluster_size > 1 or row.shared_infra_neighbor_count > 0
                ),
            })
        # enrich with workflow state (case status/assignee/SLA) + watchlist flags
        if audit is not None:
            watch = {
                r["entity"]
                for r in audit.query("SELECT entity FROM watchlist")
            }
            cases = {
                r["claim_id"]: r
                for r in audit.query("SELECT * FROM case_state")
            }
            for it in items:
                it["watchlisted"] = it["identity_key"] in watch
                cs = cases.get(it["claim_id"])
                it["status"] = cs["status"] if cs else None
                it["assigned_to"] = cs["assigned_to"] if cs else None
                it["sla_due_at"] = cs["sla_due_at"] if cs else None
        return {
            "available": True,
            "total": total,
            "page": page,
            "page_size": page_size,
            "window": {
                "from": str(self.claims["claim_ts"].min().date()),
                "to": str(self.claims["claim_ts"].max().date()),
                "label": "held-out test window",
            },
            "items": items,
        }

    def get_claim(self, claim_id: str) -> dict | None:
        self._ensure_loaded()
        if self.claims is None:
            return None
        matches = self.claims[self.claims["claim_id"] == claim_id]
        if matches.empty:
            return None
        c = matches.iloc[0]
        score = float(c["score"])
        risk_level, action = risk_action_for_score(score)
        features = {f: float(c[f]) for f in FEATURE_ORDER}
        evidence, graph, members = self._cluster_evidence(c)
        timeline = self._timeline(c, score, action, evidence)
        history = self._identity_history(c)
        case_row = None
        watch_row = None
        if audit is not None:
            case_rows = audit.query(
                "SELECT * FROM case_state WHERE claim_id=?", (str(c["claim_id"]),))
            case_row = case_rows[0] if case_rows else None
            watch_rows = audit.query(
                "SELECT * FROM watchlist WHERE entity=?",
                (str(c["identity_key"]),))
            watch_row = watch_rows[0] if watch_rows else None
        return {
            "claim": {
                "claim_id": c["claim_id"],
                "order_id": c["order_id"],
                "identity_key": c["identity_key"],
                "merchant_id": c["merchant_id"],
                "category": c["category"],
                "reason_text": c["reason_text"],
                "approved": bool(c["is_approved"]),
                "ts": pd.Timestamp(c["claim_ts"]).isoformat(),
                "amount": round(float(c["amount"]), 2),
                "ring_label": int(c["is_ring_label"]),
                "ring_id": self.ring_by_identity.get(c["identity_key"]),
            },
            "score": round(score, 6),
            "risk_level": risk_level,
            "action": action,
            "thresholds": {"high": SETTINGS.high_threshold,
                           "medium": SETTINGS.medium_threshold},
            "features": features,
            "evidence": evidence,
            "graph": graph,
            "timeline": timeline,
            "identity_history": history,
            "merchant": self._merchant_context(str(c["merchant_id"])),
            "cluster": self._cluster_summary(c, members, evidence),
            "case": case_row,
            "watchlisted": watch_row is not None,
            "watch_reason": watch_row["reason"] if watch_row else None,
            "replay": self._replay(c, members),
        }

    def _replay(self, c: pd.Series, members: set[str]) -> list[dict]:
        """Time-ordered order events for the cluster — ring-formation replay."""
        events: list[dict] = []
        if self.orders is None or not members:
            return events
        sub = self.orders[self.orders["identity_key"].isin(members)]
        infra_cols = ["device_id", "vpa_id", "phone_id", "address_id", "card_id"]
        for r in sub.itertuples(index=False):
            ts = pd.Timestamp(r.order_ts)
            if ts.tzinfo is None:
                ts = ts.tz_localize("UTC")
            events.append({
                "ts": ts.isoformat(),
                "identity": str(r.identity_key),
                "infra": [str(getattr(r, col)) for col in infra_cols],
                "merchant": str(r.merchant_id),
            })
        events.sort(key=lambda e: e["ts"])
        return events[:400]

    def _cluster_evidence(
        self, c: pd.Series
    ) -> tuple[dict, dict, set[str]]:
        claimant = str(c["identity_key"])
        graph: dict = {"nodes": [], "edges": []}
        infra_shared: list[dict] = []
        members: set[str] = {claimant}

        if self.orders is not None:
            own = self.orders[self.orders["identity_key"] == claimant]
            infra_cols = ["device_id", "vpa_id", "phone_id", "address_id", "card_id"]
            own_vals = {col: set(own[col].unique()) for col in infra_cols} \
                if not own.empty else {col: set() for col in infra_cols}
            mask = self.orders["identity_key"] == claimant
            for col in infra_cols:
                if own_vals[col]:
                    mask = mask | self.orders[col].isin(own_vals[col])
            relevant = self.orders[mask] if self.orders is not None else own

            infra_to_idents: dict[tuple[str, str], set[str]] = defaultdict(set)
            for row in relevant.itertuples(index=False):
                for col in infra_cols:
                    infra_to_idents[(col, getattr(row, col))].add(row.identity_key)

            type_label = {"device_id": "device", "vpa_id": "VPA",
                          "phone_id": "phone", "address_id": "address",
                          "card_id": "card"}
            seen_nodes: set[str] = set()
            for (col, node), idents in sorted(infra_to_idents.items()):
                sharing = idents - {claimant}
                if not sharing or node in seen_nodes:
                    continue
                seen_nodes.add(node)
                members |= sharing
                merchants = sorted(set(
                    relevant[(relevant[col] == node)]["merchant_id"]
                ))
                infra_shared.append({
                    "type": type_label[col],
                    "id": node,
                    "connected_identities": sorted(sharing),
                    "merchants": merchants[:8],
                })

            try:
                graph = build_cluster_graph(claimant, self.orders)
            except Exception:
                log.exception("cluster graph reconstruction failed")

        member_claims = pd.DataFrame()
        if self.claims is not None and len(members) > 1:
            member_claims = self.claims[self.claims["identity_key"].isin(members)]

        ts = pd.Timestamp(c["claim_ts"])
        burst_df = pd.DataFrame()
        if not member_claims.empty:
            burst_df = member_claims[
                (member_claims["claim_ts"] < ts)
                & (member_claims["claim_ts"] >= ts - pd.Timedelta(days=7))
            ]
        reason_reuse = False
        if not member_claims.empty:
            others = member_claims[
                (member_claims["identity_key"] != claimant)
                & (member_claims["reason_text"] == c["reason_text"])
            ]
            reason_reuse = not others.empty

        why: list[dict] = [
            {"feature": "cluster_size",
             "label": f"{int(c['cluster_size'])} identities connected "
                      f"in one shared-infrastructure cluster",
             "value": float(c["cluster_size"])},
            {"feature": "shared_infra_neighbor_count",
             "label": f"{int(c['shared_infra_neighbor_count'])} other identities "
                      f"share infrastructure with this customer",
             "value": float(c["shared_infra_neighbor_count"])},
            {"feature": "cluster_merchant_span",
             "label": f"claims spread across {int(c['cluster_merchant_span'])} merchants",
             "value": float(c["cluster_merchant_span"])},
            {"feature": "cluster_claim_burst_7d",
             "label": f"{len(burst_df)} claims filed by connected identities "
                      f"in the previous 7 days",
             "value": float(len(burst_df))},
            {"feature": "reason_text_reuse_flag",
             "label": ("identical claim reason text reused verbatim by another "
                       "cluster member") if reason_reuse
                      else "no verbatim reason-text reuse detected",
             "value": float(bool(c["reason_text_reuse_flag"]))},
            {"feature": "identity_claim_approval_ratio_so_far",
             "label": f"this identity's prior claim approval ratio: "
                      f"{float(c['identity_claim_approval_ratio_so_far']):.0%}",
             "value": float(c["identity_claim_approval_ratio_so_far"])},
        ]
        evidence = {
            "why_flagged": why,
            "shared_infra": infra_shared,
            "recent_cluster_claims_7d": len(burst_df),
            "cluster_value_7d_inr": round(float(burst_df["amount"].sum()), 2)
            if not burst_df.empty else 0.0,
            "reason_text_reused_across_identities": reason_reuse,
            "cluster_members_sample": sorted(members)[:12],
            "other_cluster_member_count": len(members) - 1,
            "cluster_capped": False,
        }
        return evidence, graph, members

    def _timeline(
        self, c: pd.Series, score: float, action: str, evidence: dict
    ) -> list[dict]:
        events: list[dict] = []
        claim_ts = pd.Timestamp(c["claim_ts"])
        order_ts = claim_ts
        order_amount = float(c["amount"])
        if self.orders is not None and c["order_id"]:
            om = self.orders[self.orders["order_id"] == c["order_id"]]
            if not om.empty:
                order_ts = pd.Timestamp(om.iloc[0]["order_ts"], tz="UTC") \
                    if pd.Timestamp(om.iloc[0]["order_ts"]).tzinfo is None \
                    else pd.Timestamp(om.iloc[0]["order_ts"])
                order_amount = float(om.iloc[0]["amount"])
        events.append({"ts": order_ts.isoformat(), "event": "order_placed",
                       "label": "Order placed",
                       "detail": f"{c['merchant_id']} · ₹{order_amount:,.0f}"})
        events.append({"ts": order_ts.isoformat(), "event": "graph_ingested",
                       "label": "Order ingested into identity graph"})
        n_shared = len(evidence.get("shared_infra", []))
        if n_shared:
            events.append({
                "ts": order_ts.isoformat(), "event": "shared_infra_detected",
                "label": "Shared infrastructure detected",
                "detail": f"{n_shared} infrastructure node(s) linked to other identities",
            })
        events.append({"ts": claim_ts.isoformat(), "event": "claim_submitted",
                       "label": "Claim submitted",
                       "detail": str(c["reason_text"])})
        events.append({
            "ts": claim_ts.isoformat(), "event": "scored",
            "label": "Risk score calculated",
            "detail": f"score {score:.4f} → {action}",
        })
        if action == ACTION_HOLD:
            events.append({"ts": claim_ts.isoformat(), "event": "payout_held",
                           "label": "Payout placed on hold",
                           "detail": "awaiting human review"})
        events.sort(key=lambda e: e["ts"])
        return events

    def _identity_history(self, c: pd.Series) -> dict:
        ident = str(c["identity_key"])
        out: dict = {"prior_claims": [], "counts": {}}
        if self.claims is None:
            return out
        prior = self.claims[
            (self.claims["identity_key"] == ident)
            & (self.claims["claim_ts"] < c["claim_ts"])
        ].sort_values("claim_ts")
        rows = []
        holds = approvals = 0
        for r in prior.itertuples(index=False):
            _risk, act = risk_action_for_score(float(r.score))
            holds += act == ACTION_HOLD
            approvals += act == ACTION_AUTO_APPROVE
            rows.append({
                "claim_id": r.claim_id,
                "ts": pd.Timestamp(r.claim_ts).isoformat(),
                "merchant_id": r.merchant_id,
                "amount": round(float(r.amount), 2),
                "score": round(float(r.score), 4),
                "action": act,
            })
        out["prior_claims"] = rows[-20:]
        out["counts"] = {"total": len(rows), "holds": holds,
                         "auto_approved": approvals}
        return out

    def _merchant_context(self, merchant_id: str) -> dict:
        ctx: dict = {"merchant_id": merchant_id}
        if self.orders is not None:
            mo = self.orders[self.orders["merchant_id"] == merchant_id]
            ctx["n_orders"] = len(mo)
            ctx["n_identities"] = int(mo["identity_key"].nunique())
        if self.claims is not None:
            mc = self.claims[self.claims["merchant_id"] == merchant_id]
            ctx["category"] = (
                str(mc["category"].mode().iloc[0]) if not mc.empty else None
            )
            ctx["n_claims"] = len(mc)
            ctx["claim_rate"] = (
                round(len(mc) / ctx["n_orders"], 4)
                if ctx.get("n_orders") else None
            )
            ring_ids = sorted({
                self.ring_by_identity[i] for i in mc["identity_key"].unique()
                if i in self.ring_by_identity
            })
            ctx["connected_clusters"] = ring_ids
        return ctx

    def _cluster_summary(
        self, c: pd.Series, members: set[str], evidence: dict
    ) -> dict:
        shared_types = sorted({s["type"] for s in evidence.get("shared_infra", [])})
        return {
            "ring_id": self.ring_by_identity.get(str(c["identity_key"])),
            "members": len(members),
            "shared_infra_types": shared_types,
        }

    def median_amount(self) -> float:
        self._ensure_loaded()
        if self.claims is None:
            return 1000.0
        return round(float(self.claims["amount"].median()), 2)

    def counterfactuals(self, detail: dict) -> dict:
        """Perturbation-based score attribution + greedy path to approval."""
        features = detail["features"]
        score = float(detail["score"])
        baselines = {**CF_BASELINES, "amount": self.median_amount()}
        contributions: list[dict] = []
        for feat, benign in baselines.items():
            if feat not in features:
                continue
            value = float(features[feat])
            if abs(value - benign) < 1e-9:
                contributions.append({
                    "feature": feat, "value": value, "benign_value": benign,
                    "score_with_benign": round(score, 6), "delta": 0.0,
                })
                continue
            cf_features = dict(features)
            cf_features[feat] = benign
            cf_score, _ = predict_score(cf_features)
            if cf_score is None:
                continue
            contributions.append({
                "feature": feat, "value": value, "benign_value": benign,
                "score_with_benign": round(cf_score, 6),
                "delta": round(score - cf_score, 6),
            })
        contributions.sort(key=lambda c: -c["delta"])

        work = dict(features)
        steps: list[dict] = []
        current = score
        for c in sorted(
            (x for x in contributions if x["delta"] > 0), key=lambda x: -x["delta"]
        ):
            work[c["feature"]] = c["benign_value"]
            s, _ = predict_score(work)
            if s is None:
                continue
            current = s
            steps.append({
                "feature": c["feature"], "to": c["benign_value"],
                "score_after": round(s, 6),
            })
            if current < SETTINGS.medium_threshold:
                break
        return {
            "available": True,
            "score": round(score, 6),
            "thresholds": {"high": SETTINGS.high_threshold,
                           "medium": SETTINGS.medium_threshold},
            "contributions": contributions,
            "path": {
                "steps": steps,
                "final_score": round(current, 6),
                "reaches_auto_approve": current < SETTINGS.medium_threshold,
            },
        }

    def settlement_impact(self, high: float, medium: float) -> dict:
        """What-if: re-band the scored test set at hypothetical thresholds and
        show the settlement consequences (held value, release calendar, and
        the merchants whose payouts would be blocked)."""
        self._ensure_loaded()
        if self.claims is None:
            return {"available": False}
        df = self.claims
        score = df["score"]
        held = (score >= high).to_numpy()
        step_up = ((score >= medium) & ~pd.Series(held, index=df.index)).to_numpy()
        auto = ~(held | step_up)

        amounts = df["amount"].to_numpy(dtype=float)
        # release delay in days: held waits for human review, step-up waits a day
        delay = np.where(held, 1, np.where(step_up, 1, 0))
        release_ts = df["claim_ts"] + pd.to_timedelta(delay, unit="D")

        cal = (
            pd.DataFrame({
                "date": release_ts.dt.date,
                "released": np.where(held | step_up, amounts, 0.0),
                "delayed_count": (held | step_up).astype(int),
            })
            .groupby("date", sort=True)
            .agg(released=("released", "sum"), payouts=("delayed_count", "sum"))
            .reset_index()
        )
        calendar = [
            {"date": str(r.date),
             "released": round(float(r.released), 2),
             "delayed_payouts": int(r.payouts)}
            for r in cal.head(21).itertuples(index=False)
        ]

        mh = (
            df[held]
            .groupby("merchant_id")
            .agg(held_count=("amount", "count"), held_amount=("amount", "sum"))
            .sort_values("held_amount", ascending=False)
            .head(8)
        )
        top_merchants = [
            {"merchant_id": mid, "held_count": int(r.held_count),
             "held_amount": round(float(r.held_amount), 2)}
            for mid, r in mh.iterrows()
        ]

        held_amount = float(amounts[held].sum())
        base_held = float(
            df.loc[score >= SETTINGS.high_threshold, "amount"].sum()
        )

        def _band(mask: np.ndarray) -> dict:
            return {"count": int(mask.sum()),
                    "amount": round(float(amounts[mask].sum()), 2)}

        return {
            "available": True,
            "thresholds": {"high": high, "medium": medium,
                           "current_high": SETTINGS.high_threshold,
                           "current_medium": SETTINGS.medium_threshold},
            "window": {
                "from": str(df["claim_ts"].min().date()),
                "to": str(df["claim_ts"].max().date()),
            },
            "held": _band(held),
            "step_up": _band(step_up),
            "auto": _band(auto),
            "held_delta_vs_current": round(held_amount - base_held, 2),
            "calendar": calendar,
            "top_merchants": top_merchants,
        }

    def merchant_risk(self, merchant_id: str) -> dict | None:
        """Merchant-facing risk profile for the Merchant Risk API."""
        self._ensure_loaded()
        if self.claims is None:
            return None
        mc = self.claims[self.claims["merchant_id"] == merchant_id]
        if mc.empty:
            return None
        scores = mc["score"]
        held = scores >= SETTINGS.high_threshold
        step_up = (scores >= SETTINGS.medium_threshold) & ~held
        rings = sorted({
            self.ring_by_identity[i]
            for i in mc["identity_key"].unique()
            if i in self.ring_by_identity
        })
        watched = 0
        if audit is not None:
            wl = {r["entity"] for r in audit.query("SELECT entity FROM watchlist")}
            watched = int(mc["identity_key"].isin(wl).sum())
        n_orders = None
        if self.orders is not None:
            n_orders = int((self.orders["merchant_id"] == merchant_id).sum())
        risk_level = "HIGH" if held.any() else ("MEDIUM" if step_up.any() else "LOW")
        held_amount = float(mc.loc[held, "amount"].sum())
        recommendation = {
            "HIGH": "review connected clusters before next settlement cycle",
            "MEDIUM": "enable step-up verification for claims from this merchant",
            "LOW": "no action required — merchant behaviour is within norms",
        }[risk_level]
        return {
            "merchant_id": merchant_id,
            "risk_level": risk_level,
            "recommendation": recommendation,
            "n_claims": int(len(mc)),
            "n_orders": n_orders,
            "total_claim_amount": round(float(mc["amount"].sum()), 2),
            "mean_score": round(float(scores.mean()), 6),
            "max_score": round(float(scores.max()), 6),
            "held": {"count": int(held.sum()),
                     "amount": round(held_amount, 2)},
            "step_up": {"count": int(step_up.sum()),
                        "amount": round(float(mc.loc[step_up, "amount"].sum()), 2)},
            "connected_rings": rings,
            "watchlisted_claimants": watched,
            "last_claim_ts": pd.Timestamp(mc["claim_ts"].max()).isoformat(),
            "window": {
                "from": str(mc["claim_ts"].min().date()),
                "to": str(mc["claim_ts"].max().date()),
            },
        }


CLAIMS_STORE = ClaimsStore()


@app.get("/v1/claims", dependencies=[Depends(auth_guard)])
async def list_claims_endpoint(
    request: Request,
    risk: str = Query("all", pattern="^(all|HIGH|MEDIUM|LOW)$"),
    merchant: str | None = Query(None, max_length=64),
    q: str | None = Query(None, max_length=80),
    min_amount: float | None = Query(None, ge=0),
    max_amount: float | None = Query(None, ge=0),
    sort: str = Query("score", pattern="^(score|amount|ts)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(50, ge=1, le=5000),
) -> dict:
    return CLAIMS_STORE.list_claims(
        risk, merchant, q, min_amount, max_amount, sort, order, page, page_size
    )


@app.get(
    "/v1/claims/{claim_id}", dependencies=[Depends(auth_guard)]
)
async def get_claim_endpoint(request: Request, claim_id: str = FPath(max_length=64)) -> dict:
    detail = CLAIMS_STORE.get_claim(claim_id)
    if detail is None:
        raise ApiError(404, "claim_not_found",
                       f"no scored claim {claim_id!r} in the evaluation dataset")
    return detail


# ---- counterfactual "why this score" ---------------------------------------
# Perturbation-based attribution: re-score the claim with each feature swapped
# to a benign baseline; the drop in score is that feature's push contribution.
# No external explainability dependency required — the model explains itself.

CF_BASELINES: dict[str, float] = {
    "cluster_size": 1,
    "shared_infra_neighbor_count": 0,
    "cluster_merchant_span": 1,
    "cluster_claim_burst_7d": 0,
    "reason_text_reuse_flag": 0,
    "identity_claim_count_so_far": 0,
    "identity_claim_approval_ratio_so_far": 0.62,
    "identity_order_count_so_far": 0,
    "identity_merchant_count_so_far": 1,
}


@app.get(
    "/v1/claims/{claim_id}/counterfactuals", dependencies=[Depends(auth_guard)]
)
async def claim_counterfactuals(
    request: Request, claim_id: str = FPath(max_length=64)
) -> dict:
    detail = CLAIMS_STORE.get_claim(claim_id)
    if detail is None:
        raise ApiError(404, "claim_not_found",
                       f"no scored claim {claim_id!r} in the evaluation dataset")
    if _model is None:
        return {"available": False,
                "reason": "model unavailable — serving fail-open scores"}
    return CLAIMS_STORE.counterfactuals(detail)


# ---- settlement impact simulator -----------------------------------------------

@app.get("/v1/settlement/impact", dependencies=[Depends(auth_guard)])
async def settlement_impact_endpoint(
    request: Request,
    high: float = Query(SETTINGS.high_threshold, ge=0.05, le=1.0),
    medium: float = Query(SETTINGS.medium_threshold, ge=0.0, le=0.95),
) -> dict:
    if medium >= high:
        raise ApiError(422, "invalid_thresholds",
                       "medium threshold must be below the high threshold")
    return CLAIMS_STORE.settlement_impact(high, medium)


# ---- merchant risk API -----------------------------------------------------------

@app.get("/v1/merchants/{merchant_id}/risk", dependencies=[Depends(auth_guard)])
async def merchant_risk_endpoint(
    request: Request, merchant_id: str = FPath(max_length=64)
) -> dict:
    profile = CLAIMS_STORE.merchant_risk(merchant_id)
    if profile is None:
        raise ApiError(404, "merchant_not_found",
                       f"no claims for merchant {merchant_id!r} in the scored dataset")
    return profile


# ---- signed webhook test-fire ----------------------------------------------------

def _is_safe_webhook_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        if hostname.lower() in ("localhost", "127.0.0.1", "::1", "169.254.169.254"):
            return False
        ip = socket.gethostbyname(hostname)
        addr = ipaddress.ip_address(ip)
        return not (addr.is_private or addr.is_loopback or addr.is_link_local)
    except Exception:
        return False


class WebhookTestIn(BaseModel):
    url: str = Field(min_length=8, max_length=300)


@app.post("/v1/webhooks/test", dependencies=[Depends(auth_guard)])
async def webhook_test(body: WebhookTestIn, request: Request) -> dict:
    if not _is_safe_webhook_url(body.url):
        raise ApiError(
            422,
            "ssrf_protection",
            "webhook destination must resolve to a valid public IP address",
        )
    payload = {
        "topic": "webhook.test",
        "ts": datetime.now(timezone.utc).isoformat(),
        "message": "Ring Sentinel webhook integration check",
        "request_id": getattr(request.state, "request_id", None),
    }
    delivered = _dispatch_webhook(
        {"name": "integration-test", "id": None, "webhook_url": body.url},
        payload,
    )
    return {
        "status": "fired",
        "url": body.url,
        "signature_header": "X-RingSentinel-Signature",
        "signature_format": _sign_webhook(json.dumps(payload).encode()),
        "note": "delivery is asynchronous; check your receiver logs",
        "delivered_probe": delivered,
    }


class DecisionIn(BaseModel):
    claim_id: str = Field(pattern=ID_PATTERN)
    kind: Literal["decision", "note", "investigation", "resolved"] = "decision"
    prev_action: str | None = Field(default=None, max_length=32)
    new_action: str | None = Field(default=None, max_length=32)
    reason: str = Field(min_length=3, max_length=512)


ANALYST_ID_PATTERN = r"^[A-Za-z0-9_.:\-]{1,64}$"


@app.post("/v1/decisions", dependencies=[Depends(auth_guard)])
async def post_decision(body: DecisionIn, request: Request) -> dict:
    actor_raw = request.headers.get("X-Analyst-Id", "ops_anonymous").strip()
    if not re.fullmatch(ANALYST_ID_PATTERN, actor_raw):
        actor_raw = "ops_anonymous"
    if body.kind == "decision":
        if body.new_action not in (ACTION_AUTO_APPROVE, ACTION_STEP_UP, ACTION_HOLD):
            raise ApiError(422, "invalid_action",
                           "new_action must be one of the agreed action vocabulary")
        if body.new_action == ACTION_AUTO_APPROVE and len(body.reason.strip()) < 3:
            raise ApiError(422, "reason_required",
                           "approving a flagged payout requires a written reason")
    if audit is None:
        raise ApiError(503, "audit_unavailable", "audit log not initialised")
    ts = datetime.now(timezone.utc).isoformat()
    audit.insert_analyst(
        ts=ts, actor=actor_raw, claim_id=body.claim_id, kind=body.kind,
        prev_action=body.prev_action, new_action=body.new_action,
        reason=body.reason.strip(),
    )
    METRIC_REQUESTS.labels(endpoint="/v1/decisions", status="200").inc()
    return {"status": "recorded", "claim_id": body.claim_id, "kind": body.kind}


@app.get("/v1/decisions", dependencies=[Depends(auth_guard)])
async def get_decisions(
    request: Request,
    claim_id: str | None = Query(None, max_length=64),
    limit: int = Query(200, ge=1, le=1000),
) -> dict:
    if audit is None:
        return {"items": []}
    return {"items": audit.fetch_analyst(claim_id=claim_id, limit=limit)}


# ---- case workflow: assignment, SLA, notes, bulk actions ---------------------

CASE_STATUSES = ("open", "in_review", "approved", "held", "escalated", "closed")
DEFAULT_SLA_HOURS = {"HIGH": 4, "MEDIUM": 24, "LOW": 72}


def _actor(request: Request) -> str:
    raw = request.headers.get("X-Analyst-Id", "ops_anonymous").strip()
    return raw if re.fullmatch(ANALYST_ID_PATTERN, raw) else "ops_anonymous"


def _case_risk(claim_id: str) -> str:
    detail = CLAIMS_STORE.get_claim(claim_id)
    return detail["risk_level"] if detail else "MEDIUM"


def _get_or_create_case(claim_id: str, risk: str) -> dict:
    rows = audit.query("SELECT * FROM case_state WHERE claim_id=?", (claim_id,))
    if rows:
        return rows[0]
    now = datetime.now(timezone.utc)
    due = now + timedelta(hours=DEFAULT_SLA_HOURS.get(risk, 48))
    audit.execute(
        "INSERT OR IGNORE INTO case_state "
        "(claim_id,status,assigned_to,sla_due_at,updated_ts,updated_by) "
        "VALUES (?,?,?,?,?,?)",
        (claim_id, "open", None, due.isoformat(), now.isoformat(), "system"),
    )
    return audit.query("SELECT * FROM case_state WHERE claim_id=?", (claim_id,))[0]


class CasePatchIn(BaseModel):
    status: Literal["open", "in_review", "approved", "held", "escalated", "closed"] | None = None
    assigned_to: str | None = Field(default=None, max_length=64)
    sla_hours: float | None = Field(default=None, ge=0.25, le=24 * 30)


@app.get("/v1/cases", dependencies=[Depends(auth_guard)])
async def list_cases(request: Request) -> dict:
    if audit is None:
        return {"items": []}
    return {"items": audit.query("SELECT * FROM case_state ORDER BY updated_ts DESC LIMIT 1000")}


@app.get("/v1/case/{claim_id}", dependencies=[Depends(auth_guard)])
async def get_case(request: Request, claim_id: str = FPath(max_length=64)) -> dict:
    if audit is None:
        raise ApiError(503, "audit_unavailable", "audit log not initialised")
    case = _get_or_create_case(claim_id, _case_risk(claim_id))
    notes = audit.query(
        "SELECT * FROM case_notes WHERE claim_id=? ORDER BY id DESC LIMIT 200",
        (claim_id,),
    )
    watch = audit.query("SELECT * FROM watchlist WHERE entity=?", (claim_id,))
    return {"case": case, "notes": notes, "watchlisted": bool(watch)}


@app.patch("/v1/case/{claim_id}", dependencies=[Depends(auth_guard)])
async def patch_case(
    body: CasePatchIn, request: Request, claim_id: str = FPath(max_length=64)
) -> dict:
    if audit is None:
        raise ApiError(503, "audit_unavailable", "audit log not initialised")
    actor = _actor(request)
    case = _get_or_create_case(claim_id, _case_risk(claim_id))
    sets: list[str] = []
    params: list = []
    if body.status is not None:
        sets.append("status=?")
        params.append(body.status)
        audit.insert_analyst(
            ts=datetime.now(timezone.utc).isoformat(), actor=actor,
            claim_id=claim_id, kind="status",
            prev_action=case["status"], new_action=body.status,
            reason=f"case status set to {body.status}",
        )
    if body.assigned_to is not None:
        assignee = body.assigned_to.strip()[:64]
        sets.append("assigned_to=?")
        params.append(assignee or None)
        audit.insert_analyst(
            ts=datetime.now(timezone.utc).isoformat(), actor=actor,
            claim_id=claim_id, kind="assignment",
            prev_action=case["assigned_to"], new_action=assignee or None,
            reason=f"assigned to {assignee}" if assignee else "unassigned",
        )
    if body.sla_hours is not None:
        due = datetime.now(timezone.utc) + timedelta(hours=body.sla_hours)
        sets.append("sla_due_at=?")
        params.append(due.isoformat())
    sets += ["updated_ts=?", "updated_by=?"]
    params += [datetime.now(timezone.utc).isoformat(), actor, claim_id]
    audit.execute(
        f"UPDATE case_state SET {', '.join(sets)} WHERE claim_id=?", tuple(params)
    )
    return {"case": audit.query(
        "SELECT * FROM case_state WHERE claim_id=?", (claim_id,))[0]}


class NoteIn(BaseModel):
    body: str = Field(min_length=2, max_length=2000)


@app.get("/v1/claims/{claim_id}/notes", dependencies=[Depends(auth_guard)])
async def get_notes(request: Request, claim_id: str = FPath(max_length=64)) -> dict:
    if audit is None:
        return {"items": []}
    return {"items": audit.query(
        "SELECT * FROM case_notes WHERE claim_id=? ORDER BY id DESC LIMIT 200",
        (claim_id,),
    )}


@app.post("/v1/claims/{claim_id}/notes", dependencies=[Depends(auth_guard)])
async def post_note(
    body: NoteIn, request: Request, claim_id: str = FPath(max_length=64)
) -> dict:
    if audit is None:
        raise ApiError(503, "audit_unavailable", "audit log not initialised")
    actor = _actor(request)
    rowid = audit.execute(
        "INSERT INTO case_notes (ts,claim_id,actor,body) VALUES (?,?,?,?)",
        (datetime.now(timezone.utc).isoformat(), claim_id, actor, body.body.strip()),
    )
    audit.insert_analyst(
        ts=datetime.now(timezone.utc).isoformat(), actor=actor,
        claim_id=claim_id, kind="note", prev_action=None, new_action=None,
        reason=body.body.strip()[:512],
    )
    return {"status": "recorded", "id": rowid}


class BulkActionIn(BaseModel):
    claim_ids: list[str] = Field(min_length=1, max_length=200)
    action: Literal["approve", "hold", "escalate", "close", "assign"]
    assigned_to: str | None = Field(default=None, max_length=64)
    reason: str = Field(min_length=3, max_length=512)


_BULK_MAP = {
    "approve": ("approved", ACTION_AUTO_APPROVE),
    "hold": ("held", ACTION_HOLD),
    "escalate": ("escalated", ACTION_STEP_UP),
    "close": ("closed", None),
    "assign": (None, None),
}


@app.post("/v1/claims/bulk", dependencies=[Depends(auth_guard)])
async def bulk_action(body: BulkActionIn, request: Request) -> dict:
    if audit is None:
        raise ApiError(503, "audit_unavailable", "audit log not initialised")
    actor = _actor(request)
    now = datetime.now(timezone.utc).isoformat()
    new_status, new_action = _BULK_MAP[body.action]
    if body.action == "assign" and not (body.assigned_to or "").strip():
        raise ApiError(422, "assignee_required",
                       "assigned_to is required for bulk assign")
    changed = 0
    for cid in body.claim_ids:
        if not re.fullmatch(ID_PATTERN, cid):
            continue
        prev_rows = audit.query(
            "SELECT status, assigned_to FROM case_state WHERE claim_id=?", (cid,))
        prev = prev_rows[0] if prev_rows else {"status": None, "assigned_to": None}
        _get_or_create_case(cid, _case_risk(cid))
        sets = ["updated_ts=?", "updated_by=?"]
        params: list = [now, actor]
        if new_status:
            sets.append("status=?")
            params.append(new_status)
        if body.action == "assign":
            sets.append("assigned_to=?")
            params.append(body.assigned_to.strip()[:64])
        params.append(cid)
        audit.execute(
            f"UPDATE case_state SET {', '.join(sets)} WHERE claim_id=?", tuple(params))
        audit.insert_analyst(
            ts=now, actor=actor, claim_id=cid,
            kind="bulk_" + body.action,
            prev_action=prev["status"], new_action=new_status,
            reason=body.reason.strip(),
        )
        changed += 1
    METRIC_REQUESTS.labels(endpoint="/v1/claims/bulk", status="200").inc()
    return {"status": "recorded", "changed": changed}


# ---- watchlist ----------------------------------------------------------------

class WatchIn(BaseModel):
    entity: str = Field(pattern=ID_PATTERN)
    kind: Literal["identity", "infra", "ring"] = "identity"
    reason: str = Field(min_length=3, max_length=280)


@app.get("/v1/watchlist", dependencies=[Depends(auth_guard)])
async def watchlist_list(request: Request) -> dict:
    if audit is None:
        return {"items": []}
    return {"items": audit.query("SELECT * FROM watchlist ORDER BY added_ts DESC LIMIT 500")}


@app.post("/v1/watchlist", dependencies=[Depends(auth_guard)])
async def watchlist_add(body: WatchIn, request: Request) -> dict:
    if audit is None:
        raise ApiError(503, "audit_unavailable", "audit log not initialised")
    actor = _actor(request)
    existing = audit.query("SELECT entity FROM watchlist WHERE entity=?", (body.entity,))
    if existing:
        raise ApiError(409, "already_watchlisted",
                       f"{body.entity!r} is already on the watchlist")
    audit.execute(
        "INSERT INTO watchlist (entity,kind,reason,added_by,added_ts) VALUES (?,?,?,?,?)",
        (body.entity, body.kind, body.reason.strip(), actor,
         datetime.now(timezone.utc).isoformat()),
    )
    audit.insert_analyst(
        ts=datetime.now(timezone.utc).isoformat(), actor=actor,
        claim_id=body.entity, kind="watchlist_add", prev_action=None,
        new_action=body.kind, reason=body.reason.strip(),
    )
    return {"status": "added", "entity": body.entity}


@app.delete("/v1/watchlist/{entity}", dependencies=[Depends(auth_guard)])
async def watchlist_remove(request: Request, entity: str = FPath(max_length=64)) -> dict:
    if audit is None:
        raise ApiError(503, "audit_unavailable", "audit log not initialised")
    audit.execute("DELETE FROM watchlist WHERE entity=?", (entity,))
    return {"status": "removed", "entity": entity}


# ---- alert rules + triggered alerts --------------------------------------------

class AlertRuleIn(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    metric: Literal["min_score", "risk_band", "cluster_burst"]
    threshold: float = Field(default=0, ge=0, le=1_000_000)
    webhook_url: str | None = Field(default=None, max_length=300)


@app.get("/v1/alert-rules", dependencies=[Depends(auth_guard)])
async def alert_rules_list(request: Request) -> dict:
    if audit is None:
        return {"items": []}
    return {"items": audit.query("SELECT * FROM alert_rules ORDER BY id DESC")}


@app.post("/v1/alert-rules", dependencies=[Depends(auth_guard)])
async def alert_rules_add(body: AlertRuleIn, request: Request) -> dict:
    if audit is None:
        raise ApiError(503, "audit_unavailable", "audit log not initialised")
    if body.metric == "min_score" and not 0 <= body.threshold <= 1:
        raise ApiError(422, "invalid_threshold",
                       "min_score threshold must be between 0 and 1")
    rowid = audit.execute(
        "INSERT INTO alert_rules (name,metric,threshold,webhook_url,enabled,created_ts) "
        "VALUES (?,?,?,?,1,?)",
        (body.name.strip(), body.metric, body.threshold,
         (body.webhook_url or "").strip() or None,
         datetime.now(timezone.utc).isoformat()),
    )
    row = audit.query("SELECT * FROM alert_rules WHERE id=?", (rowid,))
    return {"rule": row[0] if row else None}


@app.patch("/v1/alert-rules/{rule_id}", dependencies=[Depends(auth_guard)])
async def alert_rules_toggle(
    request: Request, rule_id: int, enabled: bool = Query(...)
) -> dict:
    if audit is None:
        raise ApiError(503, "audit_unavailable", "audit log not initialised")
    audit.execute("UPDATE alert_rules SET enabled=? WHERE id=?",
                  (int(enabled), rule_id))
    row = audit.query("SELECT * FROM alert_rules WHERE id=?", (rule_id,))
    if not row:
        raise ApiError(404, "rule_not_found", f"no alert rule {rule_id}")
    return {"rule": row[0]}


@app.delete("/v1/alert-rules/{rule_id}", dependencies=[Depends(auth_guard)])
async def alert_rules_delete(request: Request, rule_id: int) -> dict:
    if audit is None:
        raise ApiError(503, "audit_unavailable", "audit log not initialised")
    audit.execute("DELETE FROM alert_rules WHERE id=?", (rule_id,))
    return {"status": "deleted", "id": rule_id}


@app.get("/v1/alerts", dependencies=[Depends(auth_guard)])
async def alert_events(request: Request, limit: int = Query(100, ge=1, le=500)) -> dict:
    if audit is None:
        return {"items": []}
    return {"items": audit.query(
        "SELECT * FROM alert_events ORDER BY id DESC LIMIT ?", (limit,))}


# ---- live stream (Server-Sent Events) -------------------------------------------

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


@app.get("/v1/stream")
async def live_stream(
    request: Request, api_key: str | None = Query(None, max_length=200)
) -> Response:
    # EventSource cannot set custom headers, so the key may arrive as a query param.
    key = api_key or request.headers.get("X-API-Key", "")
    if not any(hmac.compare_digest(key, k) for k in SETTINGS.api_keys):
        raise ApiError(401, "unauthorized", "missing or invalid api key")
    q: _queue.Queue = _queue.Queue(maxsize=500)
    with _subscribers_lock:
        _subscribers.append(q)

    async def gen():
        try:
            yield _sse({"type": "hello",
                        "ts": datetime.now(timezone.utc).isoformat()})
            if audit is not None:
                recent = audit.query(
                    "SELECT ts,claim_id,identity_key,merchant_id,amount,score,action "
                    "FROM decisions WHERE action != 'AUTO_APPROVE' "
                    "ORDER BY id DESC LIMIT 25")
                for row in reversed(recent):
                    row["type"] = "score"
                    row["replay"] = True
                    row["score"] = None if row["score"] is None else float(row["score"])
                    yield _sse(row)
            last_beat = time.monotonic()
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = q.get_nowait()
                    yield _sse(ev)
                except _queue.Empty:
                    pass
                if time.monotonic() - last_beat > 15:
                    yield ": ping\n\n"
                    last_beat = time.monotonic()
                await asyncio.sleep(0.2)
        finally:
            with _subscribers_lock:
                if q in _subscribers:
                    _subscribers.remove(q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---- ops console SPA ---------------------------------------------------------
# Serves frontend/dist (built React app) from this same origin when present,
# so a single uvicorn process runs the entire demo. Added last so all API
# routes above keep precedence.

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@app.get("/models-static/eval_report.json")
def eval_report_artifact() -> Response:
    """Read-only access to the evaluation report consumed by the console.

    Served as an explicit single-file route rather than a directory mount so
    model binaries and hashes stay private.
    """
    path = os.path.join(_REPO_ROOT, "models", "eval_report.json")
    if not os.path.exists(path):
        raise ApiError(404, "report_missing",
                       "run train_eval.py to produce models/eval_report.json")
    return FileResponse(path, media_type="application/json")


@app.get("/models-static/gnn_report.json")
def gnn_report_artifact() -> Response:
    """GNN benchmark report produced by train_gnn.py (optional artifact)."""
    path = os.path.join(_REPO_ROOT, "models", "gnn_report.json")
    if not os.path.exists(path):
        raise ApiError(404, "report_missing",
                       "run train_gnn.py to produce models/gnn_report.json")
    return FileResponse(path, media_type="application/json")


_DASHBOARD_DIR = os.path.join(_REPO_ROOT, "dashboard")
if os.path.isdir(_DASHBOARD_DIR):

    @app.get("/dashboard/{asset_path:path}", include_in_schema=False)
    async def legacy_dashboard(asset_path: str) -> Response:
        """Serve the original zero-dependency static report (Track D build)."""
        candidate = os.path.normpath(os.path.join(_DASHBOARD_DIR, asset_path))
        if (
            candidate.startswith(os.path.normpath(_DASHBOARD_DIR))
            and os.path.isfile(candidate)
        ):
            return FileResponse(candidate)
        raise ApiError(404, "not_found", f"no such dashboard asset {asset_path!r}")


_DIST_DIR = os.path.join(_REPO_ROOT, "frontend", "dist")
_DIST_INDEX = os.path.join(_DIST_DIR, "index.html")
if os.path.isfile(_DIST_INDEX):

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> Response:
        """Serve built console assets, falling back to index.html for
        client-side routes like /claims/{id}. Registered after every API
        route so the JSON surface keeps precedence."""
        candidate = os.path.normpath(os.path.join(_DIST_DIR, full_path))
        if (
            full_path
            and candidate.startswith(os.path.normpath(_DIST_DIR))
            and os.path.isfile(candidate)
        ):
            return FileResponse(candidate)
        return FileResponse(_DIST_INDEX)

    log.info("ops console served from %s", _DIST_DIR)
