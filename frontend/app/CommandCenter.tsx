"use client";
// Proposed Retail Command Center (D66): Detect, Prioritise, Act, Verify over this app's own records.
// Findings link to the order workspace, where the authorised action happens. Nothing is edited here except
// ownership, and, in the retailer view, the retailer's response to a changed confirmation.
import { useState } from "react";
import {
  FINDING_TITLE, SUPPLIER_OWNERS, findingCounts, retailerActor, retailerFindings, supplierFindings,
} from "../lib/domain/command-center";
import type { Finding } from "../lib/domain/run-state";
import type { Role } from "./api";
import { useAgent } from "./run/RunProvider";

const OWNER_LABEL: Record<string, string> = { "reviewer:rita": "Rita, order desk", "administrator:alex": "Alex, operations lead" };
const ownerLabel = (a: string) => OWNER_LABEL[a] ?? (a.startsWith("retailer:") ? `Retailer buyer (${a.split("@")[1]})` : a);
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Time not recorded");
const RANK = { high: 0, medium: 1, low: 2 } as const;
const KIND = { observed: "Observed", rule: "Rule", human: "Person", outcome: "Outcome" } as const;

export type OpenTarget = { docId: number; section: Finding["nextAction"]["target"] };

export function CommandCenter({ audience, role, customerId, onOpen }: {
  audience: "supplier" | "retailer"; role: Role; customerId: string | null; onOpen?: (t: OpenTarget) => void;
}) {
  const agent = useAgent();
  const [show, setShow] = useState<"open" | "verified" | "all">("open");
  const [error, setError] = useState<string | null>(null);
  const all = !agent.ready ? [] : audience === "supplier" ? supplierFindings(agent.state)
    : customerId ? retailerFindings(agent.state, customerId) : [];
  const counts = findingCounts(all);
  const list = all.filter((f) => show === "all" || (show === "open" ? f.verification.status === "pending" : f.verification.status === "verified"))
    .sort((a, b) => (a.verification.status === b.verification.status ? 0 : a.verification.status === "pending" ? -1 : 1)
      || RANK[a.priority.level] - RANK[b.priority.level] || a.detectedAt.localeCompare(b.detectedAt));
  const go = async (f: () => Promise<unknown>) => { try { await f(); setError(null); } catch (e) { setError((e as Error).message); } };
  return (
    <section className="command-center" aria-label="Command Center">
      <p className="concept">Findings come from the orders, stock and documents in this portal. A finding stays open until its outcome is confirmed, not only until someone acts.</p>
      {error && <div className="alert bad" role="alert">{error}</div>}
      <div className="kpis" aria-label="Finding counts">
        <div className="kpi warn"><b>{counts.open}</b><span>Open findings</span></div>
        <div className="kpi"><b>{counts.unassigned}</b><span>Unassigned</span></div>
        <div className="kpi info"><b>{counts.awaitingEvidence}</b><span>Action done, outcome unverified</span></div>
        <div className="kpi ok"><b>{counts.verified}</b><span>Verified</span></div>
      </div>
      <div className="segmented" role="group" aria-label="Show findings">
        {(["open", "verified", "all"] as const).map((k) => (
          <button key={k} aria-pressed={show === k} onClick={() => setShow(k)}>{k === "open" ? "Open" : k === "verified" ? "Verified" : "All"}</button>
        ))}
      </div>
      {list.length === 0 && <p className="placeholder">{all.length === 0 ? "No findings. Findings appear when an order record meets a detection rule." : "No findings in this view."}</p>}
      {list.map((f) => (
        <FindingCard key={f.id} f={f} audience={audience} role={role} customerId={customerId} onOpen={onOpen}
          onAssign={(owner) => go(() => agent.run({ type: "assignFinding", role: role as "reviewer", findingId: f.id, owner }))}
          onRespond={(decision) => go(() => agent.run({ type: "respondToRevision", messageId: Number.parseInt(f.key.split(":")[1], 10),
            customerId: customerId!, decision }))} />
      ))}
    </section>
  );
}

function Evidence({ e }: { e: Finding["observed"][number] }) {
  return <li><span className={`tag ${e.kind}`}>{KIND[e.kind]}</span> {e.text}<div className="muted small">{e.source} · {time(e.at)}</div></li>;
}

