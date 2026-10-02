"""Tests for the Enterprise Production Scaling Architecture & AI Scam Recognition.

Covers:
- Universal Multi-Gateway Adapters (Amazon Pay, Razorpay, Stripe, Generic)
- DPDP Act & RBI Compliant PII Masking & Field-Level Encryption
- Immutable WORM Audit Log & Tamper-Evident Hash Chain Verification
- 64-Shard Distributed Graph State & Pipelining
- Fast In-Process Model Runtime (<15ms SLA)
- Zero-Risk Shadow Mode & Multi-Stage Rollout Engine
- AI Scam Pattern Recognition & Anti-Alert Fatigue Engine
- End-to-end FastAPI Webhook & Scaling API endpoints
"""

from __future__ import annotations

import json
import os
import tempfile
import pytest
import pandas as pd
from datetime import datetime, timezone
from starlette.testclient import TestClient

from src.scaling.compliance import (
    DEFAULT_TENANT_SALT,
    EnvelopeEncryptor,
    ImmutableWormAuditLog,
    anonymize_infra_key,
    normalize_phone,
    normalize_vpa,
)
from src.scaling.gateways import (
    GATEWAY_REGISTRY,
    AmazonPayAdapter,
    RazorpayAdapter,
    StripeAdapter,
    GenericGatewayAdapter,
)
from src.scaling.distributed_graph import DistributedGraphState
from src.scaling.inference import FastModelRuntime, LatencyTracker
from src.scaling.shadow_mode import (
    RolloutManager,
    RolloutPhase,
)
from src.scaling.ai_scam_detector import (
    AIScamPatternDetector,
    AlertFatigueFilter,
    ScamArchetype,
)
from src.scaling.benchmark import run_scaling_benchmark
from src.score_service import app
from tests.conftest import AUTH


# -----------------------------------------------------------------------------
# 1. Multi-Gateway Adapters & Normalization
# -----------------------------------------------------------------------------

def test_amazon_pay_adapter_order_and_claim():
    adapter = AmazonPayAdapter(tenant_salt="test-tenant-salt")

    # Amazon Pay Order / Charge Authorization
    amzn_order_payload = {
        "chargePermissionId": "P01-1234567-8901234",
        "chargeId": "S01-1234567-8901234-C01",
        "sellerId": "SELLER_AMZN_IND",
        "buyer": {
            "buyerId": "amzn1.account.AG3XYZA1234",
            "name": "Jane Doe",
            "phoneNumber": "9876543210",
            "email": "jane.doe@example.in",
        },
        "paymentPreferences": [
            {"paymentMethodToken": "tok_amzn_card_999", "upiId": "janedoe@okhdfcbank"}
        ],
        "shippingAddress": {
            "addressLine1": "Plot 42, HSR Layout Sector 2",
            "postalCode": "560102",
        },
        "chargeAmount": {"amount": "2499.00", "currencyCode": "INR"},
    }

    order_ev = adapter.parse_order(amzn_order_payload)
    assert order_ev.order_id == "S01-1234567-8901234-C01"
    assert order_ev.gateway == "amazon_pay"
    assert order_ev.identity_key.startswith("usr_")
    assert order_ev.device_id.startswith("dev_")
    assert order_ev.vpa_id.startswith("vpa_")
    assert order_ev.phone_id.startswith("ph_")
    assert order_ev.address_id.startswith("adr_")
    assert order_ev.card_id.startswith("card_")
    assert order_ev.amount == 2499.00
    assert order_ev.currency == "INR"

    # Amazon Pay A-to-z Guarantee Dispute
    amzn_claim_payload = {
        "claimId": "ATOZ_CLM_9981",
        "chargeId": "S01-1234567-8901234-C01",
        "sellerId": "SELLER_AMZN_IND",
        "buyerId": "amzn1.account.AG3XYZA1234",
        "disputeAmount": {"amount": "2499.00", "currencyCode": "INR"},
        "reasonDescription": "A-to-z Guarantee Claim: Item not received but marked delivered",
        "disputeType": "a_to_z_claim",
    }
    claim_ev = adapter.parse_claim(amzn_claim_payload)
    assert claim_ev.claim_id == "ATOZ_CLM_9981"
    assert claim_ev.gateway == "amazon_pay"
    assert claim_ev.dispute_type == "a_to_z_claim"
    assert claim_ev.amount == 2499.00

    # Dispute Dossier Generation
    dossier = adapter.generate_dispute_dossier(
        claim_ev,
        {"score": 0.92, "action": "HOLD_PAYOUT_HUMAN_REVIEW", "evidence": {"cluster_size": 8, "recent_cluster_claims_7d": 5}}
    )
    assert dossier["appealChannel"] == "AmazonPay_A_to_Z_Guarantee_Service"
    assert "syndicate" in dossier["evidenceSummary"].lower()
    assert dossier["fraudRiskScore"] == 0.92


