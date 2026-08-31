"""Ring Sentinel — Track D: self-contained ops dashboard builder.

Reads models/eval_report.json, eval/pr_curve.png, and the scored test set,
reconstructs one flagged cluster's evidence graph, and writes a single
dashboard/index.html that opens directly in a browser with no server
(styles inline, vis-network from CDN, PR curve embedded as a data URI).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import os
from collections import defaultdict

import pandas as pd

INFRA_COLS = ["device_id", "vpa_id", "phone_id", "address_id", "card_id"]
INFRA_LABELS = {
    "device_id": "device",
    "vpa_id": "VPA",
    "phone_id": "phone",
    "address_id": "address",
    "card_id": "card",
}


def inr(v: float) -> str:
    n = round(v)
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups: list[str] = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups + [tail])
    return ("₹-" if n < 0 else "₹") + s


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ring Sentinel — Ops Review Dashboard</title>
<script src="vendor/vis-network.min.js"></script>
<script>if (typeof vis === "undefined") { document.write('<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"><\/script>'); }</script>
<style>
  :root { --bg:#0b1220; --panel:#111a2c; --edge:#1d2942; --text:#dbe4f3;
          --muted:#8fa0ba; --accent:#f59e0b; --blue:#3b82f6; --red:#ef4444; --green:#34d399; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font-family:'Segoe UI',system-ui,sans-serif; padding:28px 36px; }
  h1 { font-size:22px; font-weight:600; letter-spacing:.3px; }
  .sub { color:var(--muted); font-size:12px; margin-top:4px; }
  h2 { font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:1.2px;
       color:var(--muted); margin:26px 0 10px; }
  .kpis { display:flex; gap:16px; flex-wrap:wrap; margin-top:18px; }
  .kpi { background:var(--panel); border:1px solid var(--edge); border-radius:10px;
         padding:14px 18px; min-width:170px; }
  .kpi .v { font-size:24px; font-weight:700; }
  .kpi .l { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.8px; margin-top:4px; }
  table { border-collapse:collapse; width:100%; max-width:980px; background:var(--panel);
          border:1px solid var(--edge); border-radius:10px; overflow:hidden; }
  th,td { text-align:left; padding:9px 14px; font-size:13px; border-bottom:1px solid var(--edge); }
  th { color:var(--muted); font-weight:600; text-transform:uppercase; font-size:11px; letter-spacing:.8px; }
  tr:last-child td { border-bottom:none; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .band-high { color:var(--red); font-weight:700; }
  .band-medium { color:var(--accent); font-weight:700; }
  .callout { border-left:4px solid var(--green); background:var(--panel);
             padding:12px 16px; border-radius:0 10px 10px 0; max-width:980px; font-size:13px; }
  .callout b { color:var(--green); }
  img.pr { background:var(--panel); border:1px solid var(--edge); border-radius:10px; max-width:760px; width:100%; }
  .bar { display:inline-block; height:10px; background:var(--blue); border-radius:5px; vertical-align:middle; }
  #clustergraph { background:var(--panel); border:1px solid var(--edge); border-radius:10px;
                  width:100%; max-width:1100px; height:520px; }
  .note { color:var(--muted); font-size:12px; margin-top:10px; max-width:900px; line-height:1.5; }
  .legend span { display:inline-flex; align-items:center; gap:6px; margin-right:18px; font-size:12px; color:var(--muted); }
  .dot { width:10px; height:10px; border-radius:50%; display:inline-block; }
</style>
</head>
<body>
<h1>Ring Sentinel — Ops Review Dashboard</h1>
<div class="sub">Model: __MODEL_FILE__ · sha256 __MODEL_SHA__ · generated __GENERATED_AT__ · test window __TEST_WINDOW__</div>
__STALE_BANNER__

<div class="kpis">
  <div class="kpi"><div class="v">__PR_AUC__</div><div class="l">PR-AUC (test)</div></div>
  <div class="kpi"><div class="v">__HIGH_PRECISION__</div><div class="l">HIGH precision</div></div>
  <div class="kpi"><div class="v">__HIGH_RECALL__</div><div class="l">HIGH recall</div></div>
  <div class="kpi"><div class="v">__CAMO_FP__</div><div class="l">camouflage false-flag @HIGH</div></div>
</div>

<h2>Threshold sweep — held-out test set (__N_TEST__ claims, base rate __BASE_RATE__)</h2>
<table>
  <tr><th>Band</th><th class="num">Threshold</th><th class="num">Precision</th><th class="num">Recall</th><th class="num">F1</th><th class="num">Flagged</th><th class="num">True pos</th><th class="num">False pos</th></tr>
__SWEEP_ROWS__
</table>

<h2>Money — always reported as a pair</h2>
<table>
  <tr><th>₹ ring-claim value held pre-payout (prevented)</th><th>₹ legitimate-claim value delayed (friction cost)</th></tr>
  <tr><td class="num">__INR_PREVENTED__</td><td class="num">__INR_FRICTION__</td></tr>
</table>

<h2>Precision-recall curve</h2>
<img class="pr" src="__PR_CURVE_URI__" alt="PR curve">

<h2>Feature importance</h2>
<table>
  <tr><th>Feature</th><th style="width:45%">Importance</th><th class="num">Share</th></tr>
__IMPORTANCE_ROWS__
</table>

<h2>Evidence panel — one flagged cluster, reconstructed from shared infrastructure</h2>
<div class="callout"><b>HIGH risk · score __FLAG_SCORE__</b> — claim <code>__FLAG_CLAIM__</code> by
<code>__FLAG_IDENTITY__</code> at merchant <code>__FLAG_MERCHANT__</code>, amount __FLAG_AMOUNT__,
label = confirmed ring claim. This graph is the evidence an analyst reviews before releasing or
continuing to hold the payout — the score is never shown without it.</div>
<div class="legend" style="margin-top:10px;">
  <span><span class="dot" style="background:#ef4444"></span>flagged identity</span>
  <span><span class="dot" style="background:#f59e0b"></span>linked customer identities</span>
  <span><span class="dot" style="background:#3b82f6"></span>shared device / VPA / phone / address / card</span>
</div>
<div id="clustergraph"></div>
<div class="note">Edges are labeled with the merchant each order touched. No single merchant saw anything
unusual — every order here was one order among many for that merchant. The coordination only becomes
visible when infrastructure is pooled across identities.</div>
<div class="note">Known limitation, stated up front: this build does not model a colluding or compromised
merchant feeding bad data into the graph; that needs separate merchant-trust tooling.</div>

<script>
const GRAPH = __GRAPH_JSON__;
const container = document.getElementById("clustergraph");
const nodes = new vis.DataSet(GRAPH.nodes.map(n => ({
  id: n.id, label: n.label, title: n.kind === "infra" ? ("shared " + n.infra_type) : n.id,
  shape: n.kind === "infra" ? "box" : "dot",
  color: { background: n.color, border: n.color },
  size: n.kind === "infra" ? 16 : 22,
  font: { color: "#dbe4f3", size: n.kind === "infra" ? 10 : 12 }
})));
const edges = new vis.DataSet(GRAPH.edges.map(e => ({
  from: e.from, to: e.to, label: e.label,
  font: { size: 9, color: "#8fa0ba", strokeWidth: 0 }, color: { color: "#33456b" }
})));
new vis.Network(container, { nodes, edges }, {
  autoResize: true, physics: { solver: "forceAtlas2Based",
    forceAtlas2Based: { gravitationalConstant: -3200, springLength: 130 } },
  interaction: { hover: true, tooltipDelay: 120 }
});
</script>
</body>
</html>
"""


