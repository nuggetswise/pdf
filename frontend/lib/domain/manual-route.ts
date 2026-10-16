// Act 1 of the demo (D49): what this order would cost a supplier on the manual route, retyping the PDF PO into
// the ERP and the retailer's web form. Every number is an editable, labelled assumption; nothing here is measured.
// Pure functions over RunState; money in exact decimals (no binary floats).
import { ASSUMPTION_LABELS, DEFAULT_ASSUMPTIONS, ManualRouteAssumptions } from "./manual-route-schema";
import { Dec, dec, money } from "./money";
import type { RunState } from "./run-state";
export { ASSUMPTION_LABELS, DEFAULT_ASSUMPTIONS, ManualRouteAssumptions };
import { Conflict, type Clock, Forbidden, type Who, systemClock } from "./workflow";

export const assumptionsOf = (s: RunState): ManualRouteAssumptions => s.manualRoute ?? DEFAULT_ASSUMPTIONS;

export type ManualRisk = { label: string; detail: string; amount: string | null; lineIndex: number | null;
  /** The issue the agent raised for it; null for a line the agent fixed from memory without raising one. */
  issueKey: string | null };
export type ManualRoute = {
  fields: { order: number; asn: number; invoice: number; total: number };
  minutes: string;
  labourCost: string;
  expectedKeyingErrors: string;
  /** Errors the agent caught that a person keying the PDF would likely have carried through. */
  risks: ManualRisk[];
  lateAsnExposure: string;
  chargebackExposure: string;
  orderValue: string;
  currency: string;
  /** The two assumptions behind the keying cost, so the screen can show the arithmetic. */
  secondsPerField: string;
  hourlyRate: string;
  lateAsnChancePercent: string;
  lateAsnPenaltyPercent: string;
};

const HUNDRED = Dec.of("100");
const SIXTY = Dec.of("60");
const pct = (v: string) => Dec.of(v).div(HUNDRED);
const abs = (v: Dec) => (v.lt(Dec.ZERO) ? Dec.ZERO.add(Dec.of("-1").mul(v)) : v);

/** Header fields of an order typed into the ERP: PO number, customer, ship-to, order date, delivery date, currency. */
const ORDER_HEADER_FIELDS = 6;
/** Per order line: item identifier, quantity, unit, unit price. */
const ORDER_LINE_FIELDS = 4;
/** ASN header in the web form: ship date, estimated delivery, carrier, BOL or tracking number. */
const ASN_HEADER_FIELDS = 4;
/** Invoice header: invoice number, invoice date. */
const INVOICE_HEADER_FIELDS = 2;

