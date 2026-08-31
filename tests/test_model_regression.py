"""Regression gate: the committed model artifact must be monotonically
non-decreasing in cluster_size (guide Task B.5)."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

import xgboost as xgb

from src.graph_features import FEATURE_ORDER
from src.train_eval import monotonicity_sanity

MODEL_PATH = REPO_ROOT / "models" / "ring_sentinel_xgb.json"


def test_committed_model_monotonic_in_cluster_size():
    assert MODEL_PATH.exists(), "model artifact missing — run train_eval.py first"
    model = xgb.XGBClassifier()
    model.load_model(str(MODEL_PATH))
    max_cluster = int(pd.read_parquet(REPO_ROOT / "data" / "claims_with_features.parquet")[
        "cluster_size"
    ].max()) if (REPO_ROOT / "data" / "claims_with_features.parquet").exists() else 14
    ok = monotonicity_sanity(model, max_cluster)
    assert ok, "model regressed: not monotonic in cluster_size"


def test_sweep_scores_never_decrease():
    model = xgb.XGBClassifier()
    model.load_model(str(MODEL_PATH))
    base = {
        "identity_order_count_so_far": 3,
        "identity_merchant_count_so_far": 2,
        "identity_claim_count_so_far": 1,
        "identity_claim_approval_ratio_so_far": 0.62,
        "shared_infra_neighbor_count": 1,
        "cluster_size": 2,
        "cluster_merchant_span": 2,
        "cluster_claim_burst_7d": 0,
        "reason_text_reuse_flag": 0,
        "amount": 3000.0,
    }
    rows = []
    for s in range(2, 15):
        r = dict(base)
        r["cluster_size"] = s
        r["shared_infra_neighbor_count"] = s - 1
        rows.append(r)
    scores = model.predict_proba(pd.DataFrame(rows)[FEATURE_ORDER])[:, 1]
    assert (np.diff(scores) >= -1e-9).all()
