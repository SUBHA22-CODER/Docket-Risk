"""Ring Sentinel — Universal Multi-Gateway Ingestion & Normalization Layer.

Decouples Ring Sentinel from any specific payment gateway, transforming it into a
universal fraud & syndicate risk engine supporting:
- Amazon Pay (ChargePermissions, A-to-z Guarantee claims, IPN/SNS notifications)
- Razorpay (Payments, Orders, Refunds, Disputes)
- Stripe (PaymentIntents, Charges, Disputes, Radar risk tokens)
- Adyen / Cashfree / PhonePe / Shopify / Generic Marketplace payloads

All incoming gateway payloads are normalized into Canonical Events with
DPDP/RBI-compliant salted PII pseudonymization.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Type

from src.scaling.compliance import (
    DEFAULT_TENANT_SALT,
    anonymize_infra_key,
    normalize_phone,
    normalize_vpa,
)

log = logging.getLogger("ring_sentinel.gateways")


@dataclass
class CanonicalOrderEvent:
    order_id: str
    gateway: str
    tenant_id: str
    merchant_id: str
    amount: float
    currency: str
    identity_key: str
    device_id: str
    vpa_id: str
    phone_id: str
    address_id: str
    card_id: str
    ts: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    raw_metadata: dict[str, Any] = field(default_factory=dict)

    def to_ingest_dict(self) -> dict[str, Any]:
        return {
            "order_id": self.order_id,
            "identity_key": self.identity_key,
            "merchant_id": self.merchant_id,
            "device_id": self.device_id,
            "vpa_id": self.vpa_id,
            "phone_id": self.phone_id,
            "address_id": self.address_id,
            "card_id": self.card_id,
            "amount": self.amount,
            "gateway": self.gateway,
            "tenant_id": self.tenant_id,
        }


@dataclass
class CanonicalClaimEvent:
    claim_id: str
    order_id: str
    gateway: str
    tenant_id: str
    merchant_id: str
    identity_key: str
    amount: float
    currency: str
    reason_text: str
    dispute_type: str
    approved: bool = True
    ts: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    raw_metadata: dict[str, Any] = field(default_factory=dict)

    def to_score_dict(self) -> dict[str, Any]:
        return {
            "claim_id": self.claim_id,
            "identity_key": self.identity_key,
            "merchant_id": self.merchant_id,
            "amount": self.amount,
            "reason_text": self.reason_text,
            "approved": self.approved,
            "ts": self.ts,
            "gateway": self.gateway,
            "tenant_id": self.tenant_id,
        }


class BaseGatewayAdapter(ABC):
    """Abstract contract for payment gateway payload transformation and signature verification."""

    gateway_name: str = "generic"

    def __init__(self, tenant_salt: bytes | str = DEFAULT_TENANT_SALT) -> None:
        self.tenant_salt = tenant_salt

    @abstractmethod
    def parse_order(self, payload: dict[str, Any], headers: Optional[dict[str, str]] = None) -> CanonicalOrderEvent:
        """Transforms a gateway-specific order/payment authorization payload to CanonicalOrderEvent."""
        ...

    @abstractmethod
    def parse_claim(self, payload: dict[str, Any], headers: Optional[dict[str, str]] = None) -> CanonicalClaimEvent:
        """Transforms a refund/chargeback/dispute payload to CanonicalClaimEvent."""
        ...

    def verify_webhook_signature(self, body_bytes: bytes, headers: dict[str, str], secret: str) -> bool:
        """Standard HMAC-SHA256 signature verification."""
        header_sig = headers.get("X-Signature") or headers.get("x-signature") or headers.get("Signature")
        if not header_sig or not secret:
            return False
        expected = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
        return hmac.compare_digest(header_sig, expected)

    @abstractmethod
    def generate_dispute_dossier(self, claim_event: CanonicalClaimEvent, score_bundle: dict[str, Any]) -> dict[str, Any]:
        """Generates gateway-native dispute evidence for automated merchant protection."""
        ...


class AmazonPayAdapter(BaseGatewayAdapter):
    """Adapter for Amazon Pay Checkout, Charge Permissions, and A-to-z Guarantee Claims."""

    gateway_name = "amazon_pay"

    def parse_order(self, payload: dict[str, Any], headers: Optional[dict[str, str]] = None) -> CanonicalOrderEvent:
        # Handles Amazon Pay Charge Object or IPN SNS Notification wrapper
        data = payload
        if "Message" in payload and isinstance(payload["Message"], str):
            try:
                data = json.loads(payload["Message"])
            except Exception:
                pass

        charge_permission_id = data.get("chargePermissionId") or data.get("charge_permission_id") or ""
        charge_id = data.get("chargeId") or data.get("charge_id") or data.get("amazonOrderReferenceId") or f"amz_ch_{int(datetime.now().timestamp())}"
        merchant_id = data.get("merchantId") or data.get("sellerId") or "amzn_merchant_default"
        tenant_id = data.get("tenantId") or merchant_id

        # Buyer info
        buyer = data.get("buyer") or data.get("Buyer") or {}
        buyer_id = buyer.get("buyerId") or buyer.get("amazonUserId") or data.get("buyer_id") or "amzn_buyer_anon"
        buyer_phone = normalize_phone(buyer.get("phoneNumber") or buyer.get("phone") or "")
        buyer_email = (buyer.get("email") or "").strip().lower()

        # Payment / Infra attributes
        payment_pref = data.get("paymentPreferences") or [{}]
        first_pref = payment_pref[0] if isinstance(payment_pref, list) and payment_pref else {}
        card_token = first_pref.get("paymentMethodToken") or data.get("paymentToken") or ""
        vpa = normalize_vpa(first_pref.get("upiId") or data.get("vpa") or "")

        # Shipping Address
        shipping = data.get("shippingAddress") or data.get("destination") or {}
        postal_code = shipping.get("postalCode") or shipping.get("zip") or ""
        address_line = shipping.get("addressLine1") or ""
        raw_address = f"{address_line}_{postal_code}"

        # Device / Client context
        client_context = data.get("clientContext") or data.get("deviceInfo") or {}
        raw_device = client_context.get("deviceId") or client_context.get("clientIp") or data.get("ipAddress") or "amzn_device_def"

        # Charge amount
        amount_obj = data.get("chargeAmount") or data.get("amount") or {}
        amount = float(amount_obj.get("amount", 0.0)) if isinstance(amount_obj, dict) else float(data.get("amount", 0.0))
        currency = (amount_obj.get("currencyCode") if isinstance(amount_obj, dict) else data.get("currency")) or "INR"

        salt = self.tenant_salt
        ident_key = f"usr_{anonymize_infra_key(buyer_id or buyer_email, salt)}"
        device_id = anonymize_infra_key(raw_device, salt, prefix="dev_")
        vpa_id = anonymize_infra_key(vpa or f"amzn_upi_{buyer_id}", salt, prefix="vpa_")
        phone_id = anonymize_infra_key(buyer_phone or f"amzn_ph_{buyer_id}", salt, prefix="ph_")
        address_id = anonymize_infra_key(raw_address or f"amzn_adr_{buyer_id}", salt, prefix="adr_")
        card_id = anonymize_infra_key(card_token or f"amzn_card_{buyer_id}", salt, prefix="card_")

        return CanonicalOrderEvent(
            order_id=charge_id,
            gateway=self.gateway_name,
            tenant_id=tenant_id,
            merchant_id=merchant_id,
            amount=amount,
            currency=currency,
            identity_key=ident_key,
            device_id=device_id,
            vpa_id=vpa_id,
            phone_id=phone_id,
            address_id=address_id,
            card_id=card_id,
            raw_metadata={"chargePermissionId": charge_permission_id, "original_payload": data},
        )

    def parse_claim(self, payload: dict[str, Any], headers: Optional[dict[str, str]] = None) -> CanonicalClaimEvent:
        data = payload
        if "Message" in payload and isinstance(payload["Message"], str):
            try:
                data = json.loads(payload["Message"])
            except Exception:
                pass

        claim_id = data.get("claimId") or data.get("refundId") or data.get("disputeId") or f"amzn_clm_{int(datetime.now().timestamp())}"
        order_id = data.get("chargeId") or data.get("orderId") or data.get("chargePermissionId") or ""
        merchant_id = data.get("merchantId") or data.get("sellerId") or "amzn_merchant_default"
        tenant_id = data.get("tenantId") or merchant_id

        buyer_id = data.get("buyerId") or data.get("buyer", {}).get("buyerId") or "amzn_buyer_anon"
        ident_key = f"usr_{anonymize_infra_key(buyer_id, self.tenant_salt)}"

        amount_obj = data.get("refundAmount") or data.get("disputeAmount") or data.get("amount") or {}
        amount = float(amount_obj.get("amount", 0.0)) if isinstance(amount_obj, dict) else float(data.get("amount", 0.0))
        currency = (amount_obj.get("currencyCode") if isinstance(amount_obj, dict) else data.get("currency")) or "INR"

        reason = data.get("reasonDescription") or data.get("disputeReason") or data.get("reason") or "A-to-z Guarantee Dispute"
        dispute_type = data.get("disputeType") or ("a_to_z_claim" if "A-to-z" in reason else "chargeback")

        return CanonicalClaimEvent(
            claim_id=claim_id,
            order_id=order_id,
            gateway=self.gateway_name,
            tenant_id=tenant_id,
            merchant_id=merchant_id,
            identity_key=ident_key,
            amount=amount,
            currency=currency,
            reason_text=reason,
            dispute_type=dispute_type,
            approved=data.get("approved", True),
            raw_metadata=data,
        )

    def generate_dispute_dossier(self, claim_event: CanonicalClaimEvent, score_bundle: dict[str, Any]) -> dict[str, Any]:
        """Creates an Amazon Pay A-to-z Guarantee Appeal Package."""
        evidence = score_bundle.get("evidence", {})
        score = score_bundle.get("score", 0.0)
        action = score_bundle.get("action", "HOLD_PAYOUT_HUMAN_REVIEW")

        return {
            "appealChannel": "AmazonPay_A_to_Z_Guarantee_Service",
            "chargeId": claim_event.order_id,
            "claimId": claim_event.claim_id,
            "merchantResponse": "CONTEST_DISPUTE_SYNDICATE_FRAUD_DETECTED",
            "fraudRiskScore": score,
            "decisionAction": action,
            "evidenceSummary": (
                f"Automated syndicate investigation flagged buyer {claim_event.identity_key} "
                f"sharing infrastructure with {evidence.get('cluster_size', 1)} identities across "
                f"{evidence.get('cluster_merchant_span', 1)} merchants. Claim velocity burst: "
                f"{evidence.get('recent_cluster_claims_7d', 0)} claims in 7 days."
            ),
            "evidenceDetails": {
                "bipartiteClusterSize": evidence.get("cluster_size", 1),
                "deviceSharingNeighbors": evidence.get("shared_infra_neighbor_count", 0),
                "reasonTextReuseDetected": evidence.get("reason_text_reused_across_identities", False),
            },
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }


class RazorpayAdapter(BaseGatewayAdapter):
    """Adapter for Razorpay Payments, Orders, Refunds, and Disputes."""

    gateway_name = "razorpay"

    def parse_order(self, payload: dict[str, Any], headers: Optional[dict[str, str]] = None) -> CanonicalOrderEvent:
        # Check standard Razorpay webhook wrapper (e.g. event == "order.paid" or payload.payment.entity)
        entity = payload
        if "payload" in payload and "payment" in payload["payload"]:
            entity = payload["payload"]["payment"]["entity"]
        elif "payload" in payload and "order" in payload["payload"]:
            entity = payload["payload"]["order"]["entity"]
        elif "entity" in payload:
            entity = payload["entity"]

        order_id = entity.get("order_id") or entity.get("id") or f"order_{int(datetime.now().timestamp())}"
        merchant_id = entity.get("merchant_id") or entity.get("account_id") or payload.get("account_id") or "rzp_merchant_default"
        tenant_id = entity.get("tenant_id") or merchant_id

        # Raw identifiers
        raw_contact = normalize_phone(entity.get("contact") or "")
        raw_email = (entity.get("email") or "").strip().lower()
        raw_vpa = normalize_vpa(entity.get("vpa") or "")
        card_id = entity.get("card_id") or ""
        notes = entity.get("notes") or {}
        raw_device = notes.get("device_id") or entity.get("device_id") or notes.get("ip") or "rzp_dev_default"
        raw_address = notes.get("address_id") or notes.get("shipping_pin") or "rzp_adr_default"

        # Amount in paise -> convert to rupees
        amount_raw = float(entity.get("amount", 0.0))
        amount = amount_raw / 100.0 if amount_raw > 1000 and "currency" in entity and entity["currency"] == "INR" else amount_raw
        currency = entity.get("currency", "INR")

        salt = self.tenant_salt
        ident_seed = raw_email or raw_contact or order_id
        ident_key = f"usr_{anonymize_infra_key(ident_seed, salt)}"
        device_node = anonymize_infra_key(raw_device, salt, prefix="dev_")
        vpa_node = anonymize_infra_key(raw_vpa or f"rzp_upi_{ident_seed}", salt, prefix="vpa_")
        phone_node = anonymize_infra_key(raw_contact or f"rzp_ph_{ident_seed}", salt, prefix="ph_")
        address_node = anonymize_infra_key(raw_address, salt, prefix="adr_")
        card_node = anonymize_infra_key(card_id or f"rzp_card_{ident_seed}", salt, prefix="card_")

        return CanonicalOrderEvent(
            order_id=order_id,
            gateway=self.gateway_name,
            tenant_id=tenant_id,
            merchant_id=merchant_id,
            amount=amount,
            currency=currency,
            identity_key=ident_key,
            device_id=device_node,
            vpa_id=vpa_node,
            phone_id=phone_node,
            address_id=address_node,
            card_id=card_node,
            raw_metadata=payload,
        )

    def parse_claim(self, payload: dict[str, Any], headers: Optional[dict[str, str]] = None) -> CanonicalClaimEvent:
        entity = payload
        if "payload" in payload and "dispute" in payload["payload"]:
            entity = payload["payload"]["dispute"]["entity"]
        elif "payload" in payload and "refund" in payload["payload"]:
            entity = payload["payload"]["refund"]["entity"]

        claim_id = entity.get("id") or f"disp_{int(datetime.now().timestamp())}"
        order_id = entity.get("payment_id") or entity.get("order_id") or ""
        merchant_id = payload.get("account_id") or entity.get("merchant_id") or "rzp_merchant_default"
        tenant_id = entity.get("tenant_id") or merchant_id

        amount_raw = float(entity.get("amount", 0.0))
        amount = amount_raw / 100.0 if amount_raw > 1000 else amount_raw
        currency = entity.get("currency", "INR")

        reason = entity.get("reason_code") or entity.get("reason") or "chargeback_dispute"
        dispute_type = "dispute" if "dispute" in payload.get("event", "") else "refund"

        ident_seed = entity.get("customer_id") or entity.get("contact") or claim_id
        ident_key = f"usr_{anonymize_infra_key(ident_seed, self.tenant_salt)}"

        return CanonicalClaimEvent(
            claim_id=claim_id,
            order_id=order_id,
            gateway=self.gateway_name,
            tenant_id=tenant_id,
            merchant_id=merchant_id,
            identity_key=ident_key,
            amount=amount,
            currency=currency,
            reason_text=reason,
            dispute_type=dispute_type,
            approved=entity.get("status") != "rejected",
            raw_metadata=payload,
        )

    def generate_dispute_dossier(self, claim_event: CanonicalClaimEvent, score_bundle: dict[str, Any]) -> dict[str, Any]:
        """Creates a Razorpay Dispute Representation Payload."""
        evidence = score_bundle.get("evidence", {})
        return {
            "dispute_id": claim_event.claim_id,
            "action": "represent_dispute",
            "summary": "Ring Sentinel identified this charge as an coordinated syndication claim.",
            "metrics": {
                "model_risk_score": score_bundle.get("score"),
                "syndicate_cluster_size": evidence.get("cluster_size"),
                "prior_merchant_span": evidence.get("cluster_merchant_span"),
            },
            "documents": [
                {"type": "syndicate_graph_analysis", "format": "JSON_EVIDENCE", "reference": claim_event.claim_id}
            ],
            "submitted_ts": datetime.now(timezone.utc).isoformat(),
        }


class StripeAdapter(BaseGatewayAdapter):
    """Adapter for Stripe PaymentIntents, Radar Risk, and Charge Disputes."""

    gateway_name = "stripe"

    def parse_order(self, payload: dict[str, Any], headers: Optional[dict[str, str]] = None) -> CanonicalOrderEvent:
        obj = payload.get("data", {}).get("object", payload)
        order_id = obj.get("id") or f"pi_{int(datetime.now().timestamp())}"
        merchant_id = payload.get("account") or obj.get("on_behalf_of") or "acct_stripe_default"
        tenant_id = payload.get("tenant_id") or merchant_id

        customer = obj.get("customer") or obj.get("receipt_email") or order_id
        billing = obj.get("charges", {}).get("data", [{}])[0].get("billing_details", {}) if "charges" in obj else {}
        phone = normalize_phone(billing.get("phone") or "")
        email = (billing.get("email") or "").strip().lower()
        address = billing.get("address", {})
        raw_address = f"{address.get('line1','')}_{address.get('postal_code','')}"

        # Card / Payment Method
        pm_details = obj.get("payment_method_details", {})
        card_fingerprint = pm_details.get("card", {}).get("fingerprint") or ""

        # Amount
        amount = float(obj.get("amount", 0.0)) / 100.0
        currency = (obj.get("currency") or "USD").upper()

        salt = self.tenant_salt
        ident_seed = customer or email or phone
        ident_key = f"usr_{anonymize_infra_key(ident_seed, salt)}"
        device_node = anonymize_infra_key(obj.get("client_ip", "stripe_dev"), salt, prefix="dev_")
        vpa_node = anonymize_infra_key(f"stripe_pm_{customer}", salt, prefix="vpa_")
        phone_node = anonymize_infra_key(phone or f"stripe_ph_{ident_seed}", salt, prefix="ph_")
        address_node = anonymize_infra_key(raw_address or f"stripe_adr_{ident_seed}", salt, prefix="adr_")
        card_node = anonymize_infra_key(card_fingerprint or f"stripe_card_{ident_seed}", salt, prefix="card_")

        return CanonicalOrderEvent(
            order_id=order_id,
            gateway=self.gateway_name,
            tenant_id=tenant_id,
            merchant_id=merchant_id,
            amount=amount,
            currency=currency,
            identity_key=ident_key,
            device_id=device_node,
            vpa_id=vpa_node,
            phone_id=phone_node,
            address_id=address_node,
            card_id=card_node,
            raw_metadata=payload,
        )

    def parse_claim(self, payload: dict[str, Any], headers: Optional[dict[str, str]] = None) -> CanonicalClaimEvent:
        obj = payload.get("data", {}).get("object", payload)
        claim_id = obj.get("id") or f"dp_{int(datetime.now().timestamp())}"
        order_id = obj.get("payment_intent") or obj.get("charge") or ""
        merchant_id = payload.get("account") or "acct_stripe_default"

        amount = float(obj.get("amount", 0.0)) / 100.0
        currency = (obj.get("currency") or "USD").upper()
        reason = obj.get("reason") or "fraudulent"

        ident_key = f"usr_{anonymize_infra_key(claim_id, self.tenant_salt)}"

        return CanonicalClaimEvent(
            claim_id=claim_id,
            order_id=order_id,
            gateway=self.gateway_name,
            tenant_id=merchant_id,
            merchant_id=merchant_id,
            identity_key=ident_key,
            amount=amount,
            currency=currency,
            reason_text=reason,
            dispute_type="chargeback",
            approved=True,
            raw_metadata=payload,
        )

    def generate_dispute_dossier(self, claim_event: CanonicalClaimEvent, score_bundle: dict[str, Any]) -> dict[str, Any]:
        return {
            "dispute": claim_event.claim_id,
            "evidence": {
                "uncategorized_text": (
                    f"Ring Sentinel syndicate graph proof: Cluster size {score_bundle.get('evidence', {}).get('cluster_size', 1)}, "
                    f"Risk score: {score_bundle.get('score', 0.0)}."
                )
            },
        }


class GenericGatewayAdapter(BaseGatewayAdapter):
    """Universal standard JSON adapter for custom ERPs, marketplaces, and payment aggregators."""

    gateway_name = "generic"

    def parse_order(self, payload: dict[str, Any], headers: Optional[dict[str, str]] = None) -> CanonicalOrderEvent:
        salt = self.tenant_salt
        ident = payload.get("identity_key") or payload.get("user_id") or payload.get("customer_id") or "usr_generic"
        if not ident.startswith("usr_"):
            ident = f"usr_{anonymize_infra_key(ident, salt)}"

        dev = payload.get("device_id") or "dev_default"
        if not dev.startswith("dev_"):
            dev = anonymize_infra_key(dev, salt, prefix="dev_")

        vpa = payload.get("vpa_id") or payload.get("vpa") or "vpa_default"
        if not vpa.startswith("vpa_"):
            vpa = anonymize_infra_key(normalize_vpa(vpa), salt, prefix="vpa_")

        ph = payload.get("phone_id") or payload.get("phone") or "ph_default"
        if not ph.startswith("ph_"):
            ph = anonymize_infra_key(normalize_phone(ph), salt, prefix="ph_")

        adr = payload.get("address_id") or payload.get("address") or "adr_default"
        if not adr.startswith("adr_"):
            adr = anonymize_infra_key(adr, salt, prefix="adr_")

        card = payload.get("card_id") or payload.get("card") or "card_default"
        if not card.startswith("card_"):
            card = anonymize_infra_key(card, salt, prefix="card_")

        return CanonicalOrderEvent(
            order_id=payload.get("order_id") or f"ord_{int(datetime.now().timestamp())}",
            gateway=payload.get("gateway", self.gateway_name),
            tenant_id=payload.get("tenant_id") or payload.get("merchant_id", "tenant_default"),
            merchant_id=payload.get("merchant_id", "merchant_default"),
            amount=float(payload.get("amount", 0.0)),
            currency=payload.get("currency", "INR"),
            identity_key=ident,
            device_id=dev,
            vpa_id=vpa,
            phone_id=ph,
            address_id=adr,
            card_id=card,
            raw_metadata=payload,
        )

    def parse_claim(self, payload: dict[str, Any], headers: Optional[dict[str, str]] = None) -> CanonicalClaimEvent:
        salt = self.tenant_salt
        ident = payload.get("identity_key") or payload.get("user_id") or payload.get("customer_id") or "usr_generic"
        if not ident.startswith("usr_"):
            ident = f"usr_{anonymize_infra_key(ident, salt)}"

        return CanonicalClaimEvent(
            claim_id=payload.get("claim_id") or f"clm_{int(datetime.now().timestamp())}",
            order_id=payload.get("order_id", ""),
            gateway=payload.get("gateway", self.gateway_name),
            tenant_id=payload.get("tenant_id") or payload.get("merchant_id", "tenant_default"),
            merchant_id=payload.get("merchant_id", "merchant_default"),
            identity_key=ident,
            amount=float(payload.get("amount", 0.0)),
            currency=payload.get("currency", "INR"),
            reason_text=payload.get("reason_text", "generic_claim"),
            dispute_type=payload.get("dispute_type", "claim"),
            approved=payload.get("approved", True),
            raw_metadata=payload,
        )

    def generate_dispute_dossier(self, claim_event: CanonicalClaimEvent, score_bundle: dict[str, Any]) -> dict[str, Any]:
        return {
            "dispute_id": claim_event.claim_id,
            "evidence": score_bundle.get("evidence", {}),
            "score": score_bundle.get("score"),
            "action": score_bundle.get("action"),
        }


class GatewayRegistry:
    """Dynamic gateway registry with multi-tenant routing and signature verification."""

    def __init__(self) -> None:
        self._adapters: dict[str, Type[BaseGatewayAdapter]] = {}
        self.register("amazon_pay", AmazonPayAdapter)
        self.register("razorpay", RazorpayAdapter)
        self.register("stripe", StripeAdapter)
        self.register("generic", GenericGatewayAdapter)

    def register(self, name: str, adapter_cls: Type[BaseGatewayAdapter]) -> None:
        self._adapters[name.lower()] = adapter_cls

    def get_adapter(self, name: str, tenant_salt: bytes | str = DEFAULT_TENANT_SALT) -> BaseGatewayAdapter:
        cls = self._adapters.get(name.lower(), GenericGatewayAdapter)
        return cls(tenant_salt=tenant_salt)

    def supported_gateways(self) -> list[str]:
        return sorted(self._adapters.keys())


GATEWAY_REGISTRY = GatewayRegistry()
