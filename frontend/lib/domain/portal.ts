// Supplier portal (D45, D47): order confirmation, ASN and invoice, each with its own simulated outbound deliveries.
// Pure functions over RunState, like workflow.ts. Every outbound message has its own status
// (pending / delivered / failed), its own idempotency key and a safe retry that first asks the simulated
// receiver whether it already holds the message. Nothing leaves the browser tab: the "Retailer EDI outbox"
// and the "supplier ERP" are records in RunState.portal.received.
//
// D47: every EDIFACT message is checked against the trading partner's compliance profile before it is sent.
// An ASN or invoice that would fail a blocking rule is refused with the reasons, so nothing the retailer would
// reject leaves the portal. The ASN carries a pallet and carton hierarchy with SSCCs; the invoice carries tax
// per rate and allowances or charges, and is matched line by line against the order and the ASN.
import { buildDesadvX12, buildInvoicX12, buildOrdrspX12 } from "./x12";
import { type ComplianceResult, PROFILES, blocking, checkMessage, rateKey, refusal } from "./compliance";
import {
  type EdiAllowance, type EdiLine, type EdiMessage, type EdiParties, type EdiPallet, buildDesadv, buildInvoic, buildOrdrsp,
} from "./edifact";
import { sscc } from "./gs1";
import { MAX_REPLY_CHARS, SupplierReplyInterpretation } from "./reply";
import { Dec, money } from "./money";
import { partnerFor, supplierSetup, termsText, validRate } from "./partners";
import {
  type Asn, type ComplianceSummary, type Invoice, type InvoiceAllowance, type OutboundMessage, type Pallet, type Portal,
  type RunState, decimalString, emptyPortal,
} from "./run-state";
import { Conflict, type Clock, Forbidden, type Who, systemClock } from "./workflow";
import { choose, consumeStock, firstShipOn, freeStock, planFulfilment, stockOf } from "./fulfilment";
import { isoDate } from "./dates";

const REVIEWERS = new Set(["reviewer", "administrator"]);
const requireReviewer = (role: string) => {
  if (!REVIEWERS.has(role)) throw new Forbidden("Reviewer or administrator role required");
};
const pad = (n: number) => String(n).padStart(5, "0");
const nextId = (rows: { id: number }[]) => rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
const HUNDRED = Dec.of("100");
const NEG = Dec.of("-1");

type Run = RunState & { portal: Portal };
const withPortal = (s: RunState): Run => { s.portal ??= emptyPortal(); return s as Run; };

function act(state: RunState, clock: Clock, fn: (s: Run, now: string) => void): RunState {
  const s = withPortal(structuredClone(state));
  fn(s, clock.now());
  return s;
}

const RECEIVER_PREFIX: Record<OutboundMessage["kind"], string> = {
  ORDRSP: "EDI-OUT", DESADV: "EDI-OUT", INVOIC: "EDI-OUT", ERP_SHIPMENT: "SIM-SHP", ERP_INVOICE: "SIM-INV", ERP_ORDER_CHANGE: "SIM-CHG",
};

function addMessage(s: Run, now: string, m: Pick<OutboundMessage, "kind" | "channel" | "documentId" | "sourceType"
  | "sourceId" | "idempotencyKey" | "format" | "body" | "mapping"> & { compliance?: ComplianceSummary }): OutboundMessage {
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
  note(msg, now, "delivered", "delivered", `Placed in the simulated Trading Grid outbox as ${msg.receiverRef}`);
}

const summary = (c: ComplianceResult): ComplianceSummary =>
  ({ profile: c.profile, rulesChecked: c.rulesChecked, rulesPassed: c.rulesPassed, findings: c.findings });
const edifact = (m: EdiMessage, c: ComplianceResult) => ({
  format: c.profile === "x12_retail" ? "x12" as const : "edifact" as const, body: m.text,
  mapping: m.segments.map((x) => ({ segment: x.raw, meaning: x.meaning })), compliance: summary(c) });
const json = (v: unknown, mapping: { segment: string; meaning: string }[]) =>
  ({ format: "json" as const, body: JSON.stringify(v, null, 2), mapping });

type OrderRow = RunState["orders"][number];
function orderFor(s: RunState, docId: number): OrderRow {
  const o = s.orders.find((x) => x.documentId === docId);
  if (!o) throw new Conflict("Unknown order");
  return o;
}

/** Key for the delivery party when the PO printed no ship-to. */
export const DEFAULT_SHIP_TO = "(no ship-to on the PO)";

/** Parties for the EDI header from the supplier setup and the retailer's trading partner setup. */
export function ediContext(s: RunState, o: OrderRow): { parties: EdiParties; profile: keyof typeof PROFILES } {
  const sup = supplierSetup(s);
  const ord = o.validation.order;
  const partner = partnerFor(s, ord.customer_id);
  const shipTo = ord.ship_to_id ?? DEFAULT_SHIP_TO;
  return {
    profile: partner.profile,
    parties: {
      poNumber: ord.po_number ?? "", currency: ord.currency,
      supplier: { gln: sup.gln, vatId: sup.vatId, name: sup.name },
      buyer: { gln: partner.buyerGln, vatId: partner.buyerVatId, name: ord.customer_name },
      deliveryParty: { gln: partner.shipToGlns.find((t) => t.shipToId === shipTo)?.gln ?? null, printedId: ord.ship_to_id },
      contractRef: partner.contractRef, vendorNumber: partner.vendorNumber ?? null,
    },
  };
}

const ediLine = (o: OrderRow, lineIndex: number, quantity: string): EdiLine => {
  const l = o.validation.order.lines.find((x) => x.line_index === lineIndex)!;
  return { sourceLineId: l.source_line_id, gtin: l.gtin, sku: l.sku ?? "", customerItemCode: l.customer_item_code,
    description: l.description, unit: l.unit ?? "", quantity };
};

const dateOnly = (iso: string) => iso.slice(0, 10);
/** YYYY-MM-DD plus n calendar days (UTC). */
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// ---------- step 1: order confirmation, automatic on ERP delivery ----------

