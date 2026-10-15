"use client";
import { useState } from "react";
import { summary as summarise } from "../lib/domain/workflow";
import { PEOPLE, Role } from "./api";
import { ErpView, MemoryView, Workspace } from "./Panels";
import { EdiView } from "./Portal";
import { RunProvider, useAgent, useHealth } from "./run/RunProvider";

type Tab = "work" | "memory" | "erp" | "edi";
const TABS: [Tab, string][] = [["work", "Inbox & review"], ["memory", "Agent memory"], ["erp", "ERP records"], ["edi", "EDI"]];

export default function Page() {
  return <RunProvider><App /></RunProvider>;
}

function App() {
  const [tab, setTab] = useState<Tab>("work");
  const [role, setRole] = useState<Role>("reviewer");
  const agent = useAgent();
  const health = useHealth();
  const summary = agent.ready ? summarise(agent.state) : null;
  const error = agent.serverError;

  const exceptionOnly = health?.policy.mode === "exception_only";
  const extraction = !health ? "…" : health.rehearsal_mode || health.extractor_mode === "test"
    ? "Rehearsal: TEST ADAPTER (not AI)" : health.extraction === "available" ? `AI extraction: ${health.model}` : "AI extraction unavailable";

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="logo" aria-hidden>◆</span> PDF Order Agent <small>prototype</small></div>
        <span className={`mode ${exceptionOnly ? "exc" : "all"}`} title="Automation mode, set by an administrator">
          {exceptionOnly ? "Exception-only mode" : "Review-all mode"}
        </span>
        <span className={`pill ${health?.rehearsal_mode || health?.extractor_mode === "test" ? "warn" : health?.extraction === "available" ? "ok" : "bad"}`}>{extraction}</span>
        <span className="pill muted">ERP and EDI: local simulators</span>
        <label className="role">Signed in as
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Demo role">
            {(["reviewer", "administrator", "viewer"] as Role[]).map((r) => <option key={r} value={r}>{PEOPLE[r]}</option>)}
          </select>
          <small>demo-only sign-in</small>
        </label>
      </header>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {agent.storageWarning && <div className="alert warn" role="status">{agent.storageWarning}</div>}
      <div className="kpis" aria-label="Executive summary">
        <Kpi n={summary?.orders_received} label="Orders received" />
        <Kpi n={summary?.delivered_to_erp} label="Delivered to ERP" tone="ok" />
        <Kpi n={summary?.auto_approved_by_policy} label="Approved by policy, no human touch" tone="ok" />
        <Kpi n={summary?.held_for_review} label="Held for a person" tone="warn" />
        <Kpi n={summary?.resolved_by_memory} label="Lines fixed by agent memory" tone="memory" />
        {!!summary?.delivery_problems && <Kpi n={summary.delivery_problems} label="Delivery needs attention" tone="bad" />}
      </div>
      <nav className="tabs" role="tablist" aria-label="Sections">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </nav>
      <main>
        {tab === "work" && <Workspace role={role} health={health} />}
        {tab === "memory" && <MemoryView role={role} />}
        {tab === "erp" && <ErpView />}
        {tab === "edi" && <EdiView role={role} />}
      </main>
    </>
  );
}

function Kpi({ n, label, tone }: { n?: number; label: string; tone?: string }) {
  return <div className={`kpi ${tone ?? ""}`}><b>{n ?? "–"}</b><span>{label}</span></div>;
}
