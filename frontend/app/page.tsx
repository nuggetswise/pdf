"use client";
import { pilotRows, toCsv } from "../lib/domain/pilot";
import { useState } from "react";
import { summary as summarise } from "../lib/domain/workflow";
import { manualRouteTotals } from "../lib/domain/manual-route";
import { PEOPLE, Role } from "./api";
import { ErpView, MemoryView, SettingsView, Workspace } from "./Panels";
import { EdiView } from "./Portal";
import { LiveView } from "./LiveView";
import { RunProvider, useAgent, useHealth } from "./run/RunProvider";

type Tab = "live" | "work" | "memory" | "erp" | "edi" | "settings";
const TABS: [Tab, string][] = [["live", "Supplier and retailer"], ["work", "Inbox & review"], ["memory", "Agent memory"], ["erp", "ERP records"], ["edi", "Trading Grid outbox"], ["settings", "Settings"]];

export default function Page() {
  return <RunProvider><App /></RunProvider>;
}

function App() {
  const [tab, setTab] = useState<Tab>("live");
  // One signed-in user with full rights. Switching to a restricted demo user stays possible (role checks are
  // an acceptance check, P15) but is tucked away so it is not the first thing a supplier sees.
  const [focus, setFocus] = useState<number | null>(null);
  const [role, setRole] = useState<Role>("administrator");
  const agent = useAgent();
  const health = useHealth();
  const summary = agent.ready ? summarise(agent.state) : null;
  const totals = agent.ready ? manualRouteTotals(agent.state) : null;
  const error = agent.serverError;

  const exceptionOnly = health?.policy.mode === "exception_only";
  const extraction = !health ? "…" : health.rehearsal_mode || health.extractor_mode === "test"
    ? "Rehearsal: TEST ADAPTER (not AI)" : health.extraction === "available" ? `AI extraction: ${health.model}` : "AI extraction unavailable";

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
    <>
      <header className="topbar">
        <div className="brand"><span className="logo" aria-hidden>◆</span> Order Agent for Trading Grid <small>prototype</small></div>
        <span className={`mode ${exceptionOnly ? "exc" : "all"}`} title="Automation mode, set by an administrator">
          {exceptionOnly ? "Exception-only mode" : "Review-all mode"}
        </span>
        <span className={`pill ${health?.rehearsal_mode || health?.extractor_mode === "test" ? "warn" : health?.extraction === "available" ? "ok" : "bad"}`}>{extraction}</span>
        <span className="pill muted">ERP and Trading Grid: simulated</span>
        <details className="role">
          <summary>Signed in as {PEOPLE[role]}</summary>
          <label>Switch demo user
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Demo role">
              {(["administrator", "reviewer", "viewer"] as Role[]).map((r) => <option key={r} value={r}>{PEOPLE[r]}</option>)}
            </select>
          </label>
          <small>Only to show that a viewer cannot approve and a reviewer cannot change settings.</small>
        </details>
      </header>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {agent.storageWarning && <div className="alert warn" role="status">{agent.storageWarning}</div>}
      <div className="kpis" aria-label="Executive summary">
        <Kpi n={summary?.orders_received} label="Orders received" />
        <Kpi n={summary?.delivered_to_erp} label="Delivered to ERP" tone="ok" />
        <Kpi n={summary?.held_for_review} label="Waiting on a person" tone="warn" />
        <Kpi n={totals ? `USD ${totals.exposureAvoided}` : undefined} label="Chargeback exposure avoided (estimate)" tone="ok" />
        {!!summary?.delivery_problems && <Kpi n={summary.delivery_problems} label="Delivery needs attention" tone="bad" />}
      </div>
      <nav className="tabs" role="tablist" aria-label="Sections">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </nav>
      <main>
        {tab === "live" && <LiveView role={role} onOpen={(id) => { setFocus(id); setTab("work"); }} />}
        {tab === "work" && <Workspace key={focus ?? 0} role={role} focus={focus} />}
        {tab === "memory" && <MemoryView role={role} />}
        {tab === "erp" && <ErpView />}
        {tab === "edi" && <EdiView role={role} />}
        {tab === "settings" && <SettingsView role={role} health={health} pilot={pilot} />}
      </main>
    </>
  );
}

function Kpi({ n, label, tone }: { n?: number | string; label: string; tone?: string }) {
  return <div className={`kpi ${tone ?? ""}`}><b>{n ?? "–"}</b><span>{label}</span></div>;
}
