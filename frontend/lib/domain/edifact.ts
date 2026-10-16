// Simulated EANCOM 2002 (UN/EDIFACT directory D.01B, syntax 3) messages for the supplier portal (D45, D47):
// ORDRSP (order response), DESADV (despatch advice / ASN) and INVOIC (invoice). Nothing is sent anywhere real.
// docs/08-edi-mapping.md lists where every segment's value comes from and the source for each qualifier.
//
// Deterministic: the output depends only on the inputs (dates come from the records, never the clock).
// Every value copied from a document is untrusted text, so the EDIFACT release characters ? ' + : are
// escaped with "?" and control characters (line breaks included) are replaced by a space.
import { FICTIONAL_GLN, FICTIONAL_LABEL } from "./gs1";

export { FICTIONAL_GLN, FICTIONAL_LABEL };
export { gln } from "./gs1";

/** UNH message identifiers: message type, directory D.01B, controlling agency UN, EANCOM subset version. */
export const MESSAGE_VERSION = {
  ORDRSP: "ORDRSP:D:01B:UN:EAN009",
  DESADV: "DESADV:D:01B:UN:EAN007",
  INVOIC: "INVOIC:D:01B:UN:EAN011",
} as const;

/** Escape one data element: release character first, then the separators. */
export function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[?'+:]/g, (c) => `?${c}`);
}

export interface Segment { tag: string; raw: string; meaning: string }
export interface EdiMessage { text: string; segments: Segment[]; messageCount: number }

const seg = (raw: string, meaning: string): Segment => ({ tag: raw.slice(0, 3), raw: `${raw}'`, meaning });

/** "2026-10-15T09:30:00.000Z" -> ["20261015", "0930"]; a date-only value keeps 0000. */
function dateParts(iso: string): [string, string] {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return ["00000000", "0000"];
  return [`${m[1]}${m[2]}${m[3]}`, `${m[4] ?? "00"}${m[5] ?? "00"}`];
}
const shortDate = (iso: string) => { const [d, t] = dateParts(iso); return [d.slice(2), t]; };
/** CCYYMMDD for DTM format 102, or "" when the value is not an ISO date (the compliance check reports it). */
export const ccyymmdd = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? dateParts(iso)[0] : "");

interface Envelope { type: keyof typeof MESSAGE_VERSION; ref: string; createdAt: string; from: string; to: string | null }

/** UNA + UNB, the message body between UNH and UNT, then UNZ. UNT counts UNH..UNT inclusive. */
function wrap(env: Envelope, body: Segment[]): EdiMessage {
  const [d6, t4] = shortDate(env.createdAt);
  const ref = esc(env.ref.slice(0, 14));
  const head: Segment[] = [
    { tag: "UNA", raw: "UNA:+.? '", meaning: "Separators: component :, element +, decimal ., release ?, segment '" },
    seg(`UNB+UNOC:3+${esc(env.from)}:14+${esc(env.to ?? "")}:14+${d6}:${t4}+${ref}`,
      `Interchange from GLN ${env.from} to GLN ${env.to ?? "(missing)"}, syntax UNOC version 3, reference ${env.ref}`),
    seg(`UNH+1+${MESSAGE_VERSION[env.type]}`, `Message header: ${env.type}, EANCOM 2002 (directory D.01B)`),
  ];
  const unt = seg(`UNT+${body.length + 2}+1`, `Message trailer: ${body.length + 2} segments from UNH to UNT`);
  const all = [...head, ...body, unt, seg(`UNZ+1+${ref}`, "Interchange trailer: 1 message")];
  return { text: all.map((s) => s.raw).join("\n") + "\n", segments: all, messageCount: 1 };
}