export function manualRoute(s: RunState, docId: number): ManualRoute | null {
  const order = s.orders.find((o) => o.documentId === docId);
  if (!order) return null;
  const a = assumptionsOf(s);
  // Issues stay on the validation result once resolved, so the latest result still lists every error caught.
  const first = order.validation;
  const latest = order.validation;
  const lines = latest.order.lines.length;
  const fields = {
    order: ORDER_HEADER_FIELDS + ORDER_LINE_FIELDS * lines,
    asn: ASN_HEADER_FIELDS + lines,
    invoice: INVOICE_HEADER_FIELDS + lines,
    total: 0,
  };
  fields.total = fields.order + fields.asn + fields.invoice;
  const n = Dec.of(String(fields.total));
  const minutes = n.mul(Dec.of(a.secondsPerField)).div(SIXTY);
  const labour = minutes.div(SIXTY).mul(Dec.of(a.hourlyRate));

  const risks: ManualRisk[] = [];
  const fee = Dec.of(a.asnMismatchFee);
  let exposure = Dec.ZERO;
  for (const i of first.issues) {
    const line = i.line_index == null ? null : first.order.lines[i.line_index] ?? null;
    const label = line ? `Line ${line.source_line_id}` : "Order";
    if (i.code === "price_mismatch") {
      const printed = dec(i.printed_value);
      const ref = dec(Array.isArray(i.reference_value) ? i.reference_value[0] : i.reference_value);
      const q = dec(line?.quantity ?? line?.original_quantity);
      const amount = printed && ref && q ? abs(printed.add(Dec.of("-1").mul(ref))).mul(q) : null;
      if (amount) exposure = exposure.add(amount);
      risks.push({ label, lineIndex: i.line_index, issueKey: i.key,
        detail: "Price differs from your price list. Invoiced at your price, the retailer short-pays the difference.",
        amount: amount ? money(amount) : null });
    } else if (i.code === "outdated_identifier" || i.code === "unknown_item") {
      exposure = exposure.add(fee);
      risks.push({ label, lineIndex: i.line_index, issueKey: i.key,
        detail: i.code === "outdated_identifier"
          ? `Retired GTIN ${i.printed_value ?? ""} keyed onto the ASN; the cartons arrive with a different item.`
          : "Item not on file; keyed as printed, the ASN item will not match what ships.",
        amount: money(fee) });
    } else if (i.code === "moq_violation") {
      risks.push({ label, lineIndex: i.line_index, issueKey: i.key,
        detail: "Below your minimum order quantity. Keyed as printed, it ships at a loss; not a retailer chargeback.",
        amount: null });
    }
  }
  // Lines the agent fixed from approved memory carried an outdated identifier too.
  for (const line of latest.order.lines) {
    if (line.resolved_by?.type === "memory_rule" && !risks.some((r) => r.lineIndex === line.line_index)) {
      exposure = exposure.add(fee);
      risks.push({ label: `Line ${line.source_line_id}`, lineIndex: line.line_index, issueKey: null,
        detail: `Retired GTIN ${line.printed_gtin ?? ""} keyed onto the ASN; the agent replaced it from approved memory.`,
        amount: money(fee) });
    }
  }
  const value = latest.order.lines.reduce((t, l) => t.add(dec(l.line_amount ?? l.printed_line_amount) ?? Dec.ZERO), Dec.ZERO);
  const late = value.mul(pct(a.lateAsnPenaltyPercent)).mul(pct(a.lateAsnChancePercent));
  exposure = exposure.add(late);
  return {
    fields,
    minutes: minutes.quantize(-1, "half_up").toString(),
    labourCost: money(labour),
    expectedKeyingErrors: n.mul(pct(a.keyingErrorPercent)).quantize(-2, "half_up").toString(),
    risks,
    lateAsnExposure: money(late),
    chargebackExposure: money(exposure),
    orderValue: money(value),
    currency: latest.order.currency ?? "USD",
    secondsPerField: a.secondsPerField,
    hourlyRate: a.hourlyRate,
    lateAsnChancePercent: a.lateAsnChancePercent,
    lateAsnPenaltyPercent: a.lateAsnPenaltyPercent,
  };
}

/** Summary tiles: fields the agent kept a person from retyping, and chargeback exposure avoided, over delivered orders. */
export function manualRouteTotals(s: RunState): { fieldsNotRetyped: number; exposureAvoided: string } {
  let fieldsNotRetyped = 0;
  let exposureAvoided = Dec.ZERO;
  for (const o of s.orders) {
    if (o.deliveryState !== "erp_created") continue;
    const m = manualRoute(s, o.documentId);
    if (!m) continue;
    fieldsNotRetyped += m.fields.order;
    exposureAvoided = exposureAvoided.add(Dec.of(m.chargebackExposure));
  }
  return { fieldsNotRetyped, exposureAvoided: money(exposureAvoided) };
}

export function setManualRouteAssumptions(state: RunState, input: unknown, who: Who,
  clock: Clock = systemClock): RunState {
  if (who.role !== "administrator") throw new Forbidden("Only an administrator can change demo settings");
  const parsed = ManualRouteAssumptions.safeParse(input);
  if (!parsed.success) throw new Conflict("Each assumption must be a plain number, for example 20 or 30.00");
  for (const k of ["lateAsnChancePercent", "keyingErrorPercent", "lateAsnPenaltyPercent"] as const) {
    if (Dec.of("100").lt(Dec.of(parsed.data[k]))) throw new Conflict(`${ASSUMPTION_LABELS[k]} cannot exceed 100`);
  }
  const s = structuredClone(state);
  const now = clock.now();
  s.manualRoute = parsed.data;
  s.audit.push({ id: s.audit.reduce((m, r) => Math.max(m, r.id), 0) + 1, entityType: "system", entityId: 0,
    event: "demo_setting_changed", actor: who.actor, detail: { key: "manual_route_assumptions", value: parsed.data },
    createdAt: now });
  return s;
}
