"use client";
import { useState } from "react";
import {
  Bot, Brain, Building2, Database, FileStack, Home, Inbox, type LucideIcon, Send as Outbox, Settings, Store, Users,
} from "lucide-react";
import { pilotRows, toCsv } from "../lib/domain/pilot";
import { summary as summarise } from "../lib/domain/workflow";
import { manualRouteTotals } from "../lib/domain/manual-route";
import { PEOPLE, Role } from "./api";
import { ErpView, MemoryView, SettingsView, Workspace } from "./Panels";
import { EdiView } from "./Portal";
import { RetailerInbox, RetailerSuppliers, SupplierToday } from "./LiveView";
import { RunProvider, useAgent, useHealth } from "./run/RunProvider";

// D55: one product, two audiences. A toggle at the top switches between the supplier's workspace and what the
// retailer receives; each has its own short navigation. The view is a demo lens; the data underneath is one run.
type View = "supplier" | "retailer";
type Tab = "today" | "work" | "memory" | "erp" | "edi" | "settings" | "received" | "suppliers";
const NAV: Record<View, [Tab, string, LucideIcon, string][]> = {
  supplier: [
    ["today", "Today", Home, "What needs you, and what the agent handled on its own"],
    ["work", "Orders", Inbox, "Every purchase order, how the agent read it, and any decision waiting"],
    ["memory", "Agent memory", Brain, "Corrections an administrator approved for reuse"],
    ["erp", "ERP records", Database, "What the agent wrote to your ERP (simulated)"],
    ["edi", "Trading Grid outbox", Outbox, "Every document sent to the retailer, with its X12"],
    ["settings", "Settings", Settings, "Automation, retailer EDI setup and assumptions"],
  ],
  retailer: [
    ["received", "Documents received", FileStack, "Standard X12 arriving from suppliers who stay on email"],
    ["suppliers", "Suppliers", Users, "How each supplier connects, and their path onto Trading Grid EDI"],
  ],
};

export default function Page() {
  return <RunProvider><App /></RunProvider>;
}

function App() {
  const [view, setView] = useState<View>("supplier");
  const [tab, setTab] = useState<Tab>("today");
  const [focus, setFocus] = useState<number | null>(null);
  // One signed-in user with full rights. Switching to a restricted demo user stays possible (role checks are
  // an acceptance check, P15) but is tucked away in the account menu.
  const [role, setRole] = useState<Role>("administrator");
  const agent = useAgent();
  const health = useHealth();
  const summary = agent.ready ? summarise(agent.state) : null;
  const totals = agent.ready ? manualRouteTotals(agent.state) : null;
  const error = agent.serverError;
  const exceptionOnly = health?.policy.mode === "exception_only";
  const testMode = health?.rehearsal_mode || health?.extractor_mode === "test";
  const extraction = !health ? "…" : testMode ? "Rehearsal: TEST ADAPTER (not AI)"
    : health.extraction === "available" ? `AI: ${health.model}` : "AI unavailable";
  const switchView = (v: View) => { setView(v); setTab(NAV[v][0][0]); };
  const current = NAV[view].find((n) => n[0] === tab) ?? NAV[view][0];

  const pilot = agent.ready && agent.state.orders.length > 0 && (
    <div className="btns pilot-export">
      <button className="ghost" onClick={() => {
        const blob = new Blob([toCsv(pilotRows(agent.state))], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "order-agent-pilot.csv"; a.click();
        URL.revokeObjectURL(url);
      }}>Export pilot measurements (CSV)</button>
      <span className="muted small">One row per order: time from PDF to ERP and ASN, what a person changed, what the agent caught.</span>
    </div>
  );

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand"><span className="logo" aria-hidden><Bot size={20} /></span>
          <span>Trading Grid <b>Order Agent</b></span><small>prototype</small></div>
        <div className="viewswitch" role="group" aria-label="View as">
          <button aria-pressed={view === "supplier"} onClick={() => switchView("supplier")}><Building2 size={16} aria-hidden /> Supplier</button>
          <button aria-pressed={view === "retailer"} onClick={() => switchView("retailer")}><Store size={16} aria-hidden /> Retailer</button>
        </div>
        <div className="mast-right">
          <span className={`mode ${exceptionOnly ? "exc" : "all"}`} title="Automation mode, set by an administrator">
            {exceptionOnly ? "Exception-only mode" : "Review-all mode"}
          </span>
          <span className={`chip ${testMode ? "warn" : health?.extraction === "available" ? "ok" : "bad"}`}>{extraction}</span>
          <details className="role">
            <summary>Signed in as {PEOPLE[role]}</summary>
            <label>Switch demo user
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Demo role">
                {(["administrator", "reviewer", "viewer"] as Role[]).map((r) => <option key={r} value={r}>{PEOPLE[r]}</option>)}
              </select>
            </label>
            <small>Only to show that a viewer cannot approve and a reviewer cannot change settings.</small>
          </details>
        </div>
      </header>
      <div className="shell">
        <nav className="sidenav" role="tablist" aria-label="Sections" aria-orientation="vertical">
          <div className="nav-label">{view === "supplier" ? "Supplier workspace" : "Retailer workspace"}</div>
          {NAV[view].map(([k, label, Icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              <Icon size={18} aria-hidden /><span>{label}</span>
            </button>
          ))}
          <div className="nav-foot">ERP and Trading Grid are simulated. Fictional data only.</div>
        </nav>
        <main>
          <div className="page-head">
            <div><h1>{current[1]}</h1><p>{current[3]}</p></div>
          </div>
          {error && <div className="alert bad" role="alert">{error}</div>}
          {agent.storageWarning && <div className="alert warn" role="status">{agent.storageWarning}</div>}
          {tab === "today" && (
            <div className="kpis" aria-label="Executive summary">
              <Kpi n={summary?.orders_received} label="Orders received" />
              <Kpi n={summary?.delivered_to_erp} label="Delivered to ERP" tone="ok" />
              <Kpi n={summary?.held_for_review} label="Waiting on a person" tone="warn" />
              <Kpi n={totals ? `USD ${totals.exposureAvoided}` : undefined} label="Chargeback exposure avoided (estimate)" tone="ok" />
              {!!summary?.delivery_problems && <Kpi n={summary.delivery_problems} label="Delivery needs attention" tone="bad" />}
            </div>
          )}
          {tab === "today" && <SupplierToday role={role} onOpen={(id) => { setFocus(id); setTab("work"); }} />}
          {tab === "work" && <Workspace key={focus ?? 0} role={role} focus={focus} />}
          {tab === "memory" && <MemoryView role={role} />}
          {tab === "erp" && <ErpView />}
          {tab === "edi" && <EdiView role={role} />}
          {tab === "settings" && <SettingsView role={role} health={health} pilot={pilot} />}
          {tab === "received" && <RetailerInbox />}
          {tab === "suppliers" && <RetailerSuppliers />}
        </main>
      </div>
    </div>
  );
}

function Kpi({ n, label, tone }: { n?: number | string; label: string; tone?: string }) {
  return <div className={`kpi ${tone ?? ""}`}><b>{n ?? "–"}</b><span>{label}</span></div>;
}
