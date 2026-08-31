import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ClaimRow } from "../types";
import { api } from "../lib/api";
import { inr, pctScore } from "../lib/format";
import { Icon } from "./Icon";

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  action: () => void;
}

const NAV_ITEMS = [
  { to: "/overview", icon: "overview", label: "Overview" },
  { to: "/claims", icon: "queue", label: "Claims Queue" },
  { to: "/investigations", icon: "investigations", label: "Investigations" },
  { to: "/network", icon: "network", label: "Network" },
  { to: "/analytics", icon: "analytics", label: "Analytics" },
  { to: "/evaluation", icon: "evaluation", label: "Evaluation" },
  { to: "/demo", icon: "play", label: "Demo Mode" },
  { to: "/settings", icon: "settings", label: "Settings" },
] as const;

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<ClaimRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setResults([]);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  // debounced server search for claims / identities / merchants
  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = window.setTimeout(async () => {
      try {
        const page = await api.claims({ q: q.trim(), page_size: 6 });
        setResults(page.items);
      } catch {
        setResults([]);
      }
    }, 220);
    return () => window.clearTimeout(id);
  }, [q, open]);

  const items = useMemo<PaletteItem[]>(() => {
    const navItems: PaletteItem[] = NAV_ITEMS.filter((n) =>
      n.label.toLowerCase().includes(q.toLowerCase()),
    ).map((n) => ({
      id: `nav:${n.to}`,
      group: "Navigate",
      label: n.label,
      icon: <Icon name={n.icon} size={15} />,
      action: () => navigate(n.to),
    }));
    const claimItems: PaletteItem[] = results.map((c) => ({
      id: `claim:${c.claim_id}`,
      group: "Claims",
      label: c.claim_id,
      sub: `${pctScore(c.score)} · ${inr(c.amount)} · ${c.risk_level}`,
      icon: <Icon name="queue" size={15} />,
      action: () => navigate(`/claims/${encodeURIComponent(c.claim_id)}`),
    }));
    const identityGroup: PaletteItem[] =
      q.trim().length >= 2
        ? [
            {
              id: "ident-search",
              group: "Open in Network",
              label: `Search “${q.trim()}” in network explorer`,
              icon: <Icon name="network" size={15} />,
              action: () => navigate(`/network?q=${encodeURIComponent(q.trim())}`),
            },
          ]
        : [];
    return [...navItems, ...claimItems, ...identityGroup];
  }, [q, results, navigate]);

  useEffect(() => {
    setActive(0);
  }, [items.length, q]);

  if (!open) return null;

  const groups = Array.from(new Set(items.map((i) => i.group)));
  let flatIndex = -1;

  return (
    <div className="palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Global search">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search claims, identities, merchants, devices…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              items[active]?.action();
              onClose();
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          aria-label="Search query"
        />
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && (
            <div className="palette-empty">
              No matches. Try a claim ID like CLM_0019217, an identity like RNG006_01,
              or a merchant like MRC_00203.
            </div>
          )}
          {groups.map((g) => (
            <div key={g}>
              <div className="palette-group">{g}</div>
              {items
                .filter((i) => i.group === g)
                .map((item) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  return (
                    <div
                      key={item.id}
                      className={`palette-item ${idx === active ? "active" : ""}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => {
                        item.action();
                        onClose();
                      }}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                      {item.sub && <span className="sub">{item.sub}</span>}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
