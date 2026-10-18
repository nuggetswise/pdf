"use client";
import { useState } from "react";
import {
  Activity, ArrowLeft, Bot, Building2, FileStack, Home, ListChecks, type LucideIcon, ArrowLeftRight, Settings, Store, Users,
} from "lucide-react";
import { PEOPLE, Role } from "./api";
import { SettingsView } from "./Settings";
import { TransactionsView } from "./Transactions";
import { RulesView } from "./Rules";
import { OrderMailbox, RetailerInbox, RetailerSuppliers } from "./LiveView";
import { OrderReview } from "./OrderReview";
import { attentionCount, OpsHome, OrderExceptions } from "./OrderOps";
import { findingCounts, supplierFindings } from "../lib/domain/command-center";
import { CommandCenter, type OpenTarget } from "./CommandCenter";
import { RunProvider, useAgent, useHealth } from "./run/RunProvider";
import bundledReference from "../lib/domain/reference-data.v1.json";

// One product, two audiences. A switch at the top shows the supplier's workspace or what the retailer receives; each
// has its own short navigation. The data underneath is one run.
type View = "supplier" | "retailer";
type Tab = "ops" | "transactions" | "command" | "rules" | "settings" | "received" | "suppliers" | "rcommand";
const NAV: Record<View, [Tab, string, LucideIcon, string][]> = {
  supplier: [
    ["ops", "Orders", Home, "Orders received by email, what needs a person, and where each one stands"],
    ["transactions", "Transactions", ArrowLeftRight, "Every document received from and sent to retailers"],
    ["command", "Command Center", Activity, "Findings across orders, stock and documents sent, with who handles each"],
    ["rules", "Rules", ListChecks, "What every order is checked against, as synced from your ERP"],
    ["settings", "Settings", Settings, "Connections, company, team, notifications and approval mode"],
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
  const [opsFrom, setOpsFrom] = useState<"ops" | "command" | "transactions">("ops");
  // One signed-in user with full rights. Switching to a restricted user stays possible (role checks are an
  // acceptance check, P15) but is tucked away in the account menu, in the test environment only.
  const [role, setRole] = useState<Role>("administrator");
  const agent = useAgent();
  const health = useHealth();
  const error = agent.serverError;
  const testMode = !!(health?.test_reader || health?.extractor_mode === "test");
  const extraction = !health ? "…" : testMode ? "Scripted reader, not AI"
    : health.extraction === "available" ? `AI: ${health.model}` : "AI unavailable";
  const switchView = (v: View) => { setView(v); setTab(NAV[v][0][0]); setOpsOrder(null); };
  const goTab = (t: Tab) => { setTab(t); setOpsOrder(null); };
  const openOps = (id: string, from: "ops" | "command" | "transactions") => { setOpsOrder(id); setOpsFrom(from); setTab("ops"); window.scrollTo?.(0, 0); };
  const ccOpen = agent.ready ? findingCounts(supplierFindings(agent.state)).open + attentionCount(agent.state) : 0;
  const openFromCc = (t: OpenTarget) => { openOps(`doc:${t.docId}`, "command"); if (t.section) setTimeout(() => document.getElementById(`order-${t.section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); };
  // D72: one retailer view, with no picker. It is the retailer of the first order in the run and sees only its own orders.
  const viewingAs = agent.ready ? agent.state.orders.map((o) => o.customerId).find(Boolean) ?? null : null;
  const retailerName = viewingAs ? bundledReference.customers.find((c) => c.customer_id === viewingAs)?.name ?? viewingAs : null;
  const current: [Tab, string, LucideIcon, string] = NAV[view].find((n) => n[0] === tab) ?? NAV[view][0];


  return (
    <div className="app">
      <header className="masthead">
        <div className="brand"><span className="logo" aria-hidden><Bot size={20} /></span>
          <span>Trading Grid <b>Portal</b></span></div>
        <div className="viewswitch" role="group" aria-label="View as">
          <button aria-pressed={view === "supplier"} onClick={() => switchView("supplier")}><Building2 size={16} aria-hidden /> Supplier</button>
          <button aria-pressed={view === "retailer"} onClick={() => switchView("retailer")}><Store size={16} aria-hidden /> Retailer</button>
        </div>
        <div className="mast-right">
          {testMode && <span className="chip warn env-badge">Test environment</span>}
          <span className={`chip ${testMode ? "" : health?.extraction === "available" ? "ok" : "bad"}`}>{extraction}</span>
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
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => goTab(k)}>
              <Icon size={18} aria-hidden /><span>{label}</span>
            </button>
          ))}
          <div className="nav-foot">{testMode ? "Test environment. Your ERP and Trading Grid are simulated, and all data is fictional." : "Live environment."}</div>
        </nav>
        <main>
          <div className="page-head">
            <div><h1>{current[1]}</h1><p>{current[3]}</p></div>
          </div>
          {error && <div className="alert bad" role="alert">{error}</div>}
          {agent.storageWarning && <div className="alert warn" role="status">{agent.storageWarning}</div>}
          {tab === "ops" && !opsOrder && (
            <OpsHome role={role} onOpen={(t) => openOps(`doc:${t.docId}`, "ops")} onSettings={() => goTab("settings")}
              commandCenter={(
                <section className="panel cc-entry" aria-labelledby="cc-entry-h">
                  <header className="panel-head"><h3 id="cc-entry-h">Command Center</h3><span className="count">{ccOpen}</span></header>
                  <p className="muted small">Order exceptions and findings across stock and the documents you sent.</p>
                  <button className="ghost" onClick={() => goTab("command")}><Activity size={16} aria-hidden /> Open Command Center</button>
                </section>
              )}
              mailbox={<OrderMailbox testEnv={testMode} />} />
          )}
          {tab === "ops" && opsOrder?.startsWith("doc:") && (
            <OrderReview key={opsOrder} docId={Number(opsOrder.slice(4))} role={role}
              onBack={() => (opsFrom === "ops" ? setOpsOrder(null) : goTab(opsFrom))} />
          )}
          {tab === "transactions" && <TransactionsView role={role} onOpenOrder={(id) => openOps(`doc:${id}`, "transactions")} />}
          {tab === "command" && <OrderExceptions onOpen={(id) => openOps(`doc:${id}`, "command")} />}
          {tab === "command" && <CommandCenter audience="supplier" role={role} customerId={null} onOpen={openFromCc} />}
          {tab === "rcommand" && <CommandCenter audience="retailer" role={role} customerId={viewingAs} />}
          {tab === "rules" && <RulesView role={role} />}
          {tab === "settings" && <SettingsView role={role} health={health} />}
          {tab === "received" && <RetailerInbox customerId={viewingAs} />}
          {tab === "suppliers" && <RetailerSuppliers customerId={viewingAs} />}
        </main>
      </div>
    </div>
  );
}
