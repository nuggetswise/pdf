"use client";
// Supplier portal screens (D45): order confirmation, ASN and invoice on the order view, and the EDI tab.
// Everything here is simulated: the "Retailer EDI outbox" and the supplier ERP live in this browser tab.
import { useState } from "react";
import { FICTIONAL_GLN, FICTIONAL_LABEL } from "../lib/domain/edifact";
import { Dec, money } from "../lib/domain/money";
import { deliverySummary, outboundList, portalForOrder } from "../lib/domain/portal";
import { type OutboundMessage, decimalString } from "../lib/domain/run-state";
import { Role } from "./api";
import { useAgent } from "./run/RunProvider";

const KIND_LABEL: Record<OutboundMessage["kind"], string> = {
  ORDRSP: "Order confirmation (EDIFACT ORDRSP)", DESADV: "Shipping notice (EDIFACT DESADV)",
  INVOIC: "Invoice (EDIFACT INVOIC)", ERP_SHIPMENT: "Shipment record in supplier ERP", ERP_INVOICE: "Invoice record in supplier ERP",
};
const CHANNEL_LABEL = { retailer_edi_outbox: "Retailer EDI outbox (simulated)", supplier_erp: "Supplier ERP simulator" };
const STATUS_TONE = { delivered: "ok", pending: "warn", failed: "bad" } as const;

function useWrap() {
  const [error, setError] = useState<string | null>(null);
  const wrap = async (f: () => Promise<unknown>) => {
    try { await f(); setError(null); } catch (e) { setError((e as Error).message); }
  };
  return { error, wrap };
}

function MessageRow({ m, role }: { m: OutboundMessage; role: Role }) {
  const agent = useAgent();
  const { error, wrap } = useWrap();
  return (
    <li className={`outmsg ${m.status}`}>
      <span className={`pill ${STATUS_TONE[m.status]}`}>{m.status === "delivered" ? "Delivered" : m.status === "pending" ? "Pending" : "Failed"}</span>
      <span> {KIND_LABEL[m.kind]} → {CHANNEL_LABEL[m.channel]}{m.receiverRef ? ` as ${m.receiverRef}` : ""}</span>
      <div className="muted small">{m.attempts.at(-1)?.detail} · key <span className="mono">{m.idempotencyKey}</span></div>
      {m.status !== "delivered" && role !== "viewer" && (
        <button className="ghost" onClick={() => wrap(() => agent.run({ type: "retryOutbound", role, messageId: m.id }))}>
          Check receiver and retry safely
        </button>
      )}
      {error && <div className="alert bad" role="alert">{error}</div>}
    </li>
  );
}

