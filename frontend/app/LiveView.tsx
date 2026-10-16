"use client";
// D54: the two sides of the story on one screen. Left: the supplier keeps working by email (forward the PO,
// decide the odd exception, reply in plain words, mark it shipped in their ERP). Right: the retailer receives
// standard EDI as each of those happens. Nothing here is a script; every card is read from the run's state.
import { useState } from "react";
import { SAMPLE_LABELS } from "../lib/intake/intake";
import { openQuantities, portalForOrder, repliesFor } from "../lib/domain/portal";
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

export function LiveView({ role, onOpen }: { role: Role; onOpen: (docId: number) => void }) {
  const agent = useAgent();
  const s = agent.ready ? agent.state : null;
  const docs = s ? [...s.documents].sort((a, b) => b.id - a.id) : [];
  const toRetailer = s ? [...(s.portal?.outbound ?? [])].filter((m) => m.channel === "retailer_edi_outbox").sort((a, b) => b.id - a.id) : [];
  const toErp = s ? (s.portal?.outbound ?? []).filter((m) => m.channel === "supplier_erp").length + s.orders.filter((o) => o.erpOrderId).length : 0;
  return (
    <div className="live">
      <p className="story">The supplier keeps working by email. The retailer receives EDI in its system. Nobody retypes anything.</p>
      <div className="split">
        <section className="side supplier" aria-label="Supplier's side">
          <header><div className="eyebrow">Supplier · email and their own ERP, as today</div><h3>Supplier's inbox</h3></header>
          <Forward />
          {docs.length === 0 && <p className="placeholder">Forward a purchase order to begin. The agent reads it, checks it and puts it in the supplier's ERP.</p>}
          {s && docs.map((d) => <SupplierCard key={d.id} s={s} docId={d.id} role={role} onOpen={onOpen} />)}
          {toErp > 0 && <p className="muted small erp-note">{toErp} update{toErp === 1 ? "" : "s"} written to the supplier's ERP (simulated). See ERP records.</p>}
        </section>
        <section className="side retailer" aria-label="Retailer's side">
          <header><div className="eyebrow">Retailer · receives standard X12 EDI, as from any connected supplier</div><h3>Retailer's EDI inbox</h3></header>
          {toRetailer.length === 0 && <p className="placeholder">Nothing received yet. When the supplier's order is in their ERP, the retailer gets an acknowledgement here.</p>}
          {toRetailer.map((m) => <RetailerCard key={m.id} m={m} s={s!} />)}
          <p className="path">Path into Trading Grid: once a supplier runs clean through the agent, the retailer can invite them onto full EDI with this history already in place.</p>
        </section>
      </div>
    </div>
  );
}

function Forward() {
  const agent = useAgent();
  const [pick, setPick] = useState<string>(DEMO_EMAILS[0]);
  const { error, wrap } = useWrap();
  const add = (f: File) => wrap(async () => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name) || new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
    await (isPdf ? agent.uploadPdf(bytes, f.name) : agent.importEml(bytes));
  });
  return (
    <div className="forward-box">
      <label className="dropzone small-drop">
        <input type="file" accept=".pdf,application/pdf,.eml,message/rfc822" aria-label="Forward a purchase order"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) add(f); }} />
        <b>Forward a purchase order</b>
        <span className="muted small">The retailer's email (.eml) or its PDF. In production the supplier just forwards it to their agent address.</span>
      </label>
      <div className="forward">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Sample purchase order">
          {DEMO_EMAILS.map((n) => <option key={n} value={n}>{SAMPLE_LABELS[n]}</option>)}
        </select>
        <button onClick={() => wrap(() => agent.forwardDemo(pick))}>Forward sample</button>
      </div>
      {error && <div className="alert bad" role="alert">{error}</div>}
    </div>
  );
}