function FindingCard({ f, audience, role, customerId, onOpen, onAssign, onRespond }: {
  f: Finding; audience: "supplier" | "retailer"; role: Role; customerId: string | null; onOpen?: (t: OpenTarget) => void;
  onAssign: (owner: string | null) => void; onRespond: (d: "accepted" | "declined") => void;
}) {
  const agent = useAgent();
  const pending = f.verification.status === "pending";
  const canAssign = audience === "supplier" && role !== "viewer" && pending;
  const owners: string[] = [...SUPPLIER_OWNERS, ...(f.visibility === "shared" && f.customerId ? [retailerActor(f.customerId)] : [])];
  const responded = (agent.state.portal?.retailerResponses ?? []).some((r) => r.messageId === Number.parseInt(f.key.split(":")[1], 10));
  const canRespond = audience === "retailer" && f.type === "revised_delivery" && pending && !responded && customerId === f.customerId;
  return (
    <article className={`finding ${f.priority.level} ${pending ? "pending" : "verified"}`} aria-label={`${FINDING_TITLE[f.type]}, ${f.poNumber ?? "no PO"}`}>
      <header>
        <span className={`pill ${f.priority.level === "high" ? "bad" : f.priority.level === "medium" ? "warn" : "muted"}`}>
          {f.priority.level[0].toUpperCase() + f.priority.level.slice(1)} priority</span>
        <h4>{FINDING_TITLE[f.type]}</h4>
        <span className={`pill ${pending ? (f.actionStatus === "completed" ? "info" : "warn") : "ok"}`}>
          {pending ? (f.actionStatus === "completed" ? "Action done, verification pending" : "Open") : "Verified"}</span>
      </header>
      <dl className="finding-grid">
        <div><dt>Partner and order</dt><dd>{f.customerId ?? "Unknown partner"} · PO {f.poNumber ?? "not read"}
          {f.lines.length > 0 && <div className="muted small">{f.lines.map((l) => l.label).join("; ")}</div>}</dd></div>
        <div><dt>Priority basis</dt><dd className="small">{f.priority.basis}</dd></div>
        <div><dt>Rule</dt><dd className="small">{f.rule.text}<div className="muted small">Source: {f.rule.source}</div></dd></div>
        <div><dt>Deadline</dt><dd className="small">{f.deadline ? <>{time(f.deadline.at)}<div className="muted small">Source: {f.deadline.source}</div></> : "Not established"}</dd></div>
        <div><dt>Owner</dt><dd>{canAssign ? (
          <select aria-label="Owner" value={f.owner?.actor ?? ""} onChange={(e) => onAssign(e.target.value || null)}>
            <option value="">Unassigned</option>
            {owners.map((o) => <option key={o} value={o}>{ownerLabel(o)}</option>)}
          </select>
        ) : f.owner ? ownerLabel(f.owner.actor) : "Unassigned"}
          {f.owner && <div className="muted small">{f.owner.source === "configured" ? "Default owner for this type" : `Assigned by ${f.owner.by.split(":")[1] ?? f.owner.by}`}</div>}</dd></div>
        <div><dt>Financial exposure</dt><dd className="small">Not available</dd></div>
        <div><dt>Root cause</dt><dd className="small">Not established</dd></div>
        <div><dt>Condition</dt><dd className="small">{f.conditionActive ? `Observed ${time(f.observedAt)}` : "No longer observed in the source records"}</dd></div>
      </dl>
      <h5>Observed</h5>
      <ul className="evidence-list">{f.observed.map((e, i) => <Evidence key={i} e={e} />)}</ul>
      <div className="next">
        <div><b>Suggested action</b> {f.nextAction.text}</div>
        <div className="btns">
          {audience === "supplier" && onOpen && f.nextAction.target !== "retailer_response" && (
            <button className="primary" onClick={() => onOpen({ docId: f.documentId, section: f.nextAction.target })}>Open order</button>
          )}
          {audience === "supplier" && onOpen && f.nextAction.target === "retailer_response" && (
            <button onClick={() => onOpen({ docId: f.documentId, section: "stock" })}>Open order</button>
          )}
          {canRespond && <>
            <button className="primary" onClick={() => onRespond("accepted")}>Accept revision</button>
            <button className="ghost danger" onClick={() => onRespond("declined")}>Decline revision</button>
            <span className="muted small">Test environment: the retailer&apos;s answer is recorded here. In production it comes from the retailer&apos;s own system.</span>
          </>}
        </div>
      </div>
      <div className="verify">
        <h5>Verification</h5>
        <p className="small"><b>Resolved when:</b> {f.resolution.condition}</p>
        <p className="small"><b>Evidence required:</b> {f.resolution.evidenceRequired}</p>
        {f.verification.evidence.length > 0
          ? <ul className="evidence-list">{f.verification.evidence.map((e, i) => <Evidence key={i} e={e} />)}</ul>
          : <p className="muted small">No outcome evidence yet. Verification stays pending.</p>}
        {!pending && <p className="small ok-text">Verified {time(f.verification.at)}</p>}
      </div>
      <details>
        <summary>History ({f.history.length})</summary>
        <ol className="history-list">{f.history.map((h, i) => <li key={i}><time>{time(h.at)}</time> <b>{h.kind.replace(/_/g, " ")}</b> <span className="muted small">{h.actor.split(":")[1] ?? h.actor} · {h.text}</span></li>)}</ol>
      </details>
    </article>
  );
}
