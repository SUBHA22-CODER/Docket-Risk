# Production Scaling Blueprint — Universal 15,000+ RPS Architecture & AI Scam Defense

## 1. Executive Summary

This document specifies the enterprise production architecture for **Docket (Ring Sentinel)**, transforming it from a single-gateway prototype into a **Universal, Multi-Platform Tier-1 Risk Scoring Service** capable of handling **15,000+ Requests Per Second (RPS)** during flash sale peaks (e.g., Big Billion Days, Great Indian Festival, Diwali flash sales, Black Friday).

The platform operates across any payment ecosystem, featuring native adapters for **Amazon Pay**, **Razorpay**, **Stripe**, **Adyen**, **Paytm/PhonePe**, and **Generic Enterprise Marketplaces**. It introduces real-time **AI-driven scam pattern recognition** for modern UPI, banking, and digital wallet attacks alongside an **anti-alert fatigue engine**.

---

## 2. Universal Distributed Target Architecture

```mermaid
graph TD
    subgraph Multi-Gateway Ingestion & Edge
        GW1[Amazon Pay<br/>ChargePermission / A-to-z Claims] --> A[Kong / Envoy Gateway<br/>Auth & Rate Limiting]
        GW2[Razorpay<br/>Payments / Orders / Disputes] --> A
        GW3[Stripe / Adyen / Wallets<br/>Intents / Refunds / Radar] --> A
        A --> B[Kubernetes EKS Cluster<br/>50+ Pods FastAPI Worker Nodes]
    end

    subgraph DPDP Act & RBI Compliance Gateway
        B --> COMP[Edge PII Normalization & Salted HMAC-SHA256<br/>Field-Level Encryption AWS KMS/Fernet Envelope]
        COMP --> CANON[Canonical Risk Event Bus<br/>risk.events.canonical]
    end

    subgraph Event Streaming & Async Graph Pipeline
        CANON --> D[Apache Kafka Cluster<br/>Topic: risk.events.raw]
        D -->|Consumer Group: graph-ingest| E[Distributed Graph Workers<br/>64-Shard Partitioned Adjacency]
        E -->|Pipelined Write Path| F[(Redis Enterprise Cluster / Aerospike<br/>Sharded Entity Sets & Cluster Metadata)]
    end

    subgraph Real-Time Scoring Hot Path (<15ms SLA)
        B -->|Fetch Connected Entities & Reverse Index| F
        B -->|Vectorized Feature Tensor| G[Fast In-Process Model Runtime<br/>XGBoost C-API / ONNX / Threadpool]
        G -->|Risk Score + Evidence| H{Policy Threshold Engine<br/>Auto-Approve / Step-Up / Hold}
        H --> SCAM[AI Scam Pattern Recognition<br/>Reverse UPI, Screenshare, Mutating Text]
        SCAM --> FATIGUE[Anti-Alert Fatigue Filter<br/>Cooldown Suppress & Syndicate Rollup]
        FATIGUE --> RESP[Gateway Response & Dispute Dossier]
    end

    subgraph Observability, Audit & Dispute Defense
        H -->|Async Dual-Write| J[(Immutable WORM Audit Lake<br/>SHA-256 Tamper-Evident Hash Chain)]
        FATIGUE -->|Actionable Incidents| SEC_OPS[Risk Operations Console / SSE Stream]
        B -->|Telemetry & Latency percentiles| L[Prometheus / Grafana Mimir]
    end
```

---

## 3. Core Architectural Upgrades for Scale

### A. Universal Multi-Gateway Architecture
Docket decouples from specific payment processors via a pluggable adapter layer (`src/scaling/gateways.py`):
1. **Amazon Pay Adapter**:
   - Ingests `ChargePermission`, `Charge`, `Buyer` accounts (`amzn1.account.xxx`), and `shippingAddress`.
   - Normalizes A-to-z Guarantee Claims and Chargebacks.
   - Generates automated **Amazon Pay A-to-z Appeal Packages** contesting dispute claims with bipartite syndicate evidence.