function ordrspFor(s: RunState, o: OrderRow, createdAt: string, reply?: SupplierReplyInterpretation, n = 0) {
  const erpOrderId = o.erpOrderId!;
  const ctx = ediContext(s, o);
  // D61: the stock plan the supplier settled: per line what ships when, what is backordered, what will not ship.
  const parts = o.fulfilment?.status === "confirmed" ? o.fulfilment.parts : [];
  const lines = o.validation.order.lines.map((l) => {
    const c = reply?.lines.find((x) => x.sourceLineId === l.source_line_id);
    const base = ediLine(o, l.line_index, c?.quantity ?? l.quantity ?? "0");
    const mine = parts.filter((p) => p.lineIndex === l.line_index);
    const schedule = !c && mine.length ? mine.map((p) => ({ quantity: p.quantity,
      code: (p.kind === "now" ? "IA" : p.kind === "backorder" ? "IB" : "IR") as "IA" | "IB" | "IR", date: p.shipOn })) : undefined;
    return c ? { ...base, orderedQty: l.quantity ?? undefined, unitPrice: c.unitPrice ?? l.unit_price ?? undefined,
      orderedPrice: l.unit_price ?? undefined } : { ...base, ...(schedule ? { schedule } : {}) };
  });
  const ref = `ORDRSP-${erpOrderId.replace(/^SIM-ERP-/, "")}${n ? `-C${n}` : ""}`;
  const msg = (ctx.profile === "x12_retail" ? buildOrdrspX12 : buildOrdrsp)({ ref, createdAt, erpOrderId,
    orderDate: isoDate(o.validation.order.order_date) ?? o.validation.order.order_date,
    shipDate: reply?.shipDate ?? firstShipOn(parts) ?? null, ...ctx.parties }, lines);
  return { msg, check: checkMessage("ORDRSP", msg.text, ctx.profile) };
}

/** Called by workflow.deliver once the ERP holds the order. Mutates the run copy it is given. */
export function confirmOrder(state: RunState, now: string, docId: number) {
  const s = withPortal(state);
  const o = orderFor(s, docId);
  if (!o.erpOrderId) return;
  const key = `ORDRSP:${o.erpOrderId}`;
  if (s.portal.outbound.some((m) => m.idempotencyKey === key)) return;
  // D61: check stock and work out the ship date first; a shortage waits for a person before the retailer hears.
  o.fulfilment ??= planFulfilment(s, docId, now);
  if (o.fulfilment.status !== "confirmed") return;
  if (o.fulfilment.parts.some((p) => p.kind === "cancelled")) cancelShort(s, now, o, "Stock short: shipping what is available");
  const { msg: built, check } = ordrspFor(s, o, now);
  const msg = addMessage(s, now, { kind: "ORDRSP", channel: "retailer_edi_outbox", documentId: docId, sourceType: "order",
    sourceId: o.erpOrderId, idempotencyKey: key, ...edifact(built, check) });
  if (blocking(check).length) {
    note(msg, now, "pending", "held", `Held, not sent: ${refusal(check)} Fix the EDI setup, then retry.`);
    return;
  }
  dispatch(s, now, msg);
}

// ---------- D54: the supplier's plain-language reply, confirmed by a person ----------

/**
 * Apply a reply the agent read: a changed order acknowledgement goes to the retailer, the supplier's ERP order is
 * updated, and quantity the supplier will not ship is closed so the ASN and invoice follow the confirmed quantities.
 */
export function applySupplierReply(state: RunState, docId: number, text: string, interpretation: unknown, who: Who,
  clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  const parsed = SupplierReplyInterpretation.safeParse(interpretation);
  if (!parsed.success) throw new Conflict("The reply could not be applied; read it again");
  const interp = parsed.data;
  const body = text.trim();
  if (!body || body.length > MAX_REPLY_CHARS) throw new Conflict("Write a reply of up to 4,000 characters");
  if (!interp.lines.length && !interp.shipDate) throw new Conflict("The reply changes nothing on the order");
  return act(state, clock, (s, now) => {
    const o = orderFor(s, docId);
    if (o.deliveryState !== "erp_created" || !o.erpOrderId) throw new Conflict("Apply a reply once the order is in the ERP");
    if (s.portal.asns.some((a) => a.documentId === docId)) throw new Conflict("This order has started shipping; change it with the shipment instead");
    const open = openQuantities(s, docId);
    const cuts: { lineIndex: number; quantity: string; sku: string | null }[] = [];
    for (const c of interp.lines) {
      const l = o.validation.order.lines.find((x) => x.source_line_id === c.sourceLineId);
      if (!l) throw new Conflict(`Line ${c.sourceLineId} is not on this order`);
      if (!c.quantity) continue;
      const left = open.get(l.line_index) ?? Dec.ZERO;
      const q = Dec.of(c.quantity);
      if (left.lt(q)) throw new Conflict(`Line ${c.sourceLineId}: the reply offers ${c.quantity}, more than the ${left.toFixedPoint()} ordered. Ask the retailer for a new PO instead`);
      if (q.lt(left)) cuts.push({ lineIndex: l.line_index, quantity: left.add(q.mul(NEG)).toFixedPoint(), sku: l.sku ?? null });
    }
    s.portal.replies ??= [];
    const id = nextId(s.portal.replies);
    s.portal.replies.push({ id, documentId: docId, text: body, interpretation: interp, appliedBy: who.actor, appliedAt: now });
    s.portal.cancellations ??= [];
    for (const c of cuts) {
      s.portal.cancellations.push({ documentId: docId, lineIndex: c.lineIndex, quantity: c.quantity,
        reason: "Supplier reply: cannot ship the full quantity", createdBy: who.actor, createdAt: now });
    }
    s.audit.push({ id: nextId(s.audit), entityType: "document", entityId: docId, event: "supplier_reply_applied", actor: who.actor,
      detail: { reply_id: id, changes: interp.lines.length, ship_date: interp.shipDate, interpreter: interp.interpreter.name }, createdAt: now });
    const { msg: built, check } = ordrspFor(s, o, now, interp, id);
    const msg = addMessage(s, now, { kind: "ORDRSP", channel: "retailer_edi_outbox", documentId: docId, sourceType: "order",
      sourceId: o.erpOrderId, idempotencyKey: `ORDRSP:${o.erpOrderId}:reply-${id}`, ...edifact(built, check) });
    if (blocking(check).length) note(msg, now, "pending", "held", `Held, not sent: ${refusal(check)} Fix the EDI setup, then retry.`);
    else dispatch(s, now, msg);
    const erp = addMessage(s, now, { kind: "ERP_ORDER_CHANGE", channel: "supplier_erp", documentId: docId, sourceType: "order",
      sourceId: `REPLY-${o.erpOrderId}-${id}`, idempotencyKey: `ERP-REPLY:${o.erpOrderId}:${id}`,
      ...json({ order_change_for: o.erpOrderId, reduce_quantity: cuts.map((c) => ({ sku: c.sku, by: c.quantity })),
        price_changes: interp.lines.filter((c) => c.unitPrice).map((c) => ({ line: c.sourceLineId, unit_price: c.unitPrice })),
        ship_date: interp.shipDate, source: "supplier reply" },
      [{ segment: "reduce_quantity", meaning: "Quantity the supplier will not ship; the ERP lowers the order line" },
        { segment: "price_changes", meaning: "Price the supplier quoted; awaits the retailer's acceptance" }]) });
    dispatch(s, now, erp);
  });
}

