"""Ring Sentinel — Task E.1: live demo scenario script.

Run against the live service:
    uvicorn src.score_service:app --port 8000
    python src/demo_scenario.py

Scenario 1: three independent legitimate customers -> all near-zero, AUTO_APPROVE.
Scenario 2: an 8-member ring, one order + one claim each across 8 different
merchants, sharing 2 devices + 1 VPA -> each merchant's individual view shows
nothing unusual, but the pooled service flags STEP_UP / HOLD as evidence accrues.
The script states explicitly which early claims were NOT caught.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HIGH_THRESHOLD = 0.85
MEDIUM_THRESHOLD = 0.50
DEV_FALLBACK_API_KEY = "dev-insecure-key-change-me"


def make_session() -> tuple[requests.Session, str]:
    session = requests.Session()
    key = os.environ.get("RING_SENTINEL_API_KEY", DEV_FALLBACK_API_KEY)
    if key == DEV_FALLBACK_API_KEY:
        print(f"[warn] using development API key ({DEV_FALLBACK_API_KEY!r}) — "
              f"set RING_SENTINEL_API_KEY for anything real")
    session.headers["X-API-Key"] = key
    return session, key


def wait_for_health(base_url: str, timeout_s: int = 30) -> dict:
    deadline = time.time() + timeout_s
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            r = requests.get(f"{base_url}/health", timeout=3)
            if r.ok:
                return r.json()
        except requests.RequestException as exc:
            last_err = exc
        time.sleep(1)
    raise SystemExit(f"service never became healthy at {base_url}: {last_err}")


def ingest(base_url: str, order_id: str, identity: str, merchant: str,
           device: str, vpa: str, session: requests.Session) -> None:
    r = session.post(f"{base_url}/v1/ingest/order", json={
        "order_id": order_id,
        "identity_key": identity,
        "merchant_id": merchant,
        "device_id": device,
        "vpa_id": vpa,
        "phone_id": f"ph_{identity}",
        "address_id": f"adr_{identity}",
        "card_id": f"card_{identity}",
    }, timeout=10)
    r.raise_for_status()


def score_claim(base_url: str, claim_id: str, identity: str, merchant: str,
                amount: float, reason: str, approved: bool = True,
                session: requests.Session | None = None) -> dict:
    r = (session or requests).post(f"{base_url}/v1/score", json={
        "claim_id": claim_id,
        "identity_key": identity,
        "merchant_id": merchant,
        "amount": amount,
        "reason_text": reason,
        "approved": approved,
    }, timeout=10)
    r.raise_for_status()
    return r.json()


def scenario_legit(base_url: str, session: requests.Session) -> list[dict]:
    print("=" * 72)
    print("SCENARIO 1 — three independent legitimate customers")
    print("=" * 72)
    customers = [
        ("USR_DEMO_A", "MRC_DEMO_1", 2450.0, "Item did not fit"),
        ("USR_DEMO_B", "MRC_DEMO_2", 1180.0, "Product damaged in transit"),
        ("USR_DEMO_C", "MRC_DEMO_3", 6799.0, "Changed my mind about the purchase"),
    ]
    results = []
    for ident, merch, amount, reason in customers:
        ingest(base_url, f"ORD_{ident}", ident, merch,
               f"dev_{ident}", f"vpa_{ident}", session)
        res = score_claim(base_url, f"CLM_{ident}", ident, merch, amount, reason,
                          session=session)
        results.append(res)
        print(f"  {ident} @ {merch} (₹{amount:,.0f}): "
              f"score={res['score']:.4f} action={res['action']}")
    ok = all(r["action"] == "AUTO_APPROVE" for r in results)
    print(f"  -> expected all AUTO_APPROVE near-zero: {'PASS' if ok else 'FAIL'}\n")
    return results


def scenario_ring(base_url: str, session: requests.Session,
                  n_members: int = 8) -> list[dict]:
    print("=" * 72)
    print(f"SCENARIO 2 — {n_members}-member ring: one order+claim each across "
          f"{n_members} different merchants, sharing 2 devices + 1 VPA")
    print("=" * 72)
    shared_devices = ["dev_ring_shared_A", "dev_ring_shared_B"]
    shared_vpa = "vpa_ring_shared_S"
    reasons = ["Item never arrived at my address"]
    results = []
    for i in range(1, n_members + 1):
        ident = f"RNGDEMO_M{i}"
        merch = f"MRC_RING_D{i}"
        device = shared_devices[i % 2]
        amount = 3000.0 + i * 777.0
        ingest(base_url, f"ORD_{ident}", ident, merch, device, shared_vpa, session)
        res = score_claim(base_url, f"CLM_{ident}", ident, merch, amount,
                          reasons[i % len(reasons)], session=session)
        results.append(res)
        marker = ""
        if res["action"] == "STEP_UP_VERIFICATION":
            marker = "  <-- first MEDIUM crossing"
        elif res["action"] == "HOLD_PAYOUT_HUMAN_REVIEW":
            marker = "  <-- HIGH: payout held"
        print(f"  member {i}: merchant={merch} ₹{amount:,.0f} "
              f"score={res['score']:.4f} action={res['action']} "
              f"(cluster_size={res['evidence']['cluster_size']}){marker}")
    not_caught = [i + 1 for i, r in enumerate(results)
                  if r["action"] == "AUTO_APPROVE"]
    caught_high = [i + 1 for i, r in enumerate(results)
                   if r["action"] == "HOLD_PAYOUT_HUMAN_REVIEW"]
    print(f"\n  HONESTY NOTE: members {not_caught} were NOT caught — their claims "
          f"would have been auto-approved and paid out before the graph had enough "
          f"evidence. The system converges once shared infrastructure accumulates; "
          f"HOLD from member {caught_high[0] if caught_high else 'never'} onward.")
    each_merchant_view = (
        "each of these merchants saw exactly ONE first-time customer filing one "
        "claim — nothing unusual on any individual merchant's dashboard"
    )
    print(f"  {each_merchant_view}.\n")
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url",
                        default=os.environ.get("RING_SENTINEL_URL",
                                               "http://localhost:8000"))
    args = parser.parse_args()

    session, _ = make_session()
    health = wait_for_health(args.base_url)
    print(f"service healthy: model_loaded={health['model_loaded']} "
          f"model_sha_verified={health.get('model_sha_verified')} "
          f"known_identities={health['known_identities']}\n")

    legit = scenario_legit(args.base_url, session)
    ring = scenario_ring(args.base_url, session)

    print("=" * 72)
    print("SUMMARY")
    print("=" * 72)
    if any(r.get("degraded") for r in legit + ring):
        print("  WARNING: service served DEGRADED fail-open responses "
              "(model unavailable) during this run!")
    print(f"  legit auto-approved: {sum(r['action'] == 'AUTO_APPROVE' for r in legit)}/3")
    print(f"  ring members held for human review: "
          f"{sum(r['action'] == 'HOLD_PAYOUT_HUMAN_REVIEW' for r in ring)}/8")
    print(f"  ring members stepped up: "
          f"{sum(r['action'] == 'STEP_UP_VERIFICATION' for r in ring)}/8")


if __name__ == "__main__":
    main()
