"use client";
// Panels on the order review: order actions (hold, release, reject), how each value was read, the source as text for
// email and EDI orders, and evidence-only attachments.
import { useState } from "react";
import { provenanceRows } from "../lib/domain/provenance";
import type { Action } from "../lib/server/run-action";
import { type DocDetail, HOLD_REASON_LABEL, REJECT_REASON_LABEL, type Role } from "./api";
import { useAgent } from "./run/RunProvider";

type RunFn = (action: Action) => Promise<void>;
const who = (actor: string) => actor.split(":")[1] ?? actor;
const time = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** D64: internal hold, release and reject. Available until the order reaches the ERP. */
export function OrderActions({ d, role, onRun }: { d: DocDetail; role: Role; onRun: RunFn }) {
  const o = d.order;
  const [mode, setMode] = useState<"hold" | "reject" | null>(null);
  const [hold, setHold] = useState("checking_with_buyer");
  const [reject, setReject] = useState("");
  const [busy, setBusy] = useState(false);
  if (!o || role === "viewer") return null;
  const beforeErp = ["not_started", "failed"].includes(o.delivery_state) && !o.erp_order_id;
  if (!beforeErp || o.review_state === "rejected") return null;
  const r = role as "reviewer" | "administrator";
  const go = async (a: Action) => { setBusy(true); try { await onRun(a); setMode(null); } finally { setBusy(false); } };
  const docId = d.document.id;
  if (d.hold) {
    return (
      <div className="order-actions held" aria-label="Order hold">
        <span className="pill warn">On hold</span>
        <span>{HOLD_REASON_LABEL[d.hold.reason] ?? d.hold.reason} · {who(d.hold.held_by)} · {time(d.hold.held_at)}</span>
        <button disabled={busy} onClick={() => go({ type: "releaseHold", role: r, docId })}>Release hold</button>
      </div>
    );
  }
  return (
    <div className="order-actions" aria-label="Order actions">
      {mode === null && <>
        <button className="ghost" onClick={() => setMode("hold")}>Put on hold</button>
        <button className="ghost danger" onClick={() => setMode("reject")}>Reject order</button>
      </>}
      {mode === "hold" && <>
        <label>Hold reason
          <select aria-label="Hold reason" value={hold} onChange={(e) => setHold(e.target.value)}>
            {Object.entries(HOLD_REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button className="primary" disabled={busy} onClick={() => go({ type: "holdOrder", role: r, docId, reason: hold as never })}>Hold order</button>
        <button className="ghost" onClick={() => setMode(null)}>Cancel</button>
        <span className="muted small">Nothing is sent to the ERP or the retailer while the order is on hold.</span>
      </>}
      {mode === "reject" && <>
        <label>Reason (optional)
          <select aria-label="Reject reason" value={reject} onChange={(e) => setReject(e.target.value)}>
            <option value="">No reason</option>
            {Object.entries(REJECT_REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button className="danger" disabled={busy} onClick={() => go({ type: "rejectOrder", role: r, docId, reasonCode: (reject || null) as never })}>Confirm reject</button>
        <button className="ghost" onClick={() => setMode(null)}>Cancel</button>
      </>}
    </div>
  );
}

/** D62: a document classified as not an order, with the reason and a correction. */
export function NotAnOrder({ d, role, onRun }: { d: DocDetail; role: Role; onRun: RunFn }) {
  if (d.document.status !== "not_order") return null;
  const c = d.classification;
  return (
    <div className="alert info" role="status">
      <b>Not an order.</b> {c?.reason ?? "No PO number or order lines were found."}
      {c && <span className="muted small"> Classified by {who(c.by)}.</span>}
      {role !== "viewer" && (
        <div className="btns"><button onClick={() => onRun({ type: "treatAsOrder", role: role as "reviewer", docId: d.document.id })}>Treat as order</button></div>
      )}
    </div>
  );
}

/** The email text or EDI message, for orders that have no PDF page to show. */
export function SourceText({ d }: { d: DocDetail }) {
  if (d.kind === "pdf") return null;
  return (
    <section className="source-text" aria-label={d.kind === "edi" ? "EDI message" : "Email text"}>
      <h4 className="section">{d.kind === "edi" ? "EDI message as received" : "Email text as received"}</h4>
      <pre className="mono small">{d.pages.join("\n")}</pre>
      <p className="muted small">Displayed as received. Instructions in the text are not executed.</p>
    </section>
  );
}

/** D62: everything that came with the email, including files kept only as evidence. */
export function EmailEvidence({ d }: { d: DocDetail }) {
  const atts = d.envelope.attachments;
  if (!atts.length && !d.envelope.body_text) return null;
  return (
    <details className="evidence">
      <summary>Email and attachments ({atts.length} attachment{atts.length === 1 ? "" : "s"})</summary>
      {d.envelope.subject_metadata && <p><b>Subject</b> {d.envelope.subject_metadata}</p>}
      {atts.length > 0 && (
        <table className="lines">
          <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Handling</th></tr></thead>
          <tbody>{atts.map((a, i) => (
            <tr key={i}><td>{a.filename ?? "unnamed"}</td><td>{a.mimeType ?? "unknown"}</td><td>{a.sizeBytes.toLocaleString()} bytes</td>
              <td>{a.handling === "order_candidate" ? "Read as a possible order" : "Kept as evidence"}{a.note && <div className="muted small">{a.note}</div>}</td></tr>
          ))}</tbody>
        </table>
      )}
      {d.envelope.body_text && d.kind !== "email_body" && <pre className="mono small">{d.envelope.body_text.slice(0, 4000)}</pre>}
    </details>
  );
}

const FOUND = { found: ["Found in source", "ok"], not_found: ["Not found in source", "bad"], no_value: ["No value", "muted"] } as const;
const PLACE = { on_line: ["On its line", "ok"], other_line: ["On another line", "bad"], not_checked: ["Not checked", "muted"] } as const;

/** D65: provenance per value, as separate statements. */
export function Provenance({ d }: { d: DocDetail }) {
  const rows = provenanceRows(d);
  if (!rows.length) return null;
  return (
    <details className="provenance-panel">
      <summary>Value sources</summary>
      <p className="muted small">Each value lists how it was read, whether it appears in the source, what reference data matched and what a person confirmed. Confidence scores are not shown.</p>
      <div className="scroll">
        <table className="lines">
          <thead><tr><th>Value</th><th>Read by</th><th>Source text</th><th>Placement</th><th>Reference data</th><th>Person</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td>{r.label}<div className="mono small">{r.value ?? "—"}</div></td>
              <td className="small">{r.readBy}</td>
              <td><span className={`pill ${FOUND[r.found][1]}`}>{FOUND[r.found][0]}</span></td>
              <td><span className={`pill ${PLACE[r.placement][1]}`}>{PLACE[r.placement][0]}</span></td>
              <td className="small">{r.reference ?? "—"}</td>
              <td className="small">{r.person ?? "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}

const EVENT_LABEL: Record<string, string> = {
  received: "Received", extracted: "Values read", matching: "Matched to reference data", validating: "Checked against rules",
  needs_review: "Waiting for a decision", ready_for_approval: "Ready for approval", approved: "Approved", rejected: "Rejected",
  awaiting_customer: "Customer asked to correct", decision_recorded: "Decision recorded", approval_invalidated: "Approval withdrawn",
  on_hold: "Put on hold", hold_released: "Hold released", classified_not_order: "Classified as not an order",
  classification_corrected: "Classification corrected", delivery_retry_requested: "ERP retry requested", memory_rule_applied: "Memory rule applied",
  amendment_held: "Change held after ERP delivery", fulfilment_decided: "Shipping decision", asn_submitted: "Advance ship notice created",
  invoice_submitted: "Invoice created", extraction_retry_requested: "Reading retried", duplicate: "Duplicate file",
  retailer_revision_accepted: "Retailer accepted the revision", retailer_revision_declined: "Retailer declined the revision",
  reference_customer_added: "Customer added", reference_customer_assigned: "Customer assigned", reference_ship_to_added: "Ship-to added",
  reference_product_added: "Product added", backorder_cancelled: "Backorder cancelled",
};
const detailText = (d: Record<string, unknown>) => {
  const parts: string[] = [];
  if (typeof d.reason_code === "string") parts.push(REJECT_REASON_LABEL[d.reason_code] ?? HOLD_REASON_LABEL[d.reason_code] ?? d.reason_code);
  if (typeof d.issue_key === "string") parts.push(d.issue_key.replace(/_/g, " "));
  if (typeof d.action === "string") parts.push(d.action.replace(/_/g, " "));
  if (typeof d.reason === "string") parts.push(`“${d.reason}”`);
  if (Array.isArray(d.open_issues)) parts.push(`${d.open_issues.length} open issue${d.open_issues.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
};
