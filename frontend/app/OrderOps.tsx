"use client";
// Orders (D71, D74): the home queue over every order forwarded or uploaded in this tab. Home answers what arrived,
// what went through automatically and what needs a person. Each order opens in ForwardedReview.
import { useState } from "react";
import { CheckCircle2, ChevronRight, Cog, Server, User, Bot } from "lucide-react";
import { issueOwner } from "../lib/domain/command-center";
import type { RunState } from "../lib/domain/run-state";
import { IN_FLIGHT, STOPPED } from "./api";
import { useAgent } from "./run/RunProvider";
import { supplierState } from "./LiveView";

export type ActorKind = "system" | "agent" | "person" | "erp";
export type IssueType = "correctable_discrepancy" | "ambiguous_match" | "missing_required_data" | "validation_failure" | "downstream_rejection" | "revision";
export type FieldState = "accepted" | "changed" | "uncertain" | "missing" | "invalid";

// ---------- labels ----------

export const ISSUE_LABEL: Record<IssueType, string> = {
  correctable_discrepancy: "Recommendation available", ambiguous_match: "Judgement required",
  missing_required_data: "Missing required data", validation_failure: "Validation failed", downstream_rejection: "ERP response",
  revision: "Revision",
};
export const FIELD_STATE: Record<FieldState, [string, string]> = {
  accepted: ["Accepted", "ok"], changed: ["Changed", "info"], uncertain: ["Uncertain", "warn"], missing: ["Missing", "bad"], invalid: ["Invalid", "bad"],
};
export const ACTOR: Record<ActorKind, [string, typeof Cog]> = {
  system: ["System", Cog], agent: ["Order agent (rules)", Bot], person: ["Person", User], erp: ["Your ERP", Server],
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

// ---------- one queue over sample orders and orders forwarded into this tab ----------

type Bucket = "rejected" | "blocked" | "needs_review" | "ready" | "in_progress" | "automatic" | "after_review" | "closed";
export type Row = {
  key: string; target: { kind: "engine"; docId: number };
  po: string; customer: string; sender: string; receivedAt: string; channel: string; bucket: Bucket;
  issue: string | null; summary: string; state: [string, string]; erp: string;
  /** Forwarded orders: what happened after the ERP (stock, shipments), in one line each. */
  detail: string[];
  /** D74: context for an exception, from the order's own records. null = not available. */
  value: string | null; deliveryDate: string | null; owner: string | null; decision: string | null; openCount: number;
};

/** Orders forwarded or uploaded in this tab go through the full reading pipeline (Orders view). */
export function engineRows(s: RunState): Row[] {
  return s.documents.map((d) => {
    const o = s.orders.find((x) => x.documentId === d.id);
    const env = s.envelopes.find((e) => e.id === d.envelopeId);
    const open = o ? o.validation.issues.filter((i) => i.status === "open") : [];
    // A decision a supplier policy recorded is not a person's; such an order still counts as automatic (D74).
    const decided = s.decisions.some((x) => x.documentId === d.id && !x.actor.startsWith("policy:")) || s.approvals.some((x) => x.documentId === d.id && x.kind === "human");
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
      value: o ? `${o.validation.order.totals.computed_total} ${o.validation.order.currency ?? ""}`.trim() : null,
      deliveryDate: (o?.validation.order.requested_delivery_date as string | null | undefined) ?? null,
      owner: issueOwner(s), openCount: open.length,
      decision: open.length ? DECISION_TEXT[open[0].code] ?? "Decide or reject the order"
        : bucket === "ready" ? "Approve to send to your ERP" : o?.fulfilment?.status === "needs_decision" ? "Choose how to ship the short lines" : null,
    };
  });
}

const ATTENTION: Bucket[] = ["rejected", "blocked", "needs_review", "ready"];

