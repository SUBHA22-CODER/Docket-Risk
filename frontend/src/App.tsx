import React, { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { ErrorState, SkeletonRows } from "./components/ui";

const Overview = lazy(() => import("./pages/Overview"));
const ClaimsQueue = lazy(() => import("./pages/ClaimsQueue"));
const Investigation = lazy(() => import("./pages/Investigation"));
const Investigations = lazy(() => import("./pages/Investigations"));
const NetworkExplorer = lazy(() => import("./pages/NetworkExplorer"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Evaluation = lazy(() => import("./pages/Evaluation"));
const DemoMode = lazy(() => import("./pages/DemoMode"));
const Settings = lazy(() => import("./pages/Settings"));
const LiveFeed = lazy(() => import("./pages/LiveFeed"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Settlement = lazy(() => import("./pages/Settlement"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const RedTeamArena = lazy(() => import("./pages/RedTeamArena"));

function PageFallback() {
  return (
    <div>
      <div className="row" style={{ marginBottom: 18 }}>
        <div className="skeleton" style={{ width: 220, height: 22 }} />
      </div>
      <div className="kpis">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="kpi">
            <div className="skeleton" style={{ width: "60%", height: 10 }} />
            <div className="skeleton" style={{ width: "45%", height: 24, marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className="card">
        <SkeletonRows rows={7} />
      </div>
    </div>
  );
}

function RouteError({ error }: { error?: Error }) {
  return (
    <ErrorState
      title="This view failed to load"
      error={error ?? null}
      onRetry={() => window.location.reload()}
    />
  );
}

function guarded(C: React.LazyExoticComponent<React.ComponentType>) {
  return (
    <Suspense fallback={<PageFallback />}>
      <ErrorBoundary>
        <C />
      </ErrorBoundary>
    </Suspense>
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <RouteError
          error={this.state.error}
        />
      );
    }
    return this.props.children;
  }
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: guarded(LandingPage),
  },
  {
    path: "/landing",
    element: guarded(LandingPage),
  },
  {
    element: <AppShell />,
    children: [
      { path: "overview", element: guarded(Overview) },
      { path: "claims", element: guarded(ClaimsQueue) },
      { path: "claims/:claimId", element: guarded(Investigation) },
      { path: "investigations", element: guarded(Investigations) },
      { path: "live", element: guarded(LiveFeed) },
      { path: "alerts", element: guarded(Alerts) },
      { path: "settlement", element: guarded(Settlement) },
      { path: "network", element: guarded(NetworkExplorer) },
      { path: "analytics", element: guarded(Analytics) },
      { path: "evaluation", element: guarded(Evaluation) },
      { path: "demo", element: guarded(DemoMode) },
      { path: "arena", element: guarded(RedTeamArena) },
      { path: "settings", element: guarded(Settings) },
      { path: "*", element: <RouteError /> },
    ],
  },
]);
