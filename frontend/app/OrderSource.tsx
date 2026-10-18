"use client";
// Pieces of the order review that read the printed document: field names, the PDF with boxes on the values the
// reader took, the terms and notes printed on the PO, and adding a customer or product the PO uses.
import { useMemo, useState } from "react";
import { type PageTarget, PdfPage } from "./PdfPage";
import { useAgent } from "./run/RunProvider";
import type { Action } from "../lib/server/run-action";
import bundledReferenceJson from "../lib/domain/reference-data.v1.json";
import { mergeReference } from "../lib/domain/onboarding";
import type { Reference } from "../lib/domain/validation";
import { type DocDetail, type Field, Issue, Role } from "./api";
const bundledReference = bundledReferenceJson as unknown as Reference;

export const FIELD_LABEL: Record<string, string> = {
  customer_name: "Customer", customer_id: "Customer ID", supplier: "Supplier", po_number: "PO number", ship_to_id: "Ship-to",
  order_date: "Order date", requested_delivery_date: "Requested delivery", currency: "Currency", subtotal: "Subtotal",
  tax: "Tax", shipping: "Freight", total: "Total", source_line_id: "Line", gtin: "Product code", customer_item_code: "Retailer item",
  description: "Description", quantity: "Quantity", unit: "Unit", unit_price: "Unit price", line_amount: "Line amount",
  payment_terms: "Payment terms", ship_not_before: "Ship not before", ship_no_later_than: "Ship no later than",
  delivery_window: "Delivery window", ship_complete: "Ship complete", freight_terms: "Freight terms", supplier_sku: "Supplier SKU",
  instruction: "Order note",
};
/** Which printed value an issue is about, so its box on the page turns amber. */
const ISSUE_FIELD: Record<string, string> = {
  moq_violation: "quantity", price_mismatch: "unit_price", outdated_identifier: "gtin", rule_needs_revalidation: "gtin",
  unknown_item: "gtin", unknown_unit: "unit", unit_conversion: "unit", line_amount_mismatch: "line_amount",
  unknown_customer: "customer_name", unknown_ship_to: "ship_to_id", currency_mismatch: "currency", total_mismatch: "total",
  possible_revision: "po_number",
};
export const fieldOfIssue = (i: Issue) => (i.code === "unverified_field" ? i.field : ISSUE_FIELD[i.code]) ?? null;
export const targetId = (i: Issue) => {
  const f = fieldOfIssue(i);
  return f ? (i.line_index === null ? `h:${f}` : `l:${i.line_index}:${f}`) : null;
};

/** Every value the agent read, as something to box on the page. */
function pageTargets(d: DocDetail, issues: Issue[]): PageTarget[] {
  const p = d.latest_version?.payload;
  if (!p) return [];
  const flagged = new Set(issues.filter((i) => i.status === "open").map(targetId).filter(Boolean));
  const out: PageTarget[] = [];
  const add = (id: string, name: string, f: { value: string | null; page: number | null } | undefined, group?: string, anchor?: boolean) => {
    if (!f?.value) return;
    out.push({ id, value: f.value, page: f.page, group: group ?? null, anchor, label: FIELD_LABEL[name] ?? name,
      tone: flagged.has(id) ? "issue" : "value" });
  };
  for (const [k, f] of Object.entries(p.header)) add(`h:${k}`, k, f);
  for (const [k, f] of Object.entries(p.terms ?? {})) if (k !== "instructions") add(`t:${k}`, k, f as Field);
  (p.terms?.instructions ?? []).forEach((f, i) => add(`t:instructions:${i}`, "instruction", f));
  p.lines.forEach((l, i) => {
    for (const [k, f] of Object.entries(l)) add(`l:${i}:${k}`, k, f, `line${i}`, k === "description" || k === "gtin" || k === "supplier_sku");
  });
  return out;
}

export function SourcePanel({ d, focus, onPick }: { d: DocDetail; focus: Set<string>; onPick?: (id: string) => void }) {
  const issues = d.order?.validation.issues ?? [];
  const targets = useMemo(() => pageTargets(d, issues), [d, issues]);
  return (
    <div className="source">
      <PdfPage docId={d.document.id} targets={targets} focus={focus} onPick={onPick} pageText={d.pages}
        scanned={d.latest_version?.payload.source === "scan"} />
    </div>
  );
}

type RunFn = (action: Action) => Promise<void>;
type Line = NonNullable<DocDetail["order"]>["validation"]["order"]["lines"][number];

/** D46: add the customer or product this real PO uses, for this session. Never automatic. */
export function Onboard({ issue, docId, role, onRun, line, currency }: { issue: Issue; docId: number; role: Role; onRun: RunFn;
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

/** D59: the PO's own terms and the buyer's notes, as printed. Notes are shown to people, never acted on. */
export function OrderTerms({ d, onPick }: { d: DocDetail; onPick: (id: string) => void }) {
  const t = d.latest_version?.payload.terms;
  if (!t) return null;
  const rows = (["payment_terms", "freight_terms", "ship_not_before", "ship_no_later_than", "delivery_window", "ship_complete"] as const)
    .filter((k) => t[k]?.value);
  return (
    <section className="terms" aria-label="Order terms">
      <h4 className="section">Terms and notes on the PO</h4>
      {rows.length > 0 && (
        <dl className="termlist">
          {rows.map((k) => <div key={k} onClick={() => onPick(`t:${k}`)}><dt>{FIELD_LABEL[k] ?? k}</dt><dd>{t[k]!.value}</dd></div>)}
        </dl>
      )}
      {(t.instructions ?? []).length > 0 && (
        <ul className="notes">{t.instructions!.map((n, i) => <li key={i} onClick={() => onPick(`t:instructions:${i}`)}>{n.value}</li>)}</ul>
      )}
      <p className="muted small">Notes are displayed as printed and are not executed.</p>
    </section>
  );
}

