// Simulated ANSI ASC X12 004010 documents for US retail (D50): 855 purchase order acknowledgement, 856 ship
// notice (ASN) and 810 invoice, sent through a simulated Trading Grid web form. Nothing is sent anywhere real.
// They take exactly the inputs of the EANCOM builders in edifact.ts, so the portal picks one by the retailer's
// rules profile. Every interchange is flagged as test data (ISA15 = T).
//
// Separators: element "*", component ">", segment "~". Values copied from documents are untrusted text: the
// separators and control characters are replaced by a space, never passed through.
// Money in X12 is decimal where the element is R (PO1/IT1 prices, SN1 quantities) and implied two decimals
// (N2, cents) in TDS and SAC amounts, as the standard defines them.
import type { ComplianceResult, Finding } from "./compliance";
import type { EdiAllowance, EdiInvoiceTotals, EdiLine, EdiMessage, EdiPallet, EdiParties, Segment } from "./edi-types";
import { isGln, isGtin, isSscc } from "./gs1";
import { Dec } from "./money";

export const X12_VERSION = "004010";
export const X12_LABEL = { ORDRSP: "X12 855 acknowledgement", DESADV: "X12 856 ship notice (ASN)", INVOIC: "X12 810 invoice" } as const;
const ST: Record<keyof typeof X12_LABEL, { st: string; gs: string }> = {
  ORDRSP: { st: "855", gs: "PR" }, DESADV: { st: "856", gs: "SH" }, INVOIC: { st: "810", gs: "IN" },
};

/** One data element: separators and control characters become spaces. */
export const xesc = (value: string | null | undefined): string =>
  (value ?? "").replace(/[\u0000-\u001f\u007f*~>^]/g, " ");

const seg = (raw: string, meaning: string): Segment => ({ tag: raw.split("*")[0], raw: `${raw}~`, meaning });

function parts(iso: string): { d8: string; d6: string; t4: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return { d8: "", d6: "", t4: "0000" };
  return { d8: `${m[1]}${m[2]}${m[3]}`, d6: `${m[1].slice(2)}${m[2]}${m[3]}`, t4: `${m[4] ?? "00"}${m[5] ?? "00"}` };
}
const d8 = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? parts(iso).d8 : "");

/** Unit of measure: CASE -> CA, EACH -> EA, else the first two letters. */
export const uom = (unit: string) => {
  const u = unit.trim().toUpperCase();
  return u === "CASE" || u === "CS" ? "CA" : u === "EACH" || u === "EA" ? "EA" : u.slice(0, 2) || "EA";
};
/** Product ID qualifier: 12 digits = UP (UPC / GTIN-12), 13 = EN (EAN / GTIN-13), 14 = UK (GTIN-14). */
const gtinQual = (g: string) => (g.length === 12 ? "UP" : g.length === 13 ? "EN" : "UK");
const cents = (amount: string) => Dec.of(amount).mul(Dec.of("100")).quantize(0, "half_up").toFixedPoint();
/** Nine-digit control number from the record number's digits (ASN-00001 -> 000000001). */
const control = (ref: string) => (ref.replace(/\D/g, "").slice(-9) || "1").padStart(9, "0");
const pad15 = (v: string) => xesc(v).slice(0, 15).padEnd(15, " ");

interface Env { kind: keyof typeof X12_LABEL; ref: string; createdAt: string; from: string; to: string | null }

/** ISA, GS and ST around the body, then SE (counts ST..SE), GE and IEA. */
function wrap(env: Env, body: Segment[]): EdiMessage {
  const { d6, d8: date, t4 } = parts(env.createdAt);
  const ctl = control(env.ref);
  const gsCtl = String(parseInt(ctl, 10));
  const { st, gs } = ST[env.kind];
  const head: Segment[] = [
    seg(`ISA*00*${" ".repeat(10)}*00*${" ".repeat(10)}*14*${pad15(env.from)}*14*${pad15(env.to ?? "")}*${d6}*${t4}*U*00401*${ctl}*0*T*>`,
      `Interchange from GLN ${env.from || "(missing)"} to GLN ${env.to ?? "(missing)"} (qualifier 14 = GS1 location), control ${ctl}, T = test data`),
    seg(`GS*${gs}*${xesc(env.from)}*${xesc(env.to ?? "")}*${date}*${t4}*${gsCtl}*X*${X12_VERSION}`,
      `Functional group ${gs}, X12 version ${X12_VERSION}`),
    seg(`ST*${st}*0001`, `Transaction set ${st}: ${X12_LABEL[env.kind]}`),
  ];
  const count = body.length + 2;
  return {
    text: [...head, ...body,
      seg(`SE*${count}*0001`, `Transaction trailer: ${count} segments from ST to SE`),
      seg(`GE*1*${gsCtl}`, "Group trailer: 1 transaction set"),
      seg(`IEA*1*${ctl}`, "Interchange trailer: 1 group")].map((s) => s.raw).join("\n") + "\n",
    segments: [...head, ...body, seg(`SE*${count}*0001`, `Transaction trailer: ${count} segments from ST to SE`),
      seg(`GE*1*${gsCtl}`, "Group trailer: 1 transaction set"), seg(`IEA*1*${ctl}`, "Interchange trailer: 1 group")],
    messageCount: 1,
  };
}

