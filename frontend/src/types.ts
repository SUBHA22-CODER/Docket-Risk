export type RiskLevel = "HIGH" | "MEDIUM" | "LOW";
export type Action =
  | "AUTO_APPROVE"
  | "STEP_UP_VERIFICATION"
  | "HOLD_PAYOUT_HUMAN_REVIEW";

export interface ClaimRow {
  claim_id: string;
  ts: string;
  identity_key: string;
  merchant_id: string;
  category: string;
  amount: number;
  score: number;
  risk_level: RiskLevel;
  action: Action;
  cluster_size: number;
  has_evidence: boolean;
  status?: CaseStatus | null;
  assigned_to?: string | null;
  sla_due_at?: string | null;
  watchlisted?: boolean;
}

export type CaseStatus =
  | "open"
  | "in_review"
  | "approved"
  | "held"
  | "escalated"
  | "closed";

export interface CaseState {
  claim_id: string;
  status: CaseStatus;
  assigned_to: string | null;
  sla_due_at: string | null;
  updated_ts: string | null;
  updated_by: string | null;
}

export interface CaseNote {
  id: number;
  ts: string;
  claim_id: string;
  actor: string;
  body: string;
}

export interface CaseBundle {
  case: CaseState;
  notes: CaseNote[];
  watchlisted: boolean;
}

export interface WatchlistItem {
  entity: string;
  kind: "identity" | "infra" | "ring";
  reason: string;
  added_by: string | null;
  added_ts: string;
}

export interface AlertRule {
  id: number;
  name: string;
  metric: "min_score" | "risk_band" | "cluster_burst";
  threshold: number;
  webhook_url: string | null;
  enabled: number;
  created_ts: string;
}

export interface AlertEvent {
  id: number;
  ts: string;
  rule_id: number | null;
  rule_name: string;
  claim_id: string | null;
  severity: string;
  detail: string | null;
  delivered: number;
}

export interface StreamScoreEvent {
  type: "score";
  ts: string;
  claim_id: string | null;
  identity_key: string;
  merchant_id?: string;
  amount?: number;
  score: number | null;
  action: Action;
  degraded?: boolean;
  replay?: boolean;
}

export interface StreamAlertEvent {
  type: "alert";
  ts: string;
  rule_id: number | null;
  rule_name: string;
  claim_id: string | null;
  identity_key: string;
  score: number | null;
  action: Action;
  severity: string;
  detail: string | null;
}

export interface StreamRingFormingEvent {
  type: "ring_forming";
  ts: string;
  claim_id: string | null;
  identity_key: string;
  cluster_root: string;
  cluster_size: number;
  growth: number;
  window_min: number;
  members_sample: string[];
  detail: string;
}

export type StreamEvent =
  | { type: "hello"; ts: string }
  | StreamScoreEvent
  | StreamAlertEvent
  | StreamRingFormingEvent;

export interface CfContribution {
  feature: string;
  value: number;
  benign_value: number;
  score_with_benign: number;
  delta: number;
}

export interface Counterfactuals {
  available: boolean;
  reason?: string;
  score?: number;
  thresholds?: { high: number; medium: number };
  contributions?: CfContribution[];
  path?: {
    steps: { feature: string; to: number; score_after: number }[];
    final_score: number;
    reaches_auto_approve: boolean;
  };
}

export interface ReplayEvent {
  ts: string;
  identity: string;
  infra: string[];
  merchant: string;
}

/* ---- GNN benchmark (models/gnn_report.json) ---- */

export interface GnnReport {
  generated_at: string;
  architecture: string;
  split: string;
  n_identities: number;
  n_train: number;
  n_val: number;
  n_test: number;
  graph_edges: number;
  pr_auc: number;
  roc_auc: number;
  xgb_pr_auc: number | null;
  lift_vs_xgb: number | null;
  epochs_trained: number;
  best_val_pr_auc: number;
  train_seconds: number;
  params: number;
}

/* ---- settlement impact simulator ---- */

export interface SettlementImpact {
  available: boolean;
  thresholds: { high: number; medium: number; current_high: number; current_medium: number };
  window: { from: string; to: string };
  held: { count: number; amount: number };
  step_up: { count: number; amount: number };
  auto: { count: number; amount: number };
  held_delta_vs_current: number;
  calendar: { date: string; released: number; delayed_payouts: number }[];
  top_merchants: { merchant_id: string; held_count: number; held_amount: number }[];
}

/* ---- merchant risk API ---- */

