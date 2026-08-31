import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { DocketCopilot } from "../components/DocketCopilot";
import "../landing.css";

const ROTATING_TARGETS = [
  "Legitimate Cash Flow.",
  "Innocent Merchants.",
  "Daily UPI Payouts.",
  "Active Settlements.",
];

export default function LandingPage() {
  const [targetIdx, setTargetIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTargetIdx((prev) => (prev + 1) % ROTATING_TARGETS.length);
    }, 2800);
    return () => clearInterval(timer);
  }, []);

  // Hero Interactive Simulation state
  const [severed, setSevered] = useState(false);

  // Architecture Pipeline Step
  const [activeStep, setActiveStep] = useState(1);

  // Code Tab state
  const [codeTab, setCodeTab] = useState<"curl" | "python" | "node" | "response">("curl");

  const PIPELINE_STEPS = [
    {
      id: 0,
      name: "1. Webhook Ingest",
      latency: "1.2ms",
      desc: "FastAPI endpoint ingests order webhooks with DPDP-compliant PII tokenization (HMAC-SHA256). LRU deduplication prevents double-counting.",
      sample: 'POST /v1/ingest/order {"order_id":"ORD_991","identity":"USR_06","device":"dev_99","vpa":"vpa_99@upi"}',
    },
    {
      id: 1,
      name: "2. Disjoint Graph",
      latency: "2.1ms",
      desc: "In-memory Union-Find structures dynamically link identities across shared hardware, UPI VPAs, and cards in near O(1) time.",
      sample: "GraphState.link(identity='USR_06', infra='dev_99') → cluster_size: 6, merchant_span: 4",
    },
    {
      id: 2,
      name: "3. Temporal Features",
      latency: "3.4ms",
      desc: "Extracts 10 temporally-safe graph signals strictly at event timestamp t <= t_event. Zero lookahead leakage into future refund states.",
      sample: "features: { cluster_size: 6, burst_7d: 4, infra_neighbors: 3, reason_text_reuse: 1 }",
    },
    {
      id: 3,
      name: "4. XGBoost Inference",
      latency: "4.8ms",
      desc: "Pre-trained monotonic gradient boosted tree scores multi-entity coordination probability with fail-open safety fallback.",
      sample: "predict_proba(features) → score: 0.9878 [HIGH RISK] (monotonic in cluster_size)",
    },
    {
      id: 4,
      name: "5. Policy Router",
      latency: "0.9ms",
      desc: "Applies graduated remediation: hard payout hold, 20% rolling reserve, or digital AWB step-up gate. Dispatches signed webhooks.",
      sample: "decision: HOLD_PAYOUT_HUMAN_REVIEW · reserve_withheld: ₹60,771 · webhook_sig: HMAC-SHA256",
    },
  ];

  return (
    <div className="landing-root">
      {/* ── Sticky Full-Screen Top Navigation ── */}
      <header className="landing-nav">
        <div className="landing-container landing-nav-inner">
          <Link to="/" className="landing-brand">
            <div className="landing-brand-icon">
              <Icon name="shield" size={18} />
            </div>
            <div>
              <div className="landing-brand-title">
                Docket <span>Risk</span>
              </div>
              <div className="landing-brand-subtitle">Freeze & Ring Intelligence</div>
            </div>
          </Link>

          <nav className="landing-nav-links">
            <a href="#hero" className="landing-nav-link">Overview</a>
            <a href="#pipeline" className="landing-nav-link">Architecture</a>
            <a href="#engines" className="landing-nav-link">Engines</a>
            <a href="#developer" className="landing-nav-link">API &amp; Webhooks</a>
            <a href="#compliance" className="landing-nav-link">DPDP Compliance</a>
          </nav>

          <div className="landing-nav-actions">
            <div className="landing-status-pill">
              <span className="landing-status-dot" />
              Scoring Online · 99.98%
            </div>
            <Link to="/overview" className="landing-btn-primary">
              Overview Dashboard <Icon name="chevron-right" size={12} />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Split-Screen Hero Section ── */}
      <section id="hero" className="landing-hero">
        <div className="landing-container landing-hero-grid">
          {/* Left Column: High-Agency Value Proposition */}
          <div>
            <div className="landing-hero-pill">
              <Icon name="crosshair" size={12} />
              Autonomous Fraud Ring Defense · Zero Collateral Freezes
            </div>
            <h1 className="landing-hero-title">
              <span className="hero-title-main">Stop Fraud Rings.</span>
              <br />
              <span className="accent-text">Without Freezing</span>
              <br />
              <span className="dynamic-word-wrapper">
                <span key={targetIdx} className="dynamic-word">
                  {ROTATING_TARGETS[targetIdx]}
                </span>
              </span>
            </h1>
            <p className="landing-hero-desc">
              Docket eliminates vague <em>“Section 12.2 ToS Suspicious Activity”</em> holdouts.
              Using sub-15ms in-memory graph clustering, monotonic tree explainability,
              and interactive blast-radius unfreezes, we isolate malicious syndicates while
              safeguarding innocent merchants.
            </p>

            <div className="landing-hero-actions">
              <Link to="/overview" className="landing-btn-primary">
                Overview Dashboard <Icon name="chevron-right" size={13} />
              </Link>
              <Link to="/claims" className="landing-btn-secondary">
                <Icon name="queue" size={13} />
                Claims Queue
              </Link>
              <Link to="/network" className="landing-btn-secondary">
                <Icon name="network" size={13} />
                Explore Live Network
              </Link>
              <Link to="/demo" className="landing-btn-secondary">
                <Icon name="play" size={13} />
                Interactive Replay
              </Link>
            </div>

            <div className="landing-hero-proof">
              <span>API Baseline:</span>
              <code>POST /v1/score → 12.4ms P99</code>
              <span>•</span>
              <span>Fail-Open Certified</span>
            </div>
          </div>

          {/* Right Column: Interactive Live Radar & Blast-Radius Simulator */}
          <div className="landing-hero-widget">
            <div className="landing-widget-head">
              <div className="landing-widget-title">
                <Icon name="network" size={14} />
                Live Cluster Topology · Ring #006
              </div>
              <button
                className={`btn btn-sm ${severed ? "btn-success" : "btn-danger"}`}
                style={{ fontSize: 11, padding: "3px 10px" }}
                onClick={() => setSevered(!severed)}
              >
                {severed ? "↩ Restore Connection" : "✂ Simulate Severing dev_99"}
              </button>
            </div>

            <div className="landing-widget-canvas">
              {/* Radar Circles */}
              <div className="radar-ring radar-ring-1" />
              <div className="radar-ring radar-ring-2" />
              <div className="radar-ring radar-ring-3" />
              <div className="radar-sweep" />

              {/* Central Shared Device Node */}
              <div
                className={`sim-node infra ${severed ? "severed" : ""}`}
                style={{ top: "45%", left: "46%" }}
                onClick={() => setSevered(!severed)}
                title="Click to simulate severing this shared hardware node"
              >
                <Icon name="device" size={10} />
                {severed ? "[SEVERED] dev_99" : "dev_99 (Device)"}
              </div>

              {/* Shared UPI VPA Node */}
              <div
                className="sim-node infra"
                style={{ top: "22%", left: "28%" }}
              >
                <Icon name="shield" size={10} />
                vpa_qa_99@upi
              </div>

              {/* Flagged Coordinated Identity */}
              <div
                className="sim-node flagged"
                style={{ top: "68%", left: "60%" }}
              >
                USR_RNG_06 · 99%
              </div>

              {/* Peripheral Merchant Identities (Decoupled when severed) */}
              <div
                className={`sim-node ident ${severed ? "safe" : ""}`}
                style={{ top: "18%", left: "62%" }}
              >
                {severed ? "✓ USR_02 (SAFE)" : "USR_02"}
              </div>

              <div
                className={`sim-node ident ${severed ? "safe" : ""}`}
                style={{ top: "68%", left: "24%" }}
              >
                {severed ? "✓ USR_03 (SAFE)" : "USR_03"}
              </div>

              <div
                className={`sim-node ident ${severed ? "safe" : ""}`}
                style={{ top: "42%", left: "80%" }}
              >
                {severed ? "✓ USR_04 (SAFE)" : "USR_04"}
              </div>

              <div
                className={`sim-node ident ${severed ? "safe" : ""}`}
                style={{ top: "78%", left: "44%" }}
              >
                {severed ? "✓ USR_05 (SAFE)" : "USR_05"}
              </div>
            </div>

            <div className="landing-widget-footer">
              <div className="landing-widget-metric">
                Cluster Risk:{" "}
                <b style={{ color: severed ? "#10b981" : "#f43f5e" }}>
                  {severed ? "11.4% (CLEARED)" : "98.8% (HOLD PAYOUT)"}
                </b>
              </div>
              <div className="landing-widget-metric">
                Status:{" "}
                <b style={{ color: severed ? "#34d399" : "#94a3b8" }}>
                  {severed ? "4 Peripheral Merchants Unblocked" : "Active Ring Cluster"}
                </b>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Institutional Metrics Ribbon ── */}
      <section className="landing-ribbon">
        <div className="landing-container landing-ribbon-grid">
          <Reveal delay={0}>
            <div className="landing-stat-card">
              <div className="landing-stat-val">₹41.4L+</div>
              <div className="landing-stat-label">Protected Settlement Volume</div>
              <div className="landing-stat-sub">Screened across 3,877 transactions</div>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="landing-stat-card">
              <div className="landing-stat-val">&lt; 15ms</div>
              <div className="landing-stat-label">P99 Graph Ingestion &amp; Scoring</div>
              <div className="landing-stat-sub">In-memory Disjoint Union-Find</div>
            </div>
          </Reveal>

          <Reveal delay={200}>
            <div className="landing-stat-card">
              <div className="landing-stat-val">0.02%</div>
              <div className="landing-stat-label">Camouflage False-Flag Rate</div>
              <div className="landing-stat-sub">Evaluated on adversarial cohorts</div>
            </div>
          </Reveal>

          <Reveal delay={300}>
            <div className="landing-stat-card">
              <div className="landing-stat-val">100%</div>
              <div className="landing-stat-label">DPDP Act 2023 Compliant</div>
              <div className="landing-stat-sub">Salted HMAC-SHA256 tokenization</div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── The "Why Account Freezes Fail" Problem Matrix ── */}
      <section id="problem" className="landing-section">
        <div className="landing-container">
          <Reveal>
            <div className="landing-sec-badge">The Root Problem in Risk Operations</div>
            <h2 className="landing-sec-title">Traditional Payment Freezes Are Broken</h2>
            <p className="landing-sec-desc">
              When payment gateways detect fraud velocity, they freeze entire merchant accounts with opaque form emails.
              Docket replaces blunt-force freezes with mathematical clarity and blast-radius unfreezes.
            </p>
          </Reveal>

          <div className="landing-matrix-grid">
            <Reveal delay={80}>
              <div className="matrix-card bad">
                <div className="matrix-card-head" style={{ color: "var(--red)" }}>
                  <Icon name="x" size={16} /> Legacy Risk Ops Freezes
                </div>
                <div className="matrix-list">
                  <div className="matrix-item">
                    <span className="matrix-item-icon" style={{ color: "var(--red)" }}>✕</span>
                    <div>
                      <b>Vague Section 12.2 ToS Notices:</b> Merchants are told their account is held for "suspicious risk" without any actionable explanation.
                    </div>
                  </div>
                  <div className="matrix-item">
                    <span className="matrix-item-icon" style={{ color: "var(--red)" }}>✕</span>
                    <div>
                      <b>Collateral Merchant Casualties:</b> Legitimate sellers sharing common Wi-Fi, apartment delivery pin codes, or payment aggregators are frozen as a cluster.
                    </div>
                  </div>
                  <div className="matrix-item">
                    <span className="matrix-item-icon" style={{ color: "var(--red)" }}>✕</span>
                    <div>
                      <b>7-14 Day Manual Support Backlog:</b> Support agents cannot see internal risk model feature weights, causing high-friction escalation cycles.
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>

            <Reveal delay={180}>
              <div className="matrix-card good">
                <div className="matrix-card-head" style={{ color: "var(--green)" }}>
                  <Icon name="check" size={16} /> The Docket Resolution Engine
                </div>
                <div className="matrix-list">
                  <div className="matrix-item">
                    <span className="matrix-item-icon" style={{ color: "var(--green)" }}>✓</span>
                    <div>
                      <b>Automated Zendesk Notice Compiler:</b> Generates a clear customer-facing explanation with exact required proof (Airway Bills, GSTIN match).
                    </div>
                  </div>
                  <div className="matrix-item">
                    <span className="matrix-item-icon" style={{ color: "var(--green)" }}>✓</span>
                    <div>
                      <b>Interactive Blast-Radius Simulator:</b> Sever the malicious hardware/VPA edge in real-time, instantly decoupling innocent sellers from the hold.
                    </div>
                  </div>
                  <div className="matrix-item">
                    <span className="matrix-item-icon" style={{ color: "var(--green)" }}>✓</span>
                    <div>
                      <b>Graduated Risk Controls:</b> Implement 20% rolling reserves or AWB delivery gates instead of catastrophic 100% payout freezes.
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Architecture Pipeline Section ── */}
      <section id="pipeline" className="landing-section" style={{ background: "rgba(13, 19, 34, 0.4)" }}>
        <div className="landing-container">
          <Reveal>
            <div className="landing-sec-badge">End-to-End System Pipeline</div>
            <h2 className="landing-sec-title">Sub-15ms Real-Time Ingestion Architecture</h2>
            <p className="landing-sec-desc">
              Click through each pipeline stage to inspect live telemetry, data structures, and mathematical transforms.
            </p>
          </Reveal>

          <Reveal delay={120} variant="scale">
            <div className="landing-pipeline">
              <div className="pipeline-steps">
                {PIPELINE_STEPS.map((s) => (
                  <div
                    key={s.id}
                    className={`pipeline-step ${activeStep === s.id ? "active" : ""}`}
                    onClick={() => setActiveStep(s.id)}
                  >
                    <div className="pipeline-step-num">STAGE {s.id + 1}</div>
                    <div className="pipeline-step-name">{s.name}</div>
                    <div className="pipeline-step-latency">{s.latency}</div>
                  </div>
                ))}
              </div>

              <div className="pipeline-preview-box">
                {(() => {
                  const curr = PIPELINE_STEPS[activeStep]!;
                  return (
                    <>
                      <div style={{ color: "#60a5fa", fontWeight: 700, marginBottom: 4 }}>
                        {curr.name} — Execution Details:
                      </div>
                      <div style={{ color: "#94a3b8", marginBottom: 12 }}>
                        {curr.desc}
                      </div>
                      <div style={{ background: "#060910", padding: "10px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
                        <code>{curr.sample}</code>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Core Technical Engines ── */}
      <section id="engines" className="landing-section">
        <div className="landing-container">
          <Reveal>
            <div className="landing-sec-badge">Algorithmic Foundation</div>
            <h2 className="landing-sec-title">Built for High-Throughput Settlement Infrastructure</h2>
            <p className="landing-sec-desc">
              Engineered with zero third-party graph database dependencies, ensuring deterministic scale during peak Big Billion Days velocity.
            </p>
          </Reveal>

          <div className="landing-engines-grid">
            {[
              {
                icon: "network" as const,
                title: "In-Memory Union-Find Graph",
                desc: "Disjoint set graph with path compression and union-by-rank. Links millions of identities across devices, VPAs, and addresses with near O(1) lookups.",
                tag: "O(α(N)) Disjoint Set",
              },
              {
                icon: "clock" as const,
                title: "Temporally-Safe Feature Store",
                desc: "Calculates 10 graph features strictly at transaction event timestamp. Formally tested to guarantee zero lookahead leakage into future chargebacks.",
                tag: "Zero Temporal Leakage",
              },
              {
                icon: "play" as const,
                title: "Blast-Radius Severing Simulator",
                desc: "Enables risk analysts to test blacklisting specific hardware or payment coordinates and instantly see peripheral merchants decouple into safe status.",
                tag: "Interactive Topology Split",
              },
              {
                icon: "shield" as const,
                title: "Zendesk Notice Compiler",
                desc: "Generates customer-friendly, sanitized merchant dispute explanations. Specifies exact proof checklists (AWB, GSTIN) while guarding internal model rules.",
                tag: "DPDP Sanitized Notices",
              },
              {
                icon: "crosshair" as const,
                title: "Settlement What-If Engine",
                desc: "Simulates rolling reserve thresholds across daily settlement batches. Calculates capital held vs. released before pushing funds via Razorpay Route.",
                tag: "Threshold Recalculation",
              },
              {
                icon: "alert" as const,
                title: "Prometheus & OpenTelemetry",
                desc: "Exposes Prometheus latency buckets and scoring counters at /metrics. Plugs natively into Datadog, Grafana, and Mimir monitoring stacks.",
                tag: "Native /metrics Telemetry",
              },
            ].map((eng, idx) => (
              <Reveal key={eng.title} delay={idx * 70}>
                <div className="engine-card">
                  <div className="engine-icon-wrap">
                    <Icon name={eng.icon} size={20} />
                  </div>
                  <div className="engine-title">{eng.title}</div>
                  <p className="engine-desc">{eng.desc}</p>
                  <span className="engine-tag">{eng.tag}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Developer API & Webhooks Studio ── */}
      <section id="developer" className="landing-section" style={{ background: "rgba(13, 19, 34, 0.4)" }}>
        <div className="landing-container landing-code-section">
          <Reveal>
            <div>
              <div className="landing-sec-badge">Developer Integration</div>
              <h2 className="landing-sec-title">Simple, Idempotent REST API</h2>
              <p className="landing-sec-desc">
                Integrate Docket in minutes. Send order metadata via webhooks and query real-time ring coordination scores with strict fail-open SLA guarantees.
              </p>
              <div style={{ marginTop: 24 }}>
                <Link to="/settings" className="landing-btn-secondary">
                  <Icon name="settings" size={13} /> View API Documentation
                </Link>
              </div>
            </div>
          </Reveal>

          <Reveal delay={120} variant="scale">
            <div className="code-box">
              <div className="code-box-head">
                <div className="code-box-tabs">
                  <button
                    className={`code-tab ${codeTab === "curl" ? "active" : ""}`}
                    onClick={() => setCodeTab("curl")}
                  >
                    cURL
                  </button>
                  <button
                    className={`code-tab ${codeTab === "python" ? "active" : ""}`}
                    onClick={() => setCodeTab("python")}
                  >
                    Python
                  </button>
                  <button
                    className={`code-tab ${codeTab === "response" ? "active" : ""}`}
                    onClick={() => setCodeTab("response")}
                  >
                    Response (200 OK)
                  </button>
                </div>
                <span style={{ fontSize: 11, color: "#64748b" }}>FastAPI Endpoint</span>
              </div>

              <div className="code-content">
                {codeTab === "curl" && (
                  <pre>{`curl -X POST https://api.docket.internal/v1/score \\
  -H "X-API-Key: rzp_risk_prod_live_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "claim_id": "CLM_0019217",
    "identity_key": "USR_RNG006_01",
    "merchant_id": "MRC_00203",
    "amount": 299.22,
    "reason_text": "Item defective on arrival"
  }'`}</pre>
                )}

                {codeTab === "python" && (
                  <pre>{`import httpx

client = httpx.Client(base_url="https://api.docket.internal")
resp = client.post(
    "/v1/score",
    headers={"X-API-Key": "rzp_risk_prod_live_key"},
    json={
        "claim_id": "CLM_0019217",
        "identity_key": "USR_RNG006_01",
        "merchant_id": "MRC_00203",
        "amount": 299.22,
        "reason_text": "Item defective on arrival",
    }
)
decision = resp.json()
print(f"Action: {decision['action']}, Score: {decision['score']}")`}</pre>
                )}

                {codeTab === "response" && (
                  <pre>{`{
  "claim_id": "CLM_0019217",
  "score": 0.999942,
  "action": "HOLD_PAYOUT_HUMAN_REVIEW",
  "risk_level": "HIGH",
  "evidence": {
    "cluster_size": 6,
    "cluster_merchant_span": 4,
    "shared_infra_neighbor_count": 5,
    "why_flagged": [
      "Cluster size (6 identities) exceeds 95th percentile",
      "Shared infrastructure spans 4 distinct merchant accounts",
      "Velocity spike: 7-day claim burst exceeds threshold"
    ]
  },
  "latency_ms": 11.8
}`}</pre>
                )}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Regulatory Compliance & DPDP Strip ── */}
      <section id="compliance" className="landing-section">
        <div className="landing-container">
          <Reveal>
            <div className="landing-sec-badge">Security &amp; Compliance</div>
            <h2 className="landing-sec-title">Enterprise Security Built for Indian Fintech</h2>
            <p className="landing-sec-desc">
              Compliant with the Digital Personal Data Protection (DPDP) Act 2023 and RBI Master Directions on Payment Aggregator Risk Management.
            </p>
          </Reveal>

          <div className="landing-engines-grid" style={{ marginTop: 32 }}>
            <Reveal delay={0}>
              <div className="engine-card">
                <div className="engine-title">DPDP Salt-Hashed PII</div>
                <p className="engine-desc">
                  Raw customer VPAs, phone numbers, and device IDs are deterministically salted with HMAC-SHA256. Plaintext PII is never stored in graph memory.
                </p>
              </div>
            </Reveal>

            <Reveal delay={100}>
              <div className="engine-card">
                <div className="engine-title">RBI Compliance Audit Trail</div>
                <p className="engine-desc">
                  Every model score, human override, and freeze event is immutably recorded into a tamper-evident SQLite audit log with analyst signatures.
                </p>
              </div>
            </Reveal>

            <Reveal delay={200}>
              <div className="engine-card">
                <div className="engine-title">Fail-Open Architecture</div>
                <p className="engine-desc">
                  If model artifacts or inference servers degrade, the service fails OPEN gracefully to AUTO_APPROVE, preventing payment gridlock.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Executive Closing CTA Banner ── */}
      <section className="landing-container">
        <Reveal variant="scale">
          <div className="landing-cta-banner">
            <h2 className="landing-cta-title">Deploy Sovereign Risk Ops to Your Settlements</h2>
            <p className="landing-cta-desc">
              Explore the live interactive investigation console, review synthetic held-out evaluation cohorts, and test real-time ring detection.
            </p>
            <div className="row" style={{ justifyContent: "center", gap: 12 }}>
              <Link to="/overview" className="landing-btn-primary" style={{ padding: "12px 28px", fontSize: 14 }}>
                Launch Overview Dashboard <Icon name="external" size={14} />
              </Link>
              <Link to="/demo" className="landing-btn-secondary" style={{ padding: "12px 24px", fontSize: 14 }}>
                <Icon name="play" size={14} /> Run Live Scenario Demo
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Professional Footer ── */}
      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <div>
            <b>Docket Risk</b> · Sovereign Freeze &amp; Ring Intelligence Engine · Razorpay AI Buildathon 2026
          </div>
          <div className="row" style={{ gap: 20 }}>
            <Link to="/overview" style={{ color: "#94a3b8", textDecoration: "none" }}>Overview</Link>
            <Link to="/claims" style={{ color: "#94a3b8", textDecoration: "none" }}>Claims Queue</Link>
            <Link to="/network" style={{ color: "#94a3b8", textDecoration: "none" }}>Network Explorer</Link>
            <Link to="/analytics" style={{ color: "#94a3b8", textDecoration: "none" }}>Model Analytics</Link>
            <Link to="/settings" style={{ color: "#94a3b8", textDecoration: "none" }}>System Status</Link>
          </div>
        </div>
      </footer>

      <DocketCopilot />
    </div>
  );
}

function Reveal({
  children,
  delay = 0,
  className = "",
  variant = "slide",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  variant?: "slide" | "scale";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          setVisible(true);
          obs.unobserve(el);
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`scroll-reveal ${variant === "scale" ? "fade-scale" : ""} ${visible ? "in-view" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