export interface EdiLine {
  sourceLineId: string; gtin: string | null; sku: string; customerItemCode?: string | null; description: string | null;
  unit: string; quantity: string; orderedQty?: string; unitPrice?: string; orderedPrice?: string; lineAmount?: string; taxRate?: string;
}
export interface EdiParty { gln: string | null; vatId?: string | null; name?: string | null }
export interface EdiParties {
  poNumber: string; currency: string | null;
  supplier: EdiParty; buyer: EdiParty;
  /** Delivery party: its GLN, and the ship-to code printed on the PO for the explanation. */
  deliveryParty: EdiParty & { printedId: string | null };
  /** Contract or EDI agreement reference (RFF+CT), when the retailer requires one. */
  contractRef?: string | null;
  /** D50: supplier's vendor number at the retailer (X12 REF*IA only). */
  vendorNumber?: string | null;
}

function nad(qual: "BY" | "SU" | "DP", p: EdiParty, label: string, withVat: boolean): Segment[] {
  const out = [seg(`NAD+${qual}+${esc(p.gln ?? "")}::9`,
    `${label}: GLN ${p.gln ?? "(missing)"}${p.name ? ` (${p.name})` : ""}, code list 9 = GS1`)];
  if (withVat && p.vatId) out.push(seg(`RFF+VA:${esc(p.vatId)}`, `${label} VAT registration number ${p.vatId}`));
  return out;
}

function parties(p: EdiParties, withVat: boolean): Segment[] {
  return [
    ...nad("BY", p.buyer, "Buyer", withVat),
    ...nad("SU", p.supplier, "Supplier", withVat),
    ...nad("DP", p.deliveryParty, `Delivery party${p.deliveryParty.printedId ? ` (PO ship-to ${p.deliveryParty.printedId})` : ""}`, false),
  ];
}

/** LIN, PIA and IMD for one item. LIN carries the GTIN (SRV); article numbers go in PIA. */
function lineItem(l: EdiLine, n: number): Segment[] {
  const out = [l.gtin
    ? seg(`LIN+${n}++${esc(l.gtin)}:SRV`, `Line ${n} (PO line ${l.sourceLineId}): GTIN ${l.gtin}`)
    : seg(`LIN+${n}`, `Line ${n} (PO line ${l.sourceLineId}): no GTIN on the order`)];
  if (l.sku) out.push(seg(`PIA+1+${esc(l.sku)}:SA::91`, `Supplier's article number ${l.sku} (assigned by the supplier)`));
  if (l.customerItemCode) {
    out.push(seg(`PIA+1+${esc(l.customerItemCode)}:IN::92`, `Buyer's item number ${l.customerItemCode} (assigned by the buyer)`));
  }
  out.push(seg(`IMD+F++:::${esc((l.description ?? "").slice(0, 35))}`, `Description: ${l.description ?? "none"}`));
  return out;
}

const orderLineRef = (po: string, l: EdiLine) =>
  seg(`RFF+ON:${esc(po)}:${esc(l.sourceLineId)}`, `Purchase order ${po}, line ${l.sourceLineId}`);

export function buildOrdrsp(o: { ref: string; createdAt: string; erpOrderId: string; orderDate: string | null } & EdiParties,
  lines: EdiLine[]): EdiMessage {
  const [d8] = dateParts(o.createdAt);
  const body: Segment[] = [
    seg(`BGM+231+${esc(o.ref)}+9`, `Order response ${o.ref} (original)`),
    seg(`DTM+137:${d8}:102`, `Response date ${d8}`),
    seg(`RFF+ON:${esc(o.poNumber)}`, `Retailer's purchase order number ${o.poNumber}`),
    seg(`RFF+VN:${esc(o.erpOrderId)}`, `Supplier's order number ${o.erpOrderId} (ERP simulator)`),
    ...parties(o, false),
    ...lines.flatMap((l, i) => [
      ...lineItem(l, i + 1),
      seg(`QTY+21:${esc(l.quantity)}`, `Confirmed quantity ${l.quantity} ${l.unit}`),
    ]),
    seg("UNS+S", "End of line items"),
    seg(`CNT+2:${lines.length}`, `${lines.length} line items`),
  ];
  return wrap({ type: "ORDRSP", ref: o.ref, createdAt: o.createdAt, from: o.supplier.gln ?? "", to: o.buyer.gln }, body);
}