/**
 * D54: the supplier marks the order shipped in their own ERP. The agent builds the ASN from what is still open
 * (so a reply that cut a quantity ships the confirmed amount) and the invoice from the ASN. Both go to the retailer
 * with the usual checks; the supplier types neither.
 */
export function shipFromErp(state: RunState, docId: number, ship: { carrierScac: string; trackingNumber: string },
  who: Who, clock: Clock = systemClock): RunState {
  const o = orderFor(state, docId);
  if (o.fulfilment?.status === "needs_decision") throw new Conflict("Choose how to ship the short stock first");
  const plan = shippable(state, docId);
  const holding = o.fulfilment?.choice === "ship_complete" && plan.some((p) => p.qty.lt(p.open));
  if (holding) throw new Conflict("This order ships complete and some stock has not arrived yet. Receive it in ERP records, or switch to a split shipment");
  let s = submitAsn(state, docId, {
    lines: plan.map((p) => ({ lineIndex: p.lineIndex, shippedQty: p.qty.toFixedPoint() })),
    carrierScac: ship.carrierScac, trackingNumber: ship.trackingNumber,
  }, who, clock);
  const asn = s.portal!.asns.filter((a) => a.documentId === docId).at(-1)!;
  s = submitInvoice(s, asn.id, { lines: invoiceLinesFor(s, asn).map((l) => ({ lineIndex: l.lineIndex, quantity: l.quantity })) }, who, clock);
  return s;
}

/** D61: per line, what is still open and how much of it ERP stock can cover now (stock held by other orders aside). */
export function shippable(s: RunState, docId: number) {
  const o = orderFor(s, docId);
  const open = openQuantities(s, docId);
  return o.validation.order.lines.map((l) => {
    const left = open.get(l.line_index) ?? Dec.ZERO;
    const free = l.sku ? freeStock(s, l.sku, docId) : null;
    return { lineIndex: l.line_index, open: left, qty: free === null || !free.lt(left) ? left : free };
  });
}

/** Close quantity that will not ship (ship-available choice), so the ASN and invoice follow the plan. */
function cancelShort(s: Run, now: string, o: OrderRow, reason: string) {
  s.portal.cancellations ??= [];
  if (s.portal.cancellations.some((c) => c.documentId === o.documentId && c.reason === reason)) return;
  for (const p of o.fulfilment!.parts) {
    if (p.kind === "cancelled") s.portal.cancellations.push({ documentId: o.documentId, lineIndex: p.lineIndex, quantity: p.quantity,
      reason, createdBy: o.fulfilment!.decidedBy ?? "system:order-agent", createdAt: now });
  }
}

/**
 * D61: a person settles how a short order ships: hold and ship complete, ship what is there and backorder the rest,
 * or ship what is there and cancel the rest. Optionally a later ship date. The ERP order gets the schedule and the
 * retailer gets the confirmation with each line's quantities and dates.
 */
export function decideFulfilment(state: RunState, docId: number, input: { choice: "ship_complete" | "split" | "ship_available"; shipOn?: string | null },
  who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (s, now) => {
    const o = orderFor(s, docId);
    if (o.deliveryState !== "erp_created" || !o.fulfilment) throw new Conflict("The stock check runs once the order is in the ERP");
    if (s.portal.outbound.some((m) => m.kind === "ORDRSP" && m.documentId === docId)) throw new Conflict("The retailer already has the confirmation; change it with a reply instead");
    const shipOn = input.shipOn?.trim() || null;
    if (shipOn && !isIsoDate(shipOn)) throw new Conflict("Ship date must be a date (YYYY-MM-DD)");
    let parts;
    try { parts = choose(o.fulfilment, input.choice, shipOn); } catch (e) { throw new Conflict((e as Error).message); }
    Object.assign(o.fulfilment, { status: "confirmed", choice: input.choice, decidedBy: who.actor, decidedAt: now, parts });
    s.audit.push({ id: nextId(s.audit), entityType: "document", entityId: docId, event: "fulfilment_decided", actor: who.actor,
      detail: { choice: input.choice, ship_on: firstShipOn(parts), backordered: parts.filter((p) => p.kind === "backorder").length,
        cancelled: parts.filter((p) => p.kind === "cancelled").length }, createdAt: now });
    const erp = addMessage(s, now, { kind: "ERP_ORDER_CHANGE", channel: "supplier_erp", documentId: docId, sourceType: "order",
      sourceId: `SCHEDULE-${o.erpOrderId}`, idempotencyKey: `ERP-SCHEDULE:${o.erpOrderId}`,
      ...json({ order_change_for: o.erpOrderId, schedule: parts.map((p) => ({
        sku: o.validation.order.lines.find((l) => l.line_index === p.lineIndex)?.sku ?? null, quantity: p.quantity, ship_on: p.shipOn, kind: p.kind })) },
      [{ segment: "schedule", meaning: "What ships when: now, backordered to a later date, or cancelled" }]) });
    dispatch(s, now, erp);
    confirmOrder(s, now, docId);
  });
}

