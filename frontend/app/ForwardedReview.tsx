"use client";
// The order review for files forwarded or uploaded in this tab (D72). Same layout and vocabulary as the sample
// inbox review (OrderOps.tsx): source beside the structured order, the decision first, field states, your ERP
// (simulated) and a history that names the actor. The decisions run on the reading pipeline's own workflow
// (lib/domain/workflow.ts), so MOQ, price, GTIN, stock, shipping and invoicing keep working unchanged.
import { useState } from "react";
import { AlertOctagon, ArrowLeft, CheckCircle2, CircleDot, ExternalLink, FileText, HelpCircle, Server } from "lucide-react";
import { documentDetail, type DocDetail, type Issue } from "../lib/domain/selectors";
import { portalForOrder } from "../lib/domain/portal";
import { ACTION_LABEL, IN_FLIGHT, type Role } from "./api";
import { ACTOR, engineRows, FIELD_STATE, type FieldState, ISSUE_LABEL, type IssueType } from "./OrderOps";
import { FIELD_LABEL, fieldOfIssue, Onboard, OrderTerms, SourcePanel, targetId } from "./OrderView";
import { EmailEvidence, NotAnOrder, OrderActions, SourceText } from "./OrderPanels";
import { FulfilmentPanel } from "./Fulfilment";
import { OrderPortal } from "./Portal";
import { useAgent } from "./run/RunProvider";

const dateTime = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const person = (actor: string) => actor.startsWith("policy:") ? `order policy ${actor.slice(7)}`
  : ({ "reviewer:rita": "Rita, order desk", "administrator:alex": "Alex, operations lead" } as Record<string, string>)[actor] ?? actor.split(":")[1] ?? actor;

/** The workflow's issue codes in the order-review vocabulary. */
export function issueType(i: Issue): IssueType {
  if (i.actions.length > 0 && i.actions.every((a) => a === "reject_order")) return "missing_required_data";
  if (i.code === "unknown_ship_to" || i.code === "unknown_customer") return "missing_required_data";
  if (i.code === "unknown_item" && (i.candidate_skus?.length ?? 0) > 1) return "ambiguous_match";
  if (i.proposed_action || i.actions.includes("apply_mapping") || i.actions.includes("confirm_conversion")) return "correctable_discrepancy";
  return "validation_failure";
}
const UNCERTAIN = new Set(["unknown_item", "unknown_customer", "unknown_ship_to", "unverified_field", "unit_conversion", "unknown_unit", "possible_revision"]);

function fieldState(value: string | null, issues: Issue[]): FieldState {
  const open = issues.filter((i) => i.status === "open");
  if (open.length) return open.some((i) => UNCERTAIN.has(i.code)) ? "uncertain" : "invalid";
  if (issues.some((i) => i.resolution)) return "changed";
  return value === null || value === "" ? "missing" : "accepted";
}

type Act = (i: Issue, action: string, reason: string, params: Record<string, unknown>) => Promise<void>;