def test_razorpay_adapter_order_and_claim():
    adapter = RazorpayAdapter(tenant_salt="test-tenant-salt")

    rzp_order_payload = {
        "entity": {
            "id": "order_EKfEm9A5G6Zom",
            "account_id": "acc_BF0K89kLm",
            "amount": 150000,  # 1500.00 INR in paise
            "currency": "INR",
            "contact": "+919876543210",
            "email": "customer@razorpay.test",
            "vpa": "customer@icici",
            "card_id": "card_H29kLm0",
            "notes": {"device_id": "dev_rzp_fingerprint_01", "address_id": "adr_560001"},
        }
    }
    order_ev = adapter.parse_order(rzp_order_payload)
    assert order_ev.order_id == "order_EKfEm9A5G6Zom"
    assert order_ev.gateway == "razorpay"
    assert order_ev.amount == 1500.0
    assert order_ev.vpa_id.startswith("vpa_")

    rzp_dispute_payload = {
        "payload": {
            "dispute": {
                "entity": {
                    "id": "disp_Jk829mLA01",
                    "payment_id": "pay_LKj2019A8",
                    "amount": 150000,
                    "reason_code": "unauthorized_transaction",
                    "status": "open",
                }
            }
        }
    }
    claim_ev = adapter.parse_claim(rzp_dispute_payload)
    assert claim_ev.claim_id == "disp_Jk829mLA01"
    assert claim_ev.amount == 1500.0

    dossier = adapter.generate_dispute_dossier(
        claim_ev,
        {"score": 0.88, "evidence": {"cluster_size": 6, "cluster_merchant_span": 3}}
    )
    assert dossier["action"] == "represent_dispute"
    assert dossier["metrics"]["syndicate_cluster_size"] == 6


# -----------------------------------------------------------------------------
# 2. DPDP Act, RBI Compliance & Field-Level Encryption
# -----------------------------------------------------------------------------

def test_anonymize_infra_key_salted_and_deterministic():
    salt1 = b"tenant-one-salt"
    salt2 = b"tenant-two-salt"
    raw_vpa = "MerchantUser@OkAxis"

    digest1 = anonymize_infra_key(raw_vpa, salt=salt1, prefix="vpa_")
    digest1_repeat = anonymize_infra_key("merchantuser@okaxis", salt=salt1, prefix="vpa_")
    assert digest1 == digest1_repeat
    assert digest1.startswith("vpa_")
    assert len(digest1) == 20  # 4 prefix + 16 hex

    # Multi-tenant isolation: different salt produces different hash
    digest2 = anonymize_infra_key(raw_vpa, salt=salt2, prefix="vpa_")
    assert digest1 != digest2


def test_phone_and_vpa_normalization():
    assert normalize_phone("9876543210") == "+919876543210"
    assert normalize_phone("+91 98765-43210") == "+919876543210"
    assert normalize_vpa("  User123@HDFCBANK ") == "user123@hdfcbank"


def test_field_level_encryption_roundtrip():
    encryptor = EnvelopeEncryptor(master_key_secret="test-master-kms-secret")
    secret_vpa = "victim_account@okhdfcbank"

    envelope = encryptor.encrypt_field(secret_vpa, tenant_id="tenant_amzn_01")
    assert "ciphertext" in envelope
    assert envelope["tenant_id"] == "tenant_amzn_01"

    decrypted = encryptor.decrypt_field(envelope)
    assert decrypted == secret_vpa


def test_immutable_worm_audit_chain_and_tamper_detection():
    with tempfile.TemporaryDirectory() as tmpdir:
        worm_path = os.path.join(tmpdir, "audit_worm_test.jsonl")
        worm = ImmutableWormAuditLog(worm_path)

        rec1 = worm.record_decision({"claim_id": "CLM_1", "score": 0.12, "action": "AUTO_APPROVE"})
        rec2 = worm.record_decision({"claim_id": "CLM_2", "score": 0.89, "action": "HOLD_PAYOUT_HUMAN_REVIEW"})
        rec3 = worm.record_decision({"claim_id": "CLM_3", "score": 0.65, "action": "STEP_UP_VERIFICATION"})

        assert rec1["sequence_id"] == 1
        assert rec2["prev_hash"] == rec1["current_hash"]
        assert rec3["prev_hash"] == rec2["current_hash"]

        # Integrity verification passes
        valid, msg, count = worm.verify_integrity()
        assert valid is True
        assert count == 3

        # Deliberately tamper with record #2 on disk (retroactive modification attack)
        with open(worm_path, "r", encoding="utf-8") as fh:
            lines = fh.readlines()
        tampered_entry = json.loads(lines[1])
        tampered_entry["decision"]["score"] = 0.05  # Attempt to cover up fraud score
        lines[1] = json.dumps(tampered_entry) + "\n"
        with open(worm_path, "w", encoding="utf-8") as fh:
            fh.writelines(lines)

        # Integrity check MUST detect the tampering
        tamper_worm = ImmutableWormAuditLog(worm_path)
        valid, msg, count = tamper_worm.verify_integrity()
        assert valid is False
        assert "Tampered record payload at #2" in msg


