"""API tests for the scoring service: auth, validation, idempotency,
fail-open behavior, shadow scoring, and operational endpoints."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src import score_service as ss
from tests.conftest import AUTH


def _order(oid: str = "ORD_T1", ident: str = "USR_T1") -> dict:
    return {
        "order_id": oid,
        "identity_key": ident,
        "merchant_id": "MRC_T1",
        "device_id": f"dev_{ident}",
        "vpa_id": f"vpa_{ident}",
        "phone_id": f"ph_{ident}",
        "address_id": f"adr_{ident}",
        "card_id": f"card_{ident}",
    }


def _claim(cid: str | None = "CLM_T1", ident: str = "USR_T1",
           amount: float = 1500.0) -> dict:
    return {
        "claim_id": cid,
        "identity_key": ident,
        "merchant_id": "MRC_T1",
        "amount": amount,
        "reason_text": "Item did not fit",
    }


def test_health_is_public_and_unauthenticated(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert {"status", "model_loaded", "known_identities"} <= set(body)


def test_score_requires_api_key(client):
    r = client.post("/v1/score", json=_claim())
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_ingest_requires_api_key(client):
    r = client.post("/v1/ingest/order", json=_order())
    assert r.status_code == 401


def test_wrong_key_rejected(client):
    r = client.post("/v1/score", json=_claim(), headers={"X-API-Key": "wrong"})
    assert r.status_code == 401


def test_happy_path_legit_auto_approves(client):
    client.post("/v1/ingest/order", json=_order("ORD_OK1", "USR_OK1"), headers=AUTH)
    r = client.post("/v1/score", json=_claim("CLM_OK1", "USR_OK1"), headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["action"] in ("AUTO_APPROVE", "STEP_UP_VERIFICATION",
                              "HOLD_PAYOUT_HUMAN_REVIEW")
    assert body["degraded"] is False
    assert body["request_id"]
    assert r.headers["X-Request-ID"]


def test_order_idempotency(client):
    o = _order("ORD_DUP1", "USR_DUP1")
    r1 = client.post("/v1/ingest/order", json=o, headers=AUTH)
    r2 = client.post("/v1/ingest/order", json=o, headers=AUTH)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["deduplicated"] is False
    assert r2.json()["deduplicated"] is True


def test_claim_idempotency_returns_same_decision(client):
    client.post("/v1/ingest/order", json=_order("ORD_ID1", "USR_ID1"), headers=AUTH)
    c = _claim("CLM_ID1", "USR_ID1")
    r1 = client.post("/v1/score", json=c, headers=AUTH)
    r2 = client.post("/v1/score", json=c, headers=AUTH)
    b1, b2 = r1.json(), r2.json()
    assert b1["score"] == b2["score"]
    assert b2["deduplicated"] is True


def test_invalid_amount_rejected(client):
    bad = _claim("CLM_NEG", "USR_NEG", amount=-5.0)
    r = client.post("/v1/score", json=bad, headers=AUTH)
    assert r.status_code == 422


def test_oversized_reason_rejected(client):
    bad = _claim("CLM_BIG", "USR_BIG")
    bad["reason_text"] = "x" * 10_000
    r = client.post("/v1/score", json=bad, headers=AUTH)
    assert r.status_code == 422


def test_bad_identity_characters_rejected(client):
    bad = _claim("CLM_INJ", "USR; DROP TABLE")
    r = client.post("/v1/score", json=bad, headers=AUTH)
    assert r.status_code == 422


def test_runtime_scoring_failure_fails_open(client, monkeypatch):
    class Boom:
        def predict_proba(self, *_a, **_k):
            raise RuntimeError("boom")

    original = ss._model
    ss._model = Boom()
    try:
        client.post("/v1/ingest/order", json=_order("ORD_FO1", "USR_FO1"),
                    headers=AUTH)
        r = client.post("/v1/score", json=_claim("CLM_FO1", "USR_FO1"),
                        headers=AUTH)
        assert r.status_code == 200
        body = r.json()
        assert body["score"] is None
        assert body["action"] == "AUTO_APPROVE"
        assert body["degraded"] is True
        assert body["degradation_reason"] == "scoring_error"
    finally:
        ss._model = original


def test_shadow_score_does_not_mutate_state(client):
    ident = "USR_SH1"
    client.post("/v1/ingest/order", json=_order("ORD_SH1", ident), headers=AUTH)
    r0 = client.post("/v1/score", json=_claim("CLM_SH0", ident), headers=AUTH)
    before = r0.json()["evidence"]["identity_prior_claims"]
    r1 = client.post("/v1/score/shadow", json=_claim("CLM_SHX", ident), headers=AUTH)
    assert r1.status_code == 200
    r2 = client.post("/v1/score", json=_claim("CLM_SH2", ident), headers=AUTH)
    after = r2.json()["evidence"]["identity_prior_claims"]
    assert after == before + 1  # exactly one recorded claim between the two


def test_version_endpoint(client):
    r = client.get("/version")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "ring-sentinel-scoring"
    assert "thresholds" in body


def test_readyz_public(client):
    assert client.get("/readyz").status_code == 200


def test_metrics_exposes_prometheus(client):
    r = client.get("/metrics")
    assert r.status_code == 200
    assert b"ring_sentinel_scores_total" in r.content


def test_missing_model_startup_fails_open(monkeypatch):
    saved_model = ss._model
    saved_sha = (ss._model_sha256_short, ss._model_sha_verified)
    ss.load_model(model_path="nonexistent/model/x.json")
    try:
        assert ss._model is None
    finally:
        ss._model = saved_model
        ss._model_sha256_short, ss._model_sha_verified = saved_sha
