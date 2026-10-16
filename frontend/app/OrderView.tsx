"use client";
import { useEffect, useState } from "react";
import { useAgent } from "./run/RunProvider";
import { OrderPortal } from "./Portal";
import { IssueRiskLine, ManualRoutePanel, useManualRoute } from "./ManualRoute";
import type { ManualRisk } from "../lib/domain/manual-route";
import type { Action } from "../lib/server/run-action";
import bundledReferenceJson from "../lib/domain/reference-data.v1.json";
import { mergeReference } from "../lib/domain/onboarding";
import type { Reference } from "../lib/domain/validation";
const bundledReference = bundledReferenceJson as unknown as Reference;
import {
  ACTION_LABEL, DELIVERY_LABEL, DocDetail, IN_FLIGHT, Issue, PEOPLE, PROCESS_LABEL, REVIEW_LABEL, Role, STOPPED,
} from "./api";

const STAGES = ["Received", "Reading PDF", "Matching", "Business rules", "Review", "Approved", "Sending to ERP", "In ERP"];

function stage(d: DocDetail): { at: number; stopped: boolean; waiting: boolean } {
  const s = d.document.status;
  const o = d.order;
  if (STOPPED.has(s)) return { at: s === "duplicate" ? 0 : 1, stopped: true, waiting: false };
  if (s === "received") return { at: 0, stopped: false, waiting: false };
  if (s === "extracting" || s === "extracted") return { at: 1, stopped: false, waiting: false };
  if (s === "matching") return { at: 2, stopped: false, waiting: false };
  if (!o || s === "validating") return { at: 3, stopped: false, waiting: false };
  if (o.delivery_state === "erp_created") return { at: 8, stopped: false, waiting: false };
  if (["queued", "submitting"].includes(o.delivery_state)) return { at: 6, stopped: false, waiting: false };
  if (["failed", "unknown"].includes(o.delivery_state)) return { at: 6, stopped: true, waiting: false };
  if (o.review_state === "approved") return { at: 5, stopped: false, waiting: false };
  if (o.review_state === "rejected") return { at: 4, stopped: true, waiting: false };
  return { at: 4, stopped: false, waiting: true };
}

export function Pill({ map, value, prefix }: { map: Record<string, [string, string]>; value: string; prefix: string }) {
  const [label, tone] = map[value] ?? [value, "info"];
  return <span className={`pill ${tone}`}><small>{prefix}</small>{label}</span>;
}

export function Timeline({ d }: { d: DocDetail }) {
  const { at, stopped, waiting } = stage(d);
  return (
    <ol className="stages" aria-label="Processing timeline">
      {STAGES.map((s, i) => {
        const cls = i < at ? "done" : i === at ? (stopped ? "stop" : waiting ? "wait" : "now") : "";
        return <li key={s} className={cls} aria-current={i === at ? "step" : undefined}>{s}</li>;
      })}
    </ol>
  );
}

function highlightTerms(d: DocDetail, focus: Issue | null): string[] {
  if (focus?.evidence) return [focus.evidence];
  const v = d.latest_version?.payload;
  if (!v) return [];
  return v.lines.map((l) => l.description?.evidence ?? l.quantity?.evidence).filter(Boolean) as string[];
}

