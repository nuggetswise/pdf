"use client";
// D54: the two sides of the story on one screen. Left: the supplier keeps working by email (forward the PO,
// decide the odd exception, reply in plain words, mark it shipped in their ERP). Right: the retailer receives
// standard EDI as each of those happens. Nothing here is a script; every card is read from the run's state.
import { useState } from "react";
import { ArrowRight, CheckCircle2, FileCheck2, Mail, Network, Receipt, ScanText, ShieldCheck, Truck } from "lucide-react";
import { SAMPLE_LABELS, SAMPLE_SENDERS } from "../lib/intake/intake";
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

/** Supplier home: what needs a person now, then everything the agent handled on its own. */
export function SupplierToday({ role, onOpen }: { role: Role; onOpen: (docId: number) => void }) {
  const agent = useAgent();
  const s = agent.ready ? agent.state : null;
  const docs = s ? [...s.documents].sort((a, b) => b.id - a.id) : [];
  const needs = s ? docs.filter((d) => {
    const o = s.orders.find((x) => x.documentId === d.id);
    return !IN_FLIGHT.has(d.status) && (!o || (o.deliveryState !== "erp_created" && (o.validation.issues.some((i) => i.status === "open") || o.reviewState === "ready")));
  }) : [];
  const rest = docs.filter((d) => !needs.includes(d));
  const inErp = s ? s.orders.filter((o) => o.erpOrderId).length : 0;
  const sent = s ? (s.portal?.outbound ?? []).filter((m) => m.channel === "retailer_edi_outbox" && m.status === "delivered").length : 0;
  const caught = s ? s.orders.reduce((t, o) => t + o.validation.issues.length, 0) : 0;
  const steps: [typeof Mail, string, string][] = [
    [Mail, "Forwarded", `${docs.length} purchase order${docs.length === 1 ? "" : "s"}`],
    [ScanText, "Read by the agent", "every value tied to the PDF"],
    [ShieldCheck, "Checked", `${caught} problem${caught === 1 ? "" : "s"} caught`],
    [CheckCircle2, "In your ERP", `${inErp} order${inErp === 1 ? "" : "s"}`],
    [FileCheck2, "Sent to the retailer", `${sent} EDI document${sent === 1 ? "" : "s"}`],
  ];
  return (
    <div className="today">
      <ol className="flowbar" aria-label="How orders flow">
        {steps.map(([I, t, d], i) => (
          <li key={t}><span className="fi" aria-hidden><I size={18} /></span><div><b>{t}</b><span>{d}</span></div>
            {i < steps.length - 1 && <ArrowRight className="farrow" size={16} aria-hidden />}</li>
        ))}
      </ol>
      <div className="today-grid">
        <section className="panel" aria-label="Needs you">
          <header className="panel-head"><h3>Needs you</h3><span className="count">{needs.length}</span></header>
          {needs.length === 0 && <p className="empty"><CheckCircle2 size={18} aria-hidden /> Nothing waiting. The agent is handling every order.</p>}
          {s && needs.map((d) => <SupplierCard key={d.id} s={s} docId={d.id} role={role} onOpen={onOpen} />)}
        </section>
        <section className="panel forward-panel" aria-label="Forward a purchase order">
          <header className="panel-head"><h3>New purchase order</h3></header>
          <Forward />
          <p className="muted small">In production, the supplier's mailbox forwards retailer POs here automatically.</p>
        </section>
      </div>
      <section className="panel" aria-label="Handled by the agent">
        <header className="panel-head"><h3>Handled by the agent</h3><span className="count muted">{rest.length}</span></header>
        {rest.length === 0 && <p className="empty">Orders the agent read, checked and put in your ERP appear here.</p>}
        {s && rest.map((d) => <SupplierCard key={d.id} s={s} docId={d.id} role={role} onOpen={onOpen} />)}
      </section>
    </div>
  );
}

/** Retailer view: standard EDI arriving from a supplier who never left email. */
export function RetailerInbox() {
  const agent = useAgent();
  const s = agent.ready ? agent.state : null;
  const msgs = s ? [...(s.portal?.outbound ?? [])].filter((m) => m.channel === "retailer_edi_outbox").sort((a, b) => b.id - a.id) : [];
  return (
    <section className="panel" aria-label="Documents received">
      <header className="panel-head"><h3>Documents received</h3><span className="count">{msgs.length}</span></header>
      {msgs.length === 0 && <p className="empty">Nothing received yet. Switch to the supplier view and forward a purchase order.</p>}
      <div className="rlist">{msgs.map((m) => <RetailerCard key={m.id} m={m} s={s!} />)}</div>
    </section>
  );
}

