// Simulated EDIFACT D.96A messages for the supplier portal (D45): ORDRSP (order confirmation), DESADV
// (despatch advice / ASN) and INVOIC (invoice). Nothing here is sent anywhere real.
//
// Deterministic: the output depends only on the inputs (dates come from the records, never the clock).
// Every value copied from a document is untrusted text, so the EDIFACT release characters ? ' + : are
// escaped with "?" and control characters (line breaks included) are replaced by a space.

/** Fictional GLNs. The 02 prefix is GS1 "restricted circulation", so these can never clash with a real company. */
export const FICTIONAL_GLN = {
  supplier: gln("020000000001"),
  retailer: gln("020000000002"),
} as const;
export const FICTIONAL_LABEL = "FICTIONAL GLN, simulated EDI - not sent to any real partner";

/** A 13-digit GLN from 12 digits plus the GS1 mod-10 check digit. */
export function gln(twelve: string): string {
  if (!/^\d{12}$/.test(twelve)) throw new Error("GLN body must be 12 digits");
  const sum = [...twelve].reduce((t, c, i) => t + "0123456789".indexOf(c) * (i % 2 === 0 ? 1 : 3), 0);
  return twelve + String((10 - (sum % 10)) % 10);
}

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

interface Envelope { type: "ORDRSP" | "DESADV" | "INVOIC"; ref: string; createdAt: string }

/** UNA + UNB, the message body between UNH and UNT, then UNZ. UNT counts UNH..UNT inclusive. */
function wrap(env: Envelope, body: Segment[]): EdiMessage {
  const [d6, t4] = shortDate(env.createdAt);
  const ref = esc(env.ref.slice(0, 14));
  const head: Segment[] = [
    { tag: "UNA", raw: "UNA:+.? '", meaning: "Separators: component :, element +, decimal ., release ?, segment '" },
    seg(`UNB+UNOC:3+${FICTIONAL_GLN.supplier}:14+${FICTIONAL_GLN.retailer}:14+${d6}:${t4}+${ref}`,
      `Interchange from supplier ${FICTIONAL_GLN.supplier} to retailer ${FICTIONAL_GLN.retailer} (both fictional), reference ${env.ref}`),
    seg(`UNH+1+${env.type}:D:96A:UN:EAN008`, `Message header: ${env.type}, EDIFACT directory D.96A`),
  ];
  const unt = seg(`UNT+${body.length + 2}+1`, `Message trailer: ${body.length + 2} segments from UNH to UNT`);
  const all = [...head, ...body, unt, seg(`UNZ+1+${ref}`, "Interchange trailer: 1 message")];
  return { text: all.map((s) => s.raw).join("\n") + "\n", segments: all, messageCount: 1 };
}

export interface EdiLine {
  sourceLineId: string; gtin: string | null; sku: string; description: string | null; unit: string;
  quantity: string; orderedQty?: string; unitPrice?: string; lineAmount?: string;
}
export interface EdiParties { poNumber: string; customerName: string | null; shipTo: string | null; currency: string | null }

function parties(p: EdiParties): Segment[] {
  return [
    seg(`RFF+ON:${esc(p.poNumber)}`, `Retailer's purchase order number ${p.poNumber}`),
    seg(`NAD+BY+${FICTIONAL_GLN.retailer}::9`, `Buyer: ${p.customerName ?? "retailer"} (fictional GLN)`),
    seg(`NAD+SU+${FICTIONAL_GLN.supplier}::9`, "Supplier: this portal's supplier (fictional GLN)"),
    ...(p.shipTo ? [seg(`NAD+DP+${esc(p.shipTo)}::92`, `Deliver to retailer location ${p.shipTo}`)] : []),
  ];
}

function lineItem(l: EdiLine, n: number): Segment[] {
  return [
    seg(`LIN+${n}++${esc(l.gtin ?? l.sku)}:${l.gtin ? "SRV" : "SA"}`, `Line ${n} (PO line ${l.sourceLineId}): item ${l.gtin ?? l.sku}`),
    seg(`PIA+1+${esc(l.sku)}:SA`, `Supplier article number ${l.sku}`),
    seg(`IMD+F++:::${esc((l.description ?? "").slice(0, 70))}`, `Description: ${l.description ?? "none"}`),
  ];
}