// ---------- DESADV with its packing hierarchy ----------

export interface EdiCarton { sscc: string; lines: EdiLine[] }
export interface EdiPallet { sscc: string; cartons: EdiCarton[] }

export function buildDesadv(a: { ref: string; createdAt: string; despatchDate: string; estimatedDelivery: string | null } & EdiParties,
  pallets: EdiPallet[]): EdiMessage {
  const [d8] = dateParts(a.createdAt);
  const despatch = ccyymmdd(a.despatchDate);
  const eta = ccyymmdd(a.estimatedDelivery);
  const body: Segment[] = [
    seg(`BGM+351+${esc(a.ref)}+9`, `Despatch advice (ASN) ${a.ref}, original`),
    seg(`DTM+137:${d8}:102`, `Document date ${d8}`),
    seg(`DTM+11:${despatch}:102`, `Despatch date ${despatch}`),
    seg(`DTM+17:${eta}:102`, `Estimated delivery date ${eta || "(missing)"}`),
    seg(`RFF+ON:${esc(a.poNumber)}`, `Retailer's purchase order number ${a.poNumber}`),
    ...parties(a, false),
    seg("CPS+1", "Hierarchy level 1: the whole consignment"),
    seg(`PAC+${pallets.length}++201`, `${pallets.length} pallet${pallets.length === 1 ? "" : "s"} in the consignment (201 = pallet ISO 1)`),
  ];
  let level = 1;
  let lin = 0;
  for (const [pi, p] of pallets.entries()) {
    const palletLevel = ++level;
    body.push(
      seg(`CPS+${palletLevel}+1`, `Hierarchy level ${palletLevel}: pallet ${pi + 1}, inside level 1`),
      seg("PAC+1++201", "One pallet (201 = pallet ISO 1)"),
      seg("PCI+33E", "Marked with a GS1 logistic label (33E = SSCC follows)"),
      seg(`GIN+BJ+${esc(p.sscc)}`, `Pallet SSCC ${p.sscc}`),
    );
    for (const [ci, c] of p.cartons.entries()) {
      const cartonLevel = ++level;
      body.push(
        seg(`CPS+${cartonLevel}+${palletLevel}`, `Hierarchy level ${cartonLevel}: carton ${ci + 1} on pallet ${pi + 1}`),
        seg("PAC+1++CT", "One carton (CT)"),
        seg("PCI+33E", "Marked with a GS1 logistic label (33E = SSCC follows)"),
        seg(`GIN+BJ+${esc(c.sscc)}`, `Carton SSCC ${c.sscc}`),
      );
      for (const l of c.lines) {
        lin += 1;
        body.push(...lineItem(l, lin),
          seg(`QTY+12:${esc(l.quantity)}`, `Despatched quantity ${l.quantity} ${l.unit} in this carton`),
          orderLineRef(a.poNumber, l));
      }
    }
  }
  body.push(seg(`CNT+2:${lin}`, `${lin} line item${lin === 1 ? "" : "s"} (LIN segments)`));
  return wrap({ type: "DESADV", ref: a.ref, createdAt: a.createdAt, from: a.supplier.gln ?? "", to: a.buyer.gln }, body);
}

// ---------- INVOIC with tax and allowances ----------

export interface EdiAllowance {
  kind: "allowance" | "charge"; code: string; description: string; percent: string | null; amount: string; taxRate: string;
}
export interface EdiInvoiceTotals {
  lineTotal: string; taxableAmount: string; taxAmount: string; invoiceAmount: string;
  byRate: { rate: string; taxable: string; tax: string }[];
}

const taxCategory = (rate: string) => (/^0+(\.0+)?$/.test(rate) ? "Z" : "S");
// UNCL 5153 has no "SALES"; US sales tax is "LOC" (local sales taxes).
const taxCode = (t: string) => (t === "SALES" ? "LOC" : t);
const taxSeg = (taxType: string, rate: string, what: string) =>
  seg(`TAX+7+${esc(taxCode(taxType))}+++:::${esc(rate)}+${taxCategory(rate)}`,
    `${what}: ${taxType} ${rate}% (category ${taxCategory(rate) === "S" ? "S = standard rate" : "Z = zero rated"})`);