def pick_flagged_claim(scored: pd.DataFrame) -> pd.Series:
    tp = scored[(scored["score"] >= 0.85) & (scored["is_ring_label"] == 1)]
    if tp.empty:
        raise SystemExit("no HIGH-risk true-positive claim found in scored test set")
    return tp.sort_values(["cluster_size", "amount"], ascending=False).iloc[0]


def build_cluster_graph(claimant: str, orders: pd.DataFrame) -> dict:
    claimant_infra: dict[str, set[str]] = defaultdict(set)
    own_rows = orders[orders["identity_key"] == claimant]
    for col in INFRA_COLS:
        claimant_infra[col] |= set(own_rows[col].unique())

    mask = orders["identity_key"] == claimant
    for col in INFRA_COLS:
        mask = mask | orders[col].isin(claimant_infra[col])
    relevant = orders[mask]

    infra_to_idents: dict[tuple[str, str], set[str]] = defaultdict(set)
    ident_merchants: dict[tuple[str, str], set[str]] = defaultdict(set)
    for row in relevant.itertuples(index=False):
        for col in INFRA_COLS:
            node = getattr(row, col)
            infra_to_idents[(col, node)].add(row.identity_key)
            ident_merchants[(row.identity_key, node)].add(row.merchant_id)

    nodes: list[dict] = []
    edges: list[dict] = []
    linked_idents = set()
    for (col, node), idents in infra_to_idents.items():
        sharing = idents - {claimant}
        if not sharing:
            continue
        linked_idents |= sharing
    linked_idents.add(claimant)

    for i, ident in enumerate(sorted(linked_idents)):
        nodes.append({
            "id": ident,
            "label": ident.replace("USR_", "").replace("RNG", "ring"),
            "kind": "ident",
            "color": "#ef4444" if ident == claimant else "#f59e0b",
        })

    seen_edges: set[tuple[str, str]] = set()
    for row in relevant.itertuples(index=False):
        if row.identity_key not in linked_idents:
            continue
        for col in INFRA_COLS:
            node = getattr(row, col)
            if len(infra_to_idents[(col, node)] - {claimant}) == 0:
                continue
            key = (row.identity_key, node)
            if key in seen_edges:
                continue
            seen_edges.add(key)
            label = "\n".join(sorted(ident_merchants[key])[:3])
            nodes.append({
                "id": node,
                "label": f"{INFRA_LABELS[col]}\n{node[-6:]}",
                "kind": "infra",
                "infra_type": INFRA_LABELS[col],
                "color": "#3b82f6",
            })
            edges.append({"from": row.identity_key, "to": node, "label": label})

    dedup_nodes: dict[str, dict] = {}
    for n in nodes:
        dedup_nodes.setdefault(n["id"], n)
    return {"nodes": list(dedup_nodes.values()), "edges": edges}


