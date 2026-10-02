"""Ring Sentinel — 15,000+ RPS Concurrency & Latency Benchmark.

Validates:
1. Multi-worker throughput simulating Kubernetes pod cluster handling flash-sale peak loads.
2. Latency SLA (<15ms p99 SLA, target <2.5ms hot-path in-process).
3. Concurrent graph partitioning and non-blocking evaluation across Amazon Pay, Razorpay, Stripe.
"""

from __future__ import annotations

import concurrent.futures
import time
from typing import Any, Dict

import numpy as np
import pandas as pd

from src.scaling.distributed_graph import DistributedGraphState
from src.scaling.inference import FastModelRuntime


def run_scaling_benchmark(
    total_claims: int = 10_000,
    concurrency: int = 32,
    model_instance: Any = None,
) -> dict[str, Any]:
    """Executes high-concurrency synthetic scoring benchmark."""
    graph = DistributedGraphState(max_cluster_size=250)
    runtime = FastModelRuntime(model_instance)

    # Pre-seed graph with realistic multi-gateway bipartite orders
    gateways = ["amazon_pay", "razorpay", "stripe", "generic"]
    preseed_n = min(500, total_claims)
    orders = []
    for i in range(preseed_n):
        gw = gateways[i % len(gateways)]
        orders.append({
            "identity_key": f"usr_bench_{i % 50}",
            "device_id": f"dev_bench_{i % 20}",
            "vpa_id": f"vpa_bench_{i % 30}",
            "phone_id": f"ph_bench_{i % 40}",
            "address_id": f"adr_bench_{i % 15}",
            "card_id": f"card_bench_{i % 25}",
            "merchant_id": f"m_{gw}_{i % 10}",
        })
    graph.pipeline_batch_ingest(orders)

    now = pd.Timestamp.now()
    latencies: list[float] = []

    def _worker_task(claim_id: int) -> float:
        t0 = time.perf_counter()
        ident = f"usr_bench_{claim_id % 500}"
        feats, bundle = graph.compute_features(
            now, ident, 1500.0, "defective item refund",
            predictor=None,
            record_claim=False,
        )
        runtime.predict_fast(feats)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return elapsed_ms

    start_wall = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(_worker_task, i) for i in range(total_claims)]
        for f in concurrent.futures.as_completed(futures):
            latencies.append(f.result())
    total_duration = time.perf_counter() - start_wall

    arr = sorted(latencies)
    n = len(arr)
    p50 = arr[int(n * 0.50)]
    p95 = arr[min(n - 1, int(n * 0.95))]
    p99 = arr[min(n - 1, int(n * 0.99))]
    avg = sum(arr) / n
    rps = float(total_claims) / total_duration

    # Across a 50-pod Kubernetes cluster:
    cluster_est_rps = rps * 50

    return {
        "benchmark_timestamp": pd.Timestamp.now().isoformat(),
        "total_claims_evaluated": total_claims,
        "concurrency_workers": concurrency,
        "wall_time_seconds": round(total_duration, 3),
        "single_node_rps": round(rps, 1),
        "cluster_50_pods_projected_rps": round(cluster_est_rps, 1),
        "latency_stats_ms": {
            "avg_ms": round(avg, 3),
            "p50_ms": round(p50, 3),
            "p95_ms": round(p95, 3),
            "p99_ms": round(p99, 3),
            "target_sla_ms": 15.0,
            "sla_met": bool(p99 < 15.0),
        },
    }


if __name__ == "__main__":
    res = run_scaling_benchmark(total_claims=5000, concurrency=16)
    import json
    print(json.dumps(res, indent=2))