function parties(p: EdiParties): Segment[] {
  const n1 = (code: string, label: string, gln: string | null, name: string | null | undefined) =>
    seg(`N1*${code}*${xesc((name ?? label).slice(0, 60))}*UL*${xesc(gln ?? "")}`,
      `${label}: GLN ${gln ?? "(missing)"} (UL = GS1 location number)`);
  return [
    n1("BY", "Buyer", p.buyer.gln, p.buyer.name),
    n1("SU", "Supplier", p.supplier.gln, p.supplier.name),
    n1("ST", `Ship to${p.deliveryParty.printedId ? ` (PO ship-to ${p.deliveryParty.printedId})` : ""}`, p.deliveryParty.gln,
      p.deliveryParty.printedId ? `Ship-to ${p.deliveryParty.printedId}` : "Ship to"),
  ];
}

/** Product IDs for PO1, IT1 and LIN: GTIN with its qualifier, then the supplier's and buyer's item numbers. */
function ids(l: EdiLine): string {
  const out: string[] = [];
  if (l.gtin) out.push(gtinQual(l.gtin), xesc(l.gtin));
  if (l.sku) out.push("VN", xesc(l.sku));
  if (l.customerItemCode) out.push("IN", xesc(l.customerItemCode));
  return out.join("*");
}
const idText = (l: EdiLine) =>
  [l.gtin && `GTIN ${l.gtin}`, l.sku && `vendor item ${l.sku}`, l.customerItemCode && `buyer item ${l.customerItemCode}`]
    .filter(Boolean).join(", ") || "no item identifiers";

/** The supplier's vendor number at the retailer, when the retailer assigned one. */
const vendorRef = (p: EdiParties): Segment[] =>
  p.vendorNumber ? [seg(`REF*IA*${xesc(p.vendorNumber)}`, `Your vendor number at this retailer: ${p.vendorNumber}`)] : [];

/** D54: ACK code from what changed. IA accepted; IQ quantity changed; IP price changed; IC both. */
const ackCode = (l: EdiLine) => {
  const q = !Dec.of(l.quantity).eq(Dec.of(l.orderedQty ?? l.quantity));
  const p = Boolean(l.unitPrice && l.orderedPrice && !Dec.of(l.unitPrice).eq(Dec.of(l.orderedPrice)));
  return q && p ? "IC" : q ? "IQ" : p ? "IP" : "IA";
};
const ACK_TEXT: Record<string, string> = { IB: "IB = item backordered", IR: "IR = item rejected, will not ship", IA: "IA = item accepted", IQ: "IQ = quantity changed", IP: "IP = price changed",
  IC: "IC = quantity and price changed" };

