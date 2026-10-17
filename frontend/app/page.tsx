"use client";
import { useState } from "react";
import {
  Activity, ArrowLeft, Bot, Brain, Building2, Database, FileStack, Home, Inbox, type LucideIcon, Send as Outbox, Settings, Store, Users,
} from "lucide-react";
import { pilotRows, toCsv } from "../lib/domain/pilot";
import { summary as summarise } from "../lib/domain/workflow";
import { PEOPLE, Role } from "./api";
import { ErpView, MemoryView, SettingsView, Workspace } from "./Panels";
import { EdiView } from "./Portal";
import { RetailerInbox, RetailerSuppliers, SupplierToday } from "./LiveView";
import { CommandCenter, type OpenTarget } from "./CommandCenter";
import { RunProvider, useAgent, useHealth } from "./run/RunProvider";

// D55: one product, two audiences. A toggle at the top switches between the supplier's workspace and what the
// retailer receives; each has its own short navigation. The data underneath is one run.
type View = "supplier" | "retailer";
type Tab = "today" | "work" | "command" | "memory" | "erp" | "edi" | "settings" | "received" | "suppliers" | "rcommand";
const NAV: Record<View, [Tab, string, LucideIcon, string][]> = {
  supplier: [
    ["today", "Today", Home, "What needs you, and what the agent handled on its own"],
    ["work", "Orders", Inbox, "Every purchase order, how the agent read it, and any decision waiting"],
    ["command", "Command Center", Activity, "Findings from order, ERP and outbox records, with owner, action and verification"],
    ["memory", "Agent memory", Brain, "Corrections an administrator approved for reuse"],
    ["erp", "ERP records", Database, "What the agent wrote to your ERP (simulated)"],
    ["edi", "Trading Grid outbox", Outbox, "Every document sent to the retailer, with its X12"],
    ["settings", "Settings", Settings, "Approvals, retailer EDI setup and your company details"],
  ],
  retailer: [
    ["received", "Documents received", FileStack, "Standard X12 arriving from suppliers who stay on email"],
    ["suppliers", "Suppliers", Users, "How each supplier connects, and their path onto Trading Grid EDI"],
    ["rcommand", "Command Center", Activity, "Findings shared by suppliers on your orders, with the response each one needs"],
  ],
};

export default function Page() {
  return <RunProvider><App /></RunProvider>;
}

function App() {
  const [view, setView] = useState<View>("supplier");
  const [tab, setTab] = useState<Tab>("today");
  const [focus, setFocus] = useState<number | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [fromCc, setFromCc] = useState(false);
  const [retailer, setRetailer] = useState<string | null>(null);
  // One signed-in user with full rights. Switching to a restricted demo user stays possible (role checks are
  // an acceptance check, P15) but is tucked away in the account menu.
  const [role, setRole] = useState<Role>("administrator");
  const agent = useAgent();
  const health = useHealth();
  const summary = agent.ready ? summarise(agent.state) : null;
  const error = agent.serverError;
  const testMode = health?.rehearsal_mode || health?.extractor_mode === "test";
  const extraction = !health ? "…" : testMode ? "Rehearsal: TEST ADAPTER (not AI)"
    : health.extraction === "available" ? `AI: ${health.model}` : "AI unavailable";
  const switchView = (v: View) => { setView(v); setTab(NAV[v][0][0]); setFromCc(false); };
  const goTab = (t: Tab) => { setTab(t); setFromCc(false); setSection(null); };
  const openFromCc = (t: OpenTarget) => { setFocus(t.docId); setSection(t.section); setFromCc(true); setTab("work"); };
  // D66: the retailer view is scoped to one retailer at a time; it sees only its own orders.
  const retailers = agent.ready ? [...new Set(agent.state.orders.map((o) => o.customerId).filter(Boolean))] as string[] : [];
  const viewingAs = retailer && retailers.includes(retailer) ? retailer : retailers[0] ?? null;
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
      <span className="muted small">One row per order: route, supervision, timings, corrections, exceptions, ERP attempts, outcome and findings. Savings are not calculated.</span>
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
          <span className={`chip ${testMode ? "warn" : health?.extraction === "available" ? "ok" : "bad"}`}>{extraction}</span>
          <details className="role">
            <summary>Signed in as {PEOPLE[role]}</summary>
            <label>Switch user
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Signed-in user">
                {(["administrator", "reviewer", "viewer"] as Role[]).map((r) => <option key={r} value={r}>{PEOPLE[r]}</option>)}
              </select>
            </label>
          </details>
        </div>
      </header>
      <div className="shell">
        <nav className="sidenav" role="tablist" aria-label="Sections" aria-orientation="vertical">
          <div className="nav-label">{view === "supplier" ? "Supplier workspace" : "Retailer workspace"}</div>
          {view === "retailer" && (
            <label className="viewing-as">Viewing as
              <select aria-label="Viewing as retailer" value={viewingAs ?? ""} onChange={(e) => setRetailer(e.target.value || null)}>
                {retailers.length === 0 && <option value="">No retailers yet</option>}
                {retailers.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}
          {NAV[view].map(([k, label, Icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => goTab(k)}>
              <Icon size={18} aria-hidden /><span>{label}</span>
            </button>
          ))}
          <div className="nav-foot">ERP and Trading Grid are simulated. Fictional data only.</div>
        </nav>
        <main>
          <div className="page-head">
            <div><h1>{current[1]}</h1><p>{current[3]}</p></div>
            {fromCc && tab === "work" && <button className="ghost" onClick={() => goTab("command")}><ArrowLeft size={16} aria-hidden /> Back to Command Center</button>}
          </div>
          {error && <div className="alert bad" role="alert">{error}</div>}
          {agent.storageWarning && <div className="alert warn" role="status">{agent.storageWarning}</div>}
          {tab === "today" && (
            <div className="kpis" aria-label="Executive summary">
              <Kpi n={summary?.orders_received} label="Orders received" />
              <Kpi n={summary?.delivered_to_erp} label="Delivered to ERP" tone="ok" />
              <Kpi n={summary?.held_for_review} label="Waiting on a person" tone="warn" />
              {!!summary?.delivery_problems && <Kpi n={summary.delivery_problems} label="Delivery needs attention" tone="bad" />}
            </div>
          )}
          {tab === "today" && <SupplierToday role={role} onOpen={(id) => { setFocus(id); setSection(null); setTab("work"); }} />}
          {tab === "work" && <Workspace key={`${focus ?? 0}:${section ?? ""}`} role={role} focus={focus} section={section} />}
          {tab === "command" && <CommandCenter audience="supplier" role={role} customerId={null} onOpen={openFromCc} />}
          {tab === "rcommand" && <CommandCenter audience="retailer" role={role} customerId={viewingAs} />}
          {tab === "memory" && <MemoryView role={role} />}
          {tab === "erp" && <ErpView role={role} />}
          {tab === "edi" && <EdiView role={role} />}
          {tab === "settings" && <SettingsView role={role} health={health} pilot={pilot} />}
          {tab === "received" && <RetailerInbox customerId={viewingAs} />}
          {tab === "suppliers" && <RetailerSuppliers customerId={viewingAs} />}
        </main>
      </div>
    </div>
  );
}

function Kpi({ n, label, tone }: { n?: number | string; label: string; tone?: string }) {
  return <div className={`kpi ${tone ?? ""}`}><b>{n ?? "–"}</b><span>{label}</span></div>;
}
