// D61: the stock check and ship date, worked out when an approved order reaches the (simulated) ERP.
//
// Best practice it follows (available-to-promise, as ERP order promising does it):
//   ready date   = today when the stock is free; else when the supplier's own incoming PO lands; else today + lead time
//   ship date    = ready date + packing working days, never before the PO's "ship not before" date
//   ship by      = the earlier of the PO's "ship no later than" date and its delivery date less transit working days
// Free stock is what is on hand less what earlier orders already hold for shipping now (a reservation), so two
// orders never promise the same cases. Stock and dates come from the ERP records in RunState (fictional, editable).
//
// When stock is short a person chooses: hold and ship complete, or ship what is there and backorder the rest
// (or, by setting, ship what is there and cancel the rest). The retailer's confirmation waits for that choice and
// then carries each line's quantities and dates. Lateness alone is a warning, never a hold.
import bundledStock from "./erp-stock.v1.json";
import { addDays, addWorkdays, maxDate, minDate, subtractWorkdays } from "./dates";
import { orderDate } from "./checks";
import { Dec } from "./money";
import { type Fulfilment, type FulfilmentSettings, type RunState, type ShipPart, type StockItem, decimalString } from "./run-state";

type FulfilmentT = Fulfilment;
type Choice = "ship_complete" | "split" | "ship_available";
export const DEFAULT_FULFILMENT: FulfilmentSettings = { packDays: 2, transitDays: 3, shortStock: "ask", retailers: [] };

export const BUNDLED_STOCK: StockItem[] = bundledStock.items as StockItem[];
export const stockOf = (s: RunState): StockItem[] => s.erpStock ?? BUNDLED_STOCK;
export const fulfilmentSettings = (s: RunState): FulfilmentSettings => s.fulfilmentSettings ?? DEFAULT_FULFILMENT;

/** Transit days and short-stock rule for one retailer, falling back to the supplier-wide settings. */
export function retailerRules(s: RunState, customerId: string | null | undefined) {
  const set = fulfilmentSettings(s);
  const r = set.retailers.find((x) => x.customerId === customerId);
  return { transitDays: r?.transitDays ?? set.transitDays, shortStock: r?.shortStock ?? set.shortStock, packDays: set.packDays };
}

const ZERO = Dec.ZERO;
const NEG = Dec.of("-1");
const d = (v: string | null | undefined) => (v && decimalString.safeParse(v).success ? Dec.of(v) : ZERO);
const sub = (a: Dec, b: Dec) => a.add(b.mul(NEG));
const pos = (a: Dec) => (a.lt(ZERO) ? ZERO : a);
const min = (a: Dec, b: Dec) => (a.lt(b) ? a : b);

type OrderRow = RunState["orders"][number];

/** The PO's terms as read from the document (D59), for the order's current version. */
export function termsOf(s: RunState, o: OrderRow) {
  return s.versions.find((v) => v.documentId === o.documentId && v.version === o.currentVersion)?.payload.terms;
}

/** Shipped quantity on one line of one order, from its ASNs. */
function shipped(s: RunState, docId: number, lineIndex: number): Dec {
  let q = ZERO;
  for (const a of s.portal?.asns ?? []) if (a.documentId === docId) for (const x of a.lines) if (x.lineIndex === lineIndex) q = q.add(Dec.of(x.shippedQty));
  return q;
}

/** Stock other orders already hold to ship now (their "now" quantities not yet shipped). */
export function reserved(s: RunState, sku: string, exceptDocId: number | null): Dec {
  let q = ZERO;
  for (const o of s.orders) {
    if (o.documentId === exceptDocId || !o.fulfilment) continue;
    for (const p of o.fulfilment.parts) {
      if (p.kind !== "now") continue;
      const line = o.validation.order.lines.find((l) => l.line_index === p.lineIndex);
      if (line?.sku !== sku) continue;
      q = q.add(pos(sub(Dec.of(p.quantity), shipped(s, o.documentId, p.lineIndex))));
    }
  }
  return q;
}

/** Free stock for a SKU right now: on hand less what other orders hold. Null when the ERP has no record. */
export function freeStock(s: RunState, sku: string, exceptDocId: number | null = null): Dec | null {
  const item = stockOf(s).find((x) => x.sku === sku);
  return item ? pos(sub(Dec.of(item.onHand), reserved(s, sku, exceptDocId))) : null;
}

