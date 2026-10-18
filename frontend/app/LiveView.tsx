"use client";
// D54: the supplier and retailer sides. The supplier home is Order operations (D71); this file keeps the forward box,
// the forwarded-order state line, the plain-language reply and the retailer's view of the standard EDI it receives.
// Nothing here is a script; every card is read from the run's state.
import { useState } from "react";
import { FileCheck2, Mail, Network, Receipt, Truck } from "lucide-react";
import { SAMPLE_LABELS, SAMPLE_SENDERS } from "../lib/intake/intake";
import { portalForOrder } from "../lib/domain/portal";
import { showDate } from "../lib/domain/dates";
import { firstShipOn } from "../lib/domain/fulfilment";
import { partsText } from "./Fulfilment";
import { type ReplyPoLine, type SupplierReplyInterpretation, replyRows } from "../lib/domain/reply";
import type { OutboundMessage, RunState } from "../lib/domain/run-state";
import { IN_FLIGHT, type Role } from "./api";
import { DEMO_EMAILS, useAgent } from "./run/RunProvider";

type Order = RunState["orders"][number];
const STATUS_TONE = { delivered: "ok", pending: "warn", failed: "bad" } as const;
const DOC_NAME: Record<string, string> = { ORDRSP: "Order acknowledgement", DESADV: "Advance ship notice", INVOIC: "Invoice" };
const X12_NO: Record<string, string> = { ORDRSP: "855", DESADV: "856", INVOIC: "810" };

function useWrap() {
  const [error, setError] = useState<string | null>(null);
  const wrap = async (f: () => Promise<unknown>) => {
    try { await f(); setError(null); } catch (e) { setError((e as Error).message); }
  };
  return { error, wrap };
}

/** Retailer view: standard EDI arriving from a supplier who never left email. */
/** D66: a retailer sees only documents for its own orders. */
const forRetailer = (s: RunState, customerId: string | null) => (m: { documentId: number }) =>
  s.orders.find((o) => o.documentId === m.documentId)?.customerId === customerId;

export function RetailerInbox({ customerId }: { customerId: string | null }) {
  const agent = useAgent();
  const s = agent.ready ? agent.state : null;
  const msgs = s ? [...(s.portal?.outbound ?? [])].filter((m) => m.channel === "retailer_edi_outbox").filter(forRetailer(s, customerId)).sort((a, b) => b.id - a.id) : [];
  return (
    <section className="panel" aria-label="Documents received">
      <header className="panel-head"><h3>Documents received</h3><span className="count">{msgs.length}</span></header>
      {msgs.length === 0 && <p className="empty">No documents received.</p>}
      <div className="rlist">{msgs.map((m) => <RetailerCard key={m.id} m={m} s={s!} />)}</div>
    </section>
  );
}

export function RetailerSuppliers({ customerId }: { customerId: string | null }) {
  const agent = useAgent();
  const s = agent.ready ? agent.state : null;
  const msgs = s ? (s.portal?.outbound ?? []).filter((m) => m.channel === "retailer_edi_outbox").filter(forRetailer(s, customerId)) : [];
  const orders = s?.orders ?? [];
  const untouched = orders.filter((o) => o.deliveryState === "erp_created" && o.validation.issues.length === 0).length;
  const supplier = s?.portal?.supplier?.name ?? "Fictional demo supplier";
  return (
    <section className="panel" aria-label="Suppliers">
      <header className="panel-head"><h3>Suppliers</h3></header>
      <table className="grid-table stack-table">
        <thead><tr><th>Supplier</th><th>How they connect</th><th>Orders</th><th>Documents received</th><th>Went through untouched</th><th></th></tr></thead>
        <tbody>
          <tr>
            <td data-label="Supplier"><b>{supplier}</b><div className="muted small">Fictional</div></td>
            <td data-label="How they connect"><span className="pill info"><Mail size={14} aria-hidden /> Email, via Order Agent</span></td>
            <td data-label="Orders">{orders.length}</td><td data-label="Documents received">{msgs.length}</td>
            <td data-label="Went through untouched">{orders.length ? `${untouched} of ${orders.length}` : "–"}</td>
            <td data-label="Onboarding" className="muted small">Onboarding is outside this concept</td>
          </tr>
        </tbody>
      </table>
      <p className="path"><Network size={16} aria-hidden /> Once a supplier runs clean through the agent, invite them onto full Trading Grid EDI with this history already in place.</p>
    </section>
  );
}