export function buildOrdrsp(o: { ref: string; createdAt: string; erpOrderId: string; orderDate: string | null } & EdiParties,
  lines: EdiLine[]): EdiMessage {
  const [d8] = dateParts(o.createdAt);
  const body: Segment[] = [
    seg(`BGM+231+${esc(o.ref)}+9`, `Order response ${o.ref} (original)`),
    seg(`DTM+137:${d8}:102`, `Response date ${d8}`),
    seg(`RFF+VN:${esc(o.erpOrderId)}`, `Supplier's order number ${o.erpOrderId} (ERP simulator)`),
    ...parties(o),
    ...lines.flatMap((l, i) => [
      ...lineItem(l, i + 1),
      seg(`QTY+21:${esc(l.quantity)}:${esc(l.unit)}`, `Confirmed quantity ${l.quantity} ${l.unit}`),
    ]),
    seg("UNS+S", "End of line items"),
    seg(`CNT+2:${lines.length}`, `${lines.length} line items`),
  ];
  return wrap({ type: "ORDRSP", ref: o.ref, createdAt: o.createdAt }, body);
}

export function buildDesadv(a: { ref: string; createdAt: string } & EdiParties, lines: EdiLine[]): EdiMessage {
  const [d8] = dateParts(a.createdAt);
  const body: Segment[] = [
    seg(`BGM+351+${esc(a.ref)}+9`, `Despatch advice (ASN) ${a.ref}`),
    seg(`DTM+137:${d8}:102`, `Document date ${d8}`),
    seg(`DTM+11:${d8}:102`, `Despatch date ${d8}`),
    ...parties(a),
    seg("CPS+1", "Shipment level 1 (whole shipment)"),
    ...lines.flatMap((l, i) => [
      ...lineItem(l, i + 1),
      seg(`QTY+12:${esc(l.quantity)}:${esc(l.unit)}`, `Shipped quantity ${l.quantity} ${l.unit}`),
      ...(l.orderedQty !== undefined ? [seg(`QTY+21:${esc(l.orderedQty)}:${esc(l.unit)}`, `Ordered quantity ${l.orderedQty} ${l.unit}`)] : []),
    ]),
    seg(`CNT+2:${lines.length}`, `${lines.length} line items`),
  ];
  return wrap({ type: "DESADV", ref: a.ref, createdAt: a.createdAt }, body);
}

export function buildInvoic(inv: { ref: string; createdAt: string; asnRef: string; subtotal: string; total: string } & EdiParties,
  lines: EdiLine[]): EdiMessage {
  const [d8] = dateParts(inv.createdAt);
  const cur = esc(inv.currency ?? "");
  const body: Segment[] = [
    seg(`BGM+380+${esc(inv.ref)}+9`, `Commercial invoice ${inv.ref}`),
    seg(`DTM+137:${d8}:102`, `Invoice date ${d8}`),
    seg(`RFF+AAK:${esc(inv.asnRef)}`, `Despatch advice (ASN) ${inv.asnRef}`),
    ...parties(inv),
    seg(`CUX+2:${cur}:4`, `Invoice currency ${inv.currency}`),
    ...lines.flatMap((l, i) => [
      ...lineItem(l, i + 1),
      seg(`QTY+47:${esc(l.quantity)}:${esc(l.unit)}`, `Invoiced quantity ${l.quantity} ${l.unit} (from the ASN)`),
      seg(`MOA+203:${esc(l.lineAmount)}`, `Line amount ${l.lineAmount} ${inv.currency}`),
      seg(`PRI+AAA:${esc(l.unitPrice)}`, `Net unit price ${l.unitPrice} ${inv.currency} (from the order)`),
    ]),
    seg("UNS+S", "End of line items"),
    seg(`CNT+2:${lines.length}`, `${lines.length} line items`),
    seg(`MOA+79:${esc(inv.subtotal)}`, `Total of line amounts ${inv.subtotal} ${inv.currency}`),
    seg(`MOA+86:${esc(inv.total)}`, `Invoice total ${inv.total} ${inv.currency} (tax not calculated by the simulator)`),
  ];
  return wrap({ type: "INVOIC", ref: inv.ref, createdAt: inv.createdAt }, body);
}