/** D61: an incoming purchase order from the supplier's own vendor arrives; its quantity joins stock on hand. */
export function receiveStock(state: RunState, sku: string, ref: string, who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (s, now) => {
    const stock = structuredClone(stockOf(s));
    const item = stock.find((x) => x.sku === sku);
    const inc = item?.incoming.find((x) => x.ref === ref);
    if (!item || !inc) throw new Conflict("That incoming delivery is not on file");
    item.onHand = Dec.of(item.onHand).add(Dec.of(inc.quantity)).toFixedPoint();
    item.incoming = item.incoming.filter((x) => x !== inc);
    s.erpStock = stock;
    s.audit.push({ id: nextId(s.audit), entityType: "system", entityId: 0, event: "stock_received", actor: who.actor,
      detail: { sku, ref, quantity: inc.quantity }, createdAt: now });
  });
}

/** D61: an administrator corrects an ERP stock record (on hand and lead time). */
export function setStock(state: RunState, sku: string, input: { onHand: string; leadTimeDays: number }, who: Who, clock: Clock = systemClock): RunState {
  if (who.role !== "administrator") throw new Forbidden("Only an administrator can change ERP records");
  if (!decimalString.safeParse(input.onHand).success || input.onHand.startsWith("-")) throw new Conflict("On hand must be a number of zero or more");
  if (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0 || input.leadTimeDays > 365) throw new Conflict("Lead time must be 0 to 365 days");
  return act(state, clock, (s, now) => {
    const stock = structuredClone(stockOf(s));
    const item = stock.find((x) => x.sku === sku);
    if (item) Object.assign(item, { onHand: input.onHand, leadTimeDays: input.leadTimeDays });
    else stock.push({ sku, onHand: input.onHand, leadTimeDays: input.leadTimeDays, incoming: [] });
    s.erpStock = stock;
    s.audit.push({ id: nextId(s.audit), entityType: "system", entityId: 0, event: "stock_updated", actor: who.actor,
      detail: { sku, on_hand: input.onHand, lead_time_days: input.leadTimeDays }, createdAt: now });
  });
}

export const repliesFor = (s: RunState, docId: number) => (s.portal?.replies ?? []).filter((r) => r.documentId === docId);

// ---------- step 2: ASN with packing ----------

export interface PackingInput {
  /** Cartons per pallet; default: every carton on one pallet. */
  cartonsPerPallet?: number | null;
  /** Units per carton for each line; default: the whole line in one carton. */
  unitsPerCarton?: { lineIndex: number; units: string }[];
}
export interface AsnInput {
  lines: { lineIndex: number; shippedQty: string; overrideReason?: string | null }[];
  despatchDate?: string | null;
  estimatedDelivery?: string | null;
  /** D51: carrier details for the 856; each optional. */
  carrierScac?: string | null;
  bolNumber?: string | null;
  trackingNumber?: string | null;
  packing?: PackingInput;
}

const MAX_UNITS = 2000;

/** Split shipped lines into cartons, then cartons onto pallets, numbering every unit with an SSCC. */
export function packShipment(shipped: { lineIndex: number; sourceLineId: string; shippedQty: string }[],
  packing: PackingInput | undefined, companyPrefix: string, lastSerial: number): { pallets: Pallet[]; lastSerial: number } {
  const per = new Map((packing?.unitsPerCarton ?? []).map((u) => [u.lineIndex, u.units.trim()]));
  const cartons: Pallet["cartons"][number]["contents"][] = [];
  for (const l of shipped) {
    const q = Dec.of(l.shippedQty);
    const raw = per.get(l.lineIndex) || l.shippedQty;
    if (!decimalString.safeParse(raw).success || !Dec.ZERO.lt(Dec.of(raw))) {
      throw new Conflict(`Line ${l.sourceLineId}: units per carton must be a number above zero`);
    }
    const u = Dec.of(raw);
    if (!q.isIntegral() || !u.isIntegral() || !u.lt(q)) { cartons.push([{ lineIndex: l.lineIndex, quantity: l.shippedQty }]); continue; }
    let left = q;
    while (Dec.ZERO.lt(left)) {
      const take = left.lt(u) ? left : u;
      cartons.push([{ lineIndex: l.lineIndex, quantity: take.normalize().toFixedPoint() }]);
      left = left.add(take.mul(NEG));
      if (cartons.length > MAX_UNITS) throw new Conflict(`More than ${MAX_UNITS} cartons; check the units per carton`);
    }
  }
  const perPallet = packing?.cartonsPerPallet ?? cartons.length;
  if (!Number.isInteger(perPallet) || perPallet < 1) throw new Conflict("Cartons per pallet must be a whole number of 1 or more");
  let serial = lastSerial;
  const pallets: Pallet[] = [];
  for (let i = 0; i < cartons.length; i += perPallet) {
    const pallet = sscc(companyPrefix, ++serial);
    pallets.push({ sscc: pallet, cartons: cartons.slice(i, i + perPallet).map((contents) => ({ sscc: sscc(companyPrefix, ++serial), contents })) });
  }
  return { pallets, lastSerial: serial };
}

export interface AsnDraft { asn: Asn; message: EdiMessage; compliance: ComplianceResult; lastSerial: number }

