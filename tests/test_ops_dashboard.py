"""Tests for ops-dashboard endpoints: /v1/claims, /v1/claims/{id}, /v1/decisions."""

from __future__ import annotations

from tests.conftest import AUTH


def _get(client, path):
    return client.get(path, headers=AUTH)


def test_claims_requires_auth(client):
    resp = client.get("/v1/claims")
    assert resp.status_code == 401


def test_claims_list_high_risk(client):
    data = _get(client, "/v1/claims?risk=HIGH&page_size=10").json()
    assert data["available"] is True
    assert data["total"] > 0
    assert len(data["items"]) <= 10
    for item in data["items"]:
        assert item["score"] >= 0.85
        assert item["action"] == "HOLD_PAYOUT_HUMAN_REVIEW"
        assert item["risk_level"] == "HIGH"


def test_claims_search_and_amount_filters(client):
    all_items = _get(client, "/v1/claims?page_size=500").json()["items"]
    target = all_items[0]["merchant_id"]
    by_merchant = _get(client, f"/v1/claims?merchant={target}").json()
    assert all(i["merchant_id"] == target for i in by_merchant["items"])

    amt = _get(client, "/v1/claims?min_amount=100000").json()
    assert amt["total"] == 0

    first_claim = all_items[0]["claim_id"]
    found = _get(client, f"/v1/claims?q={first_claim}").json()
    assert found["total"] >= 1


def test_claims_pagination(client):
    p1 = _get(client, "/v1/claims?page=1&page_size=5&sort=ts").json()
    p2 = _get(client, "/v1/claims?page=2&page_size=5&sort=ts").json()
    ids_1 = {i["claim_id"] for i in p1["items"]}
    ids_2 = {i["claim_id"] for i in p2["items"]}
    assert not (ids_1 & ids_2)
    assert p2["page"] == 2


def test_claim_detail_full_payload(client):
    top = _get(client, "/v1/claims?sort=score&page_size=1").json()["items"][0]
    detail = _get(client, f"/v1/claims/{top['claim_id']}").json()
    assert detail["claim"]["claim_id"] == top["claim_id"]
    assert set(detail) >= {"claim", "score", "risk_level", "action", "features",
                           "evidence", "graph", "timeline", "identity_history",
                           "merchant", "cluster"}
    assert abs(detail["score"] - top["score"]) < 1e-6
    assert len(detail["features"]) == 10
    if detail["evidence"]["shared_infra"]:
        node = detail["evidence"]["shared_infra"][0]
        assert node["connected_identities"], "shared node must list identities"
    assert any(n["kind"] == "infra" for n in detail["graph"]["nodes"]) or \
        detail["graph"]["nodes"] == []
    events = [t["event"] for t in detail["timeline"]]
    assert events[0] == "order_placed"
    assert "claim_submitted" in events and "scored" in events
    assert detail["timeline"] == sorted(detail["timeline"], key=lambda t: t["ts"])


def test_claim_detail_not_found(client):
    resp = _get(client, "/v1/claims/CLM_DOES_NOT_EXIST")
    assert resp.status_code == 404


def test_decision_roundtrip_and_validation(client):
    top = _get(client, "/v1/claims?risk=HIGH&page_size=1").json()["items"][0]
    cid = top["claim_id"]

    ok = client.post("/v1/decisions", headers=AUTH, json={
        "claim_id": cid,
        "kind": "decision",
        "prev_action": top["action"],
        "new_action": "AUTO_APPROVE",
        "reason": "Customer verification completed via video KYC",
    })
    assert ok.status_code == 200
    assert ok.json()["status"] == "recorded"

    listed = _get(client, f"/v1/decisions?claim_id={cid}").json()["items"]
    assert any(
        i["new_action"] == "AUTO_APPROVE" and i["reason"].startswith("Customer")
        for i in listed
    )

    note = client.post("/v1/decisions", headers=AUTH, json={
        "claim_id": cid, "kind": "note", "reason": "Called merchant for context",
    })
    assert note.status_code == 200

    bad_action = client.post("/v1/decisions", headers=AUTH, json={
        "claim_id": cid, "kind": "decision",
        "new_action": "BAN_EVERYONE", "reason": "test invalid vocabulary",
    })
    assert bad_action.status_code == 422

    no_reason = client.post("/v1/decisions", headers=AUTH, json={
        "claim_id": cid, "kind": "decision",
        "new_action": "AUTO_APPROVE", "reason": "x",
    })
    assert no_reason.status_code == 422


def test_decisions_require_auth(client):
    resp = client.post("/v1/decisions", json={
        "claim_id": "CLM_X", "kind": "note", "reason": "no key provided",
    })
    assert resp.status_code == 401