export function planFulfilment(s: RunState, docId: number, now: string): FulfilmentT {
  const o = s.orders.find((x) => x.documentId === docId)!;
  const ord = o.validation.order;
  const today = now.slice(0, 10);
  const rules = retailerRules(s, ord.customer_id);
  const terms = termsOf(s, o);
  // D63: a date a person chose for an unclear printed date wins; an ambiguous printed date is never read.
  const orderDay = orderDate(ord, "order_date", ord.order_date, today) ?? today;
  const notBefore = orderDate(ord, "ship_not_before", terms?.ship_not_before?.value, orderDay);
  const noLaterThan = orderDate(ord, "ship_no_later_than", terms?.ship_no_later_than?.value, orderDay);
  const deliverBy = orderDate(ord, "requested_delivery_date", ord.requested_delivery_date, orderDay);
  const shipBy = minDate(noLaterThan, deliverBy ? subtractWorkdays(deliverBy, rules.transitDays) : null);
  const dispatch = (ready: string) => maxDate(addWorkdays(ready, rules.packDays), notBefore)!;

  const lines = ord.lines.map((l) => {
    const ordered = d(l.quantity);
    const item = l.sku ? stockOf(s).find((x) => x.sku === l.sku) : undefined;
    // No ERP record (or no product yet): not stock-managed here, so nothing is promised short.
    const free = item ? pos(sub(Dec.of(item.onHand), reserved(s, item.sku, docId))) : ordered;
    const availableNow = min(ordered, free);
    const short = sub(ordered, availableNow);
    let shortReadyOn: string | null = null;
    let shortSource: "incoming" | "lead_time" | null = null;
    if (item && ZERO.lt(short)) {
      let cum = ZERO;
      for (const inc of [...item.incoming].sort((a, b) => a.expected.localeCompare(b.expected))) {
        cum = cum.add(Dec.of(inc.quantity));
        if (!cum.lt(short)) { shortReadyOn = maxDate(inc.expected, today); shortSource = "incoming"; break; }
      }
      if (!shortReadyOn) { shortReadyOn = addDays(today, item.leadTimeDays); shortSource = "lead_time"; }
    }
    return { lineIndex: l.line_index, sku: l.sku ?? null, ordered: ordered.toFixedPoint(), availableNow: availableNow.toFixedPoint(),
      short: short.toFixedPoint(), shortReadyOn, shortSource };
  });

  const nowDate = dispatch(today);
  const anyShort = lines.some((l) => ZERO.lt(Dec.of(l.short)));
  const completeDate = dispatch(maxDate(today, ...lines.map((l) => l.shortReadyOn))!);
  const isLate = (date: string | null) => Boolean(shipBy && date && date > shipBy);
  const part = (lineIndex: number, quantity: string, shipOn: string | null, kind: ShipPart["kind"]): ShipPart => ({ lineIndex, quantity, shipOn, kind });

  const complete = lines.map((l) => part(l.lineIndex, l.ordered, completeDate, "now"));
  const options: FulfilmentT["options"] = { ship_complete: { parts: complete, late: isLate(completeDate) } };
  if (anyShort) {
    const nowParts = lines.filter((l) => ZERO.lt(Dec.of(l.availableNow))).map((l) => part(l.lineIndex, l.availableNow, nowDate, "now"));
    const backorders = lines.filter((l) => ZERO.lt(Dec.of(l.short))).map((l) => part(l.lineIndex, l.short, dispatch(l.shortReadyOn!), "backorder"));
    const cancelled = lines.filter((l) => ZERO.lt(Dec.of(l.short))).map((l) => part(l.lineIndex, l.short, null, "cancelled"));
    options.split = { parts: [...nowParts, ...backorders], late: isLate(nowDate) || backorders.some((b) => isLate(b.shipOn)) };
    options.ship_available = { parts: [...nowParts, ...cancelled], late: isLate(nowDate) };
  }
  // Hold for the full quantity when that is still on time or the PO asks for complete shipments; otherwise split.
  const recommended: Choice = !anyShort || !options.ship_complete.late || terms?.ship_complete ? "ship_complete" : "split";
  const policy = rules.shortStock;
  const choice: Choice | null = !anyShort ? "ship_complete" : policy === "ask" ? null : policy;
  return {
    checkedOn: today, lines,
    window: { notBefore, noLaterThan, deliverBy, transitDays: rules.transitDays, packDays: rules.packDays },
    shipBy, options, recommended,
    status: choice ? "confirmed" : "needs_decision",
    choice, decidedBy: choice && anyShort ? "system:order-agent" : null, decidedAt: choice && anyShort ? now : null,
    parts: choice ? options[choice]!.parts : [],
  };
}

/** Earliest a person may move the "ships now" date to: the planned date (stock, packing and the ship window). */
export function earliestShipOn(f: FulfilmentT, choice: Choice): string | null {
  const nowParts = f.options[choice]?.parts.filter((p) => p.kind === "now") ?? [];
  return minDate(...nowParts.map((p) => p.shipOn));
}

/** Apply a person's choice and optional later ship date. Returns the parts the retailer will be told. */
export function choose(f: FulfilmentT, choice: Choice, shipOn: string | null): ShipPart[] {
  const opt = f.options[choice];
  if (!opt) throw new Error("That option is not available for this order");
  const earliest = earliestShipOn(f, choice);
  if (shipOn && earliest && shipOn < earliest) throw new Error(`The earliest the goods can leave is ${earliest}`);
  return opt.parts.map((p) => (p.kind === "now" && shipOn ? { ...p, shipOn } : { ...p }));
}

/** The date the retailer is told for the whole order (the first shipment). */
export const firstShipOn = (parts: ShipPart[]) => minDate(...parts.filter((p) => p.kind === "now").map((p) => p.shipOn));

/** Take shipped quantities out of ERP stock. */
export function consumeStock(s: RunState, lines: { sku: string | null; quantity: string }[]) {
  const stock = structuredClone(stockOf(s));
  for (const l of lines) {
    const item = l.sku ? stock.find((x) => x.sku === l.sku) : undefined;
    if (item) item.onHand = pos(sub(Dec.of(item.onHand), Dec.of(l.quantity))).toFixedPoint();
  }
  s.erpStock = stock;
}