/** Shown on a delivered order: the confirmation, then Create ASN, then Create invoice. */
export function OrderPortal({ docId, role }: { docId: number; role: Role }) {
  const agent = useAgent();
  const p = portalForOrder(agent.state, docId);
  const order = agent.state.orders.find((o) => o.documentId === docId);
  const [asnOpen, setAsnOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  if (!order) return null;
  return (
    <section className="portal" aria-label="Supplier portal">
      <div className="eyebrow">Supplier portal · simulated EDI, nothing is sent to a real retailer</div>
      {p.confirmation && (
        <div className="flow" aria-label="Order confirmation">
          <h4>Order confirmation sent to retailer</h4>
          <ul className="outlist"><MessageRow m={p.confirmation} role={role} /></ul>
        </div>
      )}
      <div className="flow" aria-label="Shipping notice">
        <h4>Shipping notice (ASN){p.asn && `: ${p.asn.asnNumber}`}</h4>
        {p.asn ? (
          <>
            <p className="flowstate"><b>{deliverySummary(p.asnMessages)}</b></p>
            <ul className="outlist">{p.asnMessages.map((m) => <MessageRow key={m.id} m={m} role={role} />)}</ul>
          </>
        ) : asnOpen ? (
          <AsnForm docId={docId} role={role} onDone={() => setAsnOpen(false)} />
        ) : role !== "viewer" ? (
          <button className="primary" onClick={() => setAsnOpen(true)}>Create ASN</button>
        ) : <p className="muted small">No ASN yet.</p>}
      </div>
      {p.asn && (
        <div className="flow" aria-label="Invoice">
          <h4>Invoice{p.invoice && `: ${p.invoice.invoiceNumber}`}</h4>
          {p.invoice ? (
            <>
              <p className="flowstate"><b>{deliverySummary(p.invoiceMessages)}</b> · total <b>{p.invoice.total} {p.invoice.currency}</b></p>
              <ul className="outlist">{p.invoiceMessages.map((m) => <MessageRow key={m.id} m={m} role={role} />)}</ul>
            </>
          ) : invOpen ? (
            <InvoiceForm docId={docId} role={role} onDone={() => setInvOpen(false)} />
          ) : role !== "viewer" ? (
            <button className="primary" onClick={() => setInvOpen(true)}>Create invoice</button>
          ) : <p className="muted small">No invoice yet.</p>}
        </div>
      )}
    </section>
  );
}

function AsnForm({ docId, role, onDone }: { docId: number; role: Role; onDone: () => void }) {
  const agent = useAgent();
  const order = agent.state.orders.find((o) => o.documentId === docId)!;
  const lines = order.validation.order.lines;
  const [qty, setQty] = useState<Record<number, string>>(Object.fromEntries(lines.map((l) => [l.line_index, l.quantity ?? "0"])));
  const [why, setWhy] = useState<Record<number, string>>({});
  const { error, wrap } = useWrap();
  const over = (i: number, ordered: string | null) =>
    decimalString.safeParse(qty[i]).success && ordered !== null && Dec.of(ordered).lt(Dec.of(qty[i]));
  const blocked = lines.some((l) => over(l.line_index, l.quantity) && !why[l.line_index]?.trim());
  return (
    <form className="portal-form" onSubmit={(e) => {
      e.preventDefault();
      void wrap(async () => {
        await agent.run({ type: "submitAsn", role, docId, lines: lines.map((l) => ({ lineIndex: l.line_index,
          shippedQty: qty[l.line_index].trim(), overrideReason: why[l.line_index]?.trim() || null })) });
        onDone();
      });
    }}>
      <p className="muted small">Enter what actually ships. It starts at the ordered quantity. Shipping more than ordered needs a reason.</p>
      <table className="lines">
        <thead><tr><th>Line</th><th>Item</th><th>Ordered</th><th>Shipped</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.line_index}>
              <td>{l.source_line_id}</td>
              <td>{l.description}<div className="muted small">{l.sku}</div></td>
              <td>{l.quantity} {l.unit}</td>
              <td>
                <input className="qty" inputMode="decimal" aria-label={`Shipped quantity line ${l.source_line_id}`}
                  value={qty[l.line_index]} onChange={(e) => setQty({ ...qty, [l.line_index]: e.target.value })} />
                {over(l.line_index, l.quantity) && (
                  <input aria-label={`Override reason line ${l.source_line_id}`} placeholder="Reason for shipping more than ordered"
                    value={why[l.line_index] ?? ""} onChange={(e) => setWhy({ ...why, [l.line_index]: e.target.value })} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {blocked && <div className="alert warn" role="status">A line ships more than ordered. Give a reason, or lower the quantity.</div>}
      {error && <div className="alert bad" role="alert">{error}</div>}
      <div className="btns">
        <button className="primary" type="submit" disabled={blocked}>Submit ASN</button>
        <button className="ghost" type="button" onClick={onDone}>Cancel</button>
      </div>
      <p className="muted small">Submit sends the shipping notice to the retailer EDI outbox and records the shipment in the ERP simulator. No second step.</p>
    </form>
  );
}

function InvoiceForm({ docId, role, onDone }: { docId: number; role: Role; onDone: () => void }) {
  const agent = useAgent();
  const p = portalForOrder(agent.state, docId);
  const order = agent.state.orders.find((o) => o.documentId === docId)!;
  const { error, wrap } = useWrap();
  const asn = p.asn!;
  const rows = asn.lines.filter((l) => !Dec.of(l.shippedQty).isZero()).map((l) => {
    const price = order.validation.order.lines.find((x) => x.line_index === l.lineIndex)?.unit_price ?? null;
    return { ...l, price, amount: price ? money(Dec.of(l.shippedQty).mul(Dec.of(price))) : null };
  });
  const total = money(rows.reduce((t, r) => (r.amount ? t.add(Dec.of(r.amount)) : t), Dec.ZERO));
  return (
    <form className="portal-form" onSubmit={(e) => {
      e.preventDefault();
      void wrap(async () => {
        await agent.run({ type: "submitInvoice", role, asnId: asn.id,
          lines: rows.map((r) => ({ lineIndex: r.lineIndex, quantity: r.shippedQty })) });
        onDone();
      });
    }}>
      <p className="muted small">Quantities come from {asn.asnNumber} (what shipped), prices from the order. Decimal arithmetic, rounded half-up to cents. Tax is not calculated by the simulator.</p>
      <table className="lines">
        <thead><tr><th>Line</th><th>Item</th><th>Ordered</th><th>Invoiced (shipped)</th><th>Price</th><th>Amount</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lineIndex}>
              <td>{r.sourceLineId}</td><td>{r.description}</td><td>{r.orderedQty}</td>
              <td><b>{r.shippedQty}</b> {r.unit}</td><td>{r.price}</td><td>{r.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totals"><span>Invoice total <b className="invtotal">{total} {order.validation.order.currency}</b></span></div>
      {error && <div className="alert bad" role="alert">{error}</div>}
      <div className="btns">
        <button className="primary" type="submit">Submit invoice</button>
        <button className="ghost" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

/** The EDI tab: every outbound message, raw EDIFACT, what each segment means, and a download. */
export function EdiView({ role }: { role: Role }) {
  const agent = useAgent();
  const msgs = agent.ready ? outboundList(agent.state) : [];
  const [open, setOpen] = useState<number | null>(null);
  const { error, wrap } = useWrap();
  const download = (m: OutboundMessage) => {
    const blob = new Blob([m.body], { type: m.format === "edifact" ? "application/edifact" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${m.kind}-${m.sourceId}.${m.format === "edifact" ? "edi" : "json"}`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="edi-list" aria-label="Outbound messages">
      <div className="eyebrow">Simulated EDI and ERP messages · held in this browser tab · nothing is sent anywhere real</div>
      <h3>{msgs.length} outbound message{msgs.length === 1 ? "" : "s"}</h3>
      <p className="muted small">{FICTIONAL_LABEL}: supplier {FICTIONAL_GLN.supplier}, retailer {FICTIONAL_GLN.retailer}. Fictional test data only.</p>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {msgs.length === 0 && <p className="placeholder">Nothing yet. A delivered order sends an order confirmation; ASNs and invoices add more.</p>}
      {msgs.map((m) => (
        <article key={m.id} className={`edi-card ${m.status}`} data-kind={m.kind}>
          <header>
            <h4>{KIND_LABEL[m.kind]} · {m.sourceId}</h4>
            <span className={`pill ${STATUS_TONE[m.status]}`}>{m.status}</span>
          </header>
          <p className="muted small">To {CHANNEL_LABEL[m.channel]}{m.receiverRef ? ` as ${m.receiverRef}` : ""} · order #{m.documentId} · key <span className="mono">{m.idempotencyKey}</span></p>
          <ul className="attempts">{m.attempts.map((a, i) => <li key={i}>{a.outcome}: {a.detail}</li>)}</ul>
          <div className="btns">
            <button className="ghost" onClick={() => setOpen(open === m.id ? null : m.id)}>{open === m.id ? "Hide" : "Show"} message</button>
            <button className="ghost" onClick={() => download(m)}>Download</button>
            {m.status !== "delivered" && role !== "viewer" && (
              <button className="primary" onClick={() => wrap(() => agent.run({ type: "retryOutbound", role, messageId: m.id }))}>Retry safely</button>
            )}
          </div>
          {open === m.id && (
            <div className="edi-body">
              <pre className="raw" aria-label="Raw message">{m.body}</pre>
              <table className="lines mapping" aria-label="Field mapping">
                <thead><tr><th>Segment</th><th>What it says</th></tr></thead>
                <tbody>{m.mapping.map((x, i) => <tr key={i}><td className="mono">{x.segment}</td><td>{x.meaning}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

/** Administrator demo control for the simulated retailer outbox. */
export function EdiSetting({ onError }: { onError: (e: string | null) => void }) {
  const agent = useAgent();
  return (
    <label>Retailer EDI outbox next message
      <select value={agent.state.portal?.ediFailureMode ?? "none"} onChange={(e) => {
        agent.run({ type: "setEdiFailureMode", role: "administrator", value: e.target.value as "none" })
          .then(() => onError(null), (err: Error) => onError(err.message));
      }}>
        <option value="none">Accepted</option><option value="hold_next">Stays pending</option><option value="fail_next">Fails</option>
      </select>
    </label>
  );
}