/** Build the ASN and its DESADV without changing the run. Throws Conflict for input that cannot be an ASN. */
export function draftAsn(s: RunState, docId: number, input: AsnInput, actor: string, now: string): AsnDraft {
  const o = orderFor(s, docId);
  if (o.deliveryState !== "erp_created" || !o.erpOrderId) throw new Conflict("An ASN needs an order delivered to the ERP");
  const open = openQuantities(s, docId);
  if (![...open.values()].some((q) => Dec.ZERO.lt(q))) throw new Conflict("Nothing is left to ship on this order");
  const first = !(s.portal?.asns ?? []).some((a) => a.documentId === docId);
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
    const ordered = open.get(l.line_index) ?? Dec.of(l.quantity);
    const reason = g.overrideReason?.trim() || null;
    if (ordered.lt(shipped) && !reason) {
      throw new Conflict(`Line ${l.source_line_id}: shipped ${g.shippedQty} is more than the ${first ? `${l.quantity} ordered` : `${ordered.toFixedPoint()} still open`}. `
        + "Give an override reason to ship more.");
    }
    if (!shipped.isZero()) anyShipped = true;
    return { lineIndex: l.line_index, sourceLineId: l.source_line_id, sku: l.sku, gtin: l.gtin, description: l.description,
      unit: l.unit, orderedQty: l.quantity, shippedQty: g.shippedQty, overrideReason: ordered.lt(shipped) ? reason : null,
      ...(first ? {} : { openQty: ordered.toFixedPoint() }) };
  });
  if (!anyShipped) throw new Conflict("Nothing is shipped: at least one line needs a quantity above zero");

  const despatchDate = input.despatchDate?.trim() || dateOnly(now);
  const requested = isoDate(o.validation.order.requested_delivery_date) ?? "";
  const estimatedDelivery = input.estimatedDelivery === undefined
    ? (isIsoDate(requested) ? requested : "") : (input.estimatedDelivery ?? "").trim();
  for (const [v, what] of [[despatchDate, "Despatch date"], [estimatedDelivery, "Estimated delivery date"]] as const) {
    if (v && !isIsoDate(v)) throw new Conflict(`${what} must be a date (YYYY-MM-DD)`);
  }

  const carrierScac = (input.carrierScac ?? "").trim().toUpperCase();
  if (carrierScac && !/^[A-Z]{2,4}$/.test(carrierScac)) throw new Conflict("Carrier SCAC must be 2 to 4 letters, for example UPSN");
  const ref = (v: string | null | undefined, what: string) => {
    const t = (v ?? "").trim();
    if (t.length > 30 || /[^A-Za-z0-9 -]/.test(t)) throw new Conflict(`${what} may use letters, digits, spaces and dashes, up to 30`);
    return t;
  };
  const bolNumber = ref(input.bolNumber, "Bill of lading number");
  const trackingNumber = ref(input.trackingNumber, "Tracking number");

  const sup = supplierSetup(s);
  const shipped = lines.filter((l) => !Dec.of(l.shippedQty).isZero());
  const { pallets, lastSerial } = packShipment(shipped, input.packing, sup.companyPrefix, s.portal?.ssccSerial ?? 0);
  const id = nextId(s.portal?.asns ?? []);
  const asn: Asn = { id, asnNumber: `ASN-${pad(id)}`, documentId: docId, erpOrderId: o.erpOrderId, lines, despatchDate,
    ...(estimatedDelivery ? { estimatedDelivery } : {}),
    ...(carrierScac ? { carrierScac } : {}), ...(bolNumber ? { bolNumber } : {}), ...(trackingNumber ? { trackingNumber } : {}), pallets, createdBy: actor, createdAt: now };

  const ctx = ediContext(s, o);
  const ediPallets: EdiPallet[] = pallets.map((p) => ({ sscc: p.sscc,
    cartons: p.cartons.map((c) => ({ sscc: c.sscc, lines: c.contents.map((x) => ediLine(o, x.lineIndex, x.quantity)) })) }));
  const message = (ctx.profile === "x12_retail" ? buildDesadvX12 : buildDesadv)({ ref: asn.asnNumber, createdAt: now, despatchDate, estimatedDelivery: estimatedDelivery || null,
    carrierScac: carrierScac || null, bolNumber: bolNumber || null, trackingNumber: trackingNumber || null, ...ctx.parties }, ediPallets);
  return { asn, message, compliance: checkMessage("DESADV", message.text, ctx.profile), lastSerial };
}

export function submitAsn(state: RunState, docId: number, input: AsnInput, who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (s, now) => {
    const { asn, message, compliance, lastSerial } = draftAsn(s, docId, input, who.actor, now);
    if (blocking(compliance).length) throw new Conflict(refusal(compliance));
    const o = orderFor(s, docId);
    s.portal.asns.push(asn);
    s.portal.ssccSerial = lastSerial;
    const lines = asn.lines;
    s.audit.push({ id: nextId(s.audit), entityType: "document", entityId: docId, event: "asn_submitted", actor: who.actor,
      detail: { asn: asn.asnNumber, short_lines: lines.filter((l) => Dec.of(l.shippedQty).lt(Dec.of(l.orderedQty))).length,
        pallets: asn.pallets!.length, cartons: asn.pallets!.reduce((t, p) => t + p.cartons.length, 0) },
      createdAt: now });

    const shippedLines = lines.filter((l) => !Dec.of(l.shippedQty).isZero());
    const erp = addMessage(s, now, { kind: "ERP_SHIPMENT", channel: "supplier_erp", documentId: docId, sourceType: "asn",
      sourceId: asn.asnNumber, idempotencyKey: `ERP-SHIPMENT:${asn.asnNumber}`,
      ...json({ shipment_for: o.erpOrderId, asn: asn.asnNumber, po_number: o.validation.order.po_number,
        despatch_date: asn.despatchDate, estimated_delivery: asn.estimatedDelivery ?? null,
        carrier_scac: asn.carrierScac ?? null, bol_number: asn.bolNumber ?? null, tracking_number: asn.trackingNumber ?? null,
        lines: shippedLines.map((l) => ({ sku: l.sku, shipped_qty: l.shippedQty, ordered_qty: l.orderedQty, unit: l.unit,
          override_reason: l.overrideReason })),
        pallets: asn.pallets },
      [{ segment: "shipment_for", meaning: `Shipment against ERP order ${o.erpOrderId}` },
        { segment: "lines[].shipped_qty", meaning: "Quantity actually shipped, as entered on the ASN" },
        { segment: "pallets[].sscc", meaning: "Pallet and carton SSCCs, to print on the logistic labels" }]) });
    const edi = addMessage(s, now, { kind: "DESADV", channel: "retailer_edi_outbox", documentId: docId, sourceType: "asn",
      sourceId: asn.asnNumber, idempotencyKey: `DESADV:${asn.asnNumber}`, ...edifact(message, compliance) });
    dispatch(s, now, erp);
    dispatch(s, now, edi);
    consumeStock(s, shippedLines.map((l) => ({ sku: l.sku, quantity: l.shippedQty }))); // D61: the ERP issues the goods
  });
}