export function ForwardedReview({ docId, role, onBack, onOpenIntake }: { docId: number; role: Role; onBack: () => void;
  onOpenIntake: (docId: number) => void }) {
  const agent = useAgent();
  const [focus, setFocus] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const d = agent.ready ? documentDetail(agent.state, docId) : null;
  if (!d) return <p className="placeholder">Order not found.</p>;
  const wrap = async (f: () => Promise<unknown>) => { try { await f(); setError(null); } catch (e) { setError((e as Error).message); } };
  const run = (a: Parameters<typeof agent.run>[0]) => wrap(() => agent.run(a));
  const act: Act = (i, action, reason, params) => run({ type: "decide", role, docId, issueKey: i.key, action: action as never, reason: reason || null, params });
  const row = engineRows(agent.state).find((r) => r.key === `doc-${docId}`);
  const o = d.order;
  const v = o?.validation.order;
  const issues = o?.validation.issues ?? [];
  const open = issues.filter((i) => i.status === "open");
  const resolved = issues.filter((i) => i.resolution);
  const canAct = role !== "viewer";
  const [label, tone] = row?.state ?? ["Received", "info"];
  const isAi = d.latest_version?.payload.extractor.is_ai;
  const show = (i: Issue) => { const t = targetId(i); if (t) setFocus(new Set([t])); };

  return (
    <article className="ops-review" aria-label={`Order ${row?.po ?? docId}`}>
      <div className="review-top btns">
        <button className="ghost" onClick={onBack}><ArrowLeft size={16} aria-hidden /> Back to orders</button>
        <button className="ghost" onClick={() => onOpenIntake(docId)}><ExternalLink size={16} aria-hidden /> View document</button>
      </div>
      <header className="review-head">
        <div>
          <p className="eyebrow">{d.envelope.sender ? `Purchase order from ${d.envelope.sender}` : `Uploaded purchase order · ${d.document.original_filename ?? "file"}`}</p>
          <h2>{row?.po ?? `Document ${docId}`} {v?.customer_name && <span className="sub">· {v.customer_name}</span>}</h2>
          <div className="chips">
            <span className="chip">{row?.channel ?? "Uploaded file"}</span>
            <span className="chip">Received {dateTime(d.envelope.received_at ?? d.envelope.created_at)}</span>
            {d.latest_version && <span className="chip">{isAi ? `Read by AI (${d.latest_version.payload.extractor.name})` : d.kind === "edi" ? "Structured data, no AI" : "Test adapter, not AI"}</span>}
          </div>
        </div>
        <span className={`pill ${tone} big-pill`} aria-label={`Order state: ${label}`}>{label}</span>
      </header>
      <Journey d={d} p={o ? portalForOrder(agent.state, docId) : null}
        shortStock={agent.state.orders.find((x) => x.documentId === docId)?.fulfilment?.status === "needs_decision"} />
      {error && <div className="alert bad" role="alert">{error}</div>}
      {IN_FLIGHT.has(d.document.status) && <div className="alert info pulse">Reading the order.</div>}
      {d.document.status_detail && d.document.status !== "not_order" && <div className={`alert ${d.document.status === "duplicate" ? "warn" : "bad"}`}>{d.document.status_detail}</div>}
      <NotAnOrder d={d} role={role} onRun={run} />

      <div className="review-split">
        <section className="source-panel" aria-label="Source" id="order-source">
          <div className="source-head"><h3 className="section-h"><FileText size={16} aria-hidden /> Source</h3></div>
          {d.kind === "pdf" ? <SourcePanel d={d} focus={focus} onPick={(id) => setFocus(new Set([id]))} /> : <SourceText d={d} />}
        </section>
        <div className="review-right">
          {o && (
            <section aria-labelledby="decision-h" className="decision-zone" id="order-decision">
              <h3 id="decision-h" className="section-h">{open.length ? "Decision required" : o.review_state === "ready" ? "Ready to send" : "Outcome"}</h3>
              {open.map((i) => <FwdIssueCard key={i.key} d={d} issue={i} canAct={canAct} role={role} onAct={act} onRun={run} show={show} />)}
              {o.review_state === "ready" && (
                <div className="approve-bar">
                  <p>All checks passed. Approval sends the order to your ERP.</p>
                  <button className="primary big" disabled={!canAct} onClick={() => run({ type: "approve", role, docId })}>Approve and send to ERP</button>
                </div>
              )}
              {o.delivery_state === "erp_created" && (
                <div className="outcome ok"><CheckCircle2 size={20} aria-hidden /><div><b>Accepted by your ERP as {o.erp_order_id}.</b>
                  <p className="muted small">{resolved.length || o.approvals.some((a) => a.kind === "human") ? "Approved by a person before sending." : "Processed automatically. No person was needed."}</p></div></div>
              )}
              {o.review_state === "rejected" && <div className="alert bad">Order rejected. Nothing was sent to your ERP.</div>}
            </section>
          )}
          {resolved.length > 0 && (
            <section aria-labelledby="fdecisions-h">
              <h3 id="fdecisions-h" className="section-h">Decisions on this order</h3>
              <ul className="decisions">
                {resolved.map((i) => (
                  <li key={i.key}><div><b>{i.title}</b>
                    <span className="muted small"> · {ACTION_LABEL[i.resolution!.action] ?? i.resolution!.action} by {person(i.resolution!.actor)}, {time(i.resolution!.at)}</span>
                    {i.resolution!.reason && <div className="muted small">“{i.resolution!.reason}”</div>}</div></li>
                ))}
              </ul>
            </section>
          )}
          {o && v && <Structured d={d} />}
          {o && <div id="order-erp"><ErpBox d={d} canAct={canAct} onRetry={() => run({ type: "retryDelivery", role, docId })} /></div>}
        </div>
      </div>
      {o && <OrderTerms d={d} onPick={(id) => setFocus(new Set([id]))} />}
      {o?.delivery_state === "erp_created" && (
        <div className="ship-asn">
          <div id="order-stock"><FulfilmentPanel docId={docId} role={role} /></div>
          <div id="order-outbound"><OrderPortal docId={docId} role={role} /></div>
        </div>
      )}
      <FwdHistory d={d} />
      <section className="panel order-foot" aria-label="Details">
        <EmailEvidence d={d} />
        {o && canAct && <OrderActions d={d} role={role} onRun={run} />}
      </section>
    </article>
  );
}