export function buildOrdrspX12(o: { ref: string; createdAt: string; erpOrderId: string; orderDate: string | null;
  shipDate?: string | null } & EdiParties, lines: EdiLine[]): EdiMessage {
  const changed = lines.some((l) => ackCode(l) !== "IA" || l.schedule?.some((x) => x.code !== "IA"));
  const body: Segment[] = [
    seg(`BAK*00*${changed ? "AC" : "AK"}*${xesc(o.poNumber)}*${d8(o.orderDate)}`,
      `Acknowledges purchase order ${o.poNumber} (${changed ? "AC = acknowledged with detail and changes" : "AK = acknowledged with detail, no changes"})`),
    seg(`REF*VN*${xesc(o.erpOrderId)}`, `Supplier's order number ${o.erpOrderId} (ERP simulator)`),
    ...vendorRef(o),
    ...(o.shipDate ? [seg(`DTM*068*${d8(o.shipDate)}`, `Supplier will ship on ${o.shipDate}`)] : []),
    ...parties(o),
    ...lines.flatMap((l, i) => {
      const code = ackCode(l);
      // D61: one ACK per scheduled part, each with its ship date (ACK04 068 = current schedule ship, ACK05 the date).
      const acks = l.schedule?.length ? l.schedule.map((x) => seg(`ACK*${x.code}*${xesc(x.quantity)}*${uom(l.unit)}${x.date ? `*068*${d8(x.date)}` : ""}`,
        x.code === "IR" ? `${x.quantity} ${l.unit} will not ship (${ACK_TEXT.IR})`
          : `${x.quantity} ${l.unit} ${x.code === "IB" ? "backordered, ships" : "ships"} on ${x.date ?? "(no date)"} (${ACK_TEXT[x.code]})`)) : null;
      return [
        seg(`PO1*${i + 1}*${xesc(l.orderedQty ?? l.quantity)}*${uom(l.unit)}*${l.unitPrice ? `${xesc(l.unitPrice)}*PE` : "*"}*${ids(l)}`,
          `Line ${i + 1} (PO line ${l.sourceLineId}): ${idText(l)}${l.unitPrice ? `, unit price ${l.unitPrice}` : ""}`),
        ...(acks ?? [seg(`ACK*${code}*${xesc(l.quantity)}*${uom(l.unit)}`,
          `Confirmed ${l.quantity} ${l.unit}${code === "IP" || code === "IC" ? ` at ${l.unitPrice} (PO said ${l.orderedPrice})` : ""} (${ACK_TEXT[code]})`)]),
      ];
    }),
    seg(`CTT*${lines.length}`, `${lines.length} line items`),
  ];
  return wrap({ kind: "ORDRSP", ref: o.ref, createdAt: o.createdAt, from: o.supplier.gln ?? "", to: o.buyer.gln }, body);
}

export interface X12Shipment { carrierScac?: string | null; trackingNumber?: string | null; bolNumber?: string | null }

export function buildDesadvX12(a: { ref: string; createdAt: string; despatchDate: string; estimatedDelivery: string | null }
  & EdiParties & X12Shipment, pallets: EdiPallet[]): EdiMessage {
  const p = parts(a.createdAt);
  const body: Segment[] = [
    seg(`BSN*00*${xesc(a.ref)}*${p.d8}*${p.t4}*0001`, `Ship notice ${a.ref}, original (0001 = shipment, order, packaging, item)`),
  ];
  let hl = 0;
  const shipHl = ++hl;
  body.push(seg(`HL*${shipHl}**S`, "Level 1: shipment"));
  if (a.carrierScac) body.push(seg(`TD5**2*${xesc(a.carrierScac)}`, `Carrier SCAC ${a.carrierScac}`));
  if (a.bolNumber) body.push(seg(`REF*BM*${xesc(a.bolNumber)}`, `Bill of lading ${a.bolNumber}`));
  if (a.trackingNumber) body.push(seg(`REF*CN*${xesc(a.trackingNumber)}`, `Carrier tracking (PRO) number ${a.trackingNumber}`));
  body.push(
    seg(`DTM*011*${d8(a.despatchDate)}`, `Shipped on ${d8(a.despatchDate) || "(missing)"}`),
    seg(`DTM*017*${d8(a.estimatedDelivery)}`, `Estimated delivery ${d8(a.estimatedDelivery) || "(missing)"}`),
    ...parties(a),
  );
  const orderHl = ++hl;
  body.push(seg(`HL*${orderHl}*${shipHl}*O`, "Order level"), seg(`PRF*${xesc(a.poNumber)}`, `Purchase order ${a.poNumber}`), ...vendorRef(a));
  let items = 0;
  for (const [pi, pal] of pallets.entries()) {
    const palletHl = ++hl;
    body.push(seg(`HL*${palletHl}*${orderHl}*T`, `Pallet ${pi + 1} (T = tare)`),
      seg(`MAN*GM*${xesc(pal.sscc)}`, `Pallet SSCC ${pal.sscc} (GM = GS1-128 label)`));
    for (const [ci, c] of pal.cartons.entries()) {
      const cartonHl = ++hl;
      body.push(seg(`HL*${cartonHl}*${palletHl}*P`, `Carton ${ci + 1} on pallet ${pi + 1} (P = pack)`),
        seg(`MAN*GM*${xesc(c.sscc)}`, `Carton SSCC ${c.sscc}`));
      for (const l of c.lines) {
        items += 1;
        body.push(seg(`HL*${++hl}*${cartonHl}*I`, `Item in carton ${ci + 1}`),
          seg(`LIN**${ids(l)}`, `PO line ${l.sourceLineId}: ${idText(l)}`),
          seg(`SN1**${xesc(l.quantity)}*${uom(l.unit)}`, `Shipped ${l.quantity} ${l.unit} in this carton`));
      }
    }
  }
  body.push(seg(`CTT*${hl}`, `${hl} hierarchical levels, ${items} item level${items === 1 ? "" : "s"}`));
  return wrap({ kind: "DESADV", ref: a.ref, createdAt: a.createdAt, from: a.supplier.gln ?? "", to: a.buyer.gln }, body);
}

