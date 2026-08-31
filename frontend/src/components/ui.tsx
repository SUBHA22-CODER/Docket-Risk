import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Action, RiskLevel } from "../types";
import { ACTION_SHORT } from "../lib/format";
import { Icon, type IconName } from "./Icon";

/* ---- Button ---- */

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "danger" | "success" | "ghost";
  size?: "sm" | "md";
}

export function Button({
  variant = "default",
  size = "md",
  className = "",
  ...rest
}: ButtonProps) {
  const cls =
    variant === "primary"
      ? "btn btn-primary"
      : variant === "danger"
        ? "btn btn-danger"
        : variant === "success"
          ? "btn btn-success"
          : variant === "ghost"
            ? "btn btn-ghost"
            : "btn";
  return (
    <button
      className={`${cls} ${size === "sm" ? "btn-sm" : ""} ${className}`}
      {...rest}
    />
  );
}

/* ---- Badges ---- */

const RISK_CLASS: Record<RiskLevel, string> = {
  HIGH: "badge-high",
  MEDIUM: "badge-medium",
  LOW: "badge-low",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`badge ${RISK_CLASS[level]}`}>
      <span className="dot" aria-hidden="true" />
      {level}
    </span>
  );
}

const ACTION_CLASS: Record<Action, string> = {
  AUTO_APPROVE: "badge-low",
  STEP_UP_VERIFICATION: "badge-medium",
  HOLD_PAYOUT_HUMAN_REVIEW: "badge-high",
};

export function ActionBadge({ action }: { action: Action }) {
  return (
    <span className={`badge ${ACTION_CLASS[action] ?? "badge-neutral"}`}>
      {ACTION_SHORT[action] ?? action}
    </span>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "info" | "high" | "medium" | "low";
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/* ---- Card / MetricCard ---- */

export function Card({
  title,
  actions,
  children,
  className = "",
  bodyClass = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title != null && (
        <header className="card-head">
          <h2 className="card-title" style={{ textTransform: "none", fontSize: 12.5, letterSpacing: 0 }}>
            {title}
          </h2>
          {actions}
        </header>
      )}
      <div className={bodyClass || "card-pad"}>{children}</div>
    </section>
  );
}

export interface MetricCardProps {
  label: string;
  value: string;
  tooltip?: string;
  foot?: ReactNode;
}

export function MetricCard({ label, value, tooltip, foot }: MetricCardProps) {
  const labelEl = (
    <div className="kpi-label">
      <span>{label}</span>
      {tooltip && <InfoTip text={tooltip} />}
    </div>
  );
  return (
    <div className="kpi" role="group" aria-label={label}>
      {labelEl}
      <div className="kpi-value num">{value}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}

/* ---- Tooltip ---- */

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="tt-wrap"
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-label={text}
      role="note"
    >
      <svg viewBox="0 0 24 24" width={12.5} height={12.5} fill="none" stroke="currentColor" strokeWidth={1.8} style={{ opacity: 0.7 }}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10.8v5.4" strokeLinecap="round" />
        <circle cx="12" cy="7.6" r="0.6" fill="currentColor" stroke="none" />
      </svg>
      {open && <span className="tt-bubble">{text}</span>}
    </span>
  );
}

/* ---- Skeleton / Empty / Error states ---- */

export function Skeleton({
  w,
  h,
  radius,
  className = "",
}: {
  w?: string | number;
  h?: number;
  radius?: number;
  className?: string;
}) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width: w, height: h ?? 14, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "16px 18px" }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row" style={{ gap: 16 }}>
          <Skeleton w={90} />
          <Skeleton w="26%" />
          <Skeleton w="18%" />
          <Skeleton w={64} h={20} radius={999} />
          <Skeleton w={70} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon = "check",
  title,
  desc,
  actions,
}: {
  icon?: IconName;
  title: string;
  desc?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="state-block" role="status">
      <div className={`state-icon ${icon === "alert" ? "warn" : icon === "x" ? "err" : icon === "search" ? "info" : "ok"}`}>
        <Icon name={icon} size={21} />
      </div>
      <div className="state-title">{title}</div>
      {desc && <p className="state-desc">{desc}</p>}
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  error,
  onRetry,
  extraActions,
}: {
  title?: string;
  error: Error | null;
  onRetry?: () => void;
  extraActions?: ReactNode;
}) {
  return (
    <div className="state-block" role="alert">
      <div className="state-icon err">
        <Icon name="alert" size={21} />
      </div>
      <div className="state-title">{title}</div>
      {error && <p className="state-desc">{error.message}</p>}
      {(onRetry || extraActions) && (
        <div className="state-actions">
          {onRetry && (
            <Button onClick={onRetry}>
              <Icon name="refresh" size={14} /> Retry
            </Button>
          )}
          {extraActions}
        </div>
      )}
    </div>
  );
}

/** The specific fail-open banner mirroring backend degradation. */
export function DegradedBanner({ onStatus }: { onStatus?: () => void }) {
  return (
    <div className="degraded-banner" role="alert">
      <Icon name="alert" size={17} />
      <span className="grow">
        <b>Risk service unavailable.</b> Scoring is failing open — claims are
        defaulting to AUTO_APPROVE and are NOT being blocked.
      </span>
      {onStatus && (
        <Button size="sm" onClick={onStatus}>
          View system status
        </Button>
      )}
    </div>
  );
}

/* ---- Modal + ConfirmDialog + Drawer ---- */

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function Modal({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEscape(onClose);
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          {title}
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export interface ConfirmSpec {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec; onClose: () => void }) {
  return (
    <Modal
      title={spec.title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={spec.danger ? "danger" : "primary"}
            onClick={() => {
              spec.onConfirm();
              onClose();
            }}
          >
            {spec.confirmLabel}
          </Button>
        </>
      }
    >
      {spec.body}
    </Modal>
  );
}

export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEscape(onClose);
  return (
    <>
      <div className="drawer-overlay" onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <strong>{title}</strong>
          <button className="icon-btn" onClick={onClose} aria-label="Close panel">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

/* ---- Toast ---- */

export interface ToastMsg {
  id: number;
  tone: "ok" | "err" | "info";
  title: string;
  msg?: string;
}

const ToastCtx = createContext<(t: Omit<ToastMsg, "id">) => void>(() => undefined);

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const push = (t: Omit<ToastMsg, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-4), { ...t, id }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4200);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <div className="grow">
              <div className="toast-title">{t.title}</div>
              {t.msg && <div className="toast-msg">{t.msg}</div>}
            </div>
            <button
              className="icon-btn"
              aria-label="Dismiss notification"
              onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
