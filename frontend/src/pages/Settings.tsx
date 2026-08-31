import { useState } from "react";
import { api, DEV_FALLBACK_KEY, getApiKey, setApiKey } from "../lib/api";
import { useAsync } from "../lib/hooks";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  InfoTip,
  useToast,
} from "../components/ui";
import { Icon } from "../components/Icon";
import { num, timeAgo } from "../lib/format";

export default function Settings() {
  const toast = useToast();
  const [key, setKey] = useState(getApiKey());
  const [analyst, setAnalyst] = useState(
    localStorage.getItem("ring_sentinel.analyst") ?? "ops_014",
  );
  const health = useAsync(() => api.health(), []);

  const save = () => {
    setApiKey(key.trim());
    localStorage.setItem("ring_sentinel.analyst", analyst.trim() || "ops_anonymous");
    toast({
      tone: "ok",
      title: "Settings saved",
      msg: "API key and analyst ID apply to new requests immediately.",
    });
    health.refetch();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">
            Console configuration. Credentials live only in this browser's local storage — never
            committed or logged.
          </p>
        </div>
      </div>

      <div className="inv-grid">
        <div className="stack">
          <Card title="Connection">
            <label className="small secondary" htmlFor="api-key">Scoring API key (X-API-Key)</label>
            <input
              id="api-key"
              className="input mono"
              style={{ width: "100%", marginTop: 6 }}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {key === DEV_FALLBACK_KEY && (
              <p className="small" style={{ color: "var(--amber)", marginTop: 7 }}>
                Using the development fallback key — fine for the demo, replace before any real
                deployment.
              </p>
            )}
            <div style={{ height: 12 }} />
            <label className="small secondary" htmlFor="analyst">Analyst ID (recorded in audit trail)</label>
            <input
              id="analyst"
              className="input"
              style={{ width: "100%", marginTop: 6 }}
              value={analyst}
              onChange={(e) => setAnalyst(e.target.value)}
            />
            <div style={{ height: 14 }} />
            <Button variant="primary" onClick={save}>Save settings</Button>
          </Card>

          <Card title="System status">
            {health.loading && !health.data ? (
              <p className="small muted">Checking…</p>
            ) : health.error ? (
              <ErrorState title="Risk service unreachable" error={health.error} onRetry={health.refetch} />
            ) : health.data ? (
              <>
                <StatusRow k="Service" v={<Badge tone="low">healthy</Badge>} />
                <StatusRow
                  k="Model loaded"
                  v={
                    health.data.model_loaded
                      ? <Badge tone="low">yes</Badge>
                      : <Badge tone="medium">no — failing open</Badge>
                  }
                  tip={!health.data.model_loaded ? "Without a model every score defaults to AUTO_APPROVE; claims are never blocked." : undefined}
                />
                <StatusRow k="Model SHA verified" v={<Badge tone={health.data.model_sha_verified ? "low" : "neutral"}>{String(health.data.model_sha_verified)}</Badge>} />
                <StatusRow k="Identities in live graph" v={<span className="num">{num(health.data.known_identities)}</span>} />
                <StatusRow k="Last checked" v={timeAgo(new Date().toISOString())} />
                <div style={{ height: 10 }} />
                <Button size="sm" onClick={health.refetch}>
                  <Icon name="refresh" size={13} /> Re-check
                </Button>
              </>
            ) : null}
          </Card>
        </div>

        <div className="stack">
          <Card title="About this console">
            <p className="small secondary" style={{ lineHeight: 1.65 }}>
              Ring Sentinel detects coordinated refund rings by pooling identity–infrastructure
              signals across merchants. The console is built around one workflow:
            </p>
            <p className="small mono" style={{ margin: "10px 0", color: "var(--text)" }}>
              CLAIM → RISK → EVIDENCE → NETWORK → DECISION → AUDIT TRAIL
            </p>
            <ul className="small secondary" style={{ paddingLeft: 17, lineHeight: 1.75 }}>
              <li>Queue data: scored held-out test set produced by train_eval.py.</li>
              <li>Evaluation numbers: consumed verbatim from models/eval_report.json.</li>
              <li>Live scoring &amp; demo scenarios: real /v1/score calls against the running model.</li>
            </ul>
          </Card>

          <Card
            title="Fail-open behaviour"
            actions={<InfoTip text="Deliberate product decision: refunds must never be blocked by an outage." />}
          >
            <p className="small secondary" style={{ lineHeight: 1.65 }}>
              If the scoring service is down or its model can't load, every claim scores as{" "}
              <b>AUTO_APPROVE</b> with a <span className="mono small">degraded=true</span> flag.
              This console surfaces that state everywhere rather than hiding it — analysts always
              know when they're looking at unscored claims.
            </p>
          </Card>

          <Card title="Legacy static report">
            <p className="small secondary" style={{ lineHeight: 1.65 }}>
              The original zero-dependency static dashboard (single HTML file with the flagged-cluster
              evidence graph) is still generated by <span className="mono small">build_dashboard.py</span>{" "}
              and remains available at <a className="mono small" style={{ color: "var(--blue)" }} href="/dashboard/index.html">/dashboard/index.html</a>{" "}
              for offline judging.
            </p>
          </Card>

          <MerchantApiCard />
        </div>
      </div>
    </div>
  );
}

