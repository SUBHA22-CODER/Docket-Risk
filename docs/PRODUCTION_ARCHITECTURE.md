# Production Scaling Blueprint — Razorpay 15k+ RPS Architecture

## 1. Executive Summary

This document specifies the enterprise migration path for **Docket (Ring Sentinel)** from an in-memory single-process prototype to a distributed, multi-region Tier-1 risk scoring service handling **15,000+ Requests Per Second (RPS)** during flash sale peaks (e.g., Big Billion Days, Diwali sales).

---

## 2. Distributed Target Architecture

```mermaid
graph TD
    subgraph Edge & API Gateway
        A[Kong API Gateway / Envoy] -->|Auth & Rate Limiting| B[Kubernetes EKS Cluster<br/>50+ Pods FastAPI Worker Nodes]
    end

    subgraph Event Streaming & Async Graph Pipeline
        C[Merchant Webhook Ingestion<br/>Orders / Payments / Refunds] -->|Produce| D[Apache Kafka Cluster<br/>Topic: risk.events.raw]
        D -->|Consumer Group: graph-ingest| E[Distributed Graph Workers<br/>Union-Find & Adjacency Shards]
        E -->|Write Path| F[(Redis Cluster / Aerospike<br/>Graph State & Cluster Metadata)]
    end

    subgraph Real-Time Scoring Hot Path (<15ms SLA)
        B -->|Fetch Connected Entities| F
        B -->|Vectorized Feature Extraction| G[C++ / ONNX XGBoost Runtime<br/>In-Process Threadpool]
        G -->|Decision Matrix| H{Policy Threshold Engine}
        H -->|Auto Approve / Step-Up / Hold| I[Payment Engine Response]
    end

    subgraph Observability & Audit
        H -->|Async Publish| J[Kafka Topic: risk.decisions.audit]
        J -->|Stream to S3 / Snowflake| K[(Immutable Audit Lake)]
        B -->|Scrape /metrics| L[Prometheus / Grafana Mimir]
    end
```

---

## 3. Core Architectural Upgrades for Scale

### A. Graph Partitioning & Distributed State (Replacing in-memory Union-Find)
* **Current Prototype:** In-memory Python `ClusterState` with a global `threading.Lock`.
* **Target Production Engine:**
  * **Graph Cache:** Redis Enterprise with multi-master cluster or Aerospike Key-Value store.
  * **Entity Indexing:** Hashes of `device_id`, `vpa_id`, `phone_id`, `address_id` point to `cluster_id` sets using Redis sets (`SADD`, `SUNION`).
  * **Cluster Lookup Latency:** Single-digit millisecond latency via Redis pipelining (`MGET`).

### B. Hot-Path Model Inference Optimization (<15ms p99)
* **Runtime Conversion:** Export the trained XGBoost `.json` model to **Treelite / ONNX Runtime**.
* **Zero-Allocation Scoring:** Model inference executes in $<2.5\text{ ms}$ per claim in-process, without GIL contention or Python interpreter overhead.

### C. Security, PII Hashing & Compliance (DPDP Act & RBI Norms)
1. **Salted Hash Transformation at Edge:**
   ```python
   import hashlib, hmac

   def anonymize_infra_key(raw_id: str, salt: bytes) -> str:
       # SHA-256 HMAC ensures non-reversible PII masking across merchant tenants
       return hmac.new(salt, raw_id.encode("utf-8"), hashlib.sha256).hexdigest()[:16]
   ```
2. **Field-Level Encryption (FLE):** Raw phone numbers, VPAs, and bank account identifiers are encrypted at rest using AWS KMS envelope encryption. Only the 16-character HMAC digest enters the graph.
3. **Immutable Audit Trail:** Decision records are dual-written to an append-only S3 bucket with Object Lock (WORM compliance) for RBI financial dispute audits.

---

## 4. Rollout Strategy: Zero-Risk Shadow Mode

1. **Phase 1: Shadow Mode (Weeks 1–4):**
   * Service listens to live Kafka payout streams in passive mode.
   * Compares model risk scores against existing legacy rule holds without intercepting transactions.
   * Validates false-positive rate and friction cost on live merchant cohorts.
2. **Phase 2: Step-Up Verification Gating (Weeks 5–8):**
   * Enforces 2FA / OTP challenges on `MEDIUM` band scores ($0.50 \le \text{score} < 0.85$).
   * Measures merchant drop-off and conversion impact.
3. **Phase 3: High-Confidence Settlement Reserve (Weeks 9+):**
   * Activates automated holds on `HIGH` band scores ($\ge 0.85$) with automated Zendesk Merchant Appeal Notice generation.