// ---------- step 3: invoice with tax, allowances and a three-way match ----------

export const ALLOWANCE_CODES = {
  allowance: { DI: "Discount" },
  charge: { FC: "Freight charge" },
} as const;

export interface InvoiceInput {
  lines: { lineIndex: number; quantity: string; taxRate?: string | null }[];
  allowances?: { kind: "allowance" | "charge"; code: string; description?: string | null; percent?: string | null;
    amount?: string | null; taxRate: string }[];
}

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

export interface InvoiceTotals {
  lineTotal: string; taxableAmount: string; taxAmount: string; invoiceAmount: string;
  byRate: { rate: string; taxable: string; tax: string }[];
}

/** Lines per rate, less allowances, plus charges; tax per rate rounded half-up to cents; then the sums. */
export function invoiceTotals(lines: Invoice["lines"], allowances: InvoiceAllowance[]): InvoiceTotals {
  const base = new Map<string, Dec>();
  const add = (rate: string, d: Dec) => { const k = rateKey(Dec.of(rate)); base.set(k, (base.get(k) ?? Dec.ZERO).add(d)); };
  let lineTotal = Dec.ZERO;
  for (const l of lines) { lineTotal = lineTotal.add(Dec.of(l.lineAmount)); add(l.taxRate!, Dec.of(l.lineAmount)); }
  for (const a of allowances) add(a.taxRate, a.kind === "allowance" ? Dec.of(a.amount).mul(NEG) : Dec.of(a.amount));
  const byRate = [...base.entries()].sort((a, b) => Dec.of(a[0]).cmp(Dec.of(b[0]))).map(([rate, b]) => {
    if (b.lt(Dec.ZERO)) throw new Conflict(`Allowances at ${rate}% are larger than the lines taxed at ${rate}%`);
    return { rate, taxable: money(b), tax: money(b.mul(Dec.of(rate)).div(HUNDRED)) };
  });
  const taxable = byRate.reduce((t, r) => t.add(Dec.of(r.taxable)), Dec.ZERO);
  const tax = byRate.reduce((t, r) => t.add(Dec.of(r.tax)), Dec.ZERO);
  return { lineTotal: money(lineTotal), taxableAmount: money(taxable), taxAmount: money(tax),
    invoiceAmount: money(taxable.add(tax)), byRate };
}

export interface MatchRow {
  sourceLineId: string; description: string | null; unit: string;
  poQty: string; poPrice: string | null; asnQty: string; invoiceQty: string | null; invoicePrice: string | null;
  status: "matched" | "short_shipped" | "over_shipped" | "not_shipped" | "mismatch"; note: string;
}

/** PO against ASN against invoice, line by line. Only "mismatch" blocks; short and over shipments are explained. */
export function threeWayMatch(s: RunState, asn: Asn, invLines: Invoice["lines"]): MatchRow[] {
  const o = orderFor(s, asn.documentId);
  return asn.lines.map((a) => {
    const po = o.validation.order.lines.find((x) => x.line_index === a.lineIndex)!;
    const inv = invLines.find((x) => x.lineIndex === a.lineIndex) ?? null;
    const shipped = Dec.of(a.shippedQty);
    const row = { sourceLineId: a.sourceLineId, description: a.description, unit: a.unit, poQty: a.orderedQty,
      poPrice: po.unit_price, asnQty: a.shippedQty, invoiceQty: inv?.quantity ?? null, invoicePrice: inv?.unitPrice ?? null };
    if (shipped.isZero()) {
      return inv ? { ...row, status: "mismatch" as const, note: "Invoiced but not shipped" }
        : { ...row, status: "not_shipped" as const, note: "Not shipped, not invoiced" };
    }
    if (!inv) return { ...row, status: "mismatch" as const, note: "Shipped but missing from the invoice" };
    if (!Dec.of(inv.quantity).eq(shipped)) return { ...row, status: "mismatch" as const, note: `Invoice quantity ${inv.quantity} is not the shipped ${a.shippedQty}` };
    if (!po.unit_price || !Dec.of(inv.unitPrice).eq(Dec.of(po.unit_price))) {
      return { ...row, status: "mismatch" as const, note: `Invoice price ${inv.unitPrice} is not the order price ${po.unit_price ?? "(none)"}` };
    }
    if (shipped.lt(Dec.of(a.orderedQty))) return { ...row, status: "short_shipped" as const, note: "Short shipment: invoiced what shipped" };
    if (Dec.of(a.orderedQty).lt(shipped)) return { ...row, status: "over_shipped" as const, note: `Over-shipped: ${a.overrideReason ?? ""}` };
    return { ...row, status: "matched" as const, note: "Order, ASN and invoice agree" };
  });
}

export interface InvoiceDraft {
  invoice: Invoice; message: EdiMessage; compliance: ComplianceResult; match: MatchRow[]; totals: InvoiceTotals;
}

