"use client";
// Order Operations (D71): the home queue and the order review. Home answers what arrived, what processed
// automatically and what needs a person. Review keeps the source, the structured order, the issue, the
// recommendation, its evidence and the action together, with history and the simulated ERP below.
import { useEffect, useRef, useState } from "react";
import {
  AlertOctagon, ArrowLeft, Bot, CheckCircle2, ChevronRight, CircleDot, Cog, FileText, HelpCircle, Mail, Server, Undo2, User,
} from "lucide-react";
import { canUndo, FIELD_LABEL, isAutomatic, needsAttention, primaryIssue } from "../lib/domain/ops/engine";
import { BUYERS } from "../lib/domain/ops/reference";
import type {
  Actor, ActorKind, Evidence, FieldState, IssueType, OpsField, OpsIssue, OpsOrder, OrderState, SourceRef,
} from "../lib/domain/ops/types";
import type { RunState } from "../lib/domain/run-state";
import { IN_FLIGHT, PEOPLE, type Role, STOPPED } from "./api";
import { useOps } from "./ops/OpsProvider";
import { useAgent } from "./run/RunProvider";
import { supplierState } from "./LiveView";

// ---------- labels ----------

export const STATE_LABEL: Record<OrderState, [string, string]> = {
  received: ["Received", "info"], understanding: ["Reading", "info"], validating: ["Validating", "info"],
  needs_review: ["Needs review", "warn"], blocked: ["Blocked", "bad"], ready_to_send: ["Ready to send", "warn"],
  sending: ["Sending", "info"], accepted: ["Accepted by ERP", "ok"], rejected: ["Rejected by ERP", "bad"],
};
export const ISSUE_LABEL: Record<IssueType, string> = {
  correctable_discrepancy: "Recommendation available", ambiguous_match: "Judgement required",
  missing_required_data: "Missing required data", validation_failure: "Validation failed", downstream_rejection: "ERP rejection",
};
export const FIELD_STATE: Record<FieldState, [string, string]> = {
  accepted: ["Accepted", "ok"], changed: ["Changed", "info"], uncertain: ["Uncertain", "warn"], missing: ["Missing", "bad"], invalid: ["Invalid", "bad"],
};
export const ACTOR: Record<ActorKind, [string, typeof Cog]> = {
  system: ["System", Cog], agent: ["AI agent", Bot], person: ["Person", User], erp: ["Your ERP", Server],
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dateTime = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const personFor = (role: Role): Actor => ({ kind: "person", name: PEOPLE[role] });

// ---------- one queue over sample orders and orders forwarded into this tab ----------

type Bucket = "rejected" | "blocked" | "needs_review" | "ready" | "in_progress" | "automatic" | "after_review" | "closed";
export type Row = {
  key: string; target: { kind: "ops"; id: string } | { kind: "engine"; docId: number };
  po: string; customer: string; sender: string; receivedAt: string; channel: string; bucket: Bucket;
  issue: string | null; summary: string; state: [string, string]; erp: string;
  /** Forwarded orders: what happened after the ERP (stock, shipments), in one line each. */
  detail: string[];
};

function opsRow(o: OpsOrder): Row {
  const iss = primaryIssue(o);
  const bucket: Bucket = o.state === "accepted" ? (isAutomatic(o) ? "automatic" : "after_review") : o.state === "rejected" ? "rejected"
    : o.state === "blocked" ? "blocked" : o.state === "needs_review" ? "needs_review" : o.state === "ready_to_send" ? "ready" : "in_progress";
  const last = o.erp.attempts.at(-1);
  return {
    key: o.id, target: { kind: "ops", id: o.id }, po: o.po.poNumber ?? "No PO number", customer: o.po.buyerName,
    sender: o.email.from, receivedAt: o.email.receivedAt, channel: "Email with PDF", bucket,
    issue: iss ? ISSUE_LABEL[iss.type] : o.state === "ready_to_send" ? "Approval required" : null,
    summary: iss ? iss.summary : o.state === "ready_to_send" ? "Decisions recorded. Approve to send to the ERP." : "",
    state: o.state === "accepted" ? [isAutomatic(o) ? "Completed automatically" : "Completed after review", "ok"] : STATE_LABEL[o.state],
    erp: last ? (last.response.status === "accepted" ? `Accepted · ${last.response.erpOrderId}` : `Rejected · ${last.response.code}`) : "Not sent",
    detail: [],
  };
}

/** Orders forwarded or uploaded in this tab go through the full reading pipeline (Orders view). */
export function engineRows(s: RunState): Row[] {
  return s.documents.map((d) => {
    const o = s.orders.find((x) => x.documentId === d.id);
    const env = s.envelopes.find((e) => e.id === d.envelopeId);
    const open = o ? o.validation.issues.filter((i) => i.status === "open") : [];
    const decided = s.decisions.some((x) => x.documentId === d.id) || s.approvals.some((x) => x.documentId === d.id && x.kind === "human");
    let bucket: Bucket; let state: [string, string]; let issue: string | null = null; let summary = "";
    if (IN_FLIGHT.has(d.status)) { bucket = "in_progress"; state = ["Reading", "info"]; }
    else if (d.status === "not_order" || d.status === "duplicate") { bucket = "closed"; state = [d.status === "duplicate" ? "Duplicate" : "Not an order", "muted"]; }
    else if (STOPPED.has(d.status) || !o) { bucket = "blocked"; state = ["Blocked", "bad"]; issue = "Could not be read"; summary = d.statusDetail ?? "The document could not be read."; }
    else if (o.deliveryState === "failed" || o.deliveryState === "unknown") { bucket = "rejected"; state = ["ERP delivery failed", "bad"]; issue = "ERP delivery"; summary = "The ERP did not confirm the order."; }
    else if (o.deliveryState === "erp_created") {
      bucket = o.fulfilment?.status === "needs_decision" ? "needs_review" : decided ? "after_review" : "automatic";
      state = bucket === "needs_review" ? ["Needs review", "warn"] : [decided ? "Completed after review" : "Completed automatically", "ok"];
      if (bucket === "needs_review") issue = "Stock short";
    } else if (open.length) {
      const blocking = open.some((i) => i.actions.every((a) => a === "reject_order"));
      bucket = blocking ? "blocked" : "needs_review"; state = blocking ? ["Blocked", "bad"] : ["Needs review", "warn"];
      issue = open[0].title; summary = open[0].message;
    } else if (o.reviewState === "ready") { bucket = "ready"; state = ["Ready to send", "warn"]; issue = "Approval required"; }
    else { bucket = "closed"; state = ["Closed", "muted"]; }
    const said = supplierState(s, d.id);
    if (!summary) summary = said.text;
    return {
      detail: ATTENTION.includes(bucket) ? said.shipments : [said.text, ...said.shipments],
      key: `doc-${d.id}`, target: { kind: "engine", docId: d.id }, po: o?.validation.order.po_number ?? d.originalFilename ?? `Document ${d.id}`,
      customer: o?.validation.order.customer_name ?? "Unknown customer", sender: env?.sender ?? "Uploaded file",
      receivedAt: env?.createdAt ?? d.createdAt, channel: d.kind === "email_body" ? "Email text" : d.kind === "edi" ? "EDI file" : env?.sender ? "Email with PDF" : "Uploaded PDF",
      bucket, issue, summary, state, erp: o?.erpOrderId ? `Accepted · ${o.erpOrderId}` : "Not sent",
    };
  });
}

const ATTENTION: Bucket[] = ["rejected", "blocked", "needs_review", "ready"];

// ---------- home ----------

export function OpsHome({ onOpen, forward, commandCenter }: {
  onOpen: (t: Row["target"]) => void; forward: React.ReactNode; commandCenter: React.ReactNode;
}) {
  const ops = useOps();
  const agent = useAgent();
  if (!ops.state) return <p className="placeholder">Loading orders.</p>;
  const rows = [...ops.state.orders.map(opsRow), ...(agent.ready ? engineRows(agent.state) : [])];
  const by = (b: Bucket) => rows.filter((r) => r.bucket === b).length;
  const attention = rows.filter((r) => ATTENTION.includes(r.bucket))
    .sort((a, b) => ATTENTION.indexOf(a.bucket) - ATTENTION.indexOf(b.bucket) || a.receivedAt.localeCompare(b.receivedAt));
  const normal = rows.filter((r) => !ATTENTION.includes(r.bucket)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return (
    <div className="ops-home">
      <section aria-label="Today" className="ops-today">
        <h2 className="eyebrow">Today</h2>
        <div className="kpis ops-kpis">
          <Tile n={rows.length} label="Orders received" />
          <Tile n={by("automatic")} label="Processed automatically" tone="ok" />
          <Tile n={by("needs_review") + by("ready")} label="Need review" tone="warn" />
          <Tile n={by("blocked")} label="Blocked" tone="bad" />
          <Tile n={by("rejected")} label="Rejected by ERP" tone="bad" />
          <Tile n={by("after_review")} label="Completed after review" />
        </div>
      </section>
      <div className="ops-grid">
        <section className="panel" aria-labelledby="attention-h">
          <header className="panel-head"><h3 id="attention-h">Needs attention</h3><span className="count">{attention.length}</span></header>
          {attention.length === 0 ? <p className="empty"><CheckCircle2 size={18} aria-hidden /> No orders need attention.</p> : (
            <ul className="queue" aria-label="Orders that need attention">
              {attention.map((r) => (
                <li key={r.key} className={`qrow ${r.state[1]}`} data-po={r.po}>
                  <div className="q-main">
                    <div className="q-title"><b>{r.po}</b><span className="muted"> · {r.customer}</span></div>
                    <div className="q-issue">{r.issue && <span className={`pill ${r.state[1]}`}>{r.issue}</span>}<span>{r.summary}</span></div>
                    {r.detail.map((t) => <div key={t} className="small">{t}</div>)}
                    <div className="muted small">Received {time(r.receivedAt)} from {r.sender}</div>
                  </div>
                  <span className={`pill ${r.state[1]} q-state`}>{r.state[0]}</span>
                  <button className="primary" onClick={() => onOpen(r.target)} aria-label={`Review order ${r.po}`}>Review order <ChevronRight size={16} aria-hidden /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="ops-side">
          {commandCenter}
          {forward}
        </aside>
      </div>
      <section className="panel" aria-labelledby="normal-h">
        <header className="panel-head"><h3 id="normal-h">Processing normally or completed</h3><span className="count muted">{normal.length}</span></header>
        <div className="scroll">
          <table className="grid-table ops-table stack-table">
            <thead><tr><th>PO number</th><th>Customer</th><th>Received</th><th>Channel</th><th>State</th><th>ERP result (simulated)</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {normal.map((r) => (
                <tr key={r.key} data-po={r.po}>
                  <td data-label="PO number"><b>{r.po}</b></td><td data-label="Customer">{r.customer}</td>
                  <td data-label="Received">{time(r.receivedAt)}</td><td data-label="Channel">{r.channel}</td>
                  <td data-label="State"><div><span className={`pill ${r.state[1]}`}>{r.state[0]}</span>{r.detail.map((t) => <div key={t} className="muted small wrap">{t}</div>)}</div></td>
                  <td data-label="ERP result">{r.erp}</td>
                  <td className="row-open"><button className="ghost" onClick={() => onOpen(r.target)} aria-label={`View order ${r.po}`}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return <div className={`kpi ${tone ?? ""}`} aria-label={`${label}: ${n}`}><b>{n}</b><span>{label}</span></div>;
}

// ---------- review ----------

export function OpsReview({ id, role, onBack }: { id: string; role: Role; onBack: () => void }) {
  const ops = useOps();
  const o = ops.state?.orders.find((x) => x.id === id) ?? null;
  const [focus, setFocus] = useState<SourceRef | null>(null);
  const [doc, setDoc] = useState<"pdf" | "email">("pdf");
  const status = useRef<HTMLDivElement>(null);
  const canAct = role !== "viewer";
  useEffect(() => { ops.clearError(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const p = o && primaryIssue(o); const src = p?.evidence.find((e) => e.source)?.source ?? null; setFocus(src); if (src) setDoc(src.doc); },
    [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return <p className="placeholder">Order not found.</p>;
  const show = (s: SourceRef | null) => { if (!s) return; setDoc(s.doc); setFocus(s); };
  const actor = personFor(role);
  const open = o.issues.filter((i) => i.status === "open").sort((a, b) => (primaryIssue(o)?.id === a.id ? -1 : primaryIssue(o)?.id === b.id ? 1 : 0));
  const [label, tone] = o.state === "accepted" ? [isAutomatic(o) ? "Completed automatically" : "Completed after review", "ok"] : STATE_LABEL[o.state];
  const activeDecisions = o.decisions.filter((d) => d.undoneAt === null);
  const last = o.erp.attempts.at(-1);
  return (
    <article className="ops-review" aria-label={`Order ${o.po.poNumber ?? o.id}`}>
      <div className="review-top">
        <button className="ghost" onClick={onBack}><ArrowLeft size={16} aria-hidden /> Back to order operations</button>
      </div>
      <header className="review-head">
        <div>
          <p className="eyebrow">Purchase order from {o.email.fromName} &lt;{o.email.from}&gt;</p>
          <h2>{o.po.poNumber ?? "No PO number"} <span className="sub">· {o.po.buyerName}</span></h2>
          <div className="chips"><span className="chip">Email with PDF</span><span className="chip">Received {dateTime(o.email.receivedAt)}</span>
            <span className="chip">Sample order, fictional</span></div>
        </div>
        <span className={`pill ${tone} big-pill`} aria-label={`Order state: ${label}`}>{label}</span>
      </header>
      <Journey o={o} />
      <div ref={status} role="status" aria-live="polite" className="sr-only">{label}</div>
      {ops.error && <div className="alert bad" role="alert">{ops.error}</div>}

      <div className="review-split">
        <SourcePanel o={o} doc={doc} setDoc={setDoc} focus={focus} />
        <div className="review-right">
          <section aria-labelledby="decision-h" className="decision-zone">
            <h3 id="decision-h" className="section-h">{open.length ? "Decision required" : o.state === "ready_to_send" ? "Ready to send" : "Outcome"}</h3>
            {open.map((iss) => <IssueCard key={iss.id} o={o} iss={iss} canAct={canAct} show={show}
              onDecide={(input) => ops.decide(o.id, iss.id, input, actor)} />)}
            {o.state === "ready_to_send" && (
              <div className="approve-bar">
                <p>{o.erp.attempts.length ? "Correction recorded. Resend the order to your ERP." : "All blocking issues are resolved. Approval sends the order to your ERP."}</p>
                <button className="primary big" disabled={!canAct} onClick={() => ops.approve(o.id, actor)}>
                  {o.erp.attempts.length ? "Resend to ERP" : "Approve and send to ERP"}</button>
              </div>
            )}
            {o.state === "accepted" && last && (
              <div className="outcome ok"><CheckCircle2 size={20} aria-hidden /><div><b>Accepted by your ERP as {last.response.erpOrderId}.</b>
                <p className="muted small">{isAutomatic(o) ? "Processed automatically. No person was needed." : `${activeDecisions.length} decision${activeDecisions.length === 1 ? "" : "s"} recorded before sending.`}</p></div></div>
            )}
          </section>
          {activeDecisions.length > 0 && (
            <section aria-labelledby="decisions-h">
              <h3 id="decisions-h" className="section-h">Decisions on this order</h3>
              <ul className="decisions">
                {activeDecisions.map((d) => {
                  const iss = o.issues.find((i) => i.id === d.issueId);
                  return (
                    <li key={d.id}>
                      <div><b>{iss?.title ?? FIELD_LABEL[d.field]}</b>
                        <span className="muted small"> · {DECISION_TEXT[d.outcome]} by {d.actor.name}, {time(d.at)}</span>
                        {d.outcome !== "deferred" && <div className="diff"><del>{d.previous ?? "None"}</del> <span aria-hidden>→</span><span className="sr-only">changed to</span> <ins>{d.value ?? "None"}</ins></div>}
                      </div>
                      {canUndo(o, d) && canAct && <button className="ghost" onClick={() => ops.undo(o.id, d.id, actor)}><Undo2 size={16} aria-hidden /> Undo</button>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <StructuredOrder o={o} show={show} />
          <ErpPanel o={o} />
        </div>
      </div>
      <History o={o} />
      <Details o={o} />
    </article>
  );
}

const DECISION_TEXT: Record<string, string> = { accepted_recommendation: "Recommendation accepted", rejected_recommendation: "Original value kept",
  selected_option: "Option selected", corrected_value: "Value corrected", deferred: "Deferred, waiting on buyer" };

function Journey({ o }: { o: OpsOrder }) {
  const sent = o.erp.attempts.length > 0;
  const steps: [string, "done" | "now" | "wait" | "stop" | ""][] = [
    ["Email received", "done"], ["PDF read", "done"], ["Validated", "done"],
    ["Decision", o.decisions.length ? (["needs_review", "blocked"].includes(o.state) ? "wait" : "done") : ["needs_review", "blocked"].includes(o.state) ? (o.state === "blocked" ? "stop" : "wait") : sent ? "done" : ""],
    ["Sent to ERP", sent ? "done" : o.state === "ready_to_send" ? "wait" : ""],
    [o.state === "rejected" ? "Rejected by ERP" : "Accepted by ERP", o.state === "accepted" ? "done" : o.state === "rejected" ? "stop" : ""],
  ];
  return (
    <ol className="stages" aria-label="Order progress">
      {steps.map(([t, c]) => <li key={t} className={c}><span className="sr-only">{c === "done" ? "Done: " : c === "wait" ? "Waiting: " : c === "stop" ? "Stopped: " : "Not reached: "}</span>{t}</li>)}
    </ol>
  );
}

function IssueCard({ o, iss, canAct, show, onDecide }: { o: OpsOrder; iss: OpsIssue; canAct: boolean; show: (s: SourceRef | null) => void;
  onDecide: (input: Parameters<ReturnType<typeof useOps>["decide"]>[2]) => void }) {
  const [evidence, setEvidence] = useState(false);
  const [pick, setPick] = useState<string>(iss.options.find((x) => x.recommended)?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const deferred = iss.decisionId !== null && o.decisions.find((d) => d.id === iss.decisionId)?.outcome === "deferred";
  const tone = iss.type === "downstream_rejection" || iss.type === "missing_required_data" ? "bad" : "warn";
  const where = iss.lineIndex === null ? FIELD_LABEL[iss.field] : `Line ${iss.lineIndex + 1} · ${FIELD_LABEL[iss.field]}`;
  const src = iss.evidence.find((e) => e.source)?.source ?? null;
  const Icon = tone === "bad" ? AlertOctagon : iss.type === "ambiguous_match" ? HelpCircle : CircleDot;
  return (
    <section className={`issue-card ${tone}`} aria-label={iss.title}>
      <header>
        <Icon size={20} aria-hidden className="ic" />
        <div><span className={`pill ${tone}`}>{ISSUE_LABEL[iss.type]}</span><h4>{iss.title}</h4></div>
        {deferred && <span className="pill muted">Waiting on buyer</span>}
      </header>
      <p className="what">{iss.summary}</p>
      <dl className="facts">
        <div><dt>Affected field</dt><dd>{where}</dd></div>
        <div><dt>Rule</dt><dd>{iss.rule.text}</dd></div>
        <div className="wide"><dt>{iss.type === "missing_required_data" ? "Why processing stopped" : "Why it matters"}</dt><dd>{iss.whyItMatters}</dd></div>
      </dl>
      {iss.proposed !== null && iss.type !== "downstream_rejection" && (
        <div className="compare" aria-label="Proposed change">
          <div><span className="eyebrow">Received</span><del>{iss.original}</del></div>
          <span className="arrow" aria-hidden>→</span>
          <div><span className="eyebrow">Proposed</span><ins>{iss.type === "correctable_discrepancy" && iss.field === "unit" ? iss.expected : iss.proposed}</ins></div>
        </div>
      )}
      {iss.agentNote && (
        <div className="agent-note"><Bot size={16} aria-hidden /><div><span className="eyebrow">Order agent (AI)</span><p>{iss.agentNote}</p></div></div>
      )}

      {(iss.type === "ambiguous_match" || iss.type === "downstream_rejection") && iss.options.length > 0 && (
        <fieldset className="options">
          <legend>{iss.type === "ambiguous_match" ? "Select the item the buyer ordered" : "Select an active ship-to"}</legend>
          {iss.options.map((opt) => (
            <label key={opt.id} className={`option ${pick === opt.id ? "on" : ""}`}>
              <input type="radio" name={`opt-${iss.id}`} value={opt.id} checked={pick === opt.id} disabled={!canAct} onChange={() => setPick(opt.id)} />
              <div><b>{opt.label}</b>{opt.recommended && <span className="pill info">Recommended</span>}
                <dl>{opt.details.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
            </label>
          ))}
        </fieldset>
      )}
      {iss.actions.includes("correct") && (
        <fieldset className="options correct">
          <legend>Enter the location the buyer confirmed</legend>
          <label>Delivery location
            <select value={pick} disabled={!canAct} onChange={(e) => setPick(e.target.value)}>
              <option value="">Select a location on file</option>
              {iss.options.map((x) => <option key={x.id} value={x.value}>{x.label}, {x.details[0][1]}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={confirmed} disabled={!canAct} onChange={(e) => setConfirmed(e.target.checked)} /> The buyer confirmed this location</label>
        </fieldset>
      )}

      <div className="btns issue-actions">
        {iss.actions.includes("accept") && <button className="primary" disabled={!canAct} onClick={() => onDecide({ outcome: "accepted_recommendation" })}>Accept change</button>}
        {iss.actions.includes("keep_original") && <button disabled={!canAct} onClick={() => onDecide({ outcome: "rejected_recommendation" })}>Keep original</button>}
        {iss.actions.includes("select") && <button className="primary" disabled={!canAct || !pick} onClick={() => onDecide({ outcome: "selected_option", optionId: pick })}>
          {iss.type === "ambiguous_match" ? "Use selected item" : "Use selected ship-to"}</button>}
        {iss.actions.includes("correct") && <button className="primary" disabled={!canAct || !pick || !confirmed}
          onClick={() => onDecide({ outcome: "corrected_value", value: pick, confirmedByBuyer: confirmed })}>Use location</button>}
        {iss.actions.includes("defer") && !deferred && <button disabled={!canAct} onClick={() => onDecide({ outcome: "deferred" })}>Mark as waiting on buyer</button>}
        <button className="ghost" aria-expanded={evidence} onClick={() => setEvidence(!evidence)}>{evidence ? "Hide evidence" : "View evidence"}</button>
        {src && <button className="ghost" onClick={() => show(src)}><FileText size={16} aria-hidden /> Show in source</button>}
      </div>
      {iss.type === "validation_failure" && o.decisions.some((d) => d.undoneAt === null && d.field === iss.field && d.lineIndex === iss.lineIndex) &&
        <p className="muted small">Undo the decision below to return to the recommendation.</p>}
      {evidence && <EvidenceList items={iss.evidence} show={show} />}
    </section>
  );
}

const EVIDENCE_KIND: Record<Evidence["kind"], string> = { source: "Source", reference: "Reference data", history: "Order history", rule: "Rule", erp: "Your ERP (simulated)" };
function EvidenceList({ items, show }: { items: Evidence[]; show: (s: SourceRef | null) => void }) {
  return (
    <ul className="evidence" aria-label="Evidence">
      {items.map((e, i) => (
        <li key={i}><span className="tag">{EVIDENCE_KIND[e.kind]}</span><span>{e.text}</span>
          {e.source && <button className="link" onClick={() => show(e.source)}>Show in {e.source.doc === "pdf" ? "PDF" : "email"}</button>}</li>
      ))}
    </ul>
  );
}

function FieldCell({ f, show }: { f: OpsField; show: (s: SourceRef | null) => void }) {
  const [label, tone] = FIELD_STATE[f.state];
  const changed = f.state === "changed";
  return (
    <>
      <td>{changed ? <span className="diff"><del>{f.extracted ?? "None"}</del> <span aria-hidden>→</span> <ins>{f.value}</ins></span> : (f.value ?? <span className="muted">{f.extracted === null ? "Not printed" : "Not set"}</span>)}
        {f.note && <div className="muted small">{f.note}</div>}</td>
      <td><span className={`pill ${tone} fstate`}>{label}</span></td>
      <td>{f.source ? <button className="link" onClick={() => show(f.source)} aria-label={`Show ${f.label} in source`}>Show</button> : <span className="muted small">Not in source</span>}</td>
    </>
  );
}

function StructuredOrder({ o, show }: { o: OpsOrder; show: (s: SourceRef | null) => void }) {
  return (
    <section aria-labelledby="structured-h">
      <h3 id="structured-h" className="section-h">Structured order</h3>
      <div className="scroll">
        <table className="fields" aria-label="Order header">
          <thead><tr><th>Field</th><th>Value</th><th>State</th><th>Source</th></tr></thead>
          <tbody>{Object.values(o.header).map((f) => (
            <tr key={f.key} className={`f-${f.state}`} data-field={f.key}><th scope="row">{f.label}{f.reference && <div className="muted small">{f.reference}</div>}</th><FieldCell f={f} show={show} /></tr>
          ))}</tbody>
        </table>
      </div>
      {o.lines.map((l) => (
        <div key={l.index} className="scroll">
          <table className="fields" aria-label={`Line ${l.index + 1}`}>
            <caption>Line {l.index + 1}{l.amount ? ` · ${l.amount} USD` : ""}</caption>
            <tbody>{Object.values(l.fields).map((f) => (
              <tr key={f.key} className={`f-${f.state}`} data-field={f.key}><th scope="row">{f.label}{f.reference && f.key !== "description" && <div className="muted small">{f.reference}</div>}</th><FieldCell f={f} show={show} /></tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      <p className="total">Order total <b>{o.total} USD</b> <span className="muted small">calculated from quantity × unit price</span></p>
    </section>
  );
}

function ErpPanel({ o }: { o: OpsOrder }) {
  const last = o.erp.attempts.at(-1);
  const steps: [string, boolean][] = [
    ["Ready", o.erp.status !== "not_sent" || !!last], ["Sending", !!last], ["Response received", !!last],
    [last?.response.status === "rejected" && o.state === "rejected" ? "Rejected" : "Accepted", o.state === "accepted" || o.state === "rejected"],
  ];
  return (
    <section className="erp-sim" aria-labelledby="erp-h">
      <h3 id="erp-h" className="section-h"><Server size={16} aria-hidden /> Your ERP (simulated)</h3>
      <p className="muted small">Simulated system. No live ERP connection.</p>
      <dl className="facts erp-roles">
        <div><dt>Accepts or rejects</dt><dd>Your ERP, using its own checks such as active ship-to codes in its customer master.</dd></div>
        <div><dt>Order Agent</dt><dd>Sends the order, records the ERP response and proposes a correction.</dd></div>
      </dl>
      <ol className="lifecycle" aria-label="ERP lifecycle">
        {steps.map(([t, done], i) => <li key={t} className={done ? (i === 3 && o.state === "rejected" ? "stop" : "done") : ""}>{t}</li>)}
      </ol>
      {o.erp.attempts.length === 0 && <p className="muted">Not sent. {o.state === "blocked" ? "Blocked orders cannot be sent." : "Sending starts when every blocking issue is resolved."}</p>}
      {[...o.erp.attempts].reverse().map((a) => (
        <details key={a.id} open={a.id === last?.id}>
          <summary>Attempt {a.id} · {time(a.sentAt)} · <span className={`pill ${a.response.status === "accepted" ? "ok" : "bad"}`}>{a.response.status === "accepted" ? "Accepted" : "Rejected"}</span></summary>
          <dl className="facts">
            <div><dt>Response</dt><dd>{a.response.code}: {a.response.message}</dd></div>
            {a.response.erpOrderId && <div><dt>ERP order</dt><dd>{a.response.erpOrderId}</dd></div>}
            {a.response.field && <div><dt>Affected field</dt><dd>{FIELD_LABEL[a.response.field]}</dd></div>}
            <div><dt>Request</dt><dd>PO {a.request.poNumber} · account {a.request.account} · ship-to {a.request.shipTo} · {a.request.lines.length} line(s) · {a.request.total} USD</dd></div>
            <div><dt>Request key</dt><dd className="mono">{a.idempotencyKey}{a.reconciled ? " (matched an earlier request; no duplicate)" : ""}</dd></div>
          </dl>
        </details>
      ))}
    </section>
  );
}

function History({ o }: { o: OpsOrder }) {
  return (
    <section className="panel history" aria-labelledby="history-h">
      <header className="panel-head"><h3 id="history-h">Order history</h3><span className="count muted">{o.history.length}</span></header>
      <ol className="timeline">
        {o.history.map((e) => {
          const [label, Icon] = ACTOR[e.actor.kind];
          return (
            <li key={e.id} className={`ev ev-${e.actor.kind}`}>
              <time dateTime={e.at}>{time(e.at)}</time>
              <span className={`ev-actor ev-actor-${e.actor.kind}`}><Icon size={14} aria-hidden /> {label}</span>
              <span className="ev-text">{e.text}{e.actor.kind === "person" && <span className="muted small"> · {e.actor.name}</span>}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Details({ o }: { o: OpsOrder }) {
  const b = BUYERS.find((x) => x.id === o.buyerId);
  const rules = [["R1", "PO number present"], ["R2", "Buyer is a trading partner"], ["R3", "Delivery location on file"], ["R4", "Delivery date present"],
    ["R5", "Each line matches one item"], ["R6", "Unit is orderable"], ["R7", "Price matches the price list"]] as const;
  return (
    <section className="panel order-foot" aria-label="Order details">
      <details><summary>Trading relationship</summary>
        {b ? <dl className="facts"><div><dt>Buyer</dt><dd>{b.name}</dd></div><div><dt>ERP account</dt><dd>{b.erpAccount}</dd></div>
          <div><dt>Sender domain</dt><dd>{b.domain}</dd></div><div><dt>Locations on file</dt><dd>{b.locations.map((l) => `${l.name} (${l.code})`).join(", ")}</dd></div></dl>
          : <p>No trading partner matched.</p>}
      </details>
      <details><summary>Applied rules</summary>
        <table className="grid-table"><tbody>{rules.map(([id, text]) => {
          const hits = o.issues.filter((i) => i.rule.id === id);
          const st = hits.some((i) => i.status === "open") ? ["Open issue", "warn"] : hits.length ? ["Resolved by a person", "info"] : ["Passed", "ok"];
          return <tr key={id}><td>{text}</td><td><span className={`pill ${st[1]}`}>{st[0]}</span></td></tr>;
        })}</tbody></table>
      </details>
    </section>
  );
}

// ---------- source panel: email and PDF ----------

function SourcePanel({ o, doc, setDoc, focus }: { o: OpsOrder; doc: "pdf" | "email"; setDoc: (d: "pdf" | "email") => void; focus: SourceRef | null }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    const el = box.current?.querySelector(`[data-region="${focus.region}"]`);
    if (el && "scrollIntoView" in el) (el as HTMLElement).scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus, doc]);
  const hi = (region: string) => (focus && focus.doc === doc && (focus.region === region || region.startsWith(`${focus.region}.`)) ? "hl" : "");
  const po = o.po;
  return (
    <section className="source-panel" aria-labelledby="source-h">
      <div className="source-head">
        <h3 id="source-h" className="section-h">Source</h3>
        <div className="segmented" role="group" aria-label="Source document">
          <button aria-pressed={doc === "pdf"} onClick={() => setDoc("pdf")}><FileText size={16} aria-hidden /> PDF</button>
          <button aria-pressed={doc === "email"} onClick={() => setDoc("email")}><Mail size={16} aria-hidden /> Email</button>
        </div>
      </div>
      <div ref={box} className="source-body">
        {doc === "email" ? (
          <div className="email-view" aria-label="Original email">
            <dl className="facts">
              <div><dt>From</dt><dd>{o.email.fromName} &lt;{o.email.from}&gt;</dd></div>
              <div><dt>To</dt><dd>{o.email.to}</dd></div>
              <div><dt>Subject</dt><dd>{o.email.subject}</dd></div>
              <div><dt>Received</dt><dd>{dateTime(o.email.receivedAt)}</dd></div>
            </dl>
            <div className={`email-body ${hi("body")}`} data-region="body">{o.email.body.map((l, i) => <p key={i}>{l}</p>)}</div>
            <p className="attach"><FileText size={16} aria-hidden /> {o.attachment.filename} · {o.attachment.sizeKb} KB · identified as a purchase order</p>
          </div>
        ) : (
          <div className="po-page" aria-label={`PDF ${o.attachment.filename}, page 1`}>
            <p className="po-sample">SAMPLE DOCUMENT · FICTIONAL DATA</p>
            <div className="po-top">
              <div><h4>PURCHASE ORDER</h4><div className={hi("buyer")} data-region="buyer"><b>{po.buyerName}</b>{po.buyerAddress.map((a) => <div key={a}>{a}</div>)}</div></div>
              <dl>
                <div className={hi("po_number")} data-region="po_number"><dt>PO number</dt><dd>{po.poNumber ?? " "}</dd></div>
                <div className={hi("order_date")} data-region="order_date"><dt>PO date</dt><dd>{po.orderDate}</dd></div>
                <div className={hi("delivery_date")} data-region="delivery_date"><dt>Requested delivery</dt><dd>{po.deliveryDate ?? " "}</dd></div>
                <div><dt>Currency</dt><dd>{po.currency}</dd></div>
              </dl>
            </div>
            <div className="po-parties">
              <div className={hi("supplier")} data-region="supplier"><span>Supplier</span><b>{po.supplierName}</b></div>
              <div className={`${hi("ship_to")} ${po.shipTo ? "" : "absent"}`} data-region="ship_to"><span>Ship to</span>
                {po.shipTo ? <><b>{po.shipTo.name} ({po.shipTo.code})</b>{po.shipTo.address.map((a) => <div key={a}>{a}</div>)}</> : <i>Not printed</i>}</div>
            </div>
            <table className="po-lines">
              <thead><tr><th>Line</th><th>Item</th><th>Description</th><th>Qty</th><th>Unit</th><th>Unit price</th></tr></thead>
              <tbody>{po.lines.map((l, i) => (
                <tr key={l.line}>
                  <td>{l.line}</td>
                  <td className={hi(`l${i}.code`)} data-region={`l${i}.code`}>{l.itemCode ?? ""}</td>
                  <td className={hi(`l${i}.desc`)} data-region={`l${i}.desc`}>{l.description}</td>
                  <td className={hi(`l${i}.qty`)} data-region={`l${i}.qty`}>{l.quantity}</td>
                  <td className={hi(`l${i}.unit`)} data-region={`l${i}.unit`}>{l.unit}</td>
                  <td className={hi(`l${i}.price`)} data-region={`l${i}.price`}>{l.unitPrice}</td>
                </tr>
              ))}</tbody>
            </table>
            <p className="po-terms">Terms: {po.terms}</p>
            <ul className="po-notes">{po.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        )}
      </div>
      {focus && focus.doc === doc && <p className="muted small hl-key"><span className="hl-swatch" aria-hidden /> Highlighted: where the value was read</p>}
    </section>
  );
}

/** Command Center list of order exceptions: each one deep-links to its review; nothing is decided here. */
export function OrderExceptions({ onOpen }: { onOpen: (id: string) => void }) {
  const ops = useOps();
  const list = (ops.state?.orders ?? []).filter((o) => needsAttention(o));
  return (
    <section className="panel cc-orders" aria-labelledby="cc-orders-h">
      <header className="panel-head"><h3 id="cc-orders-h">Order exceptions</h3><span className="count">{list.length}</span></header>
      {list.length === 0 ? <p className="empty">No order exceptions.</p> : (
        <ul className="queue compact">{list.map((o) => {
          const iss = primaryIssue(o);
          const [label, tone] = STATE_LABEL[o.state];
          return (
            <li key={o.id} className={`qrow ${tone}`}>
              <div className="q-main"><div className="q-title"><b>{o.po.poNumber ?? o.id}</b><span className="muted"> · {o.po.buyerName}</span></div>
                <div className="q-issue">{iss && <span className={`pill ${tone}`}>{ISSUE_LABEL[iss.type]}</span>}<span>{iss?.title ?? "Approval required"}</span></div></div>
              <span className={`pill ${tone} q-state`}>{label}</span>
              <button className="ghost" onClick={() => onOpen(o.id)} aria-label={`Review order ${o.po.poNumber ?? o.id}`}>Review order</button>
            </li>
          );
        })}</ul>
      )}
    </section>
  );
}