function SupplierCard({ s, docId, role, onOpen }: { s: RunState; docId: number; role: Role; onOpen: (id: number) => void }) {
  const agent = useAgent();
  const { error, wrap } = useWrap();
  const d = s.documents.find((x) => x.id === docId)!;
  const o = s.orders.find((x) => x.documentId === docId);
  const po = o?.validation.order.po_number ?? d.originalFilename ?? `Document ${docId}`;
  const open = o ? o.validation.issues.filter((i) => i.status === "open").length : 0;
  const p = o ? portalForOrder(s, docId) : null;
  const left = o?.erpOrderId ? [...openQuantities(s, docId).values()].some((q) => !q.isZero()) : false;
  const replied = repliesFor(s, docId).length > 0;
  let state: string;
  let tone = "info";
  if (IN_FLIGHT.has(d.status)) state = "The agent is reading it…";
  else if (!o) { state = d.statusDetail ?? "Could not be read"; tone = "bad"; }
  else if (o.deliveryState === "erp_created") { state = `In your ERP as ${o.erpOrderId}. Acknowledged to the retailer.`; tone = "ok"; }
  else if (open > 0) { state = `Needs your decision on ${open} thing${open === 1 ? "" : "s"}. The agent holds it until then.`; tone = "warn"; }
  else if (o.reviewState === "ready") { state = "Checked, waiting for one approval."; tone = "warn"; }
  else state = "Checked.";
  return (
    <article className={`scard ${tone}`} aria-label={`Order ${po}`}>
      <header>
        <h4>{po}<span className="sub"> · {o?.validation.order.customer_name ?? "unknown customer"}</span></h4>
        <button className="ghost" onClick={() => onOpen(docId)}>Open order</button>
      </header>
      <p className="state">{state}</p>
      {o?.erpOrderId && !p?.asn && !replied && <ReplyBox o={o} role={role} />}
      {replied && !p?.asn && <p className="muted small">Your reply was confirmed to the retailer.</p>}
      {o?.erpOrderId && left && role !== "viewer" && (
        <div className="btns">
          <button className="primary" onClick={() => wrap(() => agent.run({ type: "shipFromErp", role, docId }))}>Mark shipped in ERP</button>
          <span className="muted small">The agent sends the ship notice and the invoice from what shipped.</span>
        </div>
      )}
      {p?.shipments.map((x) => (
        <p key={x.asn.id} className="muted small">Shipped {x.asn.lines.filter((l) => !l.shippedQty.startsWith("0")).length} line(s) on {x.asn.despatchDate}: {x.asn.asnNumber}{x.invoice ? ` and invoice ${x.invoice.invoiceNumber}` : ""} sent to the retailer. You typed nothing.</p>
      ))}
      {error && <div className="alert bad" role="alert">{error}</div>}
    </article>
  );
}

const poLines = (o: Order): ReplyPoLine[] => o.validation.order.lines.map((l) => ({ sourceLineId: l.source_line_id,
  description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unit_price }));

/** A believable first draft so the demo has something to read; the user can type anything instead. */
function sampleReply(o: Order): string {
  const [a, b] = o.validation.order.lines;
  const changes: string[] = [];
  if (a?.quantity && Number(a.quantity) > 1) changes.push(`we can only do ${Number(a.quantity) - 1} not ${a.quantity} on line ${a.source_line_id}`);
  if (b?.unit_price) changes.push(`line ${b.source_line_id} price is now ${(Number(b.unit_price) + 1.5).toFixed(2)} a case`);
  return `Hi, thanks for the PO. ${changes.length ? `Heads up: ${changes.join(", and ")}. ` : ""}Ships Monday.`;
}

function ReplyBox({ o, role }: { o: Order; role: Role }) {
  const agent = useAgent();
  const [text, setText] = useState(() => sampleReply(o));
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
  return (
    <div className="reply" aria-label="Reply to the retailer">
      <label>Reply to the retailer, in your own words
        <textarea rows={3} value={text} aria-label="Supplier's reply" onChange={(e) => { setText(e.target.value); setInterp(null); }} />
      </label>
      <div className="btns"><button onClick={read} disabled={busy || !text.trim()}>{busy ? "Reading…" : "Read reply"}</button>
        <span className="muted small">Only the changes are taken; a clean order needs no reply.</span></div>
      {interp && (
        <div className="reply-read" aria-label="What the agent understood">
          <p className="muted small">{interp.interpreter.isAi ? `Read by AI (${interp.interpreter.name}).` : `${interp.interpreter.name}.`} Each change is tied to the words it came from.</p>
          {rows.length === 0 ? <p>No changes found. The order stands as acknowledged.</p> : (
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

function RetailerCard({ m, s }: { m: OutboundMessage; s: RunState }) {
  const [open, setOpen] = useState(false);
  const o = s.orders.find((x) => x.documentId === m.documentId);
  const changes = m.mapping.filter((x) => /changed|will ship/i.test(x.meaning)).map((x) => x.meaning);
  return (
    <article className={`rcard ${m.status}`} data-kind={m.kind}>
      <header>
        <h4>{DOC_NAME[m.kind] ?? m.kind}{m.format === "x12" ? ` (X12 ${X12_NO[m.kind]})` : ""}</h4>
        <span className={`pill ${STATUS_TONE[m.status]}`}>{m.status === "delivered" ? "received" : m.status}</span>
      </header>
      <p className="small">PO {o?.validation.order.po_number ?? "?"} · {m.sourceId}</p>
      {changes.length > 0 && <ul className="changes">{changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      <button className="ghost" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} EDI</button>
      {open && <pre className="raw">{m.body}</pre>}
    </article>
  );
}
