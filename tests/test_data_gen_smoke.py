"""Smoke test for the data generator on a small population."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

import src.data_gen as dg


def test_small_population_generator_produces_all_cohorts(monkeypatch):
    monkeypatch.setattr(dg, "N_LEGIT", 2_000)
    monkeypatch.setattr(dg, "N_CAMOUFLAGE", 80)
    monkeypatch.setattr(dg, "N_RING_IDENTITIES", 90)
    monkeypatch.setattr(dg, "N_RINGS", 12)
    monkeypatch.setattr(dg, "MERCHANT_POOL_SIZE", 300)

    rng = np.random.default_rng(42)
    identities = dg.gen_identities(rng)
    n_legit = sum(1 for i in identities if not i.is_ring and not i.is_camouflage)
    n_camo = sum(1 for i in identities if i.is_camouflage)
    n_ring = sum(1 for i in identities if i.is_ring)
    assert (n_legit, n_camo, n_ring) == (2_000, 80, 90)

    merchant_categories = rng.choice(
        len(dg.CATEGORY_CLAIM_RATE), size=dg.MERCHANT_POOL_SIZE,
        p=dg.CATEGORY_WEIGHTS,
    )
    orders_df, claims_df = dg.gen_orders_and_claims(
        identities, merchant_categories, rng, 0.22
    )
    assert len(orders_df) > 0 and len(claims_df) > 0

    pos_rate = float(claims_df["is_ring_label"].mean())
    assert 0.001 < pos_rate < 0.15, f"positive rate {pos_rate:.2%} out of range"

    ring_share = n_ring / len(identities)
    assert 0.02 <= ring_share <= 0.05

    camo_keys = {i.identity_key for i in identities if i.is_camouflage}
    assert all(k.startswith("CAMO_") for k in camo_keys)