/** D74: the whole order lifecycle, from the email to the invoice. Each step opens its section; one next action. */
function Journey({ d, p, shortStock }: { d: DocDetail; p: ReturnType<typeof portalForOrder> | null; shortStock: boolean }) {
  const o = d.order;
  const read = !IN_FLIGHT.has(d.document.status) && !!d.latest_version;
  const open = o?.validation.issues.some((i) => i.status === "open") ?? false;
  const sent = (o?.deliveries.length ?? 0) > 0;
  const failed = o ? ["failed", "unknown"].includes(o.delivery_state) : false;
  const inErp = o?.delivery_state === "erp_created";
  const confirmed = !!p?.confirmation;
  const shipped = (p?.shipments.length ?? 0) > 0;
  const invoiced = p?.shipments.some((x) => x.invoice) ?? false;
  type Step = [string, "done" | "wait" | "stop" | "", string];
  const steps: Step[] = [
    [d.envelope.sender ? "Email received" : "File received", "done", "order-source"],
    [d.kind === "pdf" ? "PDF read" : "Read", read ? "done" : IN_FLIGHT.has(d.document.status) ? "wait" : "stop", "order-source"],
    ["Checked", o ? "done" : "", "order-decision"],
    ["Decision", !o ? "" : open || o.review_state === "ready" ? "wait" : "done", "order-decision"],
    [failed ? "ERP did not confirm" : "In your ERP", inErp ? "done" : failed ? "stop" : sent ? "wait" : "", "order-erp"],
    ["Confirmed (855)", confirmed ? "done" : inErp ? "wait" : "", "order-outbound"],
    ["Shipped (856)", shipped ? "done" : confirmed ? "wait" : "", "order-stock"],
    ["Invoiced (810)", invoiced ? "done" : shipped ? "wait" : "", "order-outbound"],
  ];
  const next: [string, string] | null = !o ? null : open ? ["Decide the open checks", "order-decision"]
    : o.review_state === "ready" ? ["Approve and send to your ERP", "order-decision"]
    : failed ? ["Retry delivery to your ERP", "order-erp"]
    : shortStock ? ["Choose how to ship the short lines", "order-stock"]
    : inErp && !shipped ? ["Create the ship notice (ASN)", "order-outbound"]
    : shipped && !invoiced ? ["Create the invoice", "order-outbound"] : null;
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <nav className="journey" aria-label="Order lifecycle">
      <ol className="stages">
        {steps.map(([t, c, id]) => (
          <li key={t} className={c}><button className="stage-btn" onClick={() => go(id)}>
            <span className="sr-only">{c === "done" ? "Done: " : c === "wait" ? "Waiting: " : c === "stop" ? "Stopped: " : "Not reached: "}</span>{t}</button></li>
        ))}
      </ol>
      {next && <p className="next-action"><b>Next:</b> <button className="linkish" onClick={() => go(next[1])}>{next[0]}</button></p>}
    </nav>
  );
}