export interface MerchantRisk {
  merchant_id: string;
  risk_level: RiskLevel;
  recommendation: string;
  n_claims: number;
  n_orders?: number | null;
  total_claim_amount: number;
  mean_score: number;
  max_score: number;
  held: { count: number; amount: number };
  step_up: { count: number; amount: number };
  connected_rings: string[];
  watchlisted_claimants: number;
  last_claim_ts: string;
  window: { from: string; to: string };
}

export interface ClaimsPage {
  available: boolean;
  total: number;
  page: number;
  page_size: number;
  window: { from: string; to: string; label: string } | null;
  items: ClaimRow[];
}

export interface SharedInfraNode {
  type: string;
  id: string;
  connected_identities: string[];
  merchants: string[];
}

export interface WhyFlaggedItem {
  feature: string;
  label: string;
  value: number;
}

export interface Evidence {
  why_flagged: WhyFlaggedItem[];
  shared_infra: SharedInfraNode[];
  recent_cluster_claims_7d: number;
  cluster_value_7d_inr: number;
  reason_text_reused_across_identities: boolean;
  cluster_members_sample: string[];
  other_cluster_member_count: number;
  cluster_capped: boolean;
}

export type GraphKind = "ident" | "infra";

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphKind;
  color?: string;
  infra_type?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

export interface TimelineEvent {
  ts: string;
  event: string;
  label: string;
  detail?: string;
}

export interface HistoryClaim {
  claim_id: string;
  ts: string;
  merchant_id: string;
  amount: number;
  score: number;
  action: Action;
}

export interface MerchantContext {
  merchant_id: string;
  n_orders?: number;
  n_identities?: number;
  category?: string | null;
  n_claims?: number;
  claim_rate?: number | null;
  connected_clusters?: string[];
}

export interface ClusterSummary {
  ring_id: string | null;
  members: number;
  shared_infra_types: string[];
}

export interface ClaimDetail {
  claim: {
    claim_id: string;
    order_id: string;
    identity_key: string;
    merchant_id: string;
    category: string;
    reason_text: string;
    approved: boolean;
    ts: string;
    amount: number;
    ring_label: number;
    ring_id: string | null;
  };
  score: number;
  risk_level: RiskLevel;
  action: Action;
  thresholds: { high: number; medium: number };
  features: Record<string, number>;
  evidence: Evidence;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  timeline: TimelineEvent[];
  identity_history: {
    prior_claims: HistoryClaim[];
    counts: { total: number; holds: number; auto_approved: number };
  };
  merchant: MerchantContext;
  cluster: ClusterSummary;
  case?: CaseState | null;
  watchlisted?: boolean;
  watch_reason?: string | null;
  replay?: ReplayEvent[];
}

export interface HealthStatus {
  status: string;
  model_loaded: boolean;
  model_sha_verified?: boolean;
  known_identities: number;
}

export interface AnalystAction {
  id: number;
  ts: string;
  actor: string;
  claim_id: string;
  kind: string;
  prev_action: string | null;
  new_action: string | null;
  reason: string;
}

/* ---- evaluation report (models/eval_report.json) ---- */

export interface SweepRow {
  band: string;
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  flagged?: number;
  true_positives?: number;
  false_positives?: number;
}

export interface EvalReport {
  generated_at: string;
  model_file: string;
  split: { train: string; val: string; test: string };
  pr_auc: number;
  roc_auc: number;
  base_rate: number;
  n_test_claims: number;
  n_test_ring_claims: number;
  calibration: { brier: number; ece_10bin: number };
  pr_curve: { points: [number, number][]; baseline: number };
  threshold_sweep: SweepRow[];
  monetary: { inr_prevented: number; inr_friction_cost: number };
  camouflage: {
    n_claims: number;
    false_flag_rate_high: number;
    false_flag_rate_medium: number;
  };
  feature_importance: { feature: string; importance: number }[];
}

export interface ScoreResponse {
  claim_id: string | null;
  score: number | null;
  latency_ms?: number;
  action: Action;
  degraded: boolean;
  degradation_reason?: string | null;
  thresholds: { high: number; medium: number };
  features: Record<string, number>;
  evidence: {
    cluster_size: number;
    cluster_members_sample: string[];
    other_cluster_member_count: number;
    cluster_merchant_span: number;
    recent_cluster_claims_7d: number;
    reason_text_reused_across_identities: boolean;
    shared_infra_neighbor_count: number;
  } & Partial<Evidence>;
}