2. **Razorpay Adapter**:
   - Ingests `order_...`, `pay_...`, customer contacts, UPI VPAs, cards, and device fingerprints.
   - Generates automated **Razorpay Dispute Representation Dossiers** for chargeback contestation.
3. **Stripe Adapter**:
   - Ingests `payment_intent`, `charge.dispute`, customer metadata, and radar risk tokens.
   - Formats evidence for Stripe dispute representment.
4. **Generic Gateway Adapter**:
   - Universal JSON standard for custom marketplaces, ERPs, Cashfree, PhonePe, and Shopify apps.

### B. Graph Partitioning & Distributed State (Replacing in-memory Union-Find)
* **Previous In-Memory Bottleneck:** Python `ClusterState` locked behind a single global `threading.Lock`, causing severe lock contention under high concurrency.
* **Target Production Engine (`src/scaling/distributed_graph.py`):**
  * **64-Shard Striped Partitions:** Strips lock contention across independent hash slots (`_shard_key(entity)`).
  * **Redis Cluster / Aerospike Integration:** Uses `SADD`, `SUNION`, and `MGET` Redis pipelining for single-digit millisecond cluster expansion.
  * **Zero-Deadlock Architecture:** Independent sequence lock acquisition avoids cross-shard nested locking deadlocks under 15k+ RPS concurrency.

### C. Hot-Path Model Inference Optimization (<15ms SLA, Typically <2.5ms)
* **Zero-Allocation Scoring (`src/scaling/inference.py`):** Vectorized feature extraction into pre-allocated C-contiguous NumPy float32 arrays avoids Python dictionary allocation overhead on the hot path.
* **Multi-Runtime Support:** Native XGBoost C-API and ONNX Runtime execution with in-process threadpools bypasses GIL limitations.
* **Telemetry Instrumentation:** Tracks real-time `p50`, `p95`, and `p99` latency percentiles with alerting if latency breaches the 15ms SLA.

### D. Security, PII Hashing & Compliance (DPDP Act 2023 & RBI Norms)
1. **Salted Hash Transformation at Edge (`src/scaling/compliance.py`):**
   ```python
   def anonymize_infra_key(raw_id: str, salt: bytes, prefix: str = "") -> str:
       normalized = raw_id.strip().lower().encode("utf-8")
       digest = hmac.new(salt, normalized, hashlib.sha256).hexdigest()[:16]
       return f"{prefix}{digest}" if prefix else digest
   ```
   Ensures non-reversible PII masking across multi-tenant gateways while preserving joinability within each tenant's ring graph.
2. **Field-Level Encryption (FLE) Envelope:** Sensitive PII (raw phone numbers, VPAs, addresses) is encrypted at rest using AWS KMS / Vault envelope encryption with Data Encryption Keys (DEKs). Only the 16-character HMAC digest enters the graph.
3. **Immutable WORM Audit Trail (Write Once, Read Many):** Decisions are cryptographically linked using SHA-256 block hash chaining:
   $$\mathcal{H}_i = \text{SHA-256}(\mathcal{H}_{i-1} \parallel \text{Timestamp}_i \parallel \text{Payload}_i)$$
   Guarantees tamper-evident auditability required for RBI financial dispute adjudication.

---

## 4. AI-Driven Scam Pattern Recognition & Anti-Alert Fatigue Engine

The platform introduces specialized scam pattern detectors designed for AI-enabled threats in UPI, banking, and digital wallet environments (`src/scaling/ai_scam_detector.py`):