export function draftInvoice(s: RunState, asnId: number, input: InvoiceInput, actor: string, now: string): InvoiceDraft {
  const asn = s.portal?.asns.find((a) => a.id === asnId);
  if (!asn) throw new Conflict("Unknown ASN");
  const prior = s.portal?.invoices.find((i) => i.asnId === asnId);
  if (prior) throw new Conflict(`${asn.asnNumber} already has invoice ${prior.invoiceNumber}; one invoice per ASN`);
  const sup = supplierSetup(s);
  const base = invoiceLinesFor(s, asn);
  // The invoice must match its ASN line for line: same lines, same quantities.
  const given = new Map(input.lines.map((l) => [l.lineIndex, l]));
  const mismatch = base.find((l) => {
    const q = given.get(l.lineIndex)?.quantity;
    return q === undefined || !decimalString.safeParse(q).success || !Dec.of(q).eq(Dec.of(l.quantity));
  });
  if (mismatch || given.size !== base.length || input.lines.length !== base.length) {
    const l = mismatch ?? base[0];
    throw new Conflict(`Invoice does not match ${asn.asnNumber}: line ${l?.sourceLineId ?? "?"} must invoice the shipped `
      + `quantity ${l?.quantity ?? ""}${given.size !== base.length ? " and only lines that were shipped" : ""}`);
  }
  const lines = base.map((l) => {
    const rate = (given.get(l.lineIndex)!.taxRate ?? sup.defaultTaxRate ?? "").trim();
    if (!validRate(rate)) throw new Conflict(`Line ${l.sourceLineId}: give a tax rate from 0 to 100 percent`);
    return { ...l, taxRate: rate };
  });
  const lineRates = new Set(lines.map((l) => rateKey(Dec.of(l.taxRate))));
  const allowances: InvoiceAllowance[] = (input.allowances ?? []).map((a, i) => {
    const codes = ALLOWANCE_CODES[a.kind] as Record<string, string> | undefined;
    if (!codes || !(a.code in codes)) throw new Conflict(`Allowance or charge ${i + 1}: unknown reason code`);
    if (!validRate(a.taxRate) || !lineRates.has(rateKey(Dec.of(a.taxRate)))) {
      throw new Conflict(`Allowance or charge ${i + 1}: its tax rate must be one of the line rates`);
    }
    const pct = a.percent?.trim() || null;
    let amount: string;
    if (pct !== null) {
      if (!validRate(pct) || Dec.of(pct).isZero()) throw new Conflict(`Allowance or charge ${i + 1}: percent must be above 0 and at most 100`);
      const atRate = lines.filter((l) => rateKey(Dec.of(l.taxRate)) === rateKey(Dec.of(a.taxRate)))
        .reduce((t, l) => t.add(Dec.of(l.lineAmount)), Dec.ZERO);
      amount = money(atRate.mul(Dec.of(pct)).div(HUNDRED));
    } else {
      const amt = a.amount?.trim() ?? "";
      if (!decimalString.safeParse(amt).success || !Dec.ZERO.lt(Dec.of(amt))) {
        throw new Conflict(`Allowance or charge ${i + 1}: give an amount above zero or a percent`);
      }
      amount = money(Dec.of(amt));
    }
    const description = (a.description ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 70) || codes[a.code];
    return { kind: a.kind, code: a.code, description, percent: pct, amount, taxRate: a.taxRate.trim() };
  });
  const totals = invoiceTotals(lines, allowances);
  const o = orderFor(s, asn.documentId);
  const id = nextId(s.portal?.invoices ?? []);
  const invoice: Invoice = { id, invoiceNumber: `INV-${pad(id)}`, asnId, documentId: asn.documentId,
    currency: o.validation.order.currency ?? "", lines, subtotal: totals.lineTotal, total: totals.invoiceAmount,
    rounding: "ROUND_HALF_UP to 0.01", taxType: sup.taxType, allowances, taxableAmount: totals.taxableAmount,
    taxAmount: totals.taxAmount, taxByRate: totals.byRate,
    ...(sup.paymentTerms ? { terms: sup.paymentTerms, dueDate: addDays(dateOnly(now), sup.paymentTerms.netDays) } : {}),
    createdBy: actor, createdAt: now };
  const ctx = ediContext(s, o);
  const edi: EdiAllowance[] = allowances.map((a) => ({ ...a }));
  const message = (ctx.profile === "x12_retail" ? buildInvoicX12 : buildInvoic)({ ref: invoice.invoiceNumber, createdAt: now, asnRef: asn.asnNumber, taxType: sup.taxType,
    orderDate: o.validation.order.order_date, terms: invoice.terms ? { ...invoice.terms, termsText: termsText(invoice.terms), dueDate: invoice.dueDate } : undefined,
    ...ctx.parties }, lines.map((l) => ({ ...l, customerItemCode: o.validation.order.lines.find((x) => x.line_index === l.lineIndex)
    ?.customer_item_code ?? null })), edi, totals);
  return { invoice, message, compliance: checkMessage("INVOIC", message.text, ctx.profile),
    match: threeWayMatch(s, asn, lines), totals };
}

