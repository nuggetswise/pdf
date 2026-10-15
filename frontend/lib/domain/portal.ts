// Supplier portal (D45): order confirmation, ASN and invoice, each with its own simulated outbound deliveries.
// Pure functions over RunState, like workflow.ts. Every outbound message has its own status
// (pending / delivered / failed), its own idempotency key and a safe retry that first asks the simulated
// receiver whether it already holds the message. Nothing leaves the browser tab: the "Retailer EDI outbox"
// and the "supplier ERP" are records in RunState.portal.received.
import { buildDesadv, buildInvoic, buildOrdrsp, type EdiLine, type EdiMessage } from "./edifact";
import { Dec, money } from "./money";
import {
  type Asn, type Invoice, type OutboundMessage, type Portal, type RunState, decimalString, emptyPortal,
} from "./run-state";
import { Conflict, type Clock, Forbidden, type Who, systemClock } from "./workflow";

const REVIEWERS = new Set(["reviewer", "administrator"]);
const requireReviewer = (role: string) => {
  if (!REVIEWERS.has(role)) throw new Forbidden("Reviewer or administrator role required");
};
const pad = (n: number) => String(n).padStart(5, "0");
const nextId = (rows: { id: number }[]) => rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;

type Run = RunState & { portal: Portal };
const withPortal = (s: RunState): Run => { s.portal ??= emptyPortal(); return s as Run; };

function act(state: RunState, clock: Clock, fn: (s: Run, now: string) => void): RunState {
  const s = withPortal(structuredClone(state));
  fn(s, clock.now());
  return s;
}

const RECEIVER_PREFIX: Record<OutboundMessage["kind"], string> = {
  ORDRSP: "EDI-OUT", DESADV: "EDI-OUT", INVOIC: "EDI-OUT", ERP_SHIPMENT: "SIM-SHP", ERP_INVOICE: "SIM-INV",
};

function addMessage(s: Run, now: string, m: Pick<OutboundMessage, "kind" | "channel" | "documentId" | "sourceType"
  | "sourceId" | "idempotencyKey" | "format" | "body" | "mapping">): OutboundMessage {
  const existing = s.portal.outbound.find((x) => x.idempotencyKey === m.idempotencyKey);
  if (existing) return existing;
  const msg: OutboundMessage = { id: nextId(s.portal.outbound), ...m, status: "pending", attempts: [], receiverRef: null,
    createdAt: now, updatedAt: now };
  s.portal.outbound.push(msg);
  return msg;
}

function note(msg: OutboundMessage, now: string, status: OutboundMessage["status"], outcome: string, detail: string) {
  msg.status = status;
  msg.updatedAt = now;
  msg.attempts.push({ at: now, outcome, detail });
}

/** One delivery attempt. Reconcile first: a receiver that already holds the key is never sent it twice. */
function dispatch(s: Run, now: string, msg: OutboundMessage) {
  if (msg.status === "delivered") return;
  const held = s.portal.received.find((r) => r.channel === msg.channel && r.idempotencyKey === msg.idempotencyKey);
  if (held) {
    msg.receiverRef = held.receiverRef;
    note(msg, now, "delivered", "reconciled", `Receiver already holds ${held.receiverRef}; not sent again`);
    return;
  }
  const store = () => {
    const n = s.portal.received.filter((r) => RECEIVER_PREFIX[r.kind] === RECEIVER_PREFIX[msg.kind]).length + 1;
    const ref = `${RECEIVER_PREFIX[msg.kind]}-${100000 + n}`;
    s.portal.received.push({ receiverRef: ref, channel: msg.channel, kind: msg.kind, idempotencyKey: msg.idempotencyKey,
      body: msg.body, receivedAt: now });
    return ref;
  };
  if (msg.channel === "supplier_erp") {
    const mode = s.settings.erpFailureMode;
    if (mode === "fail_next") {
      s.settings.erpFailureMode = "none";
      note(msg, now, "failed", "failed", "ERP simulator rejected the request (simulated outage)");
      return;
    }
    const ref = store();
    if (mode === "timeout_next") {
      s.settings.erpFailureMode = "none";
      note(msg, now, "pending", "unknown",
        "No answer from the ERP simulator (simulated timeout). Outcome unknown; a retry checks before sending again");
      return;
    }
    msg.receiverRef = ref;
    note(msg, now, "delivered", "delivered", `ERP simulator created ${ref}`);
    return;
  }
  const mode = s.portal.ediFailureMode;
  if (mode === "fail_next") {
    s.portal.ediFailureMode = "none";
    note(msg, now, "failed", "failed", "Retailer EDI outbox refused the message (simulated outage)");
    return;
  }
  if (mode === "hold_next") {
    s.portal.ediFailureMode = "none";
    note(msg, now, "pending", "waiting", "Retailer EDI outbox has not accepted the message yet (simulated)");
    return;
  }
  msg.receiverRef = store();
  note(msg, now, "delivered", "delivered", `Placed in the simulated Retailer EDI outbox as ${msg.receiverRef}`);
}

