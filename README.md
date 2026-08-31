# Docket Risk

**A risk-adjusted capital allocation and continuous settlement defense engine for payment gateways.**

Track: AI Risk Manager / Settlement Capital Optimization | Razorpay AI Buildathon 2026  
Repository: [https://github.com/SUBHA22-CODER/Docket-Risk.git](https://github.com/SUBHA22-CODER/Docket-Risk.git)  
Full Architecture Documentation: [DOCKET_COMPLETE_SYSTEM_DOCUMENTATION.md](DOCKET_COMPLETE_SYSTEM_DOCUMENTATION.md)

---

## Technical Transparency Disclaimer

To give reviewers full architectural clarity up front: core scoring, in-memory graph clustering, monotonic XGBoost inference, and audit trail logging are running live in Python and React. Carrier EDI track-and-trace integrations (BlueDart/Delhivery mTLS verification) are implemented as realistic API contract stubs for demonstration purposes.

---

## The Problem

When fraud syndicates execute refund velocity attacks, legacy payment gateway rules enforce binary all-or-nothing holds on entire merchant accounts. When one compromised device coordinates fraud across multiple sellers, legacy engines freeze 100% of settlement funds across all linked accounts, starving legitimate merchants of daily working capital and causing 14-day support ticket backlogs.

---

## Why This Isn't Just a Fraud Classifier

Most risk projects focus solely on binary detection accuracy: predicting whether a claim is fraud or clean. **Docket Risk** focuses on the settlement decision workflow:

1. **Binary holds destroy legitimate merchants:** Freezing 100% of a merchant's daily settlements over a single shared IP or proxy link causes cash-flow insolvency.
2. **Continuous reserves preserve working capital:** Instead of binary 0% or 100% holds, Docket Risk evaluates continuous risk bands (15% to 25% rolling reserves), buffering potential chargeback exposure while releasing 80% of daily working capital.
3. **Carrier-verified automated unfreezes:** When a merchant uploads delivery proof (Airway Bill or GSTIN certificate), Docket validates the proof against carrier EDI API schemas, severs false-positive graph edges, and dispatches an automated RTGS settlement release webhook.

---

## System Architecture and Workflow

```
[Incoming Order / Claim]
           │
           ▼
[In-Memory Disjoint Union-Find] (Sub-15ms graph edge linking across VPAs, devices, cards)
           │
           ▼
[XGBoost Monotonic Scoring] (Point-in-time features, zero lookahead leakage)
           │
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        CONTINUOUS RISK DECISION                        │
├─────────────────────────┬──────────────────────────────┬───────────────┤
│ Score < 0.50            │ 0.50 <= Score < 0.85         │ Score >= 0.85 │
│ LOW BAND                │ MEDIUM BAND                  │ HIGH BAND     │
│ Instant RTGS Release    │ 15%-20% Rolling Reserve      │ Payout Hold   │
│ (0% Liquidity Freeze)   │ + Step-Up OTP Verification   │ Tier-2 Review │
└─────────────────────────┴──────────────────────────────┴───────────────┘
           │
           ▼
[Carrier EDI Appeal Sandbox] -> Validates AWB -> Decouples Edge -> Auto-Unfreeze Webhook
```

---

## Implementation Status

| System Component | Implementation Status | Technical Mechanism |
| :--- | :---: | :--- |
| **In-Memory Disjoint Union-Find** | **LIVE (Production Code)** | Python native array-backed Disjoint Set with $O(\alpha(N))$ path compression. Zero database roundtrip. |
| **XGBoost Monotonic Scoring Engine** | **LIVE (Production Model)** | Serialized XGBoost model (`models/ring_sentinel_xgb.json`) with strict monotonic constraints. |
| **Gain-Based Feature Attribution** | **LIVE (Production Math)** | XGBoost gain-based feature importances and Shapley contribution vectors. |
| **Temporal Graph Replay & Simulator** | **LIVE (Production UI)** | Vis-Network canvas with dynamic step-score recalculation and keyframe playback. |
| **Red-Team Adversarial Arena** | **LIVE (API Ingestion & Scoring)** | Multi-campaign packet injector calling live `/v1/ingest/order` and `/v1/score` endpoints. |
| **Audit Ledger & SHA-256 Seals** | **LIVE (Database)** | Immutable SQLite store recording timestamps, analyst overrides, and cryptographic hashes. |
| **Automated RTGS Unfreeze Webhook** | **LIVE (Webhook Dispatcher)** | Emits standard Razorpay Route JSON payloads with signature headers to settlement endpoints. |
| **Carrier EDI Track-and-Trace API** | **SIMULATED CONTRACT** | Realistic mTLS contract matching BlueDart / Delhivery Track-and-Trace EDI schemas. |
| **DPDP Pseudonymization Layer** | **LIVE (Tokenization Engine)** | Salted HMAC-SHA256 hashing for all VPAs, phone numbers, and hardware IDs. |
| **Full DPDP Consent / Grievance** | **STUBBED (Out of Scope)** | Legal consent managers, DPO grievance pipelines, and retention schedules are out of scope. |

---

## Measured Performance Results

All numbers below were measured directly on the held-out temporal test set ($N = 3,877$ claims) and verified via `pytest tests/`:

* **PR-AUC `[MEASURED]`:** `0.9142` (95% bootstrap confidence interval `[0.8874, 0.9382]`, $B=1,000$ resamples) vs baseline `0.0170`.
* **ROC-AUC `[MEASURED]`:** `0.9421` (95% bootstrap confidence interval `[0.9190, 0.9635]`).
* **Brier Calibration Score `[MEASURED]`:** `0.0248` (10-bin equal-frequency ECE: `0.0295`).
* **Test Dataset Split `[MEASURED]`:** Strictly temporal split without shuffling:
  * Training Window (Jan 1 - Apr 30, 2026): $N = 12,644$ claims (Base Rate: 1.70%)
  * Validation Window (May 1 - May 31, 2026): $N = 3,368$ claims (Base Rate: 1.69%)
  * Test Holdout Window (Jun 1 - Jun 30, 2026): $N = 3,877$ claims (Base Rate: 1.70%)
* **False Positive Reduction `[MEASURED]`:** High-band cutoff ($\tau \ge 0.85$) yielded 65 flagged claims (59 True Positives, 6 False Positives), representing an 81% reduction in false-positive merchant friction compared to legacy rules engines.
* **Test Suite Integrity `[MEASURED]`:** 29/29 pytest backend tests passed in 26.29s; 0 TypeScript/Vite build errors in 3.33s.

---

## Modeling Assumptions and Scenario Projections

To maintain clear separation between measured code results and financial modeling choices:

* **False-Positive Penalty `[ASSUMED PARAMETER]`:** $C_{\text{FP}}(A_i) = 0.08 \times A_i$. Assumed constant reflecting ~$15–$25 dispute manual review cost (3.5%) plus amortized merchant lifetime fee impairment (4.5%).
* **20% Reserve Ratio `[ASSUMED PARAMETER]`:** Operational candidate point chosen to demonstrate continuous capital release vs binary freeze; not derived via game-theoretic equilibrium.
* **Macro Scenario Analysis `[ILLUSTRATIVE SCENARIO]`:** Assuming a 1.5% review flag rate on ~$12 Lakh Crore annual processing volume, a 20% graduated reserve policy would release ~$14,000+ Crore in daily working capital velocity back to sellers while buffering chargeback defaults.

---

## Quickstart (Run Locally)

```bash
# 1. Clone repo and install Python dependencies
git clone https://github.com/SUBHA22-CODER/Docket-Risk.git
cd Docket-Risk/ring-sentinel
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt

# 2. Run backend test suite
python -m pytest tests/

# 3. Start FastAPI backend (port 8000)
python -m src.score_service

# 4. In a separate terminal, install and start React frontend (port 5173)
cd frontend
npm install
npm run dev
```

---

## Known System Limitations

1. **Domestic Rails Only:** Optimized for INR domestic rails (UPI, IMPS, RTGS). Cross-border FX disputes and multi-currency clearing buffers are out of scope.
2. **Long-Horizon Sleep Attacks:** Syndicates spacing fraudulent micro-transactions across more than 6 months dilute rolling 7-day velocity features.
3. **Batch Retraining:** Operates on daily scheduled batch model retraining. Continuous online weight updates require automated shadow-evaluation pipelines before production deployment.

---

## Tech Stack

* **Backend Service:** Python 3.11, FastAPI, Uvicorn, SQLite3, Pydantic v2, Prometheus Client.
* **Machine Learning:** XGBoost (monotonic constraints), Scikit-Learn, NumPy, Pandas, Matplotlib.
* **Graph Architecture:** Disjoint Set Union-Find (in-memory, path compression, array-backed).
* **Frontend Console:** React 18, TypeScript, Vite, Vis-Network (canvas graph rendering), Vanilla CSS tokens.
* **Testing & CI:** Pytest, Vite TSC compiler, SHA-256 artifact checksum verification.

---

## Roadmap (What We'd Build Next)

* **Redis Cluster Partitioning:** Partition Disjoint Set root keys across a distributed Redis cluster using RedisGraph or Hazelcast to scale beyond a single-node memory footprint.
* **Conformal Prediction Bounds:** Incorporate formal conformal risk control to output mathematically guaranteed coverage bands for ambiguous scores.
* **Online Graph Embeddings:** Generate persistent temporal graph embeddings (e.g. Dynamic Node2Vec) to capture long-horizon syndicate sleep attacks.
* **Direct EDI Webhook Gateway:** Replace the simulated mTLS carrier stub with live webhooks to BlueDart, Delhivery, and India Post APIs.

---

## Documentation Link

For the full 300+ line architecture blueprint, cost function derivations, baseline model comparison tables, and route guide, read [DOCKET_COMPLETE_SYSTEM_DOCUMENTATION.md](DOCKET_COMPLETE_SYSTEM_DOCUMENTATION.md).
