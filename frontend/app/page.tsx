"use client";
import { useState } from "react";
import {
  Activity, ArrowLeft, Bot, Building2, FileStack, Home, Inbox, ListChecks, type LucideIcon, Send as Outbox, Settings, Store, Users,
} from "lucide-react";
import { pilotRows, toCsv } from "../lib/domain/pilot";
import { PEOPLE, Role } from "./api";
import { ErpView, MemoryView, SettingsView, Workspace } from "./Panels";
import { EdiView } from "./Portal";
import { RulesView } from "./Rules";
import { Forward, RetailerInbox, RetailerSuppliers } from "./LiveView";
import { ForwardedReview } from "./ForwardedReview";
import { attentionCount, OpsHome, OrderExceptions } from "./OrderOps";
import { findingCounts, supplierFindings } from "../lib/domain/command-center";
import { CommandCenter, type OpenTarget } from "./CommandCenter";
import { RunProvider, useAgent, useHealth } from "./run/RunProvider";
import bundledReference from "../lib/domain/reference-data.v1.json";

// D55: one product, two audiences. A toggle at the top switches between the supplier's workspace and what the
// retailer receives; each has its own short navigation. The data underneath is one run.
type View = "supplier" | "retailer";
type Tab = "ops" | "work" | "command" | "sent" | "rules" | "settings" | "received" | "suppliers" | "rcommand";
const NAV: Record<View, [Tab, string, LucideIcon, string][]> = {
  supplier: [
    ["ops", "Orders", Home, "Review orders received by email and track them to your ERP"],
    ["command", "Command Center", Activity, "Resolve findings across orders, stock and sent documents"],
    ["sent", "Sent", Outbox, "Orders written to your ERP and documents sent to retailers (simulated)"],
    ["rules", "Rules", ListChecks, "Checks applied to every order, and rules approved for reuse"],
    ["settings", "Settings", Settings, "Approval mode, retailer EDI setup and company details"],
  ],
  retailer: [
    ["received", "Documents received", FileStack, "Standard X12 from suppliers who send by email"],
    ["suppliers", "Suppliers", Users, "Connection type for each supplier and its path to EDI"],
    ["rcommand", "Command Center", Activity, "Findings suppliers shared on your orders, with the response needed"],
  ],
};

export default function Page() {
  return <RunProvider><App /></RunProvider>;
}