export function SourcePanel({ d, focus }: { d: DocDetail; focus: Issue | null }) {
  const pages = d.pages;
  const [view, setView] = useState<"evidence" | "pdf">("evidence");
  const terms = highlightTerms(d, focus);
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  return (
    <div className="source">
      <div className="seg" role="tablist" aria-label="Source view">
        <button role="tab" aria-selected={view === "evidence"} onClick={() => setView("evidence")}>Evidence in PDF text</button>
        <button role="tab" aria-selected={view === "pdf"} onClick={() => setView("pdf")}>Original PDF</button>
      </div>
      {view === "pdf" ? (
        <OriginalPdf docId={d.document.id} />
      ) : (
        <div className="paper" aria-label="PDF text with highlighted evidence">
          {pages === null && <p className="muted">Loading document text...</p>}
          {pages?.map((p, pi) => (
            <div key={pi}>
              <div className="pageno">Page {pi + 1}</div>
              {p.split("\n").map((ln, i) => {
                const hit = terms.some((t) => norm(t) && norm(ln).includes(norm(t)) || (norm(t).includes(norm(ln)) && norm(ln).length > 8));
                const focused = focus?.evidence && norm(ln).includes(norm(focus.evidence));
                return <div key={i} className={`pl ${hit ? "hl" : ""} ${focused ? "focus" : ""}`}>{ln || " "}</div>;
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The PDF bytes stay in this tab's memory (never in the saved run), so they are gone after a reload. */
function OriginalPdf({ docId }: { docId: number }) {
  const agent = useAgent();
  const bytes = agent.pdfBytes(docId);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes) { setUrl(null); return; }
    const u = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes]);
  if (!url) return <p className="placeholder">The original PDF is kept only in memory and is gone after a reload. The PDF text and its evidence are still shown under Evidence in PDF text.</p>;
  return <iframe title="Source PDF" src={url} />;
}

type Act = (issue: Issue, action: string, reason: string, params: Record<string, unknown>) => Promise<void>;
type RunFn = (action: Action) => Promise<void>;
type Line = NonNullable<DocDetail["order"]>["validation"]["order"]["lines"][number];

/** D46: add the customer or product this real PO uses, for this session. Never automatic. */
function Onboard({ issue, docId, role, onRun, line, currency }: { issue: Issue; docId: number; role: Role; onRun: RunFn;
  line?: Line; currency: string | null }) {
  const agent = useAgent();
  const r = role as "reviewer" | "administrator";
  const printed = typeof issue.printed_value === "string" ? issue.printed_value : "";
  const [name, setName] = useState(printed);
  const [cur, setCur] = useState(currency ?? "");
  const customers = mergeReference((agent.state.settings.referenceData as unknown as Reference | null) ?? bundledReference, agent.state.referenceOverlay).customers;
  const [pick, setPick] = useState(customers[0]?.customer_id ?? "");
  const ident = line?.printed_gtin || line?.customer_item_code || "";
  const [sku, setSku] = useState(ident);
  const [desc, setDesc] = useState(line?.description ?? "");
  const [moq, setMoq] = useState("1");
  const [busy, setBusy] = useState(false);
  const go = async (a: Action) => { setBusy(true); try { await onRun(a); } finally { setBusy(false); } };
  if (issue.code === "unknown_customer") {
    return (
      <div className="onboard" aria-label="Add or assign customer">
        <p className="muted small">Added for this session only, recorded in the audit trail with your name.</p>
        <div className="row">
          <input aria-label="New customer name" value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Customer currency" className="short" value={cur} maxLength={3} onChange={(e) => setCur(e.target.value)} />
          <button className="primary" disabled={busy} onClick={() => go({ type: "addCustomer", role: r, docId, name,
            ...(cur.trim() ? { currency: cur.trim() } : {}) })}>Add as new customer</button>
        </div>
        <div className="row">
          <select aria-label="Existing customer" value={pick} onChange={(e) => setPick(e.target.value)}>
            {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name} ({c.customer_id})</option>)}
          </select>
          <button disabled={busy || !pick || !printed} onClick={() => go({ type: "assignCustomer", role: r, docId, customerId: pick })}>
            Assign to existing customer</button>
        </div>
      </div>
    );
  }
  if (issue.code === "unknown_ship_to" && printed) {
    return (
      <div className="onboard">
        <button className="primary" disabled={busy} onClick={() => go({ type: "addShipTo", role: r, docId })}>
          Add ship-to {printed} for this customer</button>
      </div>
    );
  }
  if (issue.code === "unknown_item" && line && ident) {
    return (
      <div className="onboard" aria-label="Add to catalogue">
        <p className="muted small">Reference price will be the printed {line.printed_unit_price ?? "?"} {currency ?? ""} per {line.original_unit ?? "?"}. Added for this session only.</p>
        <div className="row">
          <input aria-label="New product SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
          <input aria-label="New product description" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <input aria-label="Minimum order quantity" className="short" value={moq} onChange={(e) => setMoq(e.target.value)} />
          <button className="primary" disabled={busy} onClick={() => go({ type: "addProduct", role: r, docId,
            issueKey: issue.key, sku, description: desc, moq })}>Add to catalogue</button>
        </div>
      </div>
    );
  }
  return null;
}

function IssueCard({ issue, onAct, role, focused, onFocus, onRun, docId, line, currency, risk }: { issue: Issue; onAct?: Act;
  role: Role; focused: boolean; onFocus: () => void; onRun?: RunFn; docId: number; line?: Line; currency: string | null;
  risk?: ManualRisk }) {
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("");
  const [sku, setSku] = useState(issue.candidate_skus?.[0] ?? "");
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const resolved = issue.status === "resolved";
  const canAct = onAct && !resolved && role !== "viewer";
  async function run(action: string) {
    if (!onAct) return;
    setBusy(true);
    try {
      const params: Record<string, unknown> = {};
      if (action === "apply_mapping") params.save_for_future = save;
      if (action === "map_item") params.sku = sku;
      if (action === "change_quantity" || action === "correct_price") params.value = value;
      await onAct(issue, action, reason, params);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`issue ${resolved ? "resolved" : "open"} ${focused ? "focused" : ""}`} onClick={onFocus}
      aria-label={`${issue.title}, ${resolved ? "resolved" : "open"}`}>
      <header>
        <span className={`dot ${resolved ? "ok" : "warn"}`} aria-hidden />
        <h4>{issue.title}</h4>
        <span className={`pill ${resolved ? "ok" : "warn"}`}>{resolved ? "Resolved" : "Held"}</span>
      </header>
      <p>{issue.message}</p>
      <IssueRiskLine risk={risk} currency={currency ?? "USD"} />
      <dl>
        <div><dt>Printed on PO</dt><dd>{issue.printed_value ?? "—"}</dd></div>
        <div><dt>Reference</dt><dd>{issue.reference_value ?? "—"}{issue.reference_version && <small> ({issue.reference_version})</small>}</dd></div>
        <div><dt>Proposed action</dt><dd>{issue.proposed_action ?? "Reviewer decides"}</dd></div>
        <div><dt>Who decided</dt><dd>{issue.resolution
          ? <>{issue.resolution.actor.split(":")[1]} ({issue.resolution.role}): {ACTION_LABEL[issue.resolution.action] ?? issue.resolution.action}{issue.resolution.reason && <> — “{issue.resolution.reason}”</>}</>
          : "Not yet decided"}</dd></div>
      </dl>
      {canAct && onRun && (
        <div onClick={(e) => e.stopPropagation()}>
          <Onboard issue={issue} docId={docId} role={role} onRun={onRun} line={line} currency={currency} />
        </div>
      )}
      {canAct && (
        <div className="decide" onClick={(e) => e.stopPropagation()}>
          {issue.actions.some((a) => a === "change_quantity" || a === "correct_price") && (
            <input aria-label="New value" placeholder="New value" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
          {issue.actions.includes("map_item") && (
            <select aria-label="Product" value={sku} onChange={(e) => setSku(e.target.value)}>
              {issue.candidate_skus?.map((s) => <option key={s}>{s}</option>)}
            </select>
          )}
          {issue.actions.includes("apply_mapping") && (
            <label className="check"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Save for future matching orders (needs administrator activation)</label>
          )}
          <input aria-label="Reason" placeholder="Reason (recorded in the audit trail)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="btns">
            {issue.actions.map((a) => (
              <button key={a} disabled={busy} className={a === "reject_order" ? "ghost danger" : "primary"} onClick={() => run(a)}>
                {ACTION_LABEL[a] ?? a}
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export function OrderView({ d, role, onAct, onRun, onApprove, onRetry, highlight }: {
  d: DocDetail; role: Role; onAct?: Act; onRun?: RunFn; onApprove?: () => void; onRetry?: () => void; highlight?: string;
}) {
  const [focus, setFocus] = useState<Issue | null>(null);
  const o = d.order;
  const v = o?.validation.order;
  const issues = o?.validation.issues ?? [];
  const isAi = d.latest_version?.payload.extractor.is_ai;
  const lastDelivery = o?.deliveries.at(-1);
  const mr = useManualRoute(d.document.id);
  return (
    <div className={`order ${highlight ?? ""}`}>
      <div className="order-head">
        <div>
          <div className="eyebrow">{d.envelope.intake_mode === "demo_envelope_upload" && !d.envelope.sender ? `Uploaded purchase order · ${d.document.original_filename ?? "PDF"}` : `Purchase order from ${d.envelope.sender ?? "unknown sender"}`}</div>
          <h3>{v?.po_number ?? d.latest_version?.payload.header.po_number?.value ?? `Document #${d.document.id}`}
            {v?.customer_name && <span className="sub"> · {v.customer_name} ({v.customer_id ?? "unknown"})</span>}</h3>
        </div>
        <div className="pills">
          <Pill map={PROCESS_LABEL} value={d.document.status} prefix="Processing" />
          {o && <Pill map={REVIEW_LABEL} value={o.review_state} prefix="Approval" />}
          {o && <Pill map={DELIVERY_LABEL} value={o.delivery_state} prefix="ERP delivery" />}
        </div>
      </div>
      <Timeline d={d} />
      {d.latest_version && (
        <p className={`extractor ${isAi ? "ai" : "test"}`}>
          {isAi ? `Read by AI: ${d.latest_version.payload.extractor.name}. Every value is checked against the PDF text.`
            : `${d.latest_version.payload.extractor.name}. Rehearsal only; this is not AI extraction.`}
        </p>
      )}
      {d.document.status_detail && <div className={`alert ${d.document.status === "duplicate" ? "warn" : "bad"}`}>{d.document.status_detail}</div>}
      {IN_FLIGHT.has(d.document.status) && <div className="alert info pulse">The agent is working on this order…</div>}

      {o && <ManualRoutePanel docId={d.document.id} />}
      {o && (
        <div className="review-grid">
          <div>
            {issues.length > 0 ? (
              <section aria-label="Issues">
                <h4 className="section">{issues.filter((i) => i.status === "open").length} of {issues.length} issues need a decision</h4>
                {issues.map((i) => (
                  <IssueCard key={i.key} issue={i} role={role} onAct={onAct} focused={focus?.key === i.key} onFocus={() => setFocus(i)}
                    onRun={onRun} docId={d.document.id} currency={v?.currency ?? null}
                    risk={mr?.risks.find((r) => r.issueKey === i.key)}
                    line={i.line_index === null ? undefined : v?.lines[i.line_index]} />
                ))}
              </section>
            ) : (
              <div className="allclear">All business rules passed. No issues.</div>
            )}
            {o.review_state === "ready" && (
              <div className="approve">
                <p>Review-all mode: this clean order waits for a person. Approving it sends it to the ERP automatically.</p>
                {onApprove && role !== "viewer" && <button className="primary big" onClick={onApprove}>Approve order</button>}
              </div>
            )}
            <h4 className="section">Order lines</h4>
            <div className="scroll">
              <table className="lines">
                <thead><tr><th>Line</th><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {v?.lines.map((l) => {
                    const open = issues.some((i) => i.line_index === l.line_index && i.status === "open");
                    return (
                      <tr key={l.line_index}>
                        <td>{l.source_line_id}</td>
                        <td>{l.description}<div className="muted small">{l.sku ?? "unmatched"} · printed {l.printed_gtin ?? l.customer_item_code}{l.gtin && l.gtin !== l.printed_gtin ? ` → ${l.gtin}` : ""}</div></td>
                        <td>{l.quantity ?? l.original_quantity} {l.unit ?? l.original_unit}{l.original_unit && l.unit && l.original_unit !== l.unit && <div className="muted small">printed {l.original_quantity} {l.original_unit}</div>}</td>
                        <td>{l.unit_price ?? l.printed_unit_price}</td>
                        <td>{l.line_amount ?? l.printed_line_amount}</td>
                        <td>{l.resolved_by?.type === "memory_rule"
                          ? <span className="pill memory" title={l.resolved_by.text}>Fixed by memory</span>
                          : open ? <span className="pill warn">Held</span> : <span className="pill ok">OK</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {v?.lines.filter((l) => l.resolved_by).map((l) => (
              <p key={l.line_index} className={`provenance ${l.resolved_by!.type}`}>Line {l.source_line_id}: {l.resolved_by!.text}</p>
            ))}
            <div className="totals">
              <span>Printed total <b>{v?.totals.printed_total ?? "—"} {v?.currency}</b></span>
              <span>Calculated <b>{v?.totals.computed_total}</b></span>
              <span className="muted small">Decimal arithmetic, {v?.totals.rounding}</span>
            </div>
            {(o.erp_order_id || lastDelivery) && (
              <section className={`erp ${o.delivery_state}`} aria-label="ERP record">
                <div className="eyebrow">ERP simulator (local, not a live ERP)</div>
                {o.erp_order_id ? <h3>ERP order {o.erp_order_id}</h3> : <h3>{DELIVERY_LABEL[o.delivery_state]?.[0]}</h3>}
                <p className="muted small">Approved version {o.approvals.at(-1)?.version} by {o.approvals.at(-1)?.kind === "system" ? `system policy (${o.approvals.at(-1)?.policy_mode.replace("_", "-")})` : o.approvals.at(-1)?.actor.split(":")[1]}. Idempotency key {lastDelivery?.idempotency_key}.</p>
                <ul className="attempts">
                  {o.deliveries.map((a) => <li key={a.id}><span className={`pill ${DELIVERY_LABEL[a.state]?.[1]}`}>{DELIVERY_LABEL[a.state]?.[0]}</span> attempt {a.id}: {a.detail}</li>)}
                </ul>
                {["failed", "unknown"].includes(o.delivery_state) && onRetry && role !== "viewer" && (
                  <button className="primary" onClick={onRetry}>Check ERP and retry safely</button>
                )}
              </section>
            )}
            {o.delivery_state === "erp_created" && <OrderPortal docId={d.document.id} role={role} />}
          </div>
          <SourcePanel d={d} focus={focus} />
        </div>
      )}
    </div>
  );
}

export { PEOPLE };
