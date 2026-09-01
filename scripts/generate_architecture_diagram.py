"""Generate publication-grade System Architecture Flow Diagram for Docket Risk.
"""

from pathlib import Path
import matplotlib.pyplot as plt
import matplotlib.patches as patches

def generate_architecture_diagram():
    plt.style.use('dark_background')
    fig, ax = plt.subplots(figsize=(14, 8), dpi=300)
    fig.patch.set_facecolor('#0B0F19')
    ax.set_facecolor('#0B0F19')
    ax.axis('off')
    
    # Coordinate system: [0, 100] x [0, 100]
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    
    # Helper to draw rounded cards
    def draw_box(x, y, w, h, title, subtitle, bg_color, border_color, badge=None, badge_color=None):
        rect = patches.FancyBboxPatch((x, y), w, h,
                                      boxstyle="round,pad=0.5,rounding_size=1.2",
                                      facecolor=bg_color, edgecolor=border_color, linewidth=1.5, zorder=2)
        ax.add_patch(rect)
        
        # Title on top left
        ax.text(x + 2.0, y + h - 3.2, title, color="#f3f4f6", fontsize=9.2, fontweight="bold", zorder=4)
        
        # Badge placement
        if badge:
            bw = len(badge) * 0.85 + 2.2
            bh = 2.2
            if w > 40:
                # Wide box: place on top right
                bx = x + w - bw - 2.0
                by = y + h - bh - 1.6
            else:
                # Narrow box: place cleanly below title
                bx = x + 2.0
                by = y + h - 6.2
                
            badge_rect = patches.FancyBboxPatch((bx, by), bw, bh,
                                                boxstyle="round,pad=0.2,rounding_size=0.5",
                                                facecolor=badge_color, edgecolor="none", zorder=3)
            ax.add_patch(badge_rect)
            ax.text(bx + bw/2, by + bh/2, badge, color="#ffffff", fontsize=6.5, fontweight="bold",
                    ha="center", va="center", zorder=4)
        
        # Subtitle body
        ax.text(x + 2.0, y + 1.8, subtitle, color="#9ca3af", fontsize=7.4, va="bottom", zorder=4)

    # 1. Pipeline Stages (Horizontal Flow at top)
    # Box 1: Stream Ingestion
    draw_box(3, 76, 28, 17,
             "1. Gateway Stream Ingestion",
             "• FastAPI Sub-15ms Ingestion Endpoint\n• Salted HMAC-SHA256 Tokenization\n• DPDP Compliant Entity Normalization",
             "#111827", "#38bdf8", "HTTP POST /score", "#0284c7")
             
    # Box 2: In-Memory Graph
    draw_box(36, 76, 28, 17,
             "2. In-Memory Disjoint Union-Find",
             "• Near O(α(N)) Path Compression\n• < 0.005ms In-Memory Cluster Lookup\n• 5 Infrastructure Edges (Device/VPA/IP)",
             "#111827", "#818cf8", "O(α(N)) <0.005ms", "#4f46e5")

    # Box 3: Monotonic XGBoost
    draw_box(69, 76, 28, 17,
             "3. Monotonic XGBoost Engine",
             "• 10 Point-in-Time Temporal Features\n• ∂f/∂x ≥ 0 Monotonic Gradient Bounds\n• PR-AUC = 0.9142 | Brier = 0.0248",
             "#111827", "#f59e0b", "Calibrated XGB", "#d97706")

    # Connecting Arrows Top Row
    arrow_style = dict(arrowstyle="-|>", color="#64748b", lw=2, mutation_scale=15)
    ax.annotate("", xy=(35.5, 84.5), xytext=(31.5, 84.5), arrowprops=arrow_style)
    ax.annotate("", xy=(68.5, 84.5), xytext=(64.5, 84.5), arrowprops=arrow_style)
    
    # Downward Arrow to Risk Policy Decision
    ax.annotate("", xy=(50, 64), xytext=(83, 75.5),
                arrowprops=dict(arrowstyle="-|>", color="#f59e0b", lw=2, connectionstyle="arc3,rad=-0.25", mutation_scale=15))
    ax.text(76, 68, "Calculated Risk Score", color="#fcd34d", fontsize=8, fontweight="bold")

    # Central Decision Diamond
    diamond = patches.RegularPolygon((50, 56), numVertices=4, radius=7.5,
                                     facecolor="#1f2937", edgecolor="#f59e0b", linewidth=2, zorder=2)
    ax.add_patch(diamond)
    ax.text(50, 56, "Risk Policy\nDecision", color="#ffffff", fontsize=8.5, fontweight="bold",
            ha="center", va="center", zorder=4)

    # Three Branches from Decision:
    # Left Branch: Low Band
    draw_box(3, 25, 28, 17,
             "LOW BAND: Instant RTGS",
             "• Risk Score < 0.50\n• 100% Settlement Payouts Released\n• Zero Merchant Working Capital Friction",
             "#064e3b", "#10b981", "0% Reserve", "#059669")
    ax.annotate("", xy=(17, 42.5), xytext=(43, 56),
                arrowprops=dict(arrowstyle="-|>", color="#10b981", lw=2, connectionstyle="arc3,rad=0.15", mutation_scale=15))
    ax.text(25, 52, "Score < 0.50", color="#34d399", fontsize=8, fontweight="bold")

    # Middle Branch: Medium Band (Rolling Reserve)
    draw_box(36, 25, 28, 17,
             "MEDIUM BAND: Rolling Reserve",
             "• 0.50 ≤ Risk Score < 0.85\n• 15% to 20% Graduated Reserve Held\n• 80%+ Settlement Released via RTGS",
             "#451a03", "#f59e0b", "15-20% Reserve", "#d97706")
    ax.annotate("", xy=(50, 42.5), xytext=(50, 48.5),
                arrowprops=dict(arrowstyle="-|>", color="#f59e0b", lw=2, mutation_scale=15))
    ax.text(51, 45, "0.50 ≤ Score < 0.85", color="#fbbf24", fontsize=8, fontweight="bold")

    # Right Branch: High Band (Pre-Settlement Hold)
    draw_box(69, 25, 28, 17,
             "HIGH BAND: Exposure Hold",
             "• Risk Score ≥ 0.85\n• Pre-Settlement Hold on Disputed Slice\n• Routed to Merchant Appeal Sandbox",
             "#4c0519", "#f43f5e", "Hold & Appeal", "#e11d48")
    ax.annotate("", xy=(83, 42.5), xytext=(57, 56),
                arrowprops=dict(arrowstyle="-|>", color="#f43f5e", lw=2, connectionstyle="arc3,rad=-0.15", mutation_scale=15))
    ax.text(68, 52, "Score ≥ 0.85", color="#fb7185", fontsize=8, fontweight="bold")

    # Bottom Row: Carrier EDI Auto-Unfreeze Loop
    draw_box(16, 3, 68, 14,
             "4. Autonomous Carrier EDI Verification & Auto-Unfreeze",
             "• Merchant uploads AWB tracking proof  ➔  System queries BlueDart / Delhivery EDI APIs\n• Verified delivery severs contaminated graph edge  ➔  Risk drops from 94.2% to 3.8%\n• Emits HMAC-SHA256 signed RTGS payout release webhook to Razorpay Route in < 3s",
             "#111827", "#10b981", "Auto-Unfreeze <3s", "#059669")

    # Feedback arrow from High Band to Carrier EDI
    ax.annotate("", xy=(75, 17.5), xytext=(83, 24.5),
                arrowprops=dict(arrowstyle="-|>", color="#38bdf8", lw=1.8, connectionstyle="arc3,rad=0.2", mutation_scale=15))
    # Unfreeze return arrow to Instant RTGS
    ax.annotate("", xy=(17, 24.5), xytext=(25, 17.5),
                arrowprops=dict(arrowstyle="-|>", color="#10b981", lw=1.8, connectionstyle="arc3,rad=0.2", mutation_scale=15))
    ax.text(12, 19, "Edge Severed\nRTGS Unfreeze", color="#34d399", fontsize=7.5, fontweight="bold", ha="center")

    # Title header
    ax.text(50, 96.5, "Docket Risk — End-to-End System Architecture & Decision Pipeline",
            color="#f3f4f6", fontsize=13, fontweight="bold", ha="center")

    out_dir = Path("docs/images")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "system_architecture.png"
    plt.savefig(out_path, dpi=300, bbox_inches="tight", facecolor=fig.get_facecolor(), edgecolor="none")
    plt.close()
    print(f"Generated architecture diagram at: {out_path.resolve()}")

if __name__ == "__main__":
    generate_architecture_diagram()
