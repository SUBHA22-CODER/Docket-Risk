"""Ring Sentinel — Track B: bipartite graph, identity projection, and
temporally-safe claim feature engineering.

Causal rule: a claim's features may only see orders ingested strictly before
the claim's own timestamp, and a claim is recorded into history only AFTER its
own features are computed.
"""

from __future__ import annotations

import argparse
import os
from collections import defaultdict

import networkx as nx
import numpy as np
import pandas as pd

INFRA_COLS = ["device_id", "vpa_id", "phone_id", "address_id", "card_id"]
INFRA_PREFIXES = ("dev_", "vpa_", "ph_", "adr_", "card_")

NEUTRAL_APPROVAL_RATIO = 0.62
BURST_WINDOW_DAYS = 7

FEATURE_ORDER = [
    "identity_order_count_so_far",
    "identity_merchant_count_so_far",
    "identity_claim_count_so_far",
    "identity_claim_approval_ratio_so_far",
    "shared_infra_neighbor_count",
    "cluster_size",
    "cluster_merchant_span",
    "cluster_claim_burst_7d",
    "reason_text_reuse_flag",
    "amount",
]

GRAPH_DENSITY_FEATURES = [
    "shared_infra_neighbor_count",
    "cluster_size",
    "cluster_merchant_span",
    "cluster_claim_burst_7d",
    "reason_text_reuse_flag",
]


def build_full_graph(orders: pd.DataFrame) -> nx.Graph:
    G = nx.Graph()
    for row in orders.itertuples(index=False):
        ident = row.identity_key
        G.add_node(ident, kind="ident")
        for col in INFRA_COLS:
            infra = getattr(row, col)
            G.add_node(infra, kind="infra")
            G.add_edge(ident, infra, merchant=row.merchant_id)
    return G


def identity_projection(G: nx.Graph) -> nx.Graph:
    P = nx.Graph()
    for infra in [n for n, d in G.nodes(data=True) if d.get("kind") == "infra"]:
        idents = [m for m in G.neighbors(infra) if G.nodes[m].get("kind") == "ident"]
        for i in range(len(idents)):
            for k in range(i + 1, len(idents)):
                a, b = idents[i], idents[k]
                if P.has_edge(a, b):
                    P[a][b]["merchants"].add(G[idents[i]][infra]["merchant"])
                else:
                    P.add_edge(a, b, merchants={G[a][infra]["merchant"]})
    return P


class ClusterState:
    """Union-find over identity+infra nodes with per-cluster aggregates.

    Mirrors (must stay logically identical to) GraphState in score_service.py;
    this batch version is the offline replay used for training features. In
    production the live state would be Redis-backed.
    """

    def __init__(self) -> None:
        self.parent: dict[str, str] = {}
        self.members: dict[str, set[str]] = defaultdict(set)
        self.cluster_merchants: dict[str, set[str]] = defaultdict(set)
        self.cluster_claims: dict[str, list[tuple[pd.Timestamp, str]]] = defaultdict(list)
        self.identity_order_counts: dict[str, int] = defaultdict(int)
        self.identity_merchant_sets: dict[str, set[str]] = defaultdict(set)
        self.identity_claim_stats: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        self.reason_users: dict[str, set[str]] = defaultdict(set)

    def ensure(self, node: str) -> None:
        if node not in self.parent:
            self.parent[node] = node
            root = node
            if not node.startswith(INFRA_PREFIXES):
                self.members[root].add(node)

    def find(self, x: str) -> str:
        parent = self.parent
        r = x
        while parent[r] != r:
            r = parent[r]
        while parent[x] != r:
            parent[x], x = r, parent[x]
        return r

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if len(self.members[ra]) < len(self.members[rb]):
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.members[ra] |= self.members.pop(rb, set())
        self.cluster_merchants[ra] |= self.cluster_merchants.pop(rb, set())
        self.cluster_claims[ra].extend(self.cluster_claims.pop(rb, []))

    def ingest_order(
        self,
        identity_key: str,
        infra_ids: list[str],
        merchant_id: str,
    ) -> None:
        self.ensure(identity_key)
        for n in infra_ids:
            self.ensure(n)
            self.union(identity_key, n)
        self.identity_order_counts[identity_key] += 1
        self.identity_merchant_sets[identity_key].add(merchant_id)
        self.cluster_merchants[self.find(identity_key)].add(merchant_id)

    def compute_features(self, claim_ts: pd.Timestamp, identity_key: str,
                         amount: float, reason_text: str) -> dict:
        prior_claims, approved_sum = self.identity_claim_stats.get(
            identity_key, [0, 0]
        )
        approval_ratio = (
            approved_sum / prior_claims
            if prior_claims > 0
            else NEUTRAL_APPROVAL_RATIO
        )
        root = self.find(identity_key)
        cluster = self.members[root]
        window_start = claim_ts - pd.Timedelta(days=BURST_WINDOW_DAYS)
        burst = sum(
            1
            for ts, who in self.cluster_claims[root]
            if who != identity_key and window_start <= ts <= claim_ts
        )
        reuse = int(
            any(u != identity_key for u in self.reason_users.get(reason_text, ()))
        )
        return {
            "identity_order_count_so_far": self.identity_order_counts[identity_key],
            "identity_merchant_count_so_far": len(self.identity_merchant_sets[identity_key]),
            "identity_claim_count_so_far": prior_claims,
            "identity_claim_approval_ratio_so_far": approval_ratio,
            "shared_infra_neighbor_count": max(len(cluster) - 1, 0),
            "cluster_size": len(cluster),
            "cluster_merchant_span": len(self.cluster_merchants[root]),
            "cluster_claim_burst_7d": burst,
            "reason_text_reuse_flag": reuse,
            "amount": float(amount),
        }

    def record_claim(self, claim_ts: pd.Timestamp, identity_key: str,
                     approved: int, reason_text: str) -> None:
        root = self.find(identity_key)
        self.cluster_claims[root].append((claim_ts, identity_key))
        stats = self.identity_claim_stats[identity_key]
        stats[0] += 1
        stats[1] += int(approved)
        self.reason_users[reason_text].add(identity_key)