const SAC_CODE: Record<string, { code: string; text: string }> = {
  DI: { code: "C310", text: "discount" }, FC: { code: "D240", text: "freight" },
};

export interface X12Terms { termsText?: string | null; discountPercent?: string | null; discountDays?: number | null; netDays?: number | null;
  dueDate?: string | null }

export function buildInvoicX12(inv: { ref: string; createdAt: string; asnRef: string; taxType: string; orderDate?: string | null }
  & EdiParties & { terms?: X12Terms }, lines: EdiLine[], allowances: EdiAllowance[], totals: EdiInvoiceTotals): EdiMessage {
  const p = parts(inv.createdAt);
  const body: Segment[] = [
    seg(`BIG*${p.d8}*${xesc(inv.ref)}*${d8(inv.orderDate)}*${xesc(inv.poNumber)}`, `Invoice ${inv.ref} dated ${p.d8} for purchase order ${inv.poNumber}`),
    seg(`REF*PK*${xesc(inv.asnRef)}`, `Ship notice (ASN) ${inv.asnRef} this invoice bills`),
    ...vendorRef(inv),
    seg(`CUR*SE*${xesc(inv.currency ?? "")}`, `Currency ${inv.currency ?? "(missing)"}`),
    ...parties(inv),
  ];
  const t = inv.terms;
  if (t && (t.netDays != null || t.discountPercent)) {
    body.push(seg(`ITD*01*3*${xesc(t.discountPercent ?? "")}**${t.discountDays ?? ""}**${t.netDays ?? ""}`,
      `Payment terms ${t.termsText ?? ""}`.trim()));
    if (t.dueDate) body.push(seg(`DTM*814*${d8(t.dueDate)}`, `Payment due ${d8(t.dueDate)}`));
  }
  lines.forEach((l, i) => {
    body.push(seg(`IT1*${i + 1}*${xesc(l.quantity)}*${uom(l.unit)}*${xesc(l.unitPrice)}**${ids(l)}`,
      `Line ${i + 1} (PO line ${l.sourceLineId}): ${l.quantity} ${l.unit} at ${l.unitPrice} = ${l.lineAmount}`));
    if (l.taxRate && !Dec.of(l.taxRate).isZero()) body.push(seg(`TXI*ST**${xesc(l.taxRate)}`, `Sales tax ${l.taxRate}% on this line`));
  });
  body.push(seg(`TDS*${cents(totals.invoiceAmount)}`, `Invoice total ${totals.invoiceAmount} ${inv.currency ?? ""} (in cents)`));
  if (!Dec.of(totals.taxAmount).isZero()) body.push(seg(`TXI*ST*${xesc(totals.taxAmount)}`, `Sales tax total ${totals.taxAmount}`));
  for (const a of allowances) {
    const c = SAC_CODE[a.code] ?? { code: a.code, text: a.description };
    body.push(seg(`SAC*${a.kind === "allowance" ? "A" : "C"}*${c.code}***${cents(a.amount)}${a.percent ? `**3*${xesc(a.percent)}` : ""}`,
      `${a.kind === "allowance" ? "Allowance" : "Charge"}: ${c.text} ${a.amount}${a.percent ? ` (${a.percent}%)` : ""}`));
  }
  body.push(seg(`CTT*${lines.length}`, `${lines.length} line items`));
  return wrap({ kind: "INVOIC", ref: inv.ref, createdAt: inv.createdAt, from: inv.supplier.gln ?? "", to: inv.buyer.gln }, body);
}