function FwdIssueCard({ d, issue, canAct, role, onAct, onRun, show }: { d: DocDetail; issue: Issue; canAct: boolean; role: Role; onAct: Act;
  onRun: (a: Parameters<ReturnType<typeof useAgent>["run"]>[0]) => Promise<void>; show: (i: Issue) => void }) {
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("");
  const [sku, setSku] = useState(issue.candidate_skus?.[0] ?? "");
  const [date, setDate] = useState(issue.candidate_dates?.[0] ?? "");
  const [shipTo, setShipTo] = useState(issue.candidate_ship_tos?.[0] ?? "");
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const type = issueType(issue);
  const tone = type === "missing_required_data" ? "bad" : "warn";
  const Icon = tone === "bad" ? AlertOctagon : type === "ambiguous_match" ? HelpCircle : CircleDot;
  const v = d.order?.validation.order;
  const line = issue.line_index === null ? undefined : v?.lines[issue.line_index];
  const f = fieldOfIssue(issue);
  const where = `${issue.line_index === null ? "" : `Line ${line?.source_line_id ?? issue.line_index + 1} · `}${f ? FIELD_LABEL[f] ?? f : "Order"}`;
  async function go(action: string) {
    setBusy(true);
    try {
      const params: Record<string, unknown> = {};
      if (action === "apply_mapping") params.save_for_future = save;
      if (action === "map_item") params.sku = sku;
      if (action === "change_quantity" || action === "correct_price") params.value = value;
      if (action === "choose_date") { params.date = date; if (issue.field) params.field = issue.field; }
      if (action === "choose_ship_to") params.ship_to_id = shipTo;
      await onAct(issue, action, reason, params);
    } finally { setBusy(false); }
  }
  return (
    <section className={`issue-card ${tone}`} aria-label={issue.title}>
      <header>
        <Icon size={20} aria-hidden className="ic" />
        <div><span className={`pill ${tone}`}>{ISSUE_LABEL[type]}</span><h4>{issue.title}</h4></div>
      </header>
      <p className="what">{issue.message}</p>
      <dl className="facts">
        <div><dt>Affected field</dt><dd>{where}</dd></div>
        <div><dt>Checked against</dt><dd>{issue.reference_version ?? "Reference data"}</dd></div>
        {issue.proposed_action && <div className="wide"><dt>Proposed action</dt><dd>{issue.proposed_action}</dd></div>}
      </dl>
      {issue.printed_value !== null && issue.reference_value !== null && issue.printed_value !== issue.reference_value && (
        <div className="compare" aria-label="Printed and reference values">
          <div><span className="eyebrow">Printed on PO</span><del>{issue.printed_value}</del></div>
          <span className="arrow" aria-hidden>→</span>
          <div><span className="eyebrow">On file</span><ins>{issue.reference_value}</ins></div>
        </div>
      )}
      {canAct && <Onboard issue={issue} docId={d.document.id} role={role} onRun={onRun} line={line} currency={v?.currency ?? null} />}
      {canAct && (
        <div className="decide">
          {issue.actions.some((a) => a === "change_quantity" || a === "correct_price") && (
            <input aria-label="New value" placeholder="New value" value={value} onChange={(e) => setValue(e.target.value)} />)}
          {issue.actions.includes("map_item") && (
            <select aria-label="Product" value={sku} onChange={(e) => setSku(e.target.value)}>
              {issue.candidate_skus?.map((s) => <option key={s}>{s}</option>)}
            </select>)}
          {issue.actions.includes("choose_date") && (issue.candidate_dates?.length
            ? <select aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)}>{issue.candidate_dates.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            : <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />)}
          {issue.actions.includes("choose_ship_to") && (
            <select aria-label="Location" value={shipTo} onChange={(e) => setShipTo(e.target.value)}>
              {issue.candidate_ship_tos?.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>)}
          {issue.actions.includes("apply_mapping") && (
            <label className="check"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Save for future matching orders (needs administrator activation)</label>)}
          {issue.actions.some((a) => !["reject_order", "apply_mapping", "map_item", "choose_date", "choose_ship_to"].includes(a)) && (
            <input aria-label="Reason" placeholder="Reason (recorded in the order history)" value={reason} onChange={(e) => setReason(e.target.value)} />)}
        </div>
      )}
      <div className="btns issue-actions">
        {canAct && issue.actions.map((a) => (
          <button key={a} disabled={busy} className={a === "reject_order" ? "ghost danger" : "primary"} onClick={() => go(a)}>{ACTION_LABEL[a] ?? a}</button>
        ))}
        <button className="ghost" aria-expanded={evidence} onClick={() => setEvidence(!evidence)}>{evidence ? "Hide evidence" : "View evidence"}</button>
        {targetId(issue) && d.kind === "pdf" && <button className="ghost" onClick={() => show(issue)}><FileText size={16} aria-hidden /> Show in source</button>}
      </div>
      {evidence && (
        <ul className="evidence" aria-label="Evidence">
          <li><span className="tag">Source</span><span>{issue.evidence ? `“${issue.evidence}”` : "No source text recorded"}{issue.page ? ` · page ${issue.page}` : ""}</span></li>
          <li><span className="tag">Reference data</span><span>{issue.reference_value ?? "Not on file"}{issue.reference_version ? ` · ${issue.reference_version}` : ""}</span></li>
          <li><span className="tag">Rule</span><span>{issue.code.replace(/_/g, " ")}{issue.blocking ? " · blocks sending" : ""}</span></li>
        </ul>
      )}
    </section>
  );
}