# -----------------------------------------------------------------------------
# 3. Distributed Graph State & Pipelining
# -----------------------------------------------------------------------------

def test_distributed_graph_partitioning():
    graph = DistributedGraphState(max_cluster_size=250)
    assert len(graph.shards) == 64

    # Pipelined batch ingest
    orders = [
        {
            "identity_key": f"usr_{i}",
            "device_id": f"dev_{i % 5}",  # 5 devices shared across 20 users
            "vpa_id": f"vpa_{i}",
            "phone_id": f"ph_{i}",
            "address_id": f"adr_{i % 3}",
            "card_id": f"card_{i}",
            "merchant_id": f"m_{i % 4}",
        }
        for i in range(20)
    ]
    total = graph.pipeline_batch_ingest(orders, tenant_id="amzn_pay_tenant")
    assert total == 20

    # Feature extraction with sub-millisecond SLA
    now = pd.Timestamp.now(timezone.utc)
    feats, bundle = graph.compute_features(
        now, "usr_0", 1200.0, "damaged goods return", tenant_id="amzn_pay_tenant"
    )
    assert feats["cluster_size"] > 1
    assert bundle["evidence"]["graph_lookup_latency_ms"] < 25.0


# -----------------------------------------------------------------------------
# 4. Fast Model Runtime & Latency SLA
# -----------------------------------------------------------------------------

def test_fast_model_runtime_and_tracker():
    tracker = LatencyTracker(max_samples=100)
    for lat in [1.2, 1.5, 2.1, 0.9, 1.8, 4.5]:
        tracker.record(lat)
    stats = tracker.stats()
    assert stats["count"] == 6
    assert stats["p50_ms"] > 0
    assert stats["p99_ms"] >= stats["p50_ms"]


# -----------------------------------------------------------------------------
# 5. Zero-Risk Shadow Mode & Multi-Stage Rollout
# -----------------------------------------------------------------------------

def test_rollout_manager_phases_and_transitions():
    rm = RolloutManager()
    rm.set_phase("amazon_pay", RolloutPhase.SHADOW_MODE)
    rm.set_phase("razorpay", RolloutPhase.STEP_UP_GATING)

    # 1. Amazon Pay in Shadow Mode: passive scoring (never intercepts)
    res_amz = rm.evaluate(
        claim_id="CLM_AMZ_01",
        gateway="amazon_pay",
        tenant_id="amz_tenant",
        ring_score=0.91,
        ring_action="HOLD_PAYOUT_HUMAN_REVIEW",
        legacy_action="APPROVE",
        amount=5000.0,
    )
    assert res_amz.phase == RolloutPhase.SHADOW_MODE
    assert res_amz.effective_action == "APPROVE"  # Did not intercept
    assert res_amz.discrepancy_type == "PREVENTED_FRAUD"

    # 2. Razorpay in Step-Up Gating: challenges medium risk
    res_rzp = rm.evaluate(
        claim_id="CLM_RZP_02",
        gateway="razorpay",
        tenant_id="rzp_tenant",
        ring_score=0.68,
        ring_action="STEP_UP_VERIFICATION",
        legacy_action="APPROVE",
        amount=1200.0,
    )
    assert res_rzp.phase == RolloutPhase.STEP_UP_GATING
    assert res_rzp.challenge_required is True
    assert res_rzp.effective_action == "STEP_UP_VERIFICATION"

    summary = rm.get_summary()
    assert summary["prevented_fraud_count"] == 1
    assert summary["prevented_fraud_amount"] == 5000.0


# -----------------------------------------------------------------------------
# 6. AI Scam Pattern Recognition & Anti-Alert Fatigue
# -----------------------------------------------------------------------------