const edifact = (m: EdiMessage) => ({ format: "edifact" as const, body: m.text,
  mapping: m.segments.map((x) => ({ segment: x.raw, meaning: x.meaning })) });
const json = (v: unknown, mapping: { segment: string; meaning: string }[]) =>
  ({ format: "json" as const, body: JSON.stringify(v, null, 2), mapping });

function orderFor(s: RunState, docId: number) {
  const o = s.orders.find((x) => x.documentId === docId);
  if (!o) throw new Conflict("Unknown order");
  return o;
}
const partiesOf = (o: RunState["orders"][number]) => ({
  poNumber: o.validation.order.po_number ?? "", customerName: o.validation.order.customer_name,
  shipTo: o.validation.order.ship_to_id, currency: o.validation.order.currency,
});

// ---------- step 1: order confirmation, automatic on ERP delivery ----------

/** Called by workflow.deliver once the ERP holds the order. Mutates the run copy it is given. */
export function confirmOrder(state: RunState, now: string, docId: number) {
  const s = withPortal(state);
  const o = orderFor(s, docId);
  if (!o.erpOrderId) return;
  const key = `ORDRSP:${o.erpOrderId}`;
  if (s.portal.outbound.some((m) => m.idempotencyKey === key)) return;
  const lines: EdiLine[] = o.validation.order.lines.map((l) => ({ sourceLineId: l.source_line_id, gtin: l.gtin,
    sku: l.sku ?? "", description: l.description, unit: l.unit ?? "", quantity: l.quantity ?? "0" }));
  const ref = `ORDRSP-${o.erpOrderId.replace(/^SIM-ERP-/, "")}`;
  const msg = addMessage(s, now, { kind: "ORDRSP", channel: "retailer_edi_outbox", documentId: docId, sourceType: "order",
    sourceId: o.erpOrderId, idempotencyKey: key,
    ...edifact(buildOrdrsp({ ref, createdAt: now, erpOrderId: o.erpOrderId, orderDate: o.validation.order.order_date,
      ...partiesOf(o) }, lines)) });
  dispatch(s, now, msg);
}

// ---------- step 2: ASN ----------

export interface AsnInput { lines: { lineIndex: number; shippedQty: string; overrideReason?: string | null }[] }

export function submitAsn(state: RunState, docId: number, input: AsnInput, who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (s, now) => {
    const o = orderFor(s, docId);
    if (o.deliveryState !== "erp_created" || !o.erpOrderId) throw new Conflict("An ASN needs an order delivered to the ERP");
    const prior = s.portal.asns.find((a) => a.documentId === docId);
    if (prior) throw new Conflict(`This order already has ${prior.asnNumber}`);
    const orderLines = o.validation.order.lines;
    const given = new Map(input.lines.map((l) => [l.lineIndex, l]));
    if (given.size !== input.lines.length || given.size !== orderLines.length
      || orderLines.some((l) => !given.has(l.line_index))) {
      throw new Conflict("Give a shipped quantity for every order line");
    }
    let anyShipped = false;
    const lines: Asn["lines"] = orderLines.map((l) => {
      const g = given.get(l.line_index)!;
      if (!decimalString.safeParse(g.shippedQty).success || g.shippedQty.startsWith("-")) {
        throw new Conflict(`Line ${l.source_line_id}: shipped quantity must be a number of zero or more`);
      }
      if (!l.sku || !l.quantity || !l.unit) throw new Conflict(`Line ${l.source_line_id} has no matched item and quantity`);
      const shipped = Dec.of(g.shippedQty);
      const ordered = Dec.of(l.quantity);
      const reason = g.overrideReason?.trim() || null;
      if (ordered.lt(shipped) && !reason) {
        throw new Conflict(`Line ${l.source_line_id}: shipped ${g.shippedQty} is more than the ${l.quantity} ordered. `
          + "Give an override reason to ship more.");
      }
      if (!shipped.isZero()) anyShipped = true;
      return { lineIndex: l.line_index, sourceLineId: l.source_line_id, sku: l.sku, gtin: l.gtin, description: l.description,
        unit: l.unit, orderedQty: l.quantity, shippedQty: g.shippedQty, overrideReason: ordered.lt(shipped) ? reason : null };
    });
    if (!anyShipped) throw new Conflict("Nothing is shipped: at least one line needs a quantity above zero");
    const id = nextId(s.portal.asns);
    const asn: Asn = { id, asnNumber: `ASN-${pad(id)}`, documentId: docId, erpOrderId: o.erpOrderId, lines,
      createdBy: who.actor, createdAt: now };
    s.portal.asns.push(asn);
    s.audit.push({ id: nextId(s.audit), entityType: "document", entityId: docId, event: "asn_submitted", actor: who.actor,
      detail: { asn: asn.asnNumber, short_lines: lines.filter((l) => Dec.of(l.shippedQty).lt(Dec.of(l.orderedQty))).length },
      createdAt: now });

    const shippedLines = lines.filter((l) => !Dec.of(l.shippedQty).isZero());
    const erp = addMessage(s, now, { kind: "ERP_SHIPMENT", channel: "supplier_erp", documentId: docId, sourceType: "asn",
      sourceId: asn.asnNumber, idempotencyKey: `ERP-SHIPMENT:${asn.asnNumber}`,
      ...json({ shipment_for: o.erpOrderId, asn: asn.asnNumber, po_number: o.validation.order.po_number,
        lines: shippedLines.map((l) => ({ sku: l.sku, shipped_qty: l.shippedQty, ordered_qty: l.orderedQty, unit: l.unit,
          override_reason: l.overrideReason })) },
      [{ segment: "shipment_for", meaning: `Shipment against ERP order ${o.erpOrderId}` },
        { segment: "lines[].shipped_qty", meaning: "Quantity actually shipped, as entered on the ASN" }]) });
    const edi = addMessage(s, now, { kind: "DESADV", channel: "retailer_edi_outbox", documentId: docId, sourceType: "asn",
      sourceId: asn.asnNumber, idempotencyKey: `DESADV:${asn.asnNumber}`,
      ...edifact(buildDesadv({ ref: asn.asnNumber, createdAt: now, ...partiesOf(o) },
        shippedLines.map((l) => ({ ...l, quantity: l.shippedQty })))) });
    dispatch(s, now, erp);
    dispatch(s, now, edi);
  });
}