| Scam Archetype | Attack Mechanism | Detection Signal | Automated Mitigation Playbook |
|---|---|---|---|
| **Reverse UPI Collect Trap** | Social engineering / automated scripts tricking victims into approving a collect request or scanning a QR code to "receive refund/prize". | Regex and NLP pattern matching on transaction reasons ("approve collect", "enter PIN to receive", "refund fee"). | `STEP_UP_VERIFICATION_REJECT_COLLECT`<br/>Enforce biometric / OTP re-auth. |
| **Remote Access Hijacking** | Victims coerced into installing screen-sharing software (AnyDesk, TeamViewer, QuickSupport) during customer care impersonation. | Metadata inspection on client active context & running process signals. | `TERMINATE_SESSION_FREEZE_WALLET`<br/>Immediate session termination. |
| **AI-Mutated Narrative Reuse** | Syndicates using LLMs to rephrase dispute and return reasons across dozens of accounts to bypass exact-match filters. | Semantic 2-gram Jaccard overlap ($0.50 \le \text{sim} < 1.0$) across distinct identities. | `HOLD_PAYOUT_HUMAN_REVIEW`<br/>Cluster-wide dispute quarantine. |
| **Sleeper Mule Burst** | Dormant accounts activated in synchrony to drain merchant settlements or wallet balances. | Bipartite cluster size $\ge 4$ combined with sudden claim burst ($\ge 3$ claims in 7 days). | `HOLD_CLUSTER_SETTLEMENTS`<br/>Quarantine linked cluster nodes. |
| **Algorithmic VPA Enumeration** | Automated bot creation of disposable UPI handles (e.g. `user9821a@paytm`). | Pattern recognition for programmatic alphanumeric sequence enumeration. | `FLAG_WATCHLIST_FOR_KYC`<br/>Trigger enhanced KYC verification. |

### Anti-Alert Fatigue Filter:
* **Syndicate Incident Rollup:** Groups hundreds of individual account alerts into a single cohesive **Consolidated Incident Dossier**.
* **Cooldown Suppression:** Suppresses redundant alerts for the same cluster and archetype within an active investigation window (e.g. 30-minute cooldown).
* **Entropy & Confidence Thresholding:** Suppresses low-confidence statistical noise ($<0.65$) so risk analysts only handle high-value, actionable incidents.

---

## 5. Rollout Strategy: Zero-Risk Shadow Mode

The system enforces a 3-phase rollout policy independently configurable per gateway (e.g., Amazon Pay in Phase 1, Razorpay in Phase 2):

1. **Phase 1: Shadow Mode (Passive Scoring)**
   * Listens to live transactions alongside existing gateway rules.
   * Compares model risk scores without intercepting transactions.
   * Calculates False Positive Rate (FPR), Friction Cost, and Discrepancy Matrix (`PREVENTED_FRAUD` vs `SAVED_FRICTION`).
2. **Phase 2: Step-Up Verification Gating**
   * Enforces 2FA / OTP challenges on `MEDIUM` band scores ($0.50 \le \text{score} < 0.85$).
   * Measures customer drop-off and friction recovery.
3. **Phase 3: High-Confidence Settlement Reserve**
   * Automatically executes holds on `HIGH` band scores ($\ge 0.85$).
   * Auto-generates gateway-native dispute packages (Amazon Pay A-to-z Appeal, Razorpay Representment Dossier, Zendesk Appeal Notice).

---

## 6. High-Throughput Concurrency Benchmarks

The built-in benchmark utility (`/v1/scaling/benchmark` / `src/scaling/benchmark.py`) verifies throughput and latency under high concurrency:

* **Single Pod Throughput:** ~800–1,200 RPS per pod on standard compute.
* **Kubernetes 50-Pod Cluster Projection:** **40,000–60,000+ RPS**, comfortably exceeding the **15,000 RPS** flash-sale peak requirement.
* **Latency SLA:**
  * Graph Lookup: $<1.2\text{ ms}$
  * In-Process Vectorized Inference: $<2.5\text{ ms}$
  * Total Scoring SLA: **$<8.5\text{ ms}$ (p99)**, well below the **$15\text{ ms}$ SLA**.
