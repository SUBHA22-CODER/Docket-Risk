import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "./Icon";
import "../copilot.css";

interface ChatMessage {
  id: string;
  sender: "user" | "copilot";
  text: string;
  actionUrl?: string;
  actionLabel?: string;
  timestamp: Date;
}

const INITIAL_MESSAGE: ChatMessage = {
  id: "init-1",
  sender: "copilot",
  text: `👋 Hello! I am the **Docket Copilot**, your real-time risk intelligence assistant.

I can navigate you through the console, explain fraud ring topologies, or show you how to unfreeze innocent merchants using our **Blast-Radius Simulator**.

How can I help you today?`,
  timestamp: new Date(),
};

const SUGGESTED_CHIPS = [
  "Guide me through the dashboard",
  "Launch Red-Team Arena",
  "How to unfreeze innocent merchants?",
  "Open Network Explorer",
  "Why was Ring 6 flagged?",
  "Show Settlement What-If",
  "Explain DPDP compliance",
];

export function DocketCopilot() {
  const [open, setOpen] = useState(false);
  const [showGreeting, setShowGreeting] = useState(true);
  const [closingGreeting, setClosingGreeting] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-dismiss greeting banner after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setClosingGreeting(true);
      setTimeout(() => setShowGreeting(false), 400);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // Listen to menu bar "rs:open-copilot" custom event
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener("rs:open-copilot", handleOpen);
    return () => window.removeEventListener("rs:open-copilot", handleOpen);
  }, []);

  // Keyboard shortcut: Ctrl + / (or Cmd + /) to toggle Copilot
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Scroll to bottom of message list on updates
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [messages, open]);

  const handleSend = (textToSend?: string) => {
    const query = (textToSend ?? input).trim();
    if (!query) return;

    const userMsg: ChatMessage = {
      id: "usr-" + Date.now(),
      sender: "user",
      text: query,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    // Simulate intelligent response generation
    setTimeout(() => {
      const response = generateResponse(query, location.pathname);
      setMessages((prev) => [...prev, response]);
      setIsTyping(false);
    }, 450);
  };

  const handleAction = (url: string) => {
    navigate(url);
    setOpen(false);
  };

  return (
    <>
      {/* ── Floating Compact Launcher Trigger & Side-Coming Greeting ── */}
      {!open && (
        <div className="copilot-launcher-wrap">
          {showGreeting && (
            <div
              className={`copilot-side-greeting ${closingGreeting ? "closing" : ""}`}
              onClick={() => setOpen(true)}
              title="Click to ask Copilot"
            >
              <span>👋 Ask Copilot anything or navigate</span>
              <button
                className="greeting-close-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setClosingGreeting(true);
                  setTimeout(() => setShowGreeting(false), 400);
                }}
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          <button
            className="copilot-launcher"
            onClick={() => setOpen(true)}
            title="Open Docket Copilot (Ctrl + /)"
            aria-label="Open AI Assistant"
          >
            <Icon name="shield" size={18} />
            <span className="copilot-status-dot" />
          </button>
        </div>
      )}

      {/* ── Chat Flyout Window ── */}
      {open && (
        <div className="copilot-window" role="dialog" aria-label="Docket Copilot Assistant">
          {/* Header */}
          <div className="copilot-header">
            <div className="copilot-header-info">
              <div className="copilot-avatar">
                <Icon name="shield" size={16} />
              </div>
              <div>
                <div className="copilot-title">
                  Docket Copilot
                  <span className="copilot-status-dot" />
                </div>
                <div className="copilot-sub">Risk Knowledge Assistant &amp; Command Palette</div>
              </div>
            </div>
            <div className="copilot-actions">
              <button
                className="copilot-btn-icon"
                onClick={() => setMessages([INITIAL_MESSAGE])}
                title="Reset conversation"
              >
                <Icon name="refresh" size={13} />
              </button>
              <button
                className="copilot-btn-icon"
                onClick={() => setOpen(false)}
                title="Close Copilot (Esc)"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          </div>

          {/* Messages Feed */}
          <div className="copilot-messages">
            {messages.map((m) => (
              <div key={m.id} className={`copilot-msg ${m.sender}`}>
                <div className="copilot-msg-content">
                  {formatMarkdown(m.text)}
                </div>
                {m.actionUrl && (
                  <button
                    className="copilot-action-btn"
                    onClick={() => handleAction(m.actionUrl!)}
                  >
                    <Icon name="external" size={12} />
                    {m.actionLabel ?? `Navigate to ${m.actionUrl}`}
                  </button>
                )}
              </div>
            ))}
            {isTyping && (
              <div className="copilot-msg assistant" style={{ fontStyle: "italic", color: "#94a3b8" }}>
                <span>Copilot is analyzing...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Starter Chips */}
          <div className="copilot-chips">
            {SUGGESTED_CHIPS.map((chip) => (
              <button
                key={chip}
                className="copilot-chip"
                onClick={() => handleSend(chip)}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Input Box */}
          <div className="copilot-input-area">
            <form
              className="copilot-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
            >
              <input
                ref={inputRef}
                type="text"
                className="copilot-input"
                placeholder="Ask about fraud rings, navigation, unfreezes..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button
                type="submit"
                className="copilot-send-btn"
                disabled={!input.trim()}
                title="Send message"
              >
                <Icon name="chevron-right" size={13} />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/** Intent Resolution & Knowledge Base Engine */
function generateResponse(rawQuery: string, currentPath: string): ChatMessage {
  const q = rawQuery.toLowerCase();
  const id = "res-" + Date.now();
  const timestamp = new Date();

  // 1. Navigation: Claims Queue
  if (q.includes("claim") || q.includes("queue") || q.includes("triage")) {
    return {
      id,
      sender: "copilot",
      text: `Opening the **Claims Investigation Queue**. Here you can triage individual claims, filter by risk level (HIGH, MED, LOW), inspect monotonic XGBoost scores, and export RFC-4180 audit logs.`,
      actionUrl: "/claims",
      actionLabel: "Open Claims Queue →",
      timestamp,
    };
  }

  // 2. Navigation: Network Explorer
  if (q.includes("network") || q.includes("graph") || q.includes("cluster") || q.includes("topology")) {
    return {
      id,
      sender: "copilot",
      text: `Opening the **Network Intelligence Explorer**. This interactive canvas visualizes multi-entity fraud clusters, shared infrastructure (VPAs, devices, cards), and lets you run **Blast-Radius Edge Severing Simulations**.`,
      actionUrl: "/network",
      actionLabel: "Open Network Explorer →",
      timestamp,
    };
  }

  // 3. Navigation: Overview Dashboard
  if (q.includes("overview") || q.includes("dashboard") || q.includes("kpi") || q.includes("metrics")) {
    return {
      id,
      sender: "copilot",
      text: `Navigating to the **Executive Overview Dashboard**. You can review real-time screened settlement volume (₹41.4L+), active ring alerts, and risk level distributions.`,
      actionUrl: "/overview",
      actionLabel: "Open Overview Dashboard →",
      timestamp,
    };
  }

  // 4. Navigation: Settlement Simulator
  if (q.includes("settle") || q.includes("reserve") || q.includes("payout") || q.includes("what if") || q.includes("what-if")) {
    return {
      id,
      sender: "copilot",
      text: `Opening the **Settlement What-If Simulator**. You can simulate dynamic rolling reserves (10%–30%) across daily payout batches to protect merchant cash flow while containing chargeback exposure.`,
      actionUrl: "/settlement",
      actionLabel: "Open Settlement Simulator →",
      timestamp,
    };
  }

  // 5. Navigation: Live Feed
  if (q.includes("live") || q.includes("stream") || q.includes("feed") || q.includes("incoming")) {
    return {
      id,
      sender: "copilot",
      text: `Opening the **Real-Time Live Feed**. Watch streaming transactions evaluated sub-15ms via our in-memory Union-Find graph and monotonic tree pipeline.`,
      actionUrl: "/live",
      actionLabel: "Open Live Feed →",
      timestamp,
    };
  }

  // 6. Navigation: Demo Mode
  if (q.includes("demo") || q.includes("scenario") || q.includes("replay") || q.includes("pitch")) {
    return {
      id,
      sender: "copilot",
      text: `Navigating to **Demo Mode**. You can run automated live scenarios (Scenario A: Isolated Claim, Scenario B: Synchronized Multi-Merchant Ring, Scenario C: Camouflaged Ring).`,
      actionUrl: "/demo",
      actionLabel: "Launch Scenario Replay →",
      timestamp,
    };
  }

  // 6b. Navigation: Red-Team Arena
  if (q.includes("arena") || q.includes("attack") || q.includes("red team") || q.includes("red-team") || q.includes("syndicate") || q.includes("battle")) {
    return {
      id,
      sender: "copilot",
      text: `Opening the **Adversarial Red-Team Arena**. Here you can launch simulated zero-day fraud syndicate campaigns (Telegram bursts, micro-transaction smurfing, device farms) and watch Docket intercept attacks in real time!`,
      actionUrl: "/arena",
      actionLabel: "Launch Red-Team Arena →",
      timestamp,
    };
  }

  // 7. Navigation: Analytics
  if (q.includes("analytic") || q.includes("shap") || q.includes("feature")) {
    return {
      id,
      sender: "copilot",
      text: `Navigating to **Model Analytics & Feature Store**. Inspect global SHAP feature importances, monotonic constraints, and inference latency telemetry.`,
      actionUrl: "/analytics",
      actionLabel: "Open Analytics →",
      timestamp,
    };
  }

  // 8. Navigation: Evaluation
  if (q.includes("eval") || q.includes("auc") || q.includes("pr curve") || q.includes("test")) {
    return {
      id,
      sender: "copilot",
      text: `Navigating to **Model Evaluation**. Review held-out cohort metrics: Precision-Recall curves, Brier calibration scores, and adversarial test results.`,
      actionUrl: "/evaluation",
      actionLabel: "Open Model Evaluation →",
      timestamp,
    };
  }

  // 9. Navigation: Settings
  if (q.includes("setting") || q.includes("api") || q.includes("token") || q.includes("webhook")) {
    return {
      id,
      sender: "copilot",
      text: `Navigating to **System Settings**. View your active API keys, webhook endpoints, and Prometheus metrics configuration.`,
      actionUrl: "/settings",
      actionLabel: "Open Settings & API →",
      timestamp,
    };
  }

  // 10. Navigation: Landing Page
  if (q.includes("landing") || q.includes("home") || q.includes("front page") || q.includes("website")) {
    return {
      id,
      sender: "copilot",
      text: `Returning to the **Full-Screen Product Landing Page**.`,
      actionUrl: "/",
      actionLabel: "Go to Landing Page →",
      timestamp,
    };
  }

  // 11. Domain Question: Unfreezing innocent merchants / Blast Radius
  if (q.includes("unfreeze") || q.includes("blast") || q.includes("sever") || q.includes("innocent") || q.includes("collateral")) {
    return {
      id,
      sender: "copilot",
      text: `### How to Unfreeze Innocent Merchants (Blast-Radius Simulator):

1. Go to **Network Explorer**.
2. Select any high-risk cluster (e.g. Ring 6 with 99% score).
3. Click on the shared infrastructure node (e.g. device \`dev_99\` or shared VPA) in the graph canvas.
4. In the side drawer, click **"✂ Simulate Severing Node"**.
5. **Instant Result:** The system recalculates connected components in real time. Legitimate peripheral merchants turn green (\`✓ SAFE\`), and their simulated risk drops below threshold, clearing them for immediate payout release!`,
      actionUrl: "/network",
      actionLabel: "Try Blast-Radius Simulator →",
      timestamp,
    };
  }

  // 12. Domain Question: DPDP Act Compliance
  if (q.includes("dpdp") || q.includes("privacy") || q.includes("salt") || q.includes("pii") || q.includes("hash")) {
    return {
      id,
      sender: "copilot",
      text: `### DPDP Act 2023 Compliance Architecture:

• **Salted Cryptographic Hashing:** Customer VPAs, phone numbers, and hardware IDs are deterministically salted with \`HMAC-SHA256\` prior to graph ingestion.
• **Zero Raw PII in Memory:** Plaintext personal identifiers are never kept in volatile memory or exposed in risk dossiers.
• **Audit Logging:** Every scoring decision is sealed with a SHA-256 hash in a tamper-evident audit ledger compliant with RBI Master Directions.`,
      actionUrl: "/overview",
      actionLabel: "View Compliance Metrics →",
      timestamp,
    };
  }

  // 13. Domain Question: Why Ring 6 was flagged
  if (q.includes("ring 6") || q.includes("ring #006") || q.includes("why flagged")) {
    return {
      id,
      sender: "copilot",
      text: `### Investigation Summary for Ring #006:

• **Score:** \`0.9999\` (CRITICAL RISK · Payout Withheld).
• **Pattern:** 6 customer identities coordinated across 4 distinct merchant accounts.
• **Shared Infrastructure:** Single physical device fingerprint (\`dev_sentinel_99\`) and shared VPA (\`vpa_qa_99@upi\`).
• **Velocity Burst:** 4 refund claims executed within a 72-hour rolling window.
• **Recommended Ops Action:** Sever \`dev_sentinel_99\` to release the 4 innocent peripheral merchant accounts.`,
      actionUrl: "/network",
      actionLabel: "Inspect Ring 6 in Network →",
      timestamp,
    };
  }

  // 14. Guided Tour
  if (q.includes("guide") || q.includes("tour") || q.includes("walkthrough") || q.includes("what is docket")) {
    return {
      id,
      sender: "copilot",
      text: `### Guided Tour of Docket Risk:

• **Overview (/overview):** High-level risk telemetry, protected volume, and SLA metrics.
• **Claims (/claims):** Real-time claim triage queue with RFC-4180 CSV export.
• **Network (/network):** Interactive Union-Find graph explorer with Blast-Radius severing simulator.
• **Settlement (/settlement):** What-If simulation for dynamic rolling reserves vs. hard freezes.
• **Evaluation (/evaluation):** Precision-Recall, AUC, and monotonic calibration reports.
• **Demo Mode (/demo):** 1-click live scenario playback for live presentations.`,
      actionUrl: "/overview",
      actionLabel: "Start at Overview →",
      timestamp,
    };
  }

  // Default Fallback
  return {
    id,
    sender: "copilot",
    text: `I understand you're asking about *"**${rawQuery}**"*. 

Here are some helpful actions I can perform for you right now:
• Route you to any dashboard module (**Claims**, **Network**, **Settlement**, **Analytics**, **Demo**).
• Explain how to run a **Blast-Radius unfreeze** test.
• Explain our **sub-15ms latency** and **DPDP Act compliance**.

Click any suggested chip below or type where you want to go!`,
    actionUrl: currentPath === "/" ? "/overview" : undefined,
    actionLabel: currentPath === "/" ? "Open Dashboard Console →" : undefined,
    timestamp,
  };
}

/** Simple parser to render bold, code, and bullet formatting in messages */
function formatMarkdown(content: string) {
  const lines = content.split("\n");
  return lines.map((line, idx) => {
    // Bullet point
    if (line.startsWith("• ") || line.startsWith("- ")) {
      const parsed = renderInlineStyles(line.slice(2));
      return (
        <div key={idx} style={{ display: "flex", gap: 6, margin: "2px 0 2px 4px" }}>
          <span style={{ color: "#60a5fa" }}>•</span>
          <span>{parsed}</span>
        </div>
      );
    }
    // Heading 3
    if (line.startsWith("### ")) {
      return (
        <div key={idx} style={{ fontWeight: 750, color: "#ffffff", margin: "6px 0 4px", fontSize: 13.5 }}>
          {line.slice(4)}
        </div>
      );
    }
    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+\.)\s/)?.[1];
      const rest = line.replace(/^\d+\.\s/, "");
      return (
        <div key={idx} style={{ display: "flex", gap: 6, margin: "2px 0 2px 4px" }}>
          <span style={{ color: "#60a5fa", fontWeight: 700 }}>{num}</span>
          <span>{renderInlineStyles(rest)}</span>
        </div>
      );
    }
    // Empty line
    if (!line.trim()) {
      return <div key={idx} style={{ height: 6 }} />;
    }
    // Normal paragraph line
    return <div key={idx}>{renderInlineStyles(line)}</div>;
  });
}

function renderInlineStyles(text: string): React.ReactNode {
  // Regex to split on bold (**text**) and code (`text`)
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}