def compute_claim_features(orders: pd.DataFrame, claims: pd.DataFrame) -> pd.DataFrame:
    orders_sorted = orders.sort_values("order_ts", kind="stable").reset_index(drop=True)
    claims_sorted = claims.sort_values("claim_ts", kind="stable").reset_index(drop=True)

    state = ClusterState()
    j = 0
    n_orders = len(orders_sorted)
    ord_ts = orders_sorted["order_ts"].to_numpy()
    ord_ik = orders_sorted["identity_key"].to_numpy()
    ord_infra = orders_sorted[INFRA_COLS].to_numpy()
    ord_merch = orders_sorted["merchant_id"].to_numpy()
    rows: list[dict] = []

    for claim in claims_sorted.itertuples(index=False):
        while j < n_orders and ord_ts[j] < claim.claim_ts:
            state.ingest_order(
                str(ord_ik[j]),
                [str(x) for x in ord_infra[j]],
                str(ord_merch[j]),
            )
            j += 1
        feats = state.compute_features(claim.claim_ts, claim.identity_key,
                                       claim.amount, claim.reason_text)
        rows.append(feats)
        state.record_claim(claim.claim_ts, claim.identity_key,
                           claim.is_approved, claim.reason_text)

    out = claims_sorted.copy()
    for col in FEATURE_ORDER:
        out[col] = [r[col] for r in rows]
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default="data/")
    args = parser.parse_args()

    orders = pd.read_parquet(os.path.join(args.data_dir, "orders.parquet"))
    claims = pd.read_parquet(os.path.join(args.data_dir, "claims.parquet"))

    print("B.1 building full bipartite graph...")
    G = build_full_graph(orders)
    P = identity_projection(G)
    ring_members = sorted(
        {c for c in claims.loc[claims["is_ring_label"] == 1, "identity_key"].unique()}
    )[:5]
    same_component = all(
        nx.has_path(P, ring_members[0], m) for m in ring_members[1:] if P.has_node(m)
    )
    identities_df = pd.read_parquet(os.path.join(args.data_dir, "identities.parquet"))
    pure_legit = identities_df.loc[
        (identities_df["is_ring"] == 0) & (identities_df["is_camouflage"] == 0),
        "identity_key",
    ]
    rng = np.random.default_rng(0)
    sample = list(rng.choice(pure_legit.to_numpy(), size=min(1000, len(pure_legit)), replace=False))
    in_projection = [c for c in sample if c in P]
    print(f"  graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
    print(f"  projection: {P.number_of_nodes()} nodes, {P.number_of_edges()} edges")
    print(f"  B.1 check — sample ring members connected: {same_component}")
    print(f"  B.1 check — legit identities appearing in projection: "
          f"{len(in_projection)}/{len(sample)} "
          f"(expected small — these are camouflage donors)")

    print("B.2 computing temporally-safe claim features...")
    feats = compute_claim_features(orders, claims)
    summary = feats.groupby("is_ring_label")["shared_infra_neighbor_count"].mean()
    legit_mean = float(summary.get(0, 0.0))
    ring_mean = float(summary.get(1, 0.0))
    ratio = ring_mean / legit_mean if legit_mean > 0 else float("inf")
    print(f"  mean shared_infra_neighbor_count: legit={legit_mean:.4f} "
          f"ring={ring_mean:.4f} ratio={ratio:.1f}x")
    ok = ring_mean >= 10 * max(legit_mean, 1e-9)
    print(f"  B.2 acceptance: {'OK' if ok else 'FAIL'} "
          f"(ring should be >=10x legit)")

    out_path = os.path.join(args.data_dir, "claims_with_features.parquet")
    feats.to_parquet(out_path, index=False)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