export function Forward() {
  const agent = useAgent();
  const { error, wrap } = useWrap();
  const add = (f: File) => wrap(async () => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name) || new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
    await (isPdf ? agent.uploadPdf(bytes, f.name) : agent.importEml(bytes));
  });
  // D74: five fictional emails in story order. Each one is read by the same path as any forwarded order.
  const forwarded = (name: string) => agent.ready && agent.state.envelopes.some((e) => e.messageId?.startsWith(`<${name.toLowerCase()}@`));
  return (
    <div className="forward-box">
      <p className="how">Retailers email PDF purchase orders as they do today. Forward each one to
        <b> order-agent@supplier-demo.example</b>, or drop the email or PDF here.</p>
      <ol className="inbox-list" aria-label="Supplier inbox">
        {DEMO_EMAILS.map((name) => (
          <li key={name} className="forward mailrow">
            <Mail size={18} aria-hidden />
            <div><b>{SAMPLE_LABELS[name]}</b><div className="muted small">From {SAMPLE_SENDERS[name]} · fictional</div></div>
            {forwarded(name) ? <span className="pill ok">Forwarded</span>
              : <button aria-label={`Forward ${SAMPLE_LABELS[name]}`} onClick={() => wrap(() => agent.forwardDemo(name))}>Forward to agent</button>}
          </li>
        ))}
      </ol>
      <label className="dropzone small-drop">
        <input type="file" accept=".pdf,application/pdf,.eml,message/rfc822" aria-label="Forward a purchase order"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) add(f); }} />
        <b>Or drop a retailer email (.eml) or PDF</b>
      </label>
      {error && <div className="alert bad" role="alert">{error}</div>}
    </div>
  );
}

/** What a forwarded order's state means for the supplier, in one sentence, plus what was shipped. */
export function supplierState(s: RunState, docId: number): { text: string; tone: string; shipments: string[] } {
  const d = s.documents.find((x) => x.id === docId)!;
  const o = s.orders.find((x) => x.documentId === docId);
  const open = o ? o.validation.issues.filter((i) => i.status === "open").length : 0;
  const p = o ? portalForOrder(s, docId) : null;
  const f = o?.fulfilment;
  let text: string;
  let tone = "info";
  if (IN_FLIGHT.has(d.status)) text = "The agent is reading it…";
  else if (!o) { text = d.statusDetail ?? "Could not be read"; tone = "bad"; }
  else if (f?.status === "needs_decision") {
    const n = f.lines.filter((l) => l.short !== "0").length;
    text = `In your ERP as ${o.erpOrderId}. Stock is short on ${n} line${n === 1 ? "" : "s"}: choose how to ship before the retailer is told.`; tone = "warn";
  } else if (o.deliveryState === "erp_created") {
    const back = f?.parts.some((x) => x.kind === "backorder");
    text = `In your ERP as ${o.erpOrderId}. Confirmed to the retailer${f ? `: ships ${showDate(firstShipOn(f.parts))}${back ? ", rest backordered" : ""}` : ""}.`; tone = "ok";
  }
  else if (open > 0) { text = `Needs your decision on ${open} thing${open === 1 ? "" : "s"}. The agent holds it until then.`; tone = "warn"; }
  else if (o.reviewState === "ready") { text = "Checked, waiting for one approval."; tone = "warn"; }
  else text = "Checked.";
  const shipments = (p?.shipments ?? []).map((x) => `Shipped ${x.asn.lines.filter((l) => !l.shippedQty.startsWith("0")).length} line(s) on ${x.asn.despatchDate}: ${x.asn.asnNumber}${x.invoice ? ` and invoice ${x.invoice.invoiceNumber}` : ""} sent to the retailer.`);
  return { text, tone, shipments };
}

const poLines = (o: Order): ReplyPoLine[] => o.validation.order.lines.map((l) => ({ sourceLineId: l.source_line_id,
  description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unit_price }));

