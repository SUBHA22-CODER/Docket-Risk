"""Parity test: batch ClusterState vs live GraphState MUST produce identical
features on the same event stream. This is the training/serving-skew guard."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.graph_features import FEATURE_ORDER, ClusterState


def test_batch_and_serving_features_are_identical(fresh_state):
    rng = np.random.default_rng(7)
    n_idents = 40

    idents = [f"USR_{i:04d}" for i in range(n_idents)]
    devices = [f"dev_{i:03d}" for i in range(10)]
    vpas = [f"vpa_{i:03d}" for i in range(10)]

    events: list[dict] = []
    t0 = pd.Timestamp("2026-06-01T00:00:00Z")
    for i in range(300):
        ident = idents[int(rng.integers(0, n_idents))]
        dev = devices[int(rng.integers(0, 4 if i % 5 == 0 else 10))]
        vpa = vpas[int(rng.integers(0, 3 if i % 7 == 0 else 10))]
        ts = t0 + pd.Timedelta(minutes=int(i * 17 + rng.integers(0, 10)))
        events.append({
            "kind": "order",
            "identity_key": ident,
            "device_id": dev,
            "vpa_id": vpa,
            "merchant_id": f"MRC_{int(rng.integers(0, 50)):03d}",
            "ts": ts,
        })

    claims = []
    for i in range(80):
        src = events[int(rng.integers(0, len(events)))]
        ts = src["ts"] + pd.Timedelta(days=int(rng.integers(1, 9)))
        claims.append({
            "claim_id": f"CLM_{i:04d}",
            "identity_key": src["identity_key"],
            "amount": float(rng.uniform(200, 20000)),
            "reason_text": str(
                ["Item did not fit", "Item never arrived at my address"][i % 2]
            ),
            "approved": bool(i % 3 == 0),
            "claim_ts": ts,
        })
    claims.sort(key=lambda c: c["claim_ts"])

    batch = ClusterState()
    live = fresh_state

    order_rows = sorted([e for e in events], key=lambda e: e["ts"])
    oi = 0
    infra_cols = ["device_id", "vpa_id"]

    for claim in claims:
        while oi < len(order_rows) and order_rows[oi]["ts"] < claim["claim_ts"]:
            e = order_rows[oi]
            batch.ingest_order(e["identity_key"], [e[c] for c in infra_cols],
                               e["merchant_id"])
            live.ingest_order(e["identity_key"], [e[c] for c in infra_cols],
                              e["merchant_id"])
            oi += 1
        feats_batch = batch.compute_features(
            claim["claim_ts"], claim["identity_key"],
            claim["amount"], claim["reason_text"],
        )
        feats_live, _bundle = live.compute_features(
            claim["claim_ts"], claim["identity_key"],
            claim["amount"], claim["reason_text"],
            predictor=None,
            record_claim=True,
            approved=claim["approved"],
        )
        batch.record_claim(claim["claim_ts"], claim["identity_key"],
                           int(claim["approved"]), claim["reason_text"])
        for col in FEATURE_ORDER:
            b = feats_batch[col]
            l = feats_live[col]
            same = (
                math.isclose(float(b), float(l), rel_tol=1e-12, abs_tol=1e-12)
                if isinstance(b, (int, float)) and isinstance(l, (int, float))
                else b == l
            )
            assert same, (
                f"skew on {col} for {claim['claim_id']}: batch={b} live={l}"
            )