/** The decision a person makes for each check, in plain words. */
const DECISION_TEXT: Record<string, string> = {
  moq_violation: "Accept a one-off quantity, change it, or ask the buyer to correct",
  price_mismatch: "Accept the printed price with a reason, or correct it",
  outdated_identifier: "Apply the replacement item, and choose whether to reuse it",
  possible_revision: "Accept as a revision of the earlier order, or reject",
  unknown_item: "Map the line to a catalogue item", unknown_customer: "Choose or add the customer",
  unknown_ship_to: "Choose or add the ship-to", unverified_field: "Confirm the value against the PDF",
  total_mismatch: "Acknowledge the total difference", line_amount_mismatch: "Acknowledge the line amount difference",
};

// ---------- home ----------

type Filter = "all" | "automatic" | "review" | "blocked" | "rejected" | "after_review";
const FILTER_BUCKETS: Record<Exclude<Filter, "all">, Bucket[]> = {
  automatic: ["automatic"], review: ["needs_review", "ready"], blocked: ["blocked"], rejected: ["rejected"], after_review: ["after_review"],
};

export function OpsHome({ onOpen, forward, commandCenter }: {
  onOpen: (t: Row["target"]) => void; forward: React.ReactNode; commandCenter: React.ReactNode;
}) {
  const agent = useAgent();
  const [filter, setFilter] = useState<Filter>("all");
  if (!agent.ready) return <p className="placeholder">Loading orders.</p>;
  const all = engineRows(agent.state);
  const by = (f: Exclude<Filter, "all">) => all.filter((r) => FILTER_BUCKETS[f].includes(r.bucket)).length;
  const rows = filter === "all" ? all : all.filter((r) => FILTER_BUCKETS[filter].includes(r.bucket));
  const attention = rows.filter((r) => ATTENTION.includes(r.bucket))
    .sort((a, b) => ATTENTION.indexOf(a.bucket) - ATTENTION.indexOf(b.bucket) || a.receivedAt.localeCompare(b.receivedAt));
  const normal = rows.filter((r) => !ATTENTION.includes(r.bucket)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const tile = (f: Filter, n: number, label: string, tone?: string) => (
    <button key={f} className={`kpi ${tone ?? ""}`} aria-pressed={filter === f} aria-label={`${label}: ${n}`}
      onClick={() => setFilter(filter === f ? "all" : f)}><b>{n}</b><span>{label}</span></button>
  );
  return (
    <div className="ops-home">
      <section aria-label="Today" className="ops-today">
        <h2 className="eyebrow">Today</h2>
        <p className="muted small how-it-works">AI reads forwarded documents into fields. Rules check every order. People decide exceptions.</p>
        <div className="kpis ops-kpis" role="group" aria-label="Filter orders">
          {tile("all", all.length, "Orders received")}
          {tile("automatic", by("automatic"), "Processed automatically", "ok")}
          {tile("review", by("review"), "Need review", "warn")}
          {tile("blocked", by("blocked"), "Blocked", "bad")}
          {tile("rejected", by("rejected"), "ERP delivery failed", "bad")}
          {tile("after_review", by("after_review"), "Completed after review")}
        </div>
        {filter !== "all" && <p className="muted small">Showing {rows.length} of {all.length} orders. <button className="linkish" onClick={() => setFilter("all")}>Show all</button></p>}
      </section>
      <div className="ops-grid">
        <section className="panel" aria-labelledby="attention-h">
          <header className="panel-head"><h3 id="attention-h">Needs attention</h3><span className="count">{attention.length}</span></header>
          {attention.length === 0 ? <p className="empty"><CheckCircle2 size={18} aria-hidden /> {all.length ? "No orders need attention." : "No orders yet. Forward one from the inbox."}</p> : (
            <ul className="queue" aria-label="Orders that need attention">
              {attention.map((r) => <ExceptionRow key={r.key} r={r} onOpen={onOpen} />)}
            </ul>
          )}
        </section>
        <aside className="ops-side">
          {forward}
          {commandCenter}
        </aside>
      </div>
      <section className="panel" aria-labelledby="normal-h">
        <header className="panel-head"><h3 id="normal-h">Processing normally or completed</h3><span className="count muted">{normal.length}</span></header>
        {normal.length === 0 ? <p className="empty">None yet.</p> : (
        <div className="scroll">
          <table className="grid-table ops-table stack-table">
            <thead><tr><th>PO number</th><th>Customer</th><th>Received</th><th>Value</th><th>State</th><th>ERP result (simulated)</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {normal.map((r) => (
                <tr key={r.key} data-po={r.po}>
                  <td data-label="PO number"><b>{r.po}</b></td><td data-label="Customer">{r.customer}</td>
                  <td data-label="Received">{time(r.receivedAt)}</td><td data-label="Value">{r.value ?? "Not available"}</td>
                  <td data-label="State"><div><span className={`pill ${r.state[1]}`}>{r.state[0]}</span>{r.detail.map((t) => <div key={t} className="muted small wrap">{t}</div>)}</div></td>
                  <td data-label="ERP result">{r.erp}</td>
                  <td className="row-open"><button className="ghost" onClick={() => onOpen(r.target)} aria-label={`View order ${r.po}`}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>)}
      </section>
    </div>
  );
}

const age = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};

/** D74: an exception with enough context to act on: what happened, value, dates, owner and the decision needed. */
function ExceptionRow({ r, onOpen }: { r: Row; onOpen: (t: Row["target"]) => void }) {
  return (
    <li className={`qrow ${r.state[1]}`} data-po={r.po}>
      <div className="q-main">
        <div className="q-title"><b>{r.po}</b><span className="muted"> · {r.customer}</span></div>
        <div className="q-issue">{r.issue && <span className={`pill ${r.state[1]}`}>{r.issue}</span>}<span>{r.summary}</span></div>
        {r.detail.map((t) => <div key={t} className="small">{t}</div>)}
        <dl className="q-context">
          <div><dt>Decision needed</dt><dd>{r.decision ?? "Not available"}{r.openCount > 1 ? ` (+${r.openCount - 1} more)` : ""}</dd></div>
          <div><dt>Order value</dt><dd>{r.value ?? "Not available"}</dd></div>
          <div><dt>Requested delivery</dt><dd>{r.deliveryDate ?? "Not printed"}</dd></div>
          <div><dt>Owner</dt><dd>{r.owner ?? "Not assigned"}</dd></div>
          <div><dt>Waiting</dt><dd>{age(r.receivedAt)} · from {r.sender}</dd></div>
        </dl>
      </div>
      <span className={`pill ${r.state[1]} q-state`}>{r.state[0]}</span>
      <button className="primary" onClick={() => onOpen(r.target)} aria-label={`Review order ${r.po}`}>Review order <ChevronRight size={16} aria-hidden /></button>
    </li>
  );
}

/** Command Center list of order exceptions: each one deep-links to its review; nothing is decided here. */
export function OrderExceptions({ onOpen }: { onOpen: (docId: number) => void }) {
  const agent = useAgent();
  const list = agent.ready ? engineRows(agent.state).filter((r) => ATTENTION.includes(r.bucket)) : [];
  return (
    <section className="panel cc-orders" aria-labelledby="cc-orders-h">
      <header className="panel-head"><h3 id="cc-orders-h">Order exceptions</h3><span className="count">{list.length}</span></header>
      {list.length === 0 ? <p className="empty">No order exceptions.</p> : (
        <ul className="queue compact">{list.map((r) => <ExceptionRow key={r.key} r={r} onOpen={(t) => onOpen(t.docId)} />)}</ul>
      )}
    </section>
  );
}

/** Number of orders that need a person, for the Command Center badge. */
export const attentionCount = (s: RunState) => engineRows(s).filter((r) => ATTENTION.includes(r.bucket)).length;