/** Merchant Risk API + signed webhooks — the "integrate in 5 lines" card. */
function MerchantApiCard() {
  const toast = useToast();
  const [hookUrl, setHookUrl] = useState("");
  const [testing, setTesting] = useState(false);

  const fireTest = async () => {
    if (!hookUrl.trim().startsWith("http")) {
      toast({ tone: "err", title: "Invalid URL", msg: "Enter an https:// receiver URL first." });
      return;
    }
    setTesting(true);
    try {
      await api.webhookTest(hookUrl.trim());
      toast({
        tone: "ok",
        title: "Test webhook fired",
        msg: "Signed payload sent — verify the X-RingSentinel-Signature header in your receiver logs.",
      });
    } catch (e) {
      toast({ tone: "err", title: "Test failed", msg: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card
      title="Merchant Risk API"
      actions={
        <InfoTip text="Merchants query risk and receive signed webhooks — the same engine that powers this console, exposed as a product surface." />
      }
    >
      <p className="small secondary" style={{ lineHeight: 1.6, marginBottom: 8 }}>
        Query any merchant's risk profile:
      </p>
      <pre className="mono small" style={{ background: "var(--panel-inset)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", overflowX: "auto", lineHeight: 1.6 }}>
{`curl -H "X-API-Key: $KEY" \\
  $BASE/v1/merchants/MRC_00203/risk`}
      </pre>
      <p className="small secondary" style={{ lineHeight: 1.6, margin: "10px 0 8px" }}>
        Every webhook is signed (HMAC-SHA256, Stripe-style). Verify it before trusting a payload:
      </p>
      <pre className="mono small" style={{ background: "var(--panel-inset)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", overflowX: "auto", lineHeight: 1.6 }}>
{`# header: X-RingSentinel-Signature: t=<unix>,v1=<hex>
expected = HMAC_SHA256(
  WEBHOOK_SECRET, f"{t}.{raw_body}")`}
      </pre>
      <div className="divider" />
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input mono grow"
          placeholder="https://your-app.example.com/ring-sentinel-hook"
          value={hookUrl}
          onChange={(e) => setHookUrl(e.target.value)}
          aria-label="Webhook receiver URL"
        />
        <Button variant="primary" disabled={testing} onClick={fireTest}>
          <Icon name="bell" size={12} /> {testing ? "Firing…" : "Send test webhook"}
        </Button>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Topics: <span className="mono">alert.triggered</span> · <span className="mono">webhook.test</span> ·
        attach a webhook URL to any alert rule on the Alerts page to subscribe.
      </p>
    </Card>
  );
}

function StatusRow({ k, v, tip }: { k: string; v: React.ReactNode; tip?: string }) {
  return (
    <div className="spread" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="small secondary row" style={{ gap: 6 }}>
        {k} {tip && <InfoTip text={tip} />}
      </span>
      <span>{v}</span>
    </div>
  );
}