export function ReplyBox({ o, role }: { o: Order; role: Role }) {
  const agent = useAgent();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [interp, setInterp] = useState<SupplierReplyInterpretation | null>(null);
  const { error, wrap } = useWrap();
  if (role === "viewer") return null;
  const lines = poLines(o);
  const read = () => wrap(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/reply", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lines, today: new Date().toISOString().slice(0, 10), rehearsal: agent.state.settings.rehearsalMode }) });
      const j = await r.json() as { ok: boolean; interpretation?: SupplierReplyInterpretation; detail?: string };
      if (!j.ok || !j.interpretation) throw new Error(j.detail ?? "The reply could not be read");
      setInterp(j.interpretation);
    } finally { setBusy(false); }
  });
  const rows = interp ? replyRows(interp, lines) : [];
  const l0 = o.validation.order.lines[0];
  const example = `Example: We can ship ${l0?.quantity ? Math.max(1, Math.floor(Number(l0.quantity) / 2)) : 50} of line ${l0?.source_line_id ?? 1} on Friday. The rest ships in two weeks.`;
  return (
    <div className="reply" aria-label="Reply to the retailer">
      <label>Reply to the retailer, in your own words
        <textarea rows={3} value={text} aria-label="Supplier's reply" placeholder="Enter your reply to the buyer." onChange={(e) => { setText(e.target.value); setInterp(null); }} />
      </label>
      <div className="btns"><button onClick={read} disabled={busy || !text.trim()}>{busy ? "Reading…" : "Read reply"}</button>
        <button type="button" className="ghost" onClick={() => { setText(example.replace(/^Example: /, "")); setInterp(null); }}>Use example</button>
        <span className="muted small">Only changes to quantity, price or date are applied.</span></div>
      <p className="muted small" aria-label="Reply example">{example}</p>
      {interp && (
        <div className="reply-read" aria-label="What the agent understood">
          <p className="muted small">{interp.interpreter.isAi ? `Read by AI (${interp.interpreter.name}).` : `${interp.interpreter.name}.`} Each change is tied to the words it came from.</p>
          {rows.length === 0 ? <p>No changes found.</p> : (
            <table className="lines"><tbody>
              {rows.map((r, i) => <tr key={i}><th>{r.label}</th><td>{r.from} → <b>{r.to}</b></td><td className="mono small">“{r.evidence}”</td></tr>)}
            </tbody></table>
          )}
          {interp.unclear.map((u, i) => <p key={i} className="alert warn">{u}</p>)}
          {rows.length > 0 && <button className="primary" onClick={() => wrap(() => agent.run({ type: "applySupplierReply", role, docId: o.documentId, text, interpretation: interp }))}>Confirm changes to the retailer</button>}
        </div>
      )}
      {error && <div className="alert bad" role="alert">{error}</div>}
    </div>
  );
}

const KIND_ICON = { ORDRSP: FileCheck2, DESADV: Truck, INVOIC: Receipt } as const;

function RetailerCard({ m, s }: { m: OutboundMessage; s: RunState }) {
  const [open, setOpen] = useState(false);
  const o = s.orders.find((x) => x.documentId === m.documentId);
  const changed = m.mapping.some((x) => /changed|backordered|will not ship/i.test(x.meaning));
  // The plain-language reading of the document the retailer's system would show: line, quantity and total rows.
  // An acknowledgement built from the stock plan reads as each line's ship and backorder dates, not codes.
  const plan = m.kind === "ORDRSP" && o?.fulfilment?.status === "confirmed" && m.idempotencyKey === `ORDRSP:${o.erpOrderId}` ? o.fulfilment.parts : null;
  const facts = plan ? o!.validation.order.lines.map((l) => `${l.description ?? l.sku}: ${partsText(plan, l.line_index)}`)
    : m.mapping.map((x) => x.meaning).filter((t) => /^(Confirmed|Supplier will ship|Line \d|Ship(ped)? date|Estimated delivery|Total|Invoice total|Carrier)/.test(t)).slice(0, 6);
  const Icon = KIND_ICON[m.kind as keyof typeof KIND_ICON] ?? FileCheck2;
  return (
    <article className={`rcard ${m.status} ${changed ? "changed" : ""}`} data-kind={m.kind}>
      <header>
        <div className="rhead"><span className="ricon" aria-hidden><Icon size={18} /></span>
          <div><h4>{DOC_NAME[m.kind] ?? m.kind}{m.format === "x12" ? ` (X12 ${X12_NO[m.kind]})` : ""}</h4>
            <p className="small muted">PO {o?.validation.order.po_number ?? "?"} · {m.sourceId} · from the supplier's email, via Order Agent</p></div></div>
        <div className="rbadges">{changed && <span className="pill warn">Changes</span>}
          <span className={`pill ${STATUS_TONE[m.status]}`}>{m.status === "delivered" ? "received" : m.status}</span></div>
      </header>
      {facts.length > 0 && <ul className="changes">{facts.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      <button className="ghost" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} EDI</button>
      {open && <pre className="raw">{m.body}</pre>}
    </article>
  );
}