// ---------- step 3: invoice ----------

export interface InvoiceInput { lines: { lineIndex: number; quantity: string }[] }

/** The invoice lines the ASN allows: shipped quantity times the order's unit price. */
export function invoiceLinesFor(s: RunState, asn: Asn): Invoice["lines"] {
  const o = orderFor(s, asn.documentId);
  return asn.lines.filter((l) => !Dec.of(l.shippedQty).isZero()).map((l) => {
    const price = o.validation.order.lines.find((x) => x.line_index === l.lineIndex)?.unit_price;
    if (!price) throw new Conflict(`Line ${l.sourceLineId} has no agreed unit price on the order`);
    return { lineIndex: l.lineIndex, sourceLineId: l.sourceLineId, sku: l.sku, gtin: l.gtin, description: l.description,
      unit: l.unit, quantity: l.shippedQty, unitPrice: price, lineAmount: money(Dec.of(l.shippedQty).mul(Dec.of(price))) };
  });
}

export function submitInvoice(state: RunState, asnId: number, input: InvoiceInput, who: Who,
  clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (s, now) => {
    const asn = s.portal.asns.find((a) => a.id === asnId);
    if (!asn) throw new Conflict("Unknown ASN");
    const prior = s.portal.invoices.find((i) => i.asnId === asnId);
    if (prior) throw new Conflict(`${asn.asnNumber} already has invoice ${prior.invoiceNumber}; one invoice per ASN`);
    const lines = invoiceLinesFor(s, asn);
    // The invoice must match its ASN line for line: same lines, same quantities.
    const given = new Map(input.lines.map((l) => [l.lineIndex, l.quantity]));
    const mismatch = lines.find((l) => {
      const q = given.get(l.lineIndex);
      return q === undefined || !decimalString.safeParse(q).success || !Dec.of(q).eq(Dec.of(l.quantity));
    });
    if (mismatch || given.size !== lines.length || input.lines.length !== lines.length) {
      const l = mismatch ?? lines[0];
      throw new Conflict(`Invoice does not match ${asn.asnNumber}: line ${l?.sourceLineId ?? "?"} must invoice the shipped `
        + `quantity ${l?.quantity ?? ""}${given.size !== lines.length ? " and only lines that were shipped" : ""}`);
    }
    const o = orderFor(s, asn.documentId);
    const subtotal = money(lines.reduce((t, l) => t.add(Dec.of(l.lineAmount)), Dec.ZERO));
    const id = nextId(s.portal.invoices);
    const inv: Invoice = { id, invoiceNumber: `INV-${pad(id)}`, asnId, documentId: asn.documentId,
      currency: o.validation.order.currency ?? "", lines, subtotal, total: subtotal, rounding: "ROUND_HALF_UP to 0.01",
      createdBy: who.actor, createdAt: now };
    s.portal.invoices.push(inv);
    s.audit.push({ id: nextId(s.audit), entityType: "document", entityId: asn.documentId, event: "invoice_submitted",
      actor: who.actor, detail: { invoice: inv.invoiceNumber, asn: asn.asnNumber, total: inv.total }, createdAt: now });
    const erp = addMessage(s, now, { kind: "ERP_INVOICE", channel: "supplier_erp", documentId: asn.documentId,
      sourceType: "invoice", sourceId: inv.invoiceNumber, idempotencyKey: `ERP-INVOICE:${inv.invoiceNumber}`,
      ...json({ invoice: inv.invoiceNumber, asn: asn.asnNumber, erp_order: asn.erpOrderId, currency: inv.currency,
        lines: lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unit_price: l.unitPrice, line_amount: l.lineAmount })),
        subtotal: inv.subtotal, total: inv.total },
      [{ segment: "lines[].quantity", meaning: `Quantity from ${asn.asnNumber}, not the purchase order` },
        { segment: "lines[].unit_price", meaning: "Unit price from the delivered order" },
        { segment: "total", meaning: "Exact decimal sum, rounded half-up to cents; tax not calculated" }]) });
    const edi = addMessage(s, now, { kind: "INVOIC", channel: "retailer_edi_outbox", documentId: asn.documentId,
      sourceType: "invoice", sourceId: inv.invoiceNumber, idempotencyKey: `INVOIC:${inv.invoiceNumber}`,
      ...edifact(buildInvoic({ ref: inv.invoiceNumber, createdAt: now, asnRef: asn.asnNumber, subtotal: inv.subtotal,
        total: inv.total, ...partiesOf(o) }, lines)) });
    dispatch(s, now, erp);
    dispatch(s, now, edi);
  });
}

