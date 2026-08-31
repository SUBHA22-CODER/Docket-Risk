# Ring Sentinel — Judge Q&A Prep (Task E.3)

Every number below is printed by the pipeline (`models/eval_report.json`) — nothing invented.

## The numbers to have memorized

| Metric | Value |
|---|---|
| PR-AUC (test, month 6) | 1.000 |
| Base rate | 1.7% |
| HIGH band (≥0.85) | precision 1.00, recall 1.00, F1 1.00 — 66/66 ring claims flagged, 0 false positives |
| MEDIUM band (≥0.50) | precision 0.99, recall 1.00 — 67 flagged, 1 false positive |
| ₹ prevented (held pre-payout) | ₹60,771 |
| ₹ friction cost (legit claims delayed) | ₹0 at HIGH |
| Camouflage cohort false-flag @HIGH | 0.0% (n=89 claims) |
| Top features | cluster_size 0.59, shared_infra_neighbor_count 0.39 |

## Q: Why graph ML and not a rule?

A rule like "flag if shared device" breaks two ways: it misses rings that share only a VPA or only an address (we generate four ring types — device-only, VPA-only, address-only, mixed — so a device-only rule fails on held-out types), and it can't weigh evidence gradually as a ring grows. Our 15% power-shopper cohort touches 3–9 merchants on purpose, so "many merchants" alone is not a fraud signal; the model had to learn that *shared infrastructure across identities* is what matters. Feature importance confirms it learned exactly that.

## Q: Why can't Thirdwatch / Dispute Responder already do this?

Existing refund-risk tools score claims per-identity or per-merchant. Ring fraud lives in the *connections between identities* — one order each, different merchants, nothing unusual anywhere in isolation. The pooled-infrastructure view is our specific contribution; per-entity features (`identity_*`) rank near zero in importance while `cluster_size` + `shared_infra_neighbor_count` carry ~98% of the signal.

## Q: Where did the data come from and how realistic is it?

Fully synthetic, generator committed (`src/data_gen.py`), seeded, reproducible. Realism choices: 21,391 identities with ring share held at 2.8%, claim base rate calibrated to 3.6% overall (test-month 1.7%), lognormal amounts, category-based legit claim rates 7–22%, rings deliberately spread thin (≤1 order per merchant, orders clustered in short activity windows). We also plant an adversarial camouflage cohort — 800 legitimate customers with exactly one coincidental shared device/address — specifically so our false-positive number means something.

## Q: What's your precision/recall and false-positive cost?

At the hold threshold: precision 1.00, recall 1.00, and 0.0% false-flag rate on the adversarial camouflage cohort. Friction cost at HIGH was ₹0 because no legitimate claim crossed 0.85; at the step-up threshold precision is still 0.99. All three numbers are always reported together — prevented rupees mean nothing without the friction cost beside them.

## Q: What happens when the model is wrong or unavailable?

Wrong: no automatic payout block below 0.85; HIGH band routes to human review where the analyst sees the evidence graph (identities + shared infra + merchants), not just a probability. Unavailable: the service **fails open** — if the model file can't load, every score defaults to 0.0 → AUTO_APPROVE, logged loudly. We tested this explicitly by deleting the model file and confirming `/health` reports `model_loaded:false` while `/score` keeps serving AUTO_APPROVE.

## Q: What's your moat?

The temporally-safe feature pipeline: every feature for a claim uses only information that existed *before* that claim's timestamp (verified — we walk time forward with union-find and record each claim into history only after scoring it). That discipline is what makes the numbers trustworthy and transferable to production event streams. Plus the action vocabulary maps directly to ops workflow: approve / step-up / hold-with-evidence-panel.

## Limitation to volunteer unprompted

"Our synthetic data is clean enough that metrics look near-perfect — real-world label noise and adaptive adversaries will compress them substantially. We also haven't modeled a colluding or compromised merchant feeding bad data into the graph; that needs separate merchant-trust tooling." Judges trust teams more when this is named before they find it.

## Demo crossover honesty

In the live demo the ring first crosses MEDIUM/HOLD at member 4 (cluster_size 4): members 1–3 were auto-approved before the graph had accumulated enough shared infrastructure. State this explicitly — the product catches rings as they grow, not retroactively.