def _sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", default="models/")
    parser.add_argument("--eval-dir", default="eval/")
    parser.add_argument("--data-dir", default="data/")
    parser.add_argument("--out", default="dashboard/index.html")
    args = parser.parse_args()

    with open(os.path.join(args.models_dir, "eval_report.json")) as fh:
        report = json.load(fh)

    meta_path = os.path.join(args.models_dir, "model_meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path) as fh:
            meta = json.load(fh)

    model_file = report.get("model_file", "models/ring_sentinel_xgb.json")
    current_sha = None
    if os.path.exists(model_file):
        current_sha = _sha256_of(model_file)
    embedded_sha = (meta.get("sha256") or current_sha or "")[:12]
    stale = (
        current_sha is not None
        and meta.get("sha256")
        and meta["sha256"] != current_sha
    )
    if stale:
        print("WARNING: dashboard is being built against a DIFFERENT model than "
              "the one this eval report was produced from — regenerate both.")
    stale_banner = (
        '<div class="callout" style="border-left-color:#ef4444;margin-top:12px">'
        "<b>STALE ARTIFACT:</b> this report was generated from a different model "
        "file than the current models/ contents. Re-run the pipeline.</div>"
        if stale
        else ""
    )

    scored = pd.read_parquet(os.path.join(args.data_dir, "test_claims_scored.parquet"))
    orders = pd.read_parquet(os.path.join(args.data_dir, "orders.parquet"))

    flag = pick_flagged_claim(scored)
    graph_payload = build_cluster_graph(str(flag["identity_key"]), orders)

    with open(os.path.join(args.eval_dir, "pr_curve.png"), "rb") as fh:
        pr_uri = "data:image/png;base64," + base64.b64encode(fh.read()).decode()

    sweep_rows = ""
    for r in report["threshold_sweep"]:
        band_cls = "band-high" if r["band"] == "HIGH" else "band-medium"
        sweep_rows += (
            f'<tr><td class="{band_cls}">{r["band"]}</td>'
            f'<td class="num">{r["threshold"]:.2f}</td>'
            f'<td class="num">{r["precision"]:.3f}</td>'
            f'<td class="num">{r["recall"]:.3f}</td>'
            f'<td class="num">{r["f1"]:.3f}</td>'
            f'<td class="num">{r.get("flagged", "-")}</td>'
            f'<td class="num">{r.get("true_positives", "-")}</td>'
            f'<td class="num">{r.get("false_positives", "-")}</td></tr>\n'
        )

    imp_rows = ""
    top_imp = report["feature_importance"][0]["importance"] or 1.0
    for item in report["feature_importance"][:10]:
        share = item["importance"]
        imp_rows += (
            f'<tr><td>{item["feature"]}</td>'
            f'<td><span class="bar" style="width:{max(share / top_imp * 100, 0.5):.0f}%"></span></td>'
            f'<td class="num">{share:.3f}</td></tr>\n'
        )

    high = next(r for r in report["threshold_sweep"] if r["band"] == "HIGH")
    camo = report.get("camouflage", {})
    camo_fp = camo.get("false_flag_rate_high", 0.0)

    page = (
        HTML_TEMPLATE
        .replace("__MODEL_FILE__", html.escape(str(report.get("model_file", "-"))))
        .replace("__MODEL_SHA__", html.escape(embedded_sha))
        .replace("__STALE_BANNER__", stale_banner)
        .replace("__GENERATED_AT__", html.escape(str(report.get("generated_at", "-"))[:19]))
        .replace("__TEST_WINDOW__", html.escape(report.get("split", {}).get("test", "-")))
        .replace("__PR_AUC__", f"{report['pr_auc']:.3f}")
        .replace("__HIGH_PRECISION__", f"{high['precision']:.2f}")
        .replace("__HIGH_RECALL__", f"{high['recall']:.2f}")
        .replace("__CAMO_FP__", f"{camo_fp:.1%}")
        .replace("__N_TEST__", f"{report['n_test_claims']:,}")
        .replace("__BASE_RATE__", f"{report['base_rate']:.2%}")
        .replace("__SWEEP_ROWS__", sweep_rows.rstrip("\n"))
        .replace("__INR_PREVENTED__", inr(report["monetary"]["inr_prevented"]))
        .replace("__INR_FRICTION__", inr(report["monetary"]["inr_friction_cost"]))
        .replace("__PR_CURVE_URI__", pr_uri)
        .replace("__IMPORTANCE_ROWS__", imp_rows.rstrip("\n"))
        .replace("__FLAG_SCORE__", f"{float(flag['score']):.2f}")
        .replace("__FLAG_CLAIM__", html.escape(str(flag["claim_id"])))
        .replace("__FLAG_IDENTITY__", html.escape(str(flag["identity_key"])))
        .replace("__FLAG_MERCHANT__", html.escape(str(flag["merchant_id"])))
        .replace("__FLAG_AMOUNT__", inr(float(flag["amount"])))
        .replace("__GRAPH_JSON__", json.dumps(graph_payload).replace("</", "<\\/"))
    )

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(page)
    print(f"wrote {args.out}")
    print(f"flagged-cluster evidence: claim={flag['claim_id']} identity={flag['identity_key']} "
          f"score={float(flag['score']):.3f} cluster_size={int(flag['cluster_size'])}")


if __name__ == "__main__":
    main()
