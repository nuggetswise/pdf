"use client";
// Transactions: every document that came in or went out, in one list, newest first. Orders is the work queue; this
// is the record. Filter by type, retailer, status, environment, date and number. A row opens the document in full
// or goes to its order.
import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { outboundList } from "../lib/domain/portal";
import type { RunState } from "../lib/domain/run-state";
import { type Role } from "./api";
import { MessageDetail } from "./Portal";
import { useAgent } from "./run/RunProvider";

type TxType = "Purchase order" | "Order confirmation" | "Ship notice" | "Invoice";
type Tx = {
  key: string; at: string; direction: "In" | "Out"; type: TxType; edi: string | null; number: string; forPo: string; partner: string;
  status: string; tone: string; docId: number; env: "Test" | "Live"; messageId: number | null;
};
const OUT_TYPE = { ORDRSP: ["Order confirmation", "855"], DESADV: ["Ship notice", "856"], INVOIC: ["Invoice", "810"] } as const;
const STATUS_OUT = { delivered: ["Delivered", "ok"], pending: ["Pending", "warn"], failed: ["Failed", "bad"] } as const;
const TYPES: TxType[] = ["Purchase order", "Order confirmation", "Ship notice", "Invoice"];

function rows(s: RunState): Tx[] {
  const orderOf = (id: number) => s.orders.find((o) => o.documentId === id);
  const partnerOf = (id: number) => orderOf(id)?.validation.order.customer_name ?? "Unknown retailer";
  const inbound: Tx[] = s.documents.map((d) => {
    const o = orderOf(d.id);
    const env = s.envelopes.find((e) => e.id === d.envelopeId);
    const [status, tone] = d.status === "duplicate" ? ["Duplicate", "muted"] : d.status === "not_order" ? ["Not an order", "muted"]
      : !o ? ["Could not be read", "bad"] : ["Received", "ok"];
    return { key: `in-${d.id}`, at: env?.receivedAt ?? env?.createdAt ?? d.createdAt, direction: "In", type: "Purchase order", edi: d.kind === "edi" ? "850" : null,
      number: o?.validation.order.po_number ?? d.originalFilename ?? `Document ${d.id}`, forPo: o?.validation.order.po_number ?? "–",
      partner: o ? partnerOf(d.id) : env?.sender ?? "Unknown sender", status, tone, docId: d.id, env: "Test", messageId: null };
  });
  const outbound: Tx[] = outboundList(s).filter((m) => m.channel === "retailer_edi_outbox" && m.kind in OUT_TYPE).map((m) => {
    const [type, edi] = OUT_TYPE[m.kind as keyof typeof OUT_TYPE];
    const held = m.status === "pending" && m.attempts.at(-1)?.outcome === "held";
    const [status, tone] = held ? ["Held", "bad"] : STATUS_OUT[m.status];
    const po = orderOf(m.documentId)?.validation.order.po_number ?? "–";
    return { key: `out-${m.id}`, at: m.createdAt, direction: "Out", type, edi, number: m.kind === "ORDRSP" ? po : m.sourceId, forPo: po,
      partner: partnerOf(m.documentId), status, tone, docId: m.documentId, env: "Test", messageId: m.id };
  });
  return [...inbound, ...outbound].sort((a, b) => b.at.localeCompare(a.at));
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function TransactionsView({ role, onOpenOrder }: { role: Role; onOpenOrder: (docId: number) => void }) {
  const agent = useAgent();
  const [type, setType] = useState("");
  const [partner, setPartner] = useState("");
  const [status, setStatus] = useState("");
  const [env, setEnv] = useState("");
  const [from, setFrom] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  if (!agent.ready) return <p className="placeholder">Loading transactions.</p>;
  const s = agent.state;
  const all = rows(s);
  const needle = q.trim().toLowerCase();
  const list = all.filter((t) => (!type || t.type === type) && (!partner || t.partner === partner) && (!status || t.status === status)
    && (!env || t.env === env) && (!from || t.at.slice(0, 10) >= from)
    && (!needle || t.number.toLowerCase().includes(needle) || t.forPo.toLowerCase().includes(needle)));
  const partners = [...new Set(all.map((t) => t.partner))];
  const statuses = [...new Set(all.map((t) => t.status))];
  return (
    <section className="transactions" aria-label="Transactions">
      <div className="filters" role="group" aria-label="Filter transactions">
        <input type="search" aria-label="Search by number" placeholder="Search by PO, ship notice or invoice number" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Document type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All document types</option>{TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select aria-label="Retailer" value={partner} onChange={(e) => setPartner(e.target.value)}>
          <option value="">All retailers</option>{partners.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{statuses.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select aria-label="Environment" value={env} onChange={(e) => setEnv(e.target.value)}>
          <option value="">Test and live</option><option>Test</option><option>Live</option>
        </select>
        <label className="inline">On or after <input type="date" aria-label="On or after" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      </div>
      <p className="muted small">{list.length} of {all.length} transactions. This is the test environment, so every transaction is marked Test and nothing reaches a real retailer.</p>
      {list.length === 0 ? <p className="empty">No transactions match.</p> : (
        <div className="scroll">
          <table className="table stack-table tx-table">
            <thead><tr><th>When</th><th>Direction</th><th>Document</th><th>Number</th><th>Retailer</th><th>Status</th><th>Environment</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{list.map((t) => {
              const m = t.messageId === null ? null : outboundList(s).find((x) => x.id === t.messageId) ?? null;
              return (
                <Fragment key={t.key}>
                  <tr data-type={t.type}>
                    <td data-label="When">{when(t.at)}</td><td data-label="Direction">{t.direction === "In" ? "Received" : "Sent"}</td>
                    <td data-label="Document">{t.type}{t.edi ? <span className="muted small"> (X12 {t.edi})</span> : null}</td>
                    <td data-label="Number"><b>{t.number}</b>{t.type !== "Purchase order" && t.type !== "Order confirmation" && <div className="muted small">for {t.forPo}</div>}</td>
                    <td data-label="Retailer">{t.partner}</td>
                    <td data-label="Status"><span className={`pill ${t.tone}`}>{t.status}</span></td>
                    <td data-label="Environment"><span className="pill warn">{t.env}</span></td>
                    <td className="row-open"><div className="btns">
                      {m && <button className="ghost" aria-expanded={open === t.key} onClick={() => setOpen(open === t.key ? null : t.key)}>{open === t.key ? "Hide" : "Show"} document</button>}
                      <button className="ghost" onClick={() => onOpenOrder(t.docId)} aria-label={`Open order for ${t.forPo}`}>Open order <ChevronRight size={14} aria-hidden /></button>
                    </div></td>
                  </tr>
                  {m && open === t.key && <tr><td colSpan={8}><MessageDetail m={m} role={role} /></td></tr>}
                </Fragment>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
