"""Ring Sentinel — Track B: temporal-split training, honest evaluation,
and the monotonicity sanity test (B.5) that gates wiring into the API.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import (
    auc,
    precision_recall_curve,
    roc_auc_score,
)

try:
    from src.graph_features import FEATURE_ORDER, GRAPH_DENSITY_FEATURES
except ImportError:  # direct-script execution from src/
    from graph_features import (  # type: ignore[no-redef, import-not-found]
        FEATURE_ORDER,
        GRAPH_DENSITY_FEATURES,
    )

try:
    from src.config import load_settings
except ImportError:  # direct-script execution from src/
    from config import load_settings  # type: ignore[no-redef, import-not-found]

_SETTINGS = load_settings()
VAL_START = pd.Timestamp("2026-05-01")
TEST_START = pd.Timestamp("2026-06-01")
HIGH_THRESHOLD = _SETTINGS.high_threshold
MEDIUM_THRESHOLD = _SETTINGS.medium_threshold


def calibration_metrics(y_true: np.ndarray, scores: np.ndarray,
                        n_bins: int = 10) -> dict:
    brier = float(np.mean((scores - y_true) ** 2))
    bins = np.clip((scores * n_bins).astype(int), 0, n_bins - 1)
    ece = 0.0
    for b in range(n_bins):
        mask = bins == b
        if mask.sum() == 0:
            continue
        ece += (mask.mean()) * abs(float(y_true[mask].mean()) - float(scores[mask].mean()))
    return {"brier": round(brier, 6), "ece_10bin": round(ece, 6)}


def write_model_artifacts(model_path: str, meta: dict) -> None:
    h = hashlib.sha256()
    with open(model_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    sha = h.hexdigest()
    with open(model_path + ".sha256", "w") as fh:
        fh.write(f"{sha}  {os.path.basename(model_path)}\n")
    commit = None
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], text=True
        ).strip()
    except Exception as exc:  # noqa: BLE001 — metadata is best-effort
        print(f"note: could not read git commit for model metadata: {exc}")
    payload = {"sha256": sha, **meta, "git_commit": commit}
    with open(os.path.join(os.path.dirname(model_path), "model_meta.json"), "w") as fh:
        json.dump(payload, fh, indent=2)
    print(f"wrote {model_path}.sha256 and model_meta.json (sha256={sha[:12]})")


def temporal_split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    train = df[df["claim_ts"] < VAL_START]
    val = df[(df["claim_ts"] >= VAL_START) & (df["claim_ts"] < TEST_START)]
    test = df[df["claim_ts"] >= TEST_START]
    return train, val, test


def monotone_constraint_vector() -> str:
    return "(" + ",".join(
        "1" if f in GRAPH_DENSITY_FEATURES else "0" for f in FEATURE_ORDER
    ) + ")"


def train_model(
    train: pd.DataFrame, val: pd.DataFrame
) -> xgb.XGBClassifier:
    X_tr = train[FEATURE_ORDER]
    y_tr = train["is_ring_label"]
    X_va = val[FEATURE_ORDER]
    y_va = val["is_ring_label"]
    spw = float((y_tr == 0).sum()) / max(float((y_tr == 1).sum()), 1.0)
    model = xgb.XGBClassifier(
        n_estimators=800,
        max_depth=3,
        learning_rate=0.06,
        subsample=0.9,
        colsample_bytree=0.9,
        min_child_weight=10,
        scale_pos_weight=spw,
        eval_metric="aucpr",
        monotone_constraints=monotone_constraint_vector(),
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_tr, y_tr, eval_set=[(X_va, y_va)], verbose=False)
    return model


def band_metrics(y_true: np.ndarray, scores: np.ndarray, threshold: float) -> dict:
    flagged = scores >= threshold
    tp = int(((flagged) & (y_true == 1)).sum())
    fp = int(((flagged) & (y_true == 0)).sum())
    if tp + fp > 0:
        precision = tp / (tp + fp)
    else:
        precision = 0.0
    recall = tp / max(int((y_true == 1).sum()), 1)
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision + recall > 0
        else 0.0
    )
    return {
        "threshold": threshold,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "flagged": int(flagged.sum()),
        "true_positives": tp,
        "false_positives": fp,
    }


def _decimate_curve(
    precision: np.ndarray, recall: np.ndarray, max_points: int = 150
) -> list[list[float]]:
    """Downsample a PR curve to at most max_points [recall, precision] pairs,
    ordered by ascending recall, for embedding in eval_report.json."""
    n = len(precision)
    idx = np.unique(np.linspace(0, n - 1, min(max_points, n)).astype(int))
    pairs = sorted(
        (float(r), float(p)) for r, p in zip(recall[idx], precision[idx])
    )
    return [[round(r, 4), round(p, 4)] for r, p in pairs]


def evaluate(model: xgb.XGBClassifier, test: pd.DataFrame) -> dict:
    X_te = test[FEATURE_ORDER]
    y_te = test["is_ring_label"].to_numpy()
    scores = model.predict_proba(X_te)[:, 1]

    pr_precision, pr_recall, _ = precision_recall_curve(y_te, scores)
    pr_auc = float(auc(pr_recall, pr_precision))
    roc_auc = float(roc_auc_score(y_te, scores))
    base_rate = float(y_te.mean())

    sweep = [
        {"band": "HIGH", **band_metrics(y_te, scores, HIGH_THRESHOLD)},
        {"band": "MEDIUM", **band_metrics(y_te, scores, MEDIUM_THRESHOLD)},
    ]

    high_flag = scores >= HIGH_THRESHOLD
    inr_prevented = float(test.loc[high_flag & (test["is_ring_label"] == 1), "amount"].sum())
    inr_friction_cost = float(test.loc[high_flag & (test["is_ring_label"] == 0), "amount"].sum())

    camo = test["identity_key"].str.startswith("CAMO_").to_numpy()
    camo_n = int(camo.sum())
    camo_fp_high = float((scores[camo] >= HIGH_THRESHOLD).mean()) if camo_n else 0.0
    camo_fp_medium = float((scores[camo] >= MEDIUM_THRESHOLD).mean()) if camo_n else 0.0

    importances = sorted(
        zip(FEATURE_ORDER, (float(x) for x in model.feature_importances_)),
        key=lambda kv: kv[1],
        reverse=True,
    )

    return {
        "pr_auc": pr_auc,
        "roc_auc": roc_auc,
        "base_rate": base_rate,
        "n_test_claims": len(test),
        "n_test_ring_claims": int(y_te.sum()),
        "calibration": calibration_metrics(y_te, scores),
        "pr_curve": {
            "points": _decimate_curve(pr_precision, pr_recall),
            "baseline": round(base_rate, 4),
        },
        "threshold_sweep": sweep,
        "monetary": {
            "inr_prevented": round(inr_prevented, 2),
            "inr_friction_cost": round(inr_friction_cost, 2),
        },
        "camouflage": {
            "n_claims": camo_n,
            "false_flag_rate_high": round(camo_fp_high, 4),
            "false_flag_rate_medium": round(camo_fp_medium, 4),
        },
        "feature_importance": [
            {"feature": f, "importance": round(v, 4)} for f, v in importances
        ],
        "_scores": scores,
    }


def monotonicity_sanity(model: xgb.XGBClassifier, max_cluster_size: int) -> bool:
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
    sizes = list(range(2, max_cluster_size + 1))
    rows = []
    for s in sizes:
        r = dict(base)
        r["cluster_size"] = s
        r["shared_infra_neighbor_count"] = s - 1
        rows.append(r)
    sweep_df = pd.DataFrame(rows)[FEATURE_ORDER]
    scores = model.predict_proba(sweep_df)[:, 1]
    print("B.5 monotonicity sweep (cluster_size -> score):")
    for s, sc in zip(sizes, scores):
        bar = "#" * int(sc * 40)
        print(f"  cluster_size={s:3d}  score={sc:.4f} {bar}")
    violations = int((np.diff(scores) < -1e-9).sum())
    coupled_ok = bool((np.diff(scores) >= -1e-9).all())
    print(f"  violations: {violations} "
          f"({'OK' if coupled_ok else 'FAIL'} — must be monotonically non-decreasing)")
    return coupled_ok


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default="data/")
    parser.add_argument("--models-dir", default="models/")
    parser.add_argument("--eval-dir", default="eval/")
    args = parser.parse_args()

    feats = pd.read_parquet(os.path.join(args.data_dir, "claims_with_features.parquet"))
    train, val, test = temporal_split(feats)
    print(f"split sizes: train={len(train)} ({int(train['is_ring_label'].sum())} ring) "
          f"val={len(val)} ({int(val['is_ring_label'].sum())} ring) "
          f"test={len(test)} ({int(test['is_ring_label'].sum())} ring)")

    model = train_model(train, val)
    os.makedirs(args.models_dir, exist_ok=True)
    model_path = os.path.join(args.models_dir, "ring_sentinel_xgb.json")
    model.save_model(model_path)
    print(f"saved {model_path} (best_iteration={getattr(model, 'best_iteration', '?')})")

    print("B.3 feature importance (top 10):")
    ranked = sorted(zip(FEATURE_ORDER, model.feature_importances_),
                    key=lambda kv: kv[1], reverse=True)
    for f, v in ranked[:10]:
        print(f"  {f}: {v:.4f}")

    ok = monotonicity_sanity(model, int(train["cluster_size"].max()))
    if not ok:
        raise SystemExit("B.5 FAIL: model not monotonic in cluster_size — do not wire into API")

    report = evaluate(model, test)
    scores = report.pop("_scores")

    write_model_artifacts(
        model_path,
        {
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "n_train": len(train),
            "n_val": len(val),
            "pr_auc_test": round(report["pr_auc"], 6),
        },
    )

    top_features = [f for f, _ in ranked[:3]]
    print("B.4 results:")
    print(f"  PR-AUC={report['pr_auc']:.4f} (base rate={report['base_rate']:.4f}) "
          f"ROC-AUC={report['roc_auc']:.4f}")
    cal = report["calibration"]
    print(f"  calibration: Brier={cal['brier']:.4f} ECE(10bin)={cal['ece_10bin']:.4f}")
    for row in report["threshold_sweep"]:
        print(f"  [{row['band']}] thr={row['threshold']} P={row['precision']:.3f} "
              f"R={row['recall']:.3f} F1={row['f1']:.3f} flagged={row['flagged']}")
    print(f"  ₹ prevented={report['monetary']['inr_prevented']:,.0f} "
          f"₹ friction cost={report['monetary']['inr_friction_cost']:,.0f}")
    camo = report["camouflage"]
    print(f"  camouflage cohort: n={camo['n_claims']} "
          f"false-flag@HIGH={camo['false_flag_rate_high']:.2%} "
          f"false-flag@MEDIUM={camo['false_flag_rate_medium']:.2%}")

    scored = test.copy()
    scored["score"] = scores
    scored.to_parquet(os.path.join(args.data_dir, "test_claims_scored.parquet"), index=False)

    fig, ax = plt.subplots(figsize=(7, 5))
    prec, rec, _ = precision_recall_curve(test["is_ring_label"], scores)
    ax.plot(rec, prec, lw=2)
    ax.axhline(report["base_rate"], ls="--", c="gray", label=f"base rate {report['base_rate']:.3f}")
    ax.set_xlabel("Recall")
    ax.set_ylabel("Precision")
    ax.set_title(f"Ring Sentinel — PR curve (PR-AUC {report['pr_auc']:.3f})")
    ax.legend()
    os.makedirs(args.eval_dir, exist_ok=True)
    fig.savefig(os.path.join(args.eval_dir, "pr_curve.png"), dpi=150)
    plt.close(fig)

    final_report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_file": model_path.replace("\\", "/"),
        "split": {
            "train": "2026-01-01..2026-04-30",
            "val": "2026-05-01..2026-05-31",
            "test": "2026-06-01..2026-06-30",
        },
        **{k: v for k, v in report.items() if k != "feature_importance"},
        "feature_importance": [
            {"feature": f, "importance": round(float(v), 4)} for f, v in ranked
        ],
    }
    with open(os.path.join(args.models_dir, "eval_report.json"), "w") as fh:
        json.dump(final_report, fh, indent=2)

    camo_fp_high = final_report["camouflage"]["false_flag_rate_high"]
    print(f"B.4 acceptance: camouflage false-flag@HIGH {'OK' if camo_fp_high <= 0.05 else 'FAIL'}"
          f" (<5%) ; graph features at top: "
          f"{'YES' if any(f in GRAPH_DENSITY_FEATURES for f in top_features[:2]) else 'CHECK'}")


if __name__ == "__main__":
    main()