function Cell({ value, printed, state }: { value: string | null; printed?: string | null; state: FieldState }) {
  const [label, tone] = FIELD_STATE[state];
  return (
    <>
      <td>{state === "changed" && printed && printed !== value
        ? <span className="diff"><del>{printed}</del> <span aria-hidden>→</span> <ins>{value}</ins></span>
        : value ?? <span className="muted">Not printed</span>}</td>
      <td><span className={`pill ${tone} fstate`}>{label}</span></td>
    </>
  );
}

function Structured({ d }: { d: DocDetail }) {
  const v = d.order!.validation.order;
  const issues = d.order!.validation.issues;
  const on = (field: string, line: number | null) => issues.filter((i) => fieldOfIssue(i) === field && i.line_index === line);
  const header: [string, string, string | null][] = [
    ["po_number", "PO number", v.po_number], ["customer_name", "Customer", v.customer_name], ["ship_to_id", "Ship-to", v.ship_to_id],
    ["requested_delivery_date", "Requested delivery", v.requested_delivery_date], ["currency", "Currency", v.currency],
  ];
  return (
    <section aria-labelledby="fstructured-h">
      <h3 id="fstructured-h" className="section-h">Structured order</h3>
      <div className="scroll">
        <table className="fields" aria-label="Order header">
          <thead><tr><th>Field</th><th>Value</th><th>State</th></tr></thead>
          <tbody>{header.filter(([k, , val]) => val !== null || on(k, null).length > 0).map(([k, l, val]) => {
            const s = fieldState(val, on(k, null));
            return <tr key={k} className={`f-${s}`} data-field={k}><th scope="row">{l}</th><Cell value={val} state={s} /></tr>;
          })}</tbody>
        </table>
      </div>
      {v.lines.map((ln) => {
        const rows: [string, string, string | null, string | null][] = [
          ["gtin", "Item", ln.sku ? `${ln.sku} · ${ln.description ?? ""}` : ln.description, ln.printed_gtin ?? ln.customer_item_code],
          ["quantity", "Quantity", ln.quantity ?? ln.original_quantity, ln.original_quantity],
          ["unit", "Unit", ln.unit ?? ln.original_unit, ln.original_unit],
          ["unit_price", "Unit price", ln.unit_price ?? ln.printed_unit_price, ln.printed_unit_price],
        ];
        return (
          <div key={ln.line_index} className="scroll">
            <table className="fields" aria-label={`Line ${ln.source_line_id}`}>
              <caption>Line {ln.source_line_id}{ln.line_amount ? ` · ${ln.line_amount} ${v.currency ?? ""}` : ""}</caption>
              <tbody>{rows.map(([k, l, val, printed]) => {
                const s = fieldState(val, on(k, ln.line_index));
                return <tr key={k} className={`f-${s}`} data-field={k}><th scope="row">{l}</th><Cell value={val} printed={printed} state={s} /></tr>;
              })}</tbody>
            </table>
          </div>
        );
      })}
      <p className="total">Order total <b>{v.totals.computed_total} {v.currency}</b> <span className="muted small">printed {v.totals.printed_total ?? "not printed"}</span></p>
    </section>
  );
}