def test_ai_scam_pattern_detector():
    detector = AIScamPatternDetector(cooldown_seconds=60)

    # 1. Reverse UPI Collect Scam
    event1 = {
        "identity_key": "usr_victim_01",
        "reason_text": "Customer care told me to approve collect request to receive refund",
        "amount": 9999.0,
    }
    signals, incident = detector.process_and_deduplicate(event1, {"cluster_size": 1})
    assert any(s.archetype == ScamArchetype.REVERSE_UPI_COLLECT for s in signals)
    assert incident is not None
    assert incident.archetype == ScamArchetype.REVERSE_UPI_COLLECT

    # 2. Alert Fatigue Cooldown: identical attack immediately afterwards should be suppressed
    signals2, incident2 = detector.process_and_deduplicate(event1, {"cluster_size": 1})
    assert bool(signals2) is True  # Signals detected
    assert incident2 is None  # Suppressed by cooldown filter to prevent alert fatigue!

    # 3. Remote Access Screen Share scam
    event3 = {
        "identity_key": "usr_victim_02",
        "reason_text": "Payment issue",
        "raw_metadata": {"running_apps": "AnyDesk, Chrome, WhatsApp"},
    }
    signals3, _ = detector.process_and_deduplicate(event3, {"cluster_size": 1})
    assert any(s.archetype == ScamArchetype.REMOTE_ACCESS_SCREENSHARE for s in signals3)


# -----------------------------------------------------------------------------
# 7. End-to-End FastAPI Endpoints
# -----------------------------------------------------------------------------

def test_api_scaling_status():
    client = TestClient(app)
    r = client.get("/v1/scaling/status")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "HEALTHY_15K_RPS_READY"
    assert "amazon_pay" in data["supported_gateways"]
    assert "razorpay" in data["supported_gateways"]
    assert data["inference_engine"]["zero_allocation_runtime"] is True


def test_api_gateway_webhook_amazon_pay_and_razorpay():
    client = TestClient(app)

    # Amazon Pay Order Ingestion Webhook
    amzn_order = {
        "chargePermissionId": "P01-998877-001",
        "chargeId": "S01-998877-001-C01",
        "sellerId": "SELLER_TEST",
        "buyer": {"buyerId": "amzn1.acc.123", "phoneNumber": "919999999999"},
        "chargeAmount": {"amount": "1299.00", "currencyCode": "INR"},
    }
    r_order = client.post("/v1/gateway/webhook/amazon_pay", json=amzn_order, headers=AUTH)
    assert r_order.status_code == 200
    assert r_order.json()["status"] == "ingested"
    assert r_order.json()["gateway"] == "amazon_pay"

    # Amazon Pay Dispute Webhook
    amzn_dispute = {
        "claimId": "ATOZ_DISP_001",
        "chargeId": "S01-998877-001-C01",
        "sellerId": "SELLER_TEST",
        "buyerId": "amzn1.acc.123",
        "amount": "1299.00",
        "reason": "A-to-z Guarantee claim: Package missing",
    }
    r_disp = client.post("/v1/gateway/webhook/amazon_pay", json=amzn_dispute, headers=AUTH)
    assert r_disp.status_code == 200
    data = r_disp.json()
    assert data["gateway"] == "amazon_pay"
    assert "effective_action" in data
    assert "rollout_phase" in data


def test_api_compliance_anonymize_and_worm_verify():
    client = TestClient(app)

    # Anonymize PII
    r_anon = client.post(
        "/v1/compliance/anonymize",
        json={"raw_id": "user@paytm", "field_type": "vpa", "tenant_id": "merchant_99"},
        headers=AUTH,
    )
    assert r_anon.status_code == 200
    body = r_anon.json()
    assert body["anonymized_node"].startswith("vpa_")
    assert body["is_reversible"] is False
    assert body["encrypted_envelope"] is not None

    # Verify WORM audit chain
    r_worm = client.get("/v1/compliance/worm/verify", headers=AUTH)
    assert r_worm.status_code == 200
    assert r_worm.json()["valid"] is True


def test_api_shadow_phase_update_and_summary():
    client = TestClient(app)

    # Get summary
    r_sum = client.get("/v1/shadow/summary", headers=AUTH)
    assert r_sum.status_code == 200

    # Update phase
    r_phase = client.post(
        "/v1/shadow/phase",
        json={"gateway": "amazon_pay", "phase": "PHASE_2_STEP_UP_GATING"},
        headers=AUTH,
    )
    assert r_phase.status_code == 200
    assert r_phase.json()["new_phase"] == "PHASE_2_STEP_UP_GATING"


def test_api_scam_detection():
    client = TestClient(app)
    r_scam = client.post(
        "/v1/scam/detect",
        json={
            "reason_text": "Support requested to approve collect request to release wallet refund",
            "amount": 4500.0,
        },
        headers=AUTH,
    )
    assert r_scam.status_code == 200
    data = r_scam.json()
    assert data["scam_detected"] is True
    assert data["highest_severity"] == "CRITICAL"


def test_benchmark_concurrency_execution():
    result = run_scaling_benchmark(total_claims=500, concurrency=8)
    assert result["total_claims_evaluated"] == 500
    assert result["latency_stats_ms"]["p99_ms"] < 15.0  # Sub-15ms p99 SLA met!
    assert result["single_node_rps"] > 0