// ---------- retry and settings ----------

export function retryOutbound(state: RunState, messageId: number, who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (s, now) => {
    const msg = s.portal.outbound.find((m) => m.id === messageId);
    if (!msg) throw new Conflict("Unknown outbound message");
    if (msg.status === "delivered") throw new Conflict("Already delivered; nothing to retry");
    msg.attempts.push({ at: now, outcome: "retry_requested", detail: `Retry by ${who.actor}; checking the receiver first` });
    dispatch(s, now, msg);
  });
}

export function setEdiFailureMode(state: RunState, value: string, who: Who, clock: Clock = systemClock): RunState {
  if (who.role !== "administrator") throw new Forbidden("Only an administrator can change demo settings");
  if (!["none", "fail_next", "hold_next"].includes(value)) throw new Conflict("value must be one of fail_next, hold_next, none");
  return act(state, clock, (s, now) => {
    s.portal.ediFailureMode = value as Portal["ediFailureMode"];
    s.audit.push({ id: nextId(s.audit), entityType: "system", entityId: 0, event: "demo_setting_changed", actor: who.actor,
      detail: { key: "edi_failure_mode", value }, createdAt: now });
  });
}

// ---------- read models (new; the existing ones are unchanged) ----------

const CHANNEL_LABEL = { supplier_erp: "ERP", retailer_edi_outbox: "EDI to retailer" } as const;
const STATUS_WORD = { delivered: { supplier_erp: "synced", retailer_edi_outbox: "delivered" }, pending: "pending",
  failed: "failed" } as const;

/** "ERP synced, EDI to retailer pending": each delivery's own state, never merged into one success. */
export function deliverySummary(messages: OutboundMessage[]): string {
  return messages.map((m) => {
    const w = m.status === "delivered" ? STATUS_WORD.delivered[m.channel] : STATUS_WORD[m.status];
    return `${CHANNEL_LABEL[m.channel]} ${w}`;
  }).join(", ");
}

export function portalForOrder(s: RunState, docId: number) {
  const p = s.portal ?? emptyPortal();
  const msgs = (type: OutboundMessage["sourceType"], id: string) =>
    p.outbound.filter((m) => m.sourceType === type && m.sourceId === id).sort((a, b) => a.id - b.id);
  const asn = p.asns.find((a) => a.documentId === docId) ?? null;
  const invoice = asn ? p.invoices.find((i) => i.asnId === asn.id) ?? null : null;
  const confirmation = p.outbound.find((m) => m.kind === "ORDRSP" && m.documentId === docId) ?? null;
  return {
    confirmation,
    asn, asnMessages: asn ? msgs("asn", asn.asnNumber) : [],
    invoice, invoiceMessages: invoice ? msgs("invoice", invoice.invoiceNumber) : [],
  };
}

export const outboundList = (s: RunState): OutboundMessage[] =>
  [...(s.portal ?? emptyPortal()).outbound].sort((a, b) => b.id - a.id);