function App() {
  const [view, setView] = useState<View>("supplier");
  const [tab, setTab] = useState<Tab>("ops");
  const [opsOrder, setOpsOrder] = useState<string | null>(null);
  const [opsFrom, setOpsFrom] = useState<"ops" | "command">("ops");
  const [focus, setFocus] = useState<number | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [fromCc, setFromCc] = useState(false);
  // One signed-in user with full rights. Switching to a restricted demo user stays possible (role checks are
  // an acceptance check, P15) but is tucked away in the account menu.
  const [role, setRole] = useState<Role>("administrator");
  const agent = useAgent();
  const health = useHealth();
  const error = agent.serverError;
  const testMode = health?.rehearsal_mode || health?.extractor_mode === "test";
  const extraction = !health ? "…" : testMode ? "Scripted reader, not live AI"
    : health.extraction === "available" ? `AI: ${health.model}` : "AI unavailable";
  const switchView = (v: View) => { setView(v); setTab(NAV[v][0][0]); setFromCc(false); };
  const goTab = (t: Tab) => { setTab(t); setFromCc(false); setSection(null); setOpsOrder(null); };
  const openOps = (id: string, from: "ops" | "command") => { setOpsOrder(id); setOpsFrom(from); setTab("ops"); window.scrollTo?.(0, 0); };
  const ccOpen = agent.ready ? findingCounts(supplierFindings(agent.state)).open + attentionCount(agent.state) : 0;
  const openFromCc = (t: OpenTarget) => { setFocus(t.docId); setSection(t.section); setFromCc(true); setTab("work"); };
  // D72: one retailer view, with no picker. It is the retailer of the first order in the run and sees only its own orders.
  const viewingAs = agent.ready ? agent.state.orders.map((o) => o.customerId).find(Boolean) ?? null : null;
  const retailerName = viewingAs ? bundledReference.customers.find((c) => c.customer_id === viewingAs)?.name ?? viewingAs : null;
  // D73: the document workspace is part of Orders, opened from "All documents"; it has no tab of its own.
  const current: [Tab, string, LucideIcon, string] = tab === "work" ? ["work", "All documents", Inbox, "Every forwarded document, how it was read, and any decision waiting"]
    : NAV[view].find((n) => n[0] === tab) ?? NAV[view][0];

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
          <span>Trading Grid <b>Portal</b></span><small>prototype</small></div>
        <div className="viewswitch" role="group" aria-label="View as">
          <button aria-pressed={view === "supplier"} onClick={() => switchView("supplier")}><Building2 size={16} aria-hidden /> Supplier</button>
          <button aria-pressed={view === "retailer"} onClick={() => switchView("retailer")}><Store size={16} aria-hidden /> Retailer</button>
        </div>
        <div className="mast-right">
          <span className={`chip ${testMode ? "warn" : health?.extraction === "available" ? "ok" : "bad"}`}>{extraction}</span>
          {testMode ? (
            <details className="role">
              <summary>Signed in as {PEOPLE[role]}</summary>
              <label>Switch user
                <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Signed-in user">
                  {(["administrator", "reviewer", "viewer"] as Role[]).map((r) => <option key={r} value={r}>{PEOPLE[r]}</option>)}
                </select>
              </label>
            </details>
          ) : <span className="muted small">Signed in as {PEOPLE[role]}</span>}
        </div>
      </header>
      <div className="shell">
        <nav className="sidenav" role="tablist" aria-label="Sections" aria-orientation="vertical">
          <div className="nav-label">{view === "supplier" ? "Supplier workspace" : "Retailer workspace"}</div>
          {view === "retailer" && <div className="viewing-as">Signed in as <b>{retailerName ?? "No retailer yet"}</b></div>}
          {NAV[view].map(([k, label, Icon]) => (
            <button key={k} role="tab" aria-selected={tab === k || (k === "ops" && tab === "work")} onClick={() => goTab(k)}>
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
          {tab === "ops" && !opsOrder && (
            <OpsHome
              onOpen={(t) => openOps(`doc:${t.docId}`, "ops")}
              commandCenter={(
                <section className="panel cc-entry" aria-labelledby="cc-entry-h">
                  <header className="panel-head"><h3 id="cc-entry-h">Command Center</h3><span className="count">{ccOpen}</span></header>
                  <p className="muted small">Order exceptions and findings across stock and the outbox.</p>
                  <button className="ghost" onClick={() => goTab("command")}><Activity size={16} aria-hidden /> Open Command Center</button>
                </section>
              )}
              forward={(
                <section className="panel forward-panel" aria-label="Forward a purchase order">
                  <header className="panel-head"><h3>New purchase order</h3>
                    <button className="ghost" onClick={() => { setFocus(null); setSection(null); setTab("work"); }}><Inbox size={16} aria-hidden /> All documents</button></header>
                  <Forward />
                </section>
              )} />
          )}
          {tab === "ops" && opsOrder?.startsWith("doc:") && (
            <ForwardedReview key={opsOrder} docId={Number(opsOrder.slice(4))} role={role}
              onBack={() => (opsFrom === "command" ? goTab("command") : setOpsOrder(null))}
              onOpenIntake={(id) => { setOpsOrder(null); setFocus(id); setSection(null); setTab("work"); }} />
          )}
          {tab === "work" && <Workspace key={`${focus ?? 0}:${section ?? ""}`} role={role} focus={focus} section={section} />}
          {tab === "command" && <OrderExceptions onOpen={(id) => openOps(`doc:${id}`, "command")} />}
          {tab === "command" && <CommandCenter audience="supplier" role={role} customerId={null} onOpen={openFromCc} />}
          {tab === "rcommand" && <CommandCenter audience="retailer" role={role} customerId={viewingAs} />}
          {tab === "rules" && <RulesView role={role} health={health} />}
          {tab === "sent" && <ErpView role={role} />}
          {tab === "sent" && <EdiView role={role} />}
          {tab === "settings" && <SettingsView role={role} health={health} pilot={pilot} />}
          {tab === "received" && <RetailerInbox customerId={viewingAs} />}
          {tab === "suppliers" && <RetailerSuppliers customerId={viewingAs} />}
        </main>
      </div>
    </div>
  );
}