function ErpBox({ d, canAct, onRetry }: { d: DocDetail; canAct: boolean; onRetry: () => void }) {
  const o = d.order!;
  const last = o.deliveries.at(-1);
  const failed = ["failed", "unknown"].includes(o.delivery_state);
  const steps: [string, boolean][] = [["Ready", o.review_state === "approved" || !!last], ["Sending", !!last], ["Response received", !!last && !["queued", "submitting"].includes(o.delivery_state)],
    [failed ? "Not confirmed" : "Accepted", o.delivery_state === "erp_created" || failed]];
  return (
    <section className="erp-sim" aria-labelledby="ferp-h">
      <h3 id="ferp-h" className="section-h"><Server size={16} aria-hidden /> Your ERP (simulated)</h3>
      <p className="muted small">Simulated system. No live ERP connection.</p>
      <dl className="facts erp-roles">
        <div><dt>Accepts or rejects</dt><dd>Your ERP, using its own checks.</dd></div>
        <div><dt>Order Agent</dt><dd>Sends the approved version, records the response and retries safely when the outcome is unknown.</dd></div>
      </dl>
      <ol className="lifecycle" aria-label="ERP lifecycle">
        {steps.map(([t, done], i) => <li key={t} className={done ? (i === 3 && failed ? "stop" : "done") : ""}>{t}</li>)}
      </ol>
      {!last && <p className="muted">Not sent. {o.validation.issues.some((i) => i.status === "open") ? "Sending starts when every blocking issue is resolved." : "Sending starts after approval."}</p>}
      {[...o.deliveries].reverse().map((a) => (
        <details key={a.id} open={a.id === last?.id}>
          <summary>Attempt {a.id} · {time(a.updated_at)} · <span className={`pill ${a.state === "erp_created" ? "ok" : failed ? "bad" : "info"}`}>{a.state === "erp_created" ? "Accepted" : a.state.replace(/_/g, " ")}</span></summary>
          <dl className="facts">
            <div><dt>Response</dt><dd>{a.detail ?? "No detail"}</dd></div>
            {a.erp_order_id && <div><dt>ERP order</dt><dd>{a.erp_order_id}</dd></div>}
            <div><dt>Approved version</dt><dd>{a.version}</dd></div>
            <div><dt>Request key</dt><dd className="mono">{a.idempotency_key}</dd></div>
          </dl>
        </details>
      ))}
      {failed && canAct && <button className="primary" onClick={onRetry}>Check ERP and retry safely</button>}
    </section>
  );
}

const EVENT_TEXT: Record<string, string> = {
  received: "Received", extracting: "Reading the document", extracted: "Values read", matching: "Matched to reference data", validating: "Checked against rules",
  needs_review: "Waiting for a decision", ready_for_approval: "Ready for approval", approved: "Approved", rejected: "Rejected",
  decision_recorded: "Decision recorded", approval_invalidated: "Approval withdrawn", on_hold: "Put on hold", hold_released: "Hold released",
  memory_rule_applied: "Saved rule applied", fulfilment_decided: "Shipping decision", asn_submitted: "Advance ship notice created",
  invoice_submitted: "Invoice created", delivery_retry_requested: "ERP retry requested", supplier_reply_applied: "Supplier reply applied",
};

function FwdHistory({ d }: { d: DocDetail }) {
  const isAi = d.latest_version?.payload.extractor.is_ai;
  const kindOf = (actor: string, event: string) => /^(reviewer|administrator):/.test(actor) ? "person" as const
    : event === "extracted" && isAi ? "agent" as const : "system" as const;
  const rows = [
    ...d.timeline.filter((t) => !/^delivery_(?!retry)/.test(t.event)).map((t) => {
      const actor = typeof t.detail.actor === "string" ? t.detail.actor : t.actor;
      return { at: t.created_at, kind: kindOf(actor, t.event), text: EVENT_TEXT[t.event] ?? t.event.replace(/_/g, " "),
        who: /^(reviewer|administrator):/.test(actor) ? person(actor) : null };
    }),
    ...(d.order?.deliveries ?? []).map((a) => ({ at: a.updated_at, kind: "erp" as const,
      text: a.state === "erp_created" ? `Accepted by your ERP as ${a.erp_order_id}` : `ERP delivery attempt ${a.id}: ${a.state.replace(/_/g, " ")}`, who: null })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <section className="panel history" aria-labelledby="fhistory-h">
      <header className="panel-head"><h3 id="fhistory-h">Order history</h3><span className="count muted">{rows.length}</span></header>
      <ol className="timeline">
        {rows.map((r, i) => {
          const [label, Icon] = ACTOR[r.kind];
          return (
            <li key={i} className={`ev ev-${r.kind}`}>
              <time dateTime={r.at}>{time(r.at)}</time>
              <span className={`ev-actor ev-actor-${r.kind}`}><Icon size={14} aria-hidden /> {label}</span>
              <span className="ev-text">{r.text}{r.who && <span className="muted small"> · {r.who}</span>}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