export function buildInvoic(inv: { ref: string; createdAt: string; asnRef: string; taxType: string } & EdiParties,
  lines: EdiLine[], allowances: EdiAllowance[], totals: EdiInvoiceTotals): EdiMessage {
  const [d8] = dateParts(inv.createdAt);
  const cur = inv.currency ?? "";
  const body: Segment[] = [
    seg(`BGM+380+${esc(inv.ref)}+9`, `Commercial invoice ${inv.ref}, original`),
    seg(`DTM+137:${d8}:102`, `Invoice date ${d8}`),
    seg(`RFF+ON:${esc(inv.poNumber)}`, `Retailer's purchase order number ${inv.poNumber}`),
    seg(`RFF+AAK:${esc(inv.asnRef)}`, `Despatch advice (ASN) ${inv.asnRef}`),
    ...(inv.contractRef ? [seg(`RFF+CT:${esc(inv.contractRef)}`, `Contract / EDI agreement ${inv.contractRef}`)] : []),
    ...parties(inv, true),
    seg(`CUX+2:${esc(cur)}:4`, `Invoice currency ${cur}`),
  ];
  for (const a of allowances) {
    const isA = a.kind === "allowance";
    body.push(seg(`ALC+${isA ? "A" : "C"}+++1+${esc(a.code)}`, `${isA ? "Allowance" : "Charge"} ${a.code}: ${a.description}`));
    if (a.percent !== null) body.push(seg(`PCD+3:${esc(a.percent)}`, `${a.percent}% of the lines taxed at ${a.taxRate}%`));
    body.push(seg(`MOA+${isA ? "204" : "23"}:${esc(a.amount)}`, `${isA ? "Allowance" : "Charge"} amount ${a.amount} ${cur}`));
    body.push(taxSeg(inv.taxType, a.taxRate, `Tax on the ${isA ? "allowance" : "charge"}`));
  }
  lines.forEach((l, i) => {
    body.push(...lineItem(l, i + 1),
      seg(`QTY+47:${esc(l.quantity)}`, `Invoiced quantity ${l.quantity} ${l.unit} (from the ASN)`),
      seg(`MOA+203:${esc(l.lineAmount)}`, `Line amount ${l.lineAmount} ${cur} before tax`),
      seg(`PRI+AAA:${esc(l.unitPrice)}`, `Net unit price ${l.unitPrice} ${cur} (from the order)`),
      orderLineRef(inv.poNumber, l),
      taxSeg(inv.taxType, l.taxRate ?? "", "Line tax rate"));
  });
  body.push(
    seg("UNS+S", "End of line items"),
    seg(`CNT+2:${lines.length}`, `${lines.length} line items`),
    seg(`MOA+77:${esc(totals.invoiceAmount)}`, `Invoice amount ${totals.invoiceAmount} ${cur} including tax`),
    seg(`MOA+79:${esc(totals.lineTotal)}`, `Total of line amounts ${totals.lineTotal} ${cur}`),
    seg(`MOA+125:${esc(totals.taxableAmount)}`, `Taxable amount ${totals.taxableAmount} ${cur} (lines less allowances plus charges)`),
    seg(`MOA+176:${esc(totals.taxAmount)}`, `Total tax ${totals.taxAmount} ${cur}`),
  );
  for (const r of totals.byRate) {
    body.push(taxSeg(inv.taxType, r.rate, "Tax subtotal"),
      seg(`MOA+124:${esc(r.tax)}`, `Tax at ${r.rate}%: ${r.tax} ${cur}`),
      seg(`MOA+125:${esc(r.taxable)}`, `Taxable at ${r.rate}%: ${r.taxable} ${cur}`));
  }
  return wrap({ type: "INVOIC", ref: inv.ref, createdAt: inv.createdAt, from: inv.supplier.gln ?? "", to: inv.buyer.gln }, body);
}
