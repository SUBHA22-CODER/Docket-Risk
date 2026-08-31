import type {
  AlertEvent,
  AlertRule,
  AnalystAction,
  CaseBundle,
  CaseState,
  ClaimDetail,
  ClaimsPage,
  Counterfactuals,
  EvalReport,
  GnnReport,
  HealthStatus,
  MerchantRisk,
  ScoreResponse,
  SettlementImpact,
  StreamEvent,
  WatchlistItem,
} from "../types";

const API_KEY_STORAGE = "ring_sentinel.api_key";
export const DEV_FALLBACK_KEY = "dev-insecure-key-change-me";

export const getApiKey = (): string =>
  localStorage.getItem(API_KEY_STORAGE) ?? DEV_FALLBACK_KEY;

export const setApiKey = (key: string): void => {
  localStorage.setItem(API_KEY_STORAGE, key);
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        "X-API-Key": getApiKey(),
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    throw new ApiError(
      0,
      "network_error",
      "Cannot reach the risk service. Is uvicorn running on port 8000?",
    );
  }
  if (!res.ok) {
    let code = "http_error";
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      if (body.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<HealthStatus>("/healthz"),
  claims: (params: Record<string, string | number | undefined>) => {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "" && v !== "all") usp.set(k, String(v));
    });
    return request<ClaimsPage>(`/v1/claims?${usp.toString()}`);
  },
  claimDetail: (claimId: string) =>
    request<ClaimDetail>(
      `/v1/claims/${encodeURIComponent(claimId)}`,
    ),
  counterfactuals: (claimId: string) =>
    request<Counterfactuals>(
      `/v1/claims/${encodeURIComponent(claimId)}/counterfactuals`,
    ),
  decisions: (claimId?: string) =>
    request<{ items: AnalystAction[] }>(
      `/v1/decisions${claimId ? `?claim_id=${encodeURIComponent(claimId)}` : ""}`,
    ),
  postDecision: (body: {
    claim_id: string;
    kind: string;
    prev_action?: string;
    new_action?: string;
    reason: string;
  }) =>
    request<{ status: string }>("/v1/decisions", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "X-Analyst-Id": localStorage.getItem("ring_sentinel.analyst") ?? "ops_anonymous" },
    }),
  ingestOrder: (order: Record<string, string>) =>
    request<{ status: string; known_identities: number }>(
      "/v1/ingest/order",
      { method: "POST", body: JSON.stringify(order) },
    ),
  scoreClaim: (claim: Record<string, unknown>) =>
    request<ScoreResponse>("/v1/score", {
      method: "POST",
      body: JSON.stringify(claim),
    }),

  /* ---- case workflow ---- */
  cases: () => request<{ items: CaseState[] }>("/v1/cases"),
  caseGet: (claimId: string) =>
    request<CaseBundle>(`/v1/case/${encodeURIComponent(claimId)}`),
  casePatch: (
    claimId: string,
    body: { status?: string; assigned_to?: string; sla_hours?: number },
  ) =>
    request<{ case: CaseState }>(`/v1/case/${encodeURIComponent(claimId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "X-Analyst-Id": localStorage.getItem("ring_sentinel.analyst") ?? "ops_anonymous" },
    }),
  addNote: (claimId: string, body: string) =>
    request<{ status: string; id: number }>(
      `/v1/claims/${encodeURIComponent(claimId)}/notes`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
        headers: { "X-Analyst-Id": localStorage.getItem("ring_sentinel.analyst") ?? "ops_anonymous" },
      },
    ),
  bulk: (body: {
    claim_ids: string[];
    action: "approve" | "hold" | "escalate" | "close" | "assign";
    assigned_to?: string;
    reason: string;
  }) =>
    request<{ status: string; changed: number }>("/v1/claims/bulk", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "X-Analyst-Id": localStorage.getItem("ring_sentinel.analyst") ?? "ops_anonymous" },
    }),

  /* ---- watchlist ---- */
  watchlist: () => request<{ items: WatchlistItem[] }>("/v1/watchlist"),
  watchlistAdd: (body: { entity: string; kind: string; reason: string }) =>
    request<{ status: string }>("/v1/watchlist", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "X-Analyst-Id": localStorage.getItem("ring_sentinel.analyst") ?? "ops_anonymous" },
    }),
  watchlistRemove: (entity: string) =>
    request<{ status: string }>(
      `/v1/watchlist/${encodeURIComponent(entity)}`,
      {
        method: "DELETE",
        headers: { "X-Analyst-Id": localStorage.getItem("ring_sentinel.analyst") ?? "ops_anonymous" },
      },
    ),

  /* ---- alerts ---- */
  alertRules: () => request<{ items: AlertRule[] }>("/v1/alert-rules"),
  alertRuleAdd: (body: {
    name: string;
    metric: string;
    threshold: number;
    webhook_url?: string;
  }) =>
    request<{ rule: AlertRule }>("/v1/alert-rules", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  alertRuleToggle: (id: number, enabled: boolean) =>
    request<{ rule: AlertRule }>(
      `/v1/alert-rules/${id}?enabled=${enabled}`,
      { method: "PATCH" },
    ),
  alertRuleDelete: (id: number) =>
    request<{ status: string }>(`/v1/alert-rules/${id}`, { method: "DELETE" }),
  alerts: (limit = 100) =>
    request<{ items: AlertEvent[] }>(`/v1/alerts?limit=${limit}`),
  settlementImpact: (high: number, medium: number) =>
    request<SettlementImpact>(
      `/v1/settlement/impact?high=${high}&medium=${medium}`,
    ),
  merchantRisk: (merchantId: string) =>
    request<MerchantRisk>(
      `/v1/merchants/${encodeURIComponent(merchantId)}/risk`,
    ),
  webhookTest: (url: string) =>
    request<{ status: string; signature_format: string }>("/v1/webhooks/test", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
};

/** GNN benchmark report — optional artifact produced by train_gnn.py. */
export async function fetchGnnReport(): Promise<GnnReport> {
  for (const url of ["/models-static/gnn_report.json", "/gnn_report.json"]) {
    try {
      const res = await fetch(url);
      if (res.ok) return (await res.json()) as GnnReport;
    } catch {
      /* try next */
    }
  }
  throw new ApiError(0, "gnn_unavailable", "GNN benchmark not trained yet");
}

/** Subscribe to the server-sent live stream. Returns a close function. */
export function openStream(onEvent: (e: StreamEvent) => void): () => void {
  const es = new EventSource(
    `/v1/stream?api_key=${encodeURIComponent(getApiKey())}`,
  );
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as StreamEvent);
    } catch {
      /* malformed event */
    }
  };
  return () => es.close();
}

/** eval_report.json is fetched from the model artifact served by the SPA host. */
export async function fetchEvalReport(): Promise<EvalReport> {
  // In production the FastAPI app serves /models-static; in dev we fall back
  // to a copy under public/. Try both so it works in either mode.
  for (const url of ["/models-static/eval_report.json", "/eval_report.json"]) {
    try {
      const res = await fetch(url);
      if (res.ok) return (await res.json()) as EvalReport;
    } catch {
      /* try next */
    }
  }
  throw new ApiError(0, "eval_unavailable", "evaluation report not reachable");
}

export interface PrometheusMetrics {
  totalScores: number;
  buckets: { le: string; count: number }[];
  sumSeconds: number;
  countSeconds: number;
  byAction: Record<string, number>;
}

/** Fetch and parse Prometheus /metrics text payload. */
export async function fetchPrometheusMetrics(): Promise<PrometheusMetrics> {
  const res = await fetch("/metrics");
  if (!res.ok) throw new ApiError(res.status, "metrics_error", "Failed to fetch /metrics");
  const text = await res.text();

  const buckets: { le: string; count: number }[] = [];
  let sumSeconds = 0;
  let countSeconds = 0;
  let totalScores = 0;
  const byAction: Record<string, number> = {};

  for (const line of text.split("\n")) {
    if (line.startsWith("#")) continue;

    // score_latency_seconds_bucket{le="0.005"} 12.0
    const bucketMatch = line.match(/score_latency_seconds_bucket\{le="([^"]+)"\}\s+([0-9.]+)/);
    if (bucketMatch) {
      buckets.push({ le: bucketMatch[1]!, count: parseFloat(bucketMatch[2]!) });
      continue;
    }

    const sumMatch = line.match(/score_latency_seconds_sum\s+([0-9.]+)/);
    if (sumMatch) {
      sumSeconds = parseFloat(sumMatch[1]!);
      continue;
    }

    const countMatch = line.match(/score_latency_seconds_count\s+([0-9.]+)/);
    if (countMatch) {
      countSeconds = parseFloat(countMatch[1]!);
      continue;
    }

    // claims_scored_total{action="HOLD_PAYOUT_HUMAN_REVIEW"} 5.0
    const actionMatch = line.match(/claims_scored_total\{action="([^"]+)"\}\s+([0-9.]+)/);
    if (actionMatch) {
      const cnt = parseFloat(actionMatch[2]!);
      byAction[actionMatch[1]!] = cnt;
      totalScores += cnt;
    }
  }

  return { totalScores, buckets, sumSeconds, countSeconds, byAction };
}