export function submitInvoice(state: RunState, asnId: number, input: InvoiceInput, who: Who,
  clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (s, now) => {
    const { invoice: inv, message, compliance, match } = draftInvoice(s, asnId, input, who.actor, now);
    const bad = match.filter((m) => m.status === "mismatch");
    if (bad.length) throw new Conflict(`Three-way match failed: ${bad.map((m) => `line ${m.sourceLineId}: ${m.note}`).join("; ")}`);
    if (blocking(compliance).length) throw new Conflict(refusal(compliance));
    const asn = s.portal.asns.find((a) => a.id === asnId)!;
    s.portal.invoices.push(inv);
    s.audit.push({ id: nextId(s.audit), entityType: "document", entityId: asn.documentId, event: "invoice_submitted",
      actor: who.actor, detail: { invoice: inv.invoiceNumber, asn: asn.asnNumber, total: inv.total }, createdAt: now });
    const erp = addMessage(s, now, { kind: "ERP_INVOICE", channel: "supplier_erp", documentId: asn.documentId,
      sourceType: "invoice", sourceId: inv.invoiceNumber, idempotencyKey: `ERP-INVOICE:${inv.invoiceNumber}`,
      ...json({ invoice: inv.invoiceNumber, asn: asn.asnNumber, erp_order: asn.erpOrderId, currency: inv.currency,
        lines: inv.lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unit_price: l.unitPrice, line_amount: l.lineAmount,
          tax_rate: l.taxRate })),
        allowances: inv.allowances, line_total: inv.subtotal, taxable_amount: inv.taxableAmount, tax_type: inv.taxType,
        tax_by_rate: inv.taxByRate, tax_amount: inv.taxAmount, invoice_amount: inv.total },
      [{ segment: "lines[].quantity", meaning: `Quantity from ${asn.asnNumber}, not the purchase order` },
        { segment: "lines[].unit_price", meaning: "Unit price from the delivered order" },
        { segment: "invoice_amount", meaning: "Taxable amount plus tax; exact decimals, tax rounded half-up to cents per rate" }]) });
    const edi = addMessage(s, now, { kind: "INVOIC", channel: "retailer_edi_outbox", documentId: asn.documentId,
      sourceType: "invoice", sourceId: inv.invoiceNumber, idempotencyKey: `INVOIC:${inv.invoiceNumber}`,
      ...edifact(message, compliance) });
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
    // An order confirmation held by the compliance check is rebuilt from the current EDI setup before it goes.
    if (msg.kind === "ORDRSP" && msg.attempts.some((a) => a.outcome === "held")
      && !s.portal.received.some((r) => r.idempotencyKey === msg.idempotencyKey)) {
      const { msg: built, check } = ordrspFor(s, orderFor(s, msg.documentId), msg.createdAt);
      Object.assign(msg, edifact(built, check));
      if (blocking(check).length) {
        note(msg, now, "pending", "held", `Still held: ${refusal(check)}`);
        return;
      }
    }
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

/** D52: per order line, what is still to ship: ordered, less every ASN's shipped quantity, less cancellations. */
export function openQuantities(s: RunState, docId: number): Map<number, Dec> {
  const o = orderFor(s, docId);
  const p = s.portal ?? emptyPortal();
  const out = new Map<number, Dec>();
  for (const l of o.validation.order.lines) {
    let q = l.quantity && decimalString.safeParse(l.quantity).success ? Dec.of(l.quantity) : Dec.ZERO;
    for (const a of p.asns) if (a.documentId === docId) for (const x of a.lines) if (x.lineIndex === l.line_index) q = q.add(Dec.of(x.shippedQty).mul(NEG));
    for (const c of p.cancellations ?? []) if (c.documentId === docId && c.lineIndex === l.line_index) q = q.add(Dec.of(c.quantity).mul(NEG));
    out.set(l.line_index, q.lt(Dec.ZERO) ? Dec.ZERO : q);
  }
  return out;
}

/** D52: the supplier will not ship what is still open. Recorded, audited and sent to the ERP as an order change. */
export function cancelBackorder(state: RunState, docId: number, reason: string, who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  const why = reason.trim();
  if (!why) throw new Conflict("Give a reason for cancelling the rest of the order");
  if (why.length > 200) throw new Conflict("Keep the reason under 200 characters");
  return act(state, clock, (s, now) => {
    const o = orderFor(s, docId);
    if (!s.portal.asns.some((a) => a.documentId === docId)) throw new Conflict("Ship something first; to refuse a whole order, reject it in review");
    const open = [...openQuantities(s, docId)].filter(([, q]) => Dec.ZERO.lt(q));
    if (!open.length) throw new Conflict("Nothing is left open on this order");
    s.portal.cancellations ??= [];
    for (const [lineIndex, q] of open) {
      s.portal.cancellations.push({ documentId: docId, lineIndex, quantity: q.toFixedPoint(), reason: why, createdBy: who.actor, createdAt: now });
    }
    s.audit.push({ id: nextId(s.audit), entityType: "document", entityId: docId, event: "backorder_cancelled", actor: who.actor,
      detail: { lines: open.length, reason: why }, createdAt: now });
    const n = s.portal.cancellations.filter((c) => c.documentId === docId).length;
    const erp = addMessage(s, now, { kind: "ERP_ORDER_CHANGE", channel: "supplier_erp", documentId: docId, sourceType: "order",
      sourceId: `CANCEL-${o.erpOrderId}-${n}`, idempotencyKey: `ERP-CANCEL:${o.erpOrderId}:${n}`,
      ...json({ order_change_for: o.erpOrderId, cancel_open_quantity: open.map(([lineIndex, q]) => ({
        sku: o.validation.order.lines.find((l) => l.line_index === lineIndex)?.sku ?? null, quantity: q.toFixedPoint() })), reason: why },
      [{ segment: "cancel_open_quantity", meaning: "Order quantity that will not ship; the ERP closes the backorder" }]) });
    dispatch(s, now, erp);
  });
}

export function portalForOrder(s: RunState, docId: number) {
  const p = s.portal ?? emptyPortal();
  const msgs = (type: OutboundMessage["sourceType"], id: string) =>
    p.outbound.filter((m) => m.sourceType === type && m.sourceId === id).sort((a, b) => a.id - b.id);
  const shipments = p.asns.filter((a) => a.documentId === docId).sort((a, b) => a.id - b.id).map((a) => {
    const inv = p.invoices.find((i) => i.asnId === a.id) ?? null;
    return { asn: a, asnMessages: msgs("asn", a.asnNumber), invoice: inv, invoiceMessages: inv ? msgs("invoice", inv.invoiceNumber) : [] };
  });
  // The latest shipment, as before D52 when an order had one ASN.
  const asn = shipments.at(-1)?.asn ?? null;
  const invoice = shipments.at(-1)?.invoice ?? null;
  const confirmation = p.outbound.find((m) => m.kind === "ORDRSP" && m.documentId === docId) ?? null;
  const cancelled = (p.cancellations ?? []).filter((c) => c.documentId === docId);
  return {
    confirmation, shipments, cancelled,
    asn, asnMessages: asn ? msgs("asn", asn.asnNumber) : [],
    invoice, invoiceMessages: invoice ? msgs("invoice", invoice.invoiceNumber) : [],
  };
}

export const outboundList = (s: RunState): OutboundMessage[] =>
  [...(s.portal ?? emptyPortal()).outbound].sort((a, b) => b.id - a.id);