export function RetailerSuppliers() {
  const agent = useAgent();
  const s = agent.ready ? agent.state : null;
  const msgs = (s?.portal?.outbound ?? []).filter((m) => m.channel === "retailer_edi_outbox");
  const orders = s?.orders ?? [];
  const untouched = orders.filter((o) => o.deliveryState === "erp_created" && o.validation.issues.length === 0).length;
  const supplier = s?.portal?.supplier?.name ?? "Fictional demo supplier";
  return (
    <section className="panel" aria-label="Suppliers">
      <header className="panel-head"><h3>Suppliers</h3></header>
      <table className="grid-table">
        <thead><tr><th>Supplier</th><th>How they connect</th><th>Orders</th><th>Documents received</th><th>Went through untouched</th><th></th></tr></thead>
        <tbody>
          <tr>
            <td><b>{supplier}</b><div className="muted small">Fictional</div></td>
            <td><span className="pill info"><Mail size={14} aria-hidden /> Email, via Order Agent</span></td>
            <td>{orders.length}</td><td>{msgs.length}</td>
            <td>{orders.length ? `${untouched} of ${orders.length}` : "–"}</td>
            <td><button className="ghost" disabled title="Prototype: shows the next step only">Invite to Trading Grid EDI</button></td>
          </tr>
        </tbody>
      </table>
      <p className="path"><Network size={16} aria-hidden /> Once a supplier runs clean through the agent, invite them onto full Trading Grid EDI with this history already in place.</p>
    </section>
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
      <p className="how">Retailers keep emailing PDF purchase orders to you as they do today. You forward each one to your
        agent address, <b>order-agent@supplier-demo.example</b>, or drop the email or PDF here.</p>
      <div className="forward">
        <label className="muted small">Your mailbox (fictional)
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Sample purchase order">
            {DEMO_EMAILS.map((n) => <option key={n} value={n}>{SAMPLE_LABELS[n]}</option>)}
          </select>
        </label>
        <span className="muted small">From {SAMPLE_SENDERS[pick as keyof typeof SAMPLE_SENDERS]}</span>
        <button onClick={() => wrap(() => agent.forwardDemo(pick))}>Forward to agent</button>
      </div>
      <label className="dropzone small-drop">
        <input type="file" accept=".pdf,application/pdf,.eml,message/rfc822" aria-label="Forward a purchase order"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) add(f); }} />
        <b>Or drop a retailer email (.eml) or PDF</b>
      </label>
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
  const [scac, setScac] = useState("");
  const [track, setTrack] = useState("");
  const env = s.envelopes.find((e) => e.id === d.envelopeId);
  const via = env?.sender ? `Emailed by ${env.sender}${env.receivedAt ? ` · ${new Date(env.receivedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC` : ""} · forwarded to your agent`
    : `PDF ${d.originalFilename ?? ""} added by you`;
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
      <p className="via muted small">{via}</p>
      <p className="state">{state}</p>
      {o?.erpOrderId && !p?.asn && !replied && <ReplyBox o={o} role={role} />}
      {replied && !p?.asn && <p className="muted small">Your reply was confirmed to the retailer.</p>}
      {o?.erpOrderId && left && role !== "viewer" && (
        <div className="btns">
          <input className="qty" aria-label="Carrier SCAC" placeholder="Carrier code" value={scac} onChange={(e) => setScac(e.target.value.toUpperCase())} />
          <input aria-label="Tracking number" placeholder="Tracking number" value={track} onChange={(e) => setTrack(e.target.value)} />
          <button className="primary" disabled={!scac.trim() || !track.trim()}
            onClick={() => wrap(() => agent.run({ type: "shipFromErp", role, docId, carrierScac: scac.trim(), trackingNumber: track.trim() }))}>Mark shipped in ERP</button>
          <span className="muted small">The agent sends the ship notice and the invoice from what shipped.</span>
        </div>
      )}
      {p?.shipments.map((x) => (
        <p key={x.asn.id} className="muted small">Shipped {x.asn.lines.filter((l) => !l.shippedQty.startsWith("0")).length} line(s) on {x.asn.despatchDate}: {x.asn.asnNumber}{x.invoice ? ` and invoice ${x.invoice.invoiceNumber}` : ""} sent to the retailer.</p>
      ))}
      {error && <div className="alert bad" role="alert">{error}</div>}
    </article>
  );
}

const poLines = (o: Order): ReplyPoLine[] => o.validation.order.lines.map((l) => ({ sourceLineId: l.source_line_id,
  description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unit_price }));

function ReplyBox({ o, role }: { o: Order; role: Role }) {
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
  return (
    <div className="reply" aria-label="Reply to the retailer">
      <label>Reply to the retailer, in your own words
        <textarea rows={3} value={text} aria-label="Supplier's reply" placeholder="Paste or type what you would tell the buyer, in your own words." onChange={(e) => { setText(e.target.value); setInterp(null); }} />
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

const KIND_ICON = { ORDRSP: FileCheck2, DESADV: Truck, INVOIC: Receipt } as const;

function RetailerCard({ m, s }: { m: OutboundMessage; s: RunState }) {
  const [open, setOpen] = useState(false);
  const o = s.orders.find((x) => x.documentId === m.documentId);
  const changed = m.mapping.some((x) => /changed/i.test(x.meaning));
  // The plain-language reading of the document the retailer's system would show: line, quantity and total rows.
  const facts = m.mapping.map((x) => x.meaning).filter((t) => /^(Confirmed|Supplier will ship|Line \d|Ship(ped)? date|Estimated delivery|Total|Invoice total|Carrier)/.test(t)).slice(0, 6);
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
