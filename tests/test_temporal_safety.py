"""Temporal-safety regression test: a claim's features must only see orders
that existed strictly BEFORE the claim's timestamp."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.graph_features import compute_claim_features


def test_claim_never_sees_future_edges():
    t_order_a = pd.Timestamp("2026-06-01T00:00:00Z")
    t_claim = pd.Timestamp("2026-06-02T00:00:00Z")
    t_order_b_late = pd.Timestamp("2026-06-03T00:00:00Z")  # AFTER the claim

    orders = pd.DataFrame([
        {   # identity A's own order
            "order_id": "O1", "identity_key": "A", "merchant_id": "M1",
            "device_id": "dev_1", "vpa_id": "vpa_1", "phone_id": "ph_1",
            "address_id": "adr_1", "card_id": "card_1",
            "order_ts": t_order_a, "amount": 100.0, "category_idx": 0,
            "is_ring_order": 0,
        },
        {   # identity B shares A's device — but only LATER
            "order_id": "O2", "identity_key": "B", "merchant_id": "M2",
            "device_id": "dev_1", "vpa_id": "vpa_2", "phone_id": "ph_2",
            "address_id": "adr_2", "card_id": "card_2",
            "order_ts": t_order_b_late, "amount": 100.0, "category_idx": 0,
            "is_ring_order": 0,
        },
    ])
    claims = pd.DataFrame([
        {
            "claim_id": "C1", "order_id": "O1", "identity_key": "A",
            "merchant_id": "M1", "category": "ELECTRONICS",
            "claim_ts": t_claim, "amount": 100.0,
            "reason_text": "Item did not fit", "is_approved": 1,
            "is_ring_label": 0,
        }
    ])

    out = compute_claim_features(orders, claims)
    row = out.iloc[0]
    assert row["shared_infra_neighbor_count"] == 0, (
        "leakage: claim saw a graph edge formed after its own timestamp"
    )
    assert row["cluster_size"] == 1

    # control: if B's order precedes the claim, the edge MUST be visible
    orders.loc[orders["order_id"] == "O2", "order_ts"] = pd.Timestamp(
        "2026-06-01T12:00:00Z"
    )
    out2 = compute_claim_features(orders, claims)
    assert out2.iloc[0]["shared_infra_neighbor_count"] == 1