// ---------- checking our own X12 before it may be sent ----------

const DTM_NAME: Record<string, string> = { "011": "Ship date", "017": "Estimated delivery date", "814": "Payment due date" };

export interface XSeg { tag: string; els: string[] }
export const parseX12 = (text: string): XSeg[] =>
  text.split("~").map((s) => s.replace(/^\s+/, "")).filter(Boolean).map((s) => { const [tag, ...els] = s.split("*"); return { tag, els }; });

interface XRule { id: string; title: string; messages: (keyof typeof X12_LABEL)[]; check: (segs: XSeg[], text: string) => string[] }
const e = (s: XSeg | undefined, i: number) => s?.els[i - 1] ?? "";
const isD8 = (d: string) => /^\d{8}$/.test(d) && !Number.isNaN(Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`));
const ALL = ["ORDRSP", "DESADV", "INVOIC"] as const;

/** Product IDs in pairs from element `from` on: [qualifier, value]. */
const idPairs = (s: XSeg, from: number) => {
  const out: [string, string][] = [];
  for (let i = from; i < s.els.length; i += 2) if (s.els[i - 1]) out.push([s.els[i - 1], s.els[i] ?? ""]);
  return out;
};

export const X12_RULES: XRule[] = [
  { id: "X12-ENVELOPE", title: "ISA is 106 characters; SE, GE and IEA counts and control numbers match", messages: [...ALL],
    check: (segs, text) => {
      const out: string[] = [];
      const isaRaw = text.split("~")[0].replace(/^\s+/, "");
      if (isaRaw.length !== 105) out.push(`ISA must be fixed width (106 characters with its terminator); it is ${isaRaw.length + 1}.`);
      const isa = segs[0]; const iea = segs.at(-1); const gs = segs[1]; const ge = segs.at(-2);
      if (isa?.tag !== "ISA" || iea?.tag !== "IEA" || e(isa, 13) !== e(iea, 2)) out.push("ISA and IEA control numbers differ.");
      if (gs?.tag !== "GS" || ge?.tag !== "GE" || e(gs, 6) !== e(ge, 2)) out.push("GS and GE control numbers differ.");
      const st = segs.findIndex((s) => s.tag === "ST"); const se = segs.findIndex((s) => s.tag === "SE");
      if (st < 0 || se < 0 || parseInt(e(segs[se], 1), 10) !== se - st + 1) out.push("SE segment count does not match ST to SE.");
      if (e(segs[st], 2) !== e(segs[se], 2)) out.push("ST and SE control numbers differ.");
      return out;
    } },
  { id: "X12-PARTIES", title: "Sender, receiver, buyer, supplier and ship-to are valid GS1 GLNs", messages: [...ALL],
    check: (segs) => {
      const out: string[] = [];
      const isa = segs[0];
      if (!isGln(e(isa, 6).trim())) out.push("Sender ID (ISA06) is not a valid GLN. Set the supplier GLN in the EDI setup.");
      if (!isGln(e(isa, 8).trim())) out.push("Receiver ID (ISA08) is not a valid GLN. Set the buyer GLN in the EDI setup.");
      for (const code of ["BY", "SU", "ST"]) {
        const n1 = segs.find((s) => s.tag === "N1" && e(s, 1) === code);
        if (!n1 || !isGln(e(n1, 4))) out.push(`${code === "ST" ? "Ship-to" : code === "BY" ? "Buyer" : "Supplier"} has no valid GLN (N1*${code}).`);
      }
      return out;
    } },
  { id: "X12-PO", title: "The retailer's purchase order number is present", messages: [...ALL],
    check: (segs) => {
      const po = e(segs.find((s) => s.tag === "BAK"), 3) || e(segs.find((s) => s.tag === "PRF"), 1) || e(segs.find((s) => s.tag === "BIG"), 4);
      return po.trim() ? [] : ["The purchase order number is missing."];
    } },
  { id: "X12-ITEM-GTIN", title: "Every item carries a valid GTIN with the matching qualifier (UP, EN or UK)", messages: [...ALL],
    check: (segs) => segs.flatMap((s) => {
      const from = s.tag === "PO1" || s.tag === "IT1" ? 6 : s.tag === "LIN" ? 2 : 0;
      if (!from) return [];
      const g = idPairs(s, from).find(([q]) => ["UP", "EN", "UK"].includes(q));
      if (!g) return [`${s.tag} ${e(s, 1) || ""}: no GTIN. US retailers match items on the UPC.`.replace("  ", " ")];
      const len = { UP: 12, EN: 13, UK: 14 }[g[0] as "UP"];
      return isGtin(g[1]) && g[1].length === len ? [] : [`${s.tag}: "${g[1]}" is not a valid ${len}-digit GTIN for qualifier ${g[0]}.`];
    }) },
  { id: "X12-DATES", title: "Dates are valid CCYYMMDD; the ASN has ship and estimated delivery dates", messages: [...ALL],
    check: (segs) => {
      const out: string[] = [];
      for (const s of segs) {
        if (s.tag === "DTM" && !isD8(e(s, 2))) out.push(`${DTM_NAME[e(s, 1)] ?? "Date"} (DTM*${e(s, 1)}) ${e(s, 2) ? `"${e(s, 2)}" is not a valid date` : "is missing"}.`);
        if (s.tag === "BIG" && !isD8(e(s, 1))) out.push("Invoice date (BIG01) is not a valid date.");
      }
      if (segs.some((s) => s.tag === "BSN")) {
        for (const q of ["011", "017"]) if (!segs.some((s) => s.tag === "DTM" && e(s, 1) === q)) out.push(`The ASN needs DTM*${q}.`);
      }
      return out;
    } },
  { id: "X12-SSCC", title: "Every pallet and carton carries a valid SSCC (MAN*GM)", messages: ["DESADV"],
    check: (segs) => {
      const out: string[] = [];
      segs.forEach((s, i) => {
        if (s.tag !== "HL" || !["T", "P"].includes(e(s, 3))) return;
        const man = segs[i + 1];
        if (man?.tag !== "MAN" || e(man, 1) !== "GM" || !isSscc(e(man, 2))) out.push(`HL ${e(s, 1)}: missing or invalid SSCC.`);
      });
      return out;
    } },
  { id: "X12-HL-COUNT", title: "CTT counts the line items (HL levels on the ASN)", messages: [...ALL],
    check: (segs) => {
      const ctt = parseInt(e(segs.find((s) => s.tag === "CTT"), 1), 10);
      const n = segs.some((s) => s.tag === "BSN") ? segs.filter((s) => s.tag === "HL").length
        : segs.filter((s) => s.tag === "PO1" || s.tag === "IT1").length;
      return ctt === n ? [] : [`CTT says ${Number.isNaN(ctt) ? "nothing" : ctt}; the document has ${n}.`];
    } },
  { id: "X12-TOTAL", title: "TDS equals the lines less allowances plus charges plus tax, in cents", messages: ["INVOIC"],
    check: (segs) => {
      let t = Dec.ZERO;
      for (const s of segs) {
        if (s.tag === "IT1") t = t.add(Dec.of(e(s, 2) || "0").mul(Dec.of(e(s, 4) || "0")).quantize(-2, "half_up"));
        if (s.tag === "SAC") t = t.add(Dec.of(e(s, 5) || "0").div(Dec.of("100")).mul(Dec.of(e(s, 1) === "A" ? "-1" : "1")));
      }
      const tax = segs.filter((s) => s.tag === "TXI" && e(s, 2)).reduce((x, s) => x.add(Dec.of(e(s, 2))), Dec.ZERO);
      const expect = cents(t.add(tax).toFixedPoint());
      const tds = e(segs.find((s) => s.tag === "TDS"), 1);
      return tds === expect ? [] : [`TDS is ${tds || "(missing)"}; the lines, allowances, charges and tax give ${expect} cents.`];
    } },
];

export function checkX12(kind: keyof typeof X12_LABEL, text: string): ComplianceResult {
  const segs = parseX12(text);
  const rules = X12_RULES.filter((r) => r.messages.includes(kind));
  const findings: Finding[] = [];
  let passed = 0;
  for (const r of rules) {
    const fails = r.check(segs, text);
    if (fails.length === 0) { passed += 1; continue; }
    findings.push(...fails.map((t) => ({ ruleId: r.id, severity: "block" as const, text: t, basis: "inferred" as const, sources: [] })));
  }
  return { profile: "x12_retail", kind, rulesChecked: rules.length, rulesPassed: passed, findings };
}
